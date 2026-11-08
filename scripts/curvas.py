"""Learning curves: train one network at a time and watch it epoch by epoch.

For every network and horizon, the configuration that won the tuning is
trained once with all the data before the test (the same split, embargo and
early-stopping rule as the final model), printing a line per epoch, Keras
style. The test is never touched.

Two errors are shown per epoch, both relative to the naive forecast
("the price in h days will be today's"), so 1 is the naive level and
below 1 beats it:
    train  error on the data the network learns from
    val    error on the last 15 % of the training period, which the network
           never learns from; early stopping watches this one

Outputs (per network and horizon), read by notebook 08:
    reports/results/ronda_N/curvas/<red>_h<h>.csv    one row per epoch
    reports/results/ronda_N/curvas/<red>_h<h>.json   configuration and summary

Usage:
    poetry run python scripts/curvas.py                          # the 9 networks
    poetry run python scripts/curvas.py --red lstm --horizonte 63
    poetry run python scripts/curvas.py --ventana 60             # force the input window
"""

import argparse
import json
import time
from dataclasses import replace
from pathlib import Path

import numpy as np
import pandas as pd

from oil_forecast.config import (
    CURRENT_ROUND,
    HORIZONS,
    ROUNDS,
    TEST_START,
    TUNED_ROUND,
    results_dir,
    tuning_dir,
)
from oil_forecast.models import CELLS
from oil_forecast.splits import train_test_split
from oil_forecast.training import (
    TrainConfig,
    early_stopping_split,
    fit,
    load_model_data,
    prepare,
)

MODEL_NAMES = {"rnn": "RNN simple", "lstm": "LSTM", "gru": "GRU"}
HORIZON_NAMES = {5: "1 semana", 63: "3 meses", 252: "1 año"}


def tuned_config(cell: str, horizon: int, round_: int) -> tuple[TrainConfig, dict]:
    """Winner of the tuning used by ``round_``."""
    path = tuning_dir(TUNED_ROUND[round_]) / f"{cell}_h{horizon}_best.json"
    best = json.loads(path.read_text())
    return TrainConfig(**best["params"]), best


def relative(mse: float, naive_mse: float) -> float:
    """RMSE relative to the naive forecast (1 = naive, below 1 beats it)."""
    return float(np.sqrt(mse / naive_mse))


def describe(cfg: TrainConfig) -> str:
    return (f"ventana {cfg.window} días · {cfg.hidden_size} neuronas × {cfg.num_layers} capa(s) · "
            f"dropout {cfg.dropout:.2f} · lr {cfg.lr:.1e} · lote {cfg.batch_size} · "
            f"weight decay {cfg.weight_decay:.1e} · pérdida {cfg.loss.upper()}")


def run_one(data, cell: str, horizon: int, round_: int, window: int | None, seed: int,
            max_epochs: int | None, out_dir) -> dict:
    cfg, best = tuned_config(cell, horizon, round_)
    if window is not None:
        cfg = replace(cfg, window=window)
    if max_epochs is not None:
        cfg = replace(cfg, max_epochs=max_epochs)

    train_pos, test_pos = train_test_split(data.index, horizon, TEST_START)
    p = prepare(data, horizon, train_pos, test_pos[:1], cfg.window)
    fit_pos, es_pos = early_stopping_split(train_pos, horizon)
    fit_pos = fit_pos[fit_pos >= cfg.window - 1]

    # The naive forecast is a zero return; in the standardised target scale that is -mean/std
    naive_z = -p["y_mean"] / p["y_std"]
    naive_fit = float(np.mean((p["y_fit"] - naive_z) ** 2))
    naive_es = float(np.mean((p["y_es"] - naive_z) ** 2))

    name = f"{MODEL_NAMES[cell]} · {HORIZON_NAMES[horizon]} ({horizon} d)"
    day = lambda pos: data.index[pos].strftime("%Y-%m")
    print(f"\n{'=' * 78}\n{name}\n{'=' * 78}")
    print(f"Configuración: {describe(cfg)}")
    print(f"Aprende con:   {day(fit_pos[0])} → {day(fit_pos[-1])}  ({len(p['y_fit']):,} ejemplos)")
    print(f"Valida con:    {day(es_pos[0])} → {day(es_pos[-1])}  ({len(p['y_es']):,} ejemplos, no aprende de ellos)")
    print("Error relativo al ingenuo: 1 = igual que 'el precio no cambia', por debajo de 1 = mejor\n")

    history = []

    def on_epoch(e: dict) -> None:
        row = {**e, "train_rel": relative(e["train_mse"], naive_fit), "val_rel": relative(e["val_mse"], naive_es)}
        history.append(row)
        mark = "★ mejor hasta ahora" if e["best"] else f"  sin mejorar {e['wait']:>2}/{cfg.patience}"
        print(f"Época {e['epoch']:>3}/{cfg.max_epochs} │ train {row['train_rel']:.4f} │ "
              f"val {row['val_rel']:.4f} │ {mark} │ {e['elapsed_s']:6.1f} s", flush=True)

    _, info = fit(cell, cfg, p, seed=seed, on_epoch=on_epoch)
    hist = pd.DataFrame(history)
    best_row = hist.loc[hist["epoch"] == info["best_epoch"]].iloc[0]
    stopped = "parada temprana" if info["epochs"] < cfg.max_epochs else "máximo de épocas"
    print(f"\n→ Fin en la época {info['epochs']} ({stopped}). Se queda con la época {info['best_epoch']}: "
          f"train {best_row['train_rel']:.4f} · val {best_row['val_rel']:.4f}. "
          f"{info['n_params']:,} parámetros, {info['train_time_s']:.1f} s "
          f"({info['train_time_s'] / info['epochs']:.2f} s por época).")

    stem = f"{cell}_h{horizon}"
    hist.to_csv(out_dir / f"{stem}.csv", index=False)
    summary = {
        "red": MODEL_NAMES[cell], "cell": cell, "h": horizon, "horizonte": HORIZON_NAMES[horizon],
        "ronda_ajuste": TUNED_ROUND[round_], "semilla": seed, "config": cfg.to_dict(),
        "n_params": info["n_params"], "epocas": info["epochs"], "mejor_epoca": info["best_epoch"],
        "tiempo_s": info["train_time_s"], "train_rel_mejor": float(best_row["train_rel"]),
        "val_rel_mejor": float(best_row["val_rel"]), "val_rel_ajuste": best.get("value"),
        "periodo_aprende": [day(fit_pos[0]), day(fit_pos[-1])], "periodo_valida": [day(es_pos[0]), day(es_pos[-1])],
        "n_aprende": len(p["y_fit"]), "n_valida": len(p["y_es"]),
    }
    (out_dir / f"{stem}.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False))
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--red", nargs="+", choices=list(CELLS), default=list(CELLS))
    parser.add_argument("--horizonte", nargs="+", type=int, choices=list(HORIZONS.values()),
                        default=list(HORIZONS.values()))
    parser.add_argument("--round", type=int, choices=ROUNDS, default=CURRENT_ROUND,
                        help="ronda cuyas configuraciones ajustadas se usan")
    parser.add_argument("--ventana", type=int, default=None, help="fuerza la misma ventana en todas las redes")
    parser.add_argument("--semilla", type=int, default=0)
    parser.add_argument("--max-epocas", type=int, default=None, help="solo para pruebas rápidas")
    parser.add_argument("--salida", default=None, help="carpeta de salida (por defecto reports/results/ronda_N/curvas)")
    args = parser.parse_args()

    out_dir = results_dir(args.round) / "curvas" if args.salida is None else Path(args.salida)
    out_dir.mkdir(parents=True, exist_ok=True)
    data = load_model_data()
    start = time.perf_counter()
    done = [run_one(data, cell, h, args.round, args.ventana, args.semilla, args.max_epocas, out_dir)
            for h in args.horizonte for cell in args.red]

    print(f"\n{'=' * 78}\nResumen (error relativo al ingenuo en la mejor época)\n{'=' * 78}")
    for s in done:
        print(f"{s['red']:<11} {s['horizonte']:<9} │ mejor época {s['mejor_epoca']:>3} de {s['epocas']:>3} │ "
              f"train {s['train_rel_mejor']:.3f} │ val {s['val_rel_mejor']:.3f} │ {s['tiempo_s']:6.1f} s")
    print(f"\nTotal: {(time.perf_counter() - start) / 60:.1f} min. Resultados en {out_dir}")


if __name__ == "__main__":
    main()
