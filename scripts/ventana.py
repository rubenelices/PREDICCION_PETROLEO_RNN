"""Round 5, step 1: the input window of each horizon, the same for the three networks.

The assignment requires RNN, LSTM and GRU to share the same input window, so
the window is chosen before tuning the networks, separately for each horizon.

Protocol (fixed before running it):
    - Windows: 20, 60 and 120 business days (plus 250 for the 1-year horizon).
    - Every network uses the same default configuration (the first trial of
      every search, ``DEFAULT_TRIAL`` in tune.py), so only the window changes.
    - Walk-forward on the validation years 2019-2023 (never the test), 3 seeds
      per network; the forecast of a network is the mean of its 3 seeds.
    - Score of a window = mean over the three networks of their mean relative
      RMSE over the years (1 = naive forecast, below 1 beats it).
    - Decision: the shortest window whose score is within 0.005 of the best
      one (differences smaller than that are seed noise; shorter is cheaper).

Outputs in reports/results/ronda_5/ventana/:
    por_año.csv        relative RMSE per window, network, seed and year
    resumen.csv        score per window and network (and the mean of the three)
    decision.json      chosen window per horizon, with the rule and the scores

Usage:
    poetry run python scripts/ventana.py [--nucleos N]
"""

import argparse
import json
from concurrent.futures import ProcessPoolExecutor

import numpy as np
import pandas as pd

from oil_forecast.config import HORIZONS, TEST_START, VAL_YEARS, n_workers, results_dir
from oil_forecast.metrics import rmse
from oil_forecast.models import CELLS
from oil_forecast.splits import walk_forward_folds
from oil_forecast.training import TrainConfig, fit, load_model_data, predict, prepare

ROUND = 5
WINDOWS = {5: (20, 60, 120), 63: (20, 60, 120), 252: (20, 60, 120, 250)}
SEEDS = (0, 1, 2)
TOLERANCE = 0.005
# Same as DEFAULT_TRIAL in scripts/tune.py
BASE = TrainConfig(hidden_size=32, num_layers=1, dropout=0.2, lr=1e-3, batch_size=128,
                   weight_decay=1e-5, loss="mse")
MODEL_NAMES = {"rnn": "RNN simple", "lstm": "LSTM", "gru": "GRU"}
H_NAMES = {5: "1 semana", 63: "3 meses", 252: "1 año"}


def window_job(cell: str, horizon: int, window: int) -> pd.DataFrame:
    """Relative RMSE per year of one network with one window (each seed and their mean)."""
    data = load_model_data()
    cfg = TrainConfig(**{**BASE.to_dict(), "window": window})
    rows = []
    for fold in walk_forward_folds(data.index, horizon, VAL_YEARS, TEST_START):
        p = prepare(data, horizon, fold.train, fold.val, window)
        pos = p["eval_pos"]
        true, today = data.price[pos + horizon], data.price[pos]
        naive = rmse(true, today)
        preds = []
        for seed in SEEDS:
            model, info = fit(cell, cfg, p, seed=seed)
            preds.append(predict(model, p))
            rows.append({"h": horizon, "ventana": window, "red": MODEL_NAMES[cell], "semilla": seed,
                         "año": int(fold.name), "rmse_relativo": rmse(true, today * np.exp(preds[-1])) / naive,
                         "mejor_epoca": info["best_epoch"], "tiempo_s": info["train_time_s"]})
        rel = rmse(true, today * np.exp(np.mean(preds, axis=0))) / naive
        rows.append({"h": horizon, "ventana": window, "red": MODEL_NAMES[cell], "semilla": "media",
                     "año": int(fold.name), "rmse_relativo": rel})
        print(f"  {MODEL_NAMES[cell]:<11} {H_NAMES[horizon]:<9} ventana {window:>3}  año {fold.name}: "
              f"error relativo {rel:.3f}", flush=True)
    return pd.DataFrame(rows)


def decide(summary: pd.DataFrame) -> dict:
    """Shortest window within TOLERANCE of the best mean score, per horizon."""
    decision = {}
    for h, g in summary.groupby("h"):
        score = g.set_index("ventana")["media_3_redes"].sort_index()
        best = score.min()
        chosen = int(score[score <= best + TOLERANCE].index.min())
        decision[str(h)] = {
            "horizonte": H_NAMES[h], "ventana": chosen, "mejor_ventana_sin_desempate": int(score.idxmin()),
            "puntuaciones": {str(w): round(float(s), 4) for w, s in score.items()},
            "preferida_por_cada_red": {r: int(g.set_index("ventana")[r].idxmin()) for r in MODEL_NAMES.values()},
        }
    return decision


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--nucleos", type=int, default=None,
                        help="máximo de procesos a la vez (menos = más lento pero se calienta menos)")
    args = parser.parse_args()

    # Longest windows and slowest networks first so the pool stays busy until the end
    jobs = sorted(((c, h, w) for c in CELLS for h in HORIZONS.values() for w in WINDOWS[h]),
                  key=lambda j: (-j[2], ["lstm", "gru", "rnn"].index(j[0])))
    print(f"{len(jobs)} combinaciones (red × horizonte × ventana), {len(SEEDS)} semillas, "
          f"{n_workers(len(jobs), args.nucleos)} procesos a la vez\n", flush=True)
    with ProcessPoolExecutor(max_workers=n_workers(len(jobs), args.nucleos)) as pool:
        per_year = pd.concat(pool.map(window_job, *zip(*jobs)))

    ens = per_year[per_year.semilla == "media"]
    summary = ens.pivot_table(index=["h", "ventana"], columns="red", values="rmse_relativo", aggfunc="mean")
    summary = summary[list(MODEL_NAMES.values())]
    summary["media_3_redes"] = summary.mean(axis=1)
    seeds = per_year[per_year.semilla != "media"]
    # Seed noise: spread of each network's score across its seeds, averaged over the networks
    per_seed = seeds.groupby(["h", "ventana", "red", "semilla"])["rmse_relativo"].mean()
    summary["desv_entre_semillas"] = per_seed.groupby(["h", "ventana", "red"]).std().groupby(["h", "ventana"]).mean()
    summary = summary.reset_index()
    decision = decide(summary)

    out = results_dir(ROUND) / "ventana"
    out.mkdir(parents=True, exist_ok=True)
    per_year.to_csv(out / "por_año.csv", index=False)
    summary.to_csv(out / "resumen.csv", index=False)
    rule = (f"Por horizonte, la ventana más corta cuya media de las tres redes queda a menos de {TOLERANCE} "
            "de la mejor. Configuración por defecto para las tres redes, 3 semillas, validación 2019-2023.")
    (out / "decision.json").write_text(json.dumps({"regla": rule, "horizontes": decision}, indent=2,
                                                  ensure_ascii=False))

    print(f"\nError relativo medio 2019-2023 (media de {len(SEEDS)} semillas; 1 = ingenuo)")
    for h, g in summary.groupby("h"):
        print(f"\n== {H_NAMES[h]} ({h} d)")
        print(g.drop(columns="h").set_index("ventana").round(3).to_string())
        d = decision[str(h)]
        print(f"→ Ventana elegida: {d['ventana']} días"
              + ("" if d["ventana"] == d["mejor_ventana_sin_desempate"]
                 else f" (la mejor era {d['mejor_ventana_sin_desempate']}, pero la diferencia es ruido)"))
    print(f"\nResultados en {out}")


if __name__ == "__main__":
    main()
