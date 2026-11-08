"""Final training of RNN, LSTM and GRU, in separate stages.

Each network is an ensemble of trained models ("members"). What the members
are depends on the variant of the round (see ``VARIANTS`` in config.py):
    base            the tuned winner, 5 seeds                  (rounds 1-2)
    top5            the 5 best configurations of the search, 1 seed each
    recientes       the tuned winner, recent years weigh more, 5 seeds
    lineal          the tuned winner + a linear model in parallel, 5 seeds
    top5_lineal     top5, each with a linear model in parallel
    top5_x2         top5 with 2 seeds per configuration (10 models)
    top5_menos_var  top5 with only the variables that help (see ``importancia``)

Stage ``importancia`` (round 4, before ``validacion``; never touches the test):
    Permutation importance of every input variable on the validation years:
    the RNN top-5 of each horizon is trained on every fold, then each variable
    is shuffled in turn and the increase of the relative RMSE is measured.
    Variables whose shuffling does not hurt are dropped.
    Outputs: importancia_variables.csv, variables_seleccionadas.json

Stage ``validacion`` (never touches the test):
    The members are retrained on every walk-forward fold. The out-of-fold
    predictions (mean of the members) are used to
      - measure the validation error of the final protocol;
      - choose, for every model, the weight ``w`` in [0, 1] of the
        "adjusted" forecast  w * network  (w = 0 is the naive forecast), which
        shrinks networks with little signal towards the naive forecast.
        Two criteria: best mean over the years ("ajustada") and best worst
        year ("prudente");
      - build the combination of the three networks (mean of their forecasts).
    Outputs: validacion_resumen.csv, predicciones_validacion.csv, pesos.json,
             pesos_prudentes.json

Stage ``test`` (run once, after reviewing the validation):
    Every model of the variants kept for the test (``TEST_VARIANTS``) is
    trained on all data before 2024 (same embargo and early-stopping rule)
    and evaluated on the hold-out test with the weights chosen in validation.
    The final model is written down beforehand (modelo_final.json).
    Outputs: comparativa.csv, metricas_por_semilla.csv, predicciones_test.csv

All outputs go to reports/results/ronda_N/.

Usage:
    poetry run python scripts/train.py importancia [--round N]
    poetry run python scripts/train.py validacion [--round N]
    poetry run python scripts/train.py test [--round N]
    add --nucleos N to cap the processes running at once (cooler, slower)
"""

import argparse
import json
from concurrent.futures import ProcessPoolExecutor
from dataclasses import replace

import numpy as np
import pandas as pd

from oil_forecast import baselines
from oil_forecast.config import (
    CURRENT_ROUND,
    FINAL_SEEDS,
    HALF_LIFE_DAYS,
    HORIZONS,
    N_TRIALS,
    ROUNDS,
    TEST_START,
    TEST_VARIANTS,
    TOP_K,
    TUNED_ROUND,
    VAL_YEARS,
    VARIANTS,
    n_workers,
    results_dir,
    tuning_dir,
)
from oil_forecast.metrics import evaluate_forecast, rmse
from oil_forecast.models import CELLS
from oil_forecast.splits import train_test_split, walk_forward_folds
from oil_forecast.training import TrainConfig, fit, load_model_data, predict, prepare

MODEL_NAMES = {"rnn": "RNN simple", "lstm": "LSTM", "gru": "GRU"}
VARIANT_LABELS = {
    "base": "", "top5": " · top-5", "recientes": " · recientes", "lineal": " · lineal",
    "top5_lineal": " · top-5 + lineal", "top5_x2": " · top-5 x2 semillas", "top5_menos_var": " · top-5 menos variables",
}
N_PERMUTATIONS = 3
COMBINATION = "Combinación"
ADJUSTED = " ajustada"
PRUDENT = " prudente"
WEIGHT_GRID = np.round(np.linspace(0, 1, 21), 2)


def model_name(cell_or_combo: str, variant: str) -> str:
    return MODEL_NAMES.get(cell_or_combo, cell_or_combo) + VARIANT_LABELS[variant]


def best_config(cell: str, horizon: int, round_: int) -> tuple[TrainConfig, dict]:
    path = tuning_dir(TUNED_ROUND[round_]) / f"{cell}_h{horizon}_best.json"
    best = json.loads(path.read_text())
    return TrainConfig(**best["params"]), best


INT_PARAMS = ("hidden_size", "num_layers", "batch_size", "window")


def top_configs(cell: str, horizon: int, round_: int, k: int, window: int | None = None) -> list[TrainConfig]:
    """The ``k`` best distinct configurations within the tuning budget.

    Read from the exported trials CSV (versioned in the repository), so the
    Optuna databases are not needed. ``window``: the study of that window
    (round 5 searches with a fixed window per study).
    """
    tuned = TUNED_ROUND[round_]
    name = f"{cell}_h{horizon}" + (f"_v{window}" if window else "")
    trials = pd.read_csv(tuning_dir(tuned) / f"{name}_trials.csv").sort_values("number")
    finished = trials[trials["state"].isin(["COMPLETE", "PRUNED"])].head(N_TRIALS[tuned])
    complete = finished[finished["state"] == "COMPLETE"].sort_values("value", kind="stable")
    configs = []
    for _, t in complete.iterrows():
        params = {c.removeprefix("params_"): t[c] for c in trials.columns
                  if c.startswith("params_") and pd.notna(t[c])}
        params = {p: int(v) if p in INT_PARAMS else v for p, v in params.items()}
        if window:
            params["window"] = window
        cfg = TrainConfig(**params)
        if cfg not in configs:
            configs.append(cfg)
    return configs[:k]


def selected_features(horizon: int, round_: int) -> tuple[str, ...]:
    path = results_dir(round_) / "variables_seleccionadas.json"
    if not path.exists():
        raise SystemExit("Falta variables_seleccionadas.json: ejecuta antes `scripts/train.py importancia`.")
    return tuple(json.loads(path.read_text())[str(horizon)])


def members(cell: str, horizon: int, round_: int, variant: str) -> list[tuple[TrainConfig, int]]:
    """(configuration, seed) of the models whose mean is the network's forecast."""
    if variant.startswith("top5"):
        configs = top_configs(cell, horizon, round_, TOP_K)
        if variant == "top5_lineal":
            configs = [replace(c, linear_skip=True) for c in configs]
        elif variant == "top5_menos_var":
            feats = selected_features(horizon, round_)
            configs = [replace(c, features=feats) for c in configs]
        seeds_per_config = 2 if variant == "top5_x2" else 1
        return [(c, i + len(configs) * k) for k in range(seeds_per_config) for i, c in enumerate(configs)]
    cfg, _ = best_config(cell, horizon, round_)
    if variant == "recientes":
        cfg = replace(cfg, half_life=HALF_LIFE_DAYS)
    elif variant == "lineal":
        cfg = replace(cfg, linear_skip=True)
    return [(cfg, seed) for seed in FINAL_SEEDS]


def fit_members(data, cell: str, horizon: int, mem, train_pos, eval_pos):
    """Train every member; returns (eval positions, predictions, infos)."""
    cache, preds, infos, pos = {}, [], [], None
    for cfg, seed in mem:
        key = (cfg.window, cfg.features)
        if key not in cache:
            cache[key] = prepare(data, horizon, train_pos, eval_pos, cfg.window, cfg.features)
        p = cache[key]
        assert pos is None or np.array_equal(pos, p["eval_pos"])
        pos = p["eval_pos"]
        model, info = fit(cell, cfg, p, seed=seed)
        preds.append(predict(model, p))
        infos.append({**info, "semilla": seed, "ventana": cfg.window})
    return pos, preds, infos


def relative_rmse_by_year(price, horizon: int, origins, years, log_ret) -> pd.Series:
    """RMSE(model) / RMSE(naive) in USD for each validation year."""
    true, today = price[origins + horizon], price[origins]
    pred = today * np.exp(log_ret)
    out = {}
    for year in np.unique(years):
        m = years == year
        out[int(year)] = rmse(true[m], pred[m]) / rmse(true[m], today[m])
    return pd.Series(out)


def choose_weight(price, horizon: int, origins, years, log_ret, criterion: str = "media") -> tuple[float, float]:
    """Weight w in [0, 1] of the adjusted forecast (ties -> smaller w).

    ``media``: best mean relative RMSE over the years.
    ``prudente``: best worst year (the weight that is safest every year).
    Returns the weight and the mean relative RMSE it gives.
    """
    by_year = [relative_rmse_by_year(price, horizon, origins, years, w * log_ret) for w in WEIGHT_GRID]
    scores = [s.mean() if criterion == "media" else s.max() for s in by_year]
    i = int(np.argmin(np.round(scores, 6)))
    return float(WEIGHT_GRID[i]), float(by_year[i].mean())


def choose_ridge_alpha(data, horizon: int) -> float:
    """Alpha with the best mean relative RMSE on the walk-forward folds."""
    folds = walk_forward_folds(data.index, horizon, VAL_YEARS, TEST_START)
    prepared = [prepare(data, horizon, f.train, f.val) for f in folds]
    scores = {}
    for alpha in baselines.RIDGE_ALPHAS:
        rel = []
        for p in prepared:
            pos = p["eval_pos"]
            pred = data.price[pos] * np.exp(baselines.ridge(p, alpha))
            true = data.price[pos + horizon]
            rel.append(rmse(true, pred) / rmse(true, data.price[pos]))
        scores[alpha] = np.mean(rel)
    return min(scores, key=scores.get)


# ---------------------------------------------------------------- validation
def validation_job(cell: str, horizon: int, round_: int, variant: str) -> pd.DataFrame:
    """Out-of-fold predictions (mean of the members) of one network."""
    data = load_model_data()
    mem = members(cell, horizon, round_, variant)
    rows = []
    name = model_name(cell, variant)
    for fold in walk_forward_folds(data.index, horizon, VAL_YEARS, TEST_START):
        pos, preds, infos = fit_members(data, cell, horizon, mem, fold.train, fold.val)
        pred = np.mean(preds, axis=0)
        rel = relative_rmse_by_year(data.price, horizon, pos, np.full(len(pos), int(fold.name)), pred).iloc[0]
        epochs = np.mean([i["best_epoch"] for i in infos])
        print(f"  {name:<36} h={horizon:<3} año {fold.name}: error relativo {rel:.3f}"
              f"  ({len(mem)} modelos, mejor época media {epochs:.0f})", flush=True)
        rows.append(pd.DataFrame({
            "h": horizon, "variante": variant, "modelo": name, "año": int(fold.name),
            "pos": pos, "retorno_pred": pred,
        }))
    print(f"  ✓ {name} h={horizon} terminado", flush=True)
    return pd.concat(rows)


# ---------------------------------------------------------------- importance
def permuted_score(price, horizon: int, models, j: int | None = None, perm=None) -> float:
    """Relative RMSE of the members' mean, with variable ``j`` shuffled across origins."""
    preds = []
    for model, p in models:
        if j is not None:
            X = p["X_eval"].copy()
            X[:, :, j] = X[perm, :, j]
            p = {**p, "X_eval": X}
        preds.append(predict(model, p))
    pos = models[0][1]["eval_pos"]
    return rmse(price[pos + horizon], price[pos] * np.exp(np.mean(preds, axis=0))) / rmse(price[pos + horizon], price[pos])


def importance_job(horizon: int, round_: int) -> pd.DataFrame:
    """Permutation importance of every variable for the RNN top-5 of one horizon."""
    data = load_model_data()
    features = list(data.feats.columns)
    mem = members("rnn", horizon, round_, "top5")
    rows = []
    for fold in walk_forward_folds(data.index, horizon, VAL_YEARS, TEST_START):
        cache, models = {}, []
        for cfg, seed in mem:
            if cfg.window not in cache:
                cache[cfg.window] = prepare(data, horizon, fold.train, fold.val, cfg.window)
            models.append((fit("rnn", cfg, cache[cfg.window], seed=seed)[0], cache[cfg.window]))
        base = permuted_score(data.price, horizon, models)
        rng = np.random.default_rng(int(fold.name))
        n = len(models[0][1]["eval_pos"])
        for j, feat in enumerate(features):
            perms = [rng.permutation(n) for _ in range(N_PERMUTATIONS)]
            delta = np.mean([permuted_score(data.price, horizon, models, j, perm) for perm in perms]) - base
            rows.append({"h": horizon, "año": int(fold.name), "variable": feat, "aumento_error": delta})
        print(f"  importancia h={horizon:<3} año {fold.name} terminada (error relativo base {base:.3f})", flush=True)
    return pd.DataFrame(rows)


def run_importance(round_: int, cores: int | None = None) -> None:
    jobs = [(h, round_) for h in HORIZONS.values()]
    with ProcessPoolExecutor(max_workers=n_workers(len(jobs), cores)) as pool:
        imp = pd.concat(pool.map(importance_job, *zip(*jobs)))
    table = imp.groupby(["h", "variable"])["aumento_error"].agg(["mean", "min", "max"]).reset_index()
    selected = {}
    for h, g in table.groupby("h"):
        keep = g[g["mean"] > 0].sort_values("mean", ascending=False)["variable"].tolist()
        selected[str(h)] = keep
        print(f"\n== h={h}: se quedan {len(keep)} de {len(g)} variables")
        print(g.sort_values("mean", ascending=False).round(4).to_string(index=False))
    out = results_dir(round_)
    out.mkdir(parents=True, exist_ok=True)
    imp.to_csv(out / "importancia_variables.csv", index=False)
    (out / "variables_seleccionadas.json").write_text(json.dumps(selected, indent=2, ensure_ascii=False))
    print(f"\nImportancias guardadas en {out}")


def run_validation(round_: int, cores: int | None = None) -> None:
    data = load_model_data()
    # Slowest networks first so the pool stays busy until the end.
    jobs = [(cell, h, round_, v) for cell in ("lstm", "gru", "rnn") for v in VARIANTS[round_] for h in HORIZONS.values()]
    with ProcessPoolExecutor(max_workers=n_workers(len(jobs), cores)) as pool:
        oof = pd.concat(pool.map(validation_job, *zip(*jobs)))

    summary, weights, prudent, predictions = [], {}, {}, []
    for hname, h in HORIZONS.items():
        nets = oof[oof.h == h].pivot_table(index=["año", "pos"], columns="modelo", values="retorno_pred")
        models = []
        for v in VARIANTS[round_]:
            names = [model_name(c, v) for c in CELLS]
            nets[model_name(COMBINATION, v)] = nets[names].mean(axis=1)
            models += [*names, model_name(COMBINATION, v)]
        years = nets.index.get_level_values("año").to_numpy()
        pos = nets.index.get_level_values("pos").to_numpy()

        alpha = choose_ridge_alpha(data, h)
        ridge = []
        for fold in walk_forward_folds(data.index, h, VAL_YEARS, TEST_START):
            p = prepare(data, h, fold.train, fold.val)
            idx = pd.MultiIndex.from_arrays([np.full(len(p["eval_pos"]), int(fold.name)), p["eval_pos"]])
            ridge.append(pd.Series(baselines.ridge(p, alpha), index=idx))
        nets["Ridge"] = pd.concat(ridge).reindex(nets.index).to_numpy()

        weights[hname], prudent[hname] = {}, {}
        tuned = {model_name(c, "base"): best_config(c, h, round_)[1]["value"] for c in CELLS}
        for model in [*models, "Ridge"]:
            r = nets[model].to_numpy()
            by_year = relative_rmse_by_year(data.price, h, pos, years, r)
            summary.append({"horizonte": hname, "h": h, "modelo": model, "peso": 1.0,
                            "rmse_relativo": by_year.mean(), "peor_año": by_year.max(),
                            "rmse_relativo_ajuste_1_semilla": tuned.get(model),
                            **{f"rel_{y}": v for y, v in by_year.items()}})
            predictions.append(pd.DataFrame({"horizonte": hname, "modelo": model, "año": years,
                                             "origen": data.index[pos], "retorno_pred": r}))
            if model == "Ridge":
                continue
            for suffix, criterion, store in ((ADJUSTED, "media", weights), (PRUDENT, "prudente", prudent)):
                w, score = choose_weight(data.price, h, pos, years, r, criterion)
                store[hname][model] = w
                by_year = relative_rmse_by_year(data.price, h, pos, years, w * r)
                summary.append({"horizonte": hname, "h": h, "modelo": model + suffix, "peso": w,
                                "rmse_relativo": score, "peor_año": by_year.max(),
                                **{f"rel_{y}": v for y, v in by_year.items()}})

    out = results_dir(round_)
    out.mkdir(parents=True, exist_ok=True)
    summary = pd.DataFrame(summary)
    summary.to_csv(out / "validacion_resumen.csv", index=False)
    pd.concat(predictions).to_csv(out / "predicciones_validacion.csv", index=False)
    (out / "pesos.json").write_text(json.dumps(weights, indent=2, ensure_ascii=False))
    (out / "pesos_prudentes.json").write_text(json.dumps(prudent, indent=2, ensure_ascii=False))
    pd.set_option("display.width", 200)
    print(summary[["horizonte", "modelo", "peso", "rmse_relativo", "peor_año"]].round(3).to_string(index=False))
    print(f"\nResultados de validación guardados en {out}")


# ---------------------------------------------------------------------- test
def record(results: dict, data, hname: str, h: int, origins, model_name: str, log_ret, extra: dict) -> None:
    """Evaluate one model on the test origins and store metrics and predictions."""
    m = evaluate_forecast(data.price, h, origins, log_ret)
    results["summary"].append({"horizonte": hname, "h": h, "modelo": model_name, **m, **extra})
    results["predictions"].append(pd.DataFrame({
        "origen": data.index[origins], "fecha_objetivo": data.index[origins + h],
        "horizonte": hname, "modelo": model_name, "retorno_pred": log_ret,
        "precio_hoy": data.price[origins], "precio_real": data.price[origins + h],
        "precio_pred": data.price[origins] * np.exp(log_ret),
    }))
    print(f"  {model_name:<34} RMSE {m['RMSE']:7.2f}  mejora {m['Mejora_RMSE_vs_ingenuo_%']:+6.2f} %")


def record_adjusted(results, data, hname, h, origins, name, log_ret, extra, weights, prudent, validation):
    """The raw forecast and its adjusted versions (both criteria)."""
    record(results, data, hname, h, origins, name, log_ret,
           {**extra, "peso": 1.0, "validacion_rmse_relativo": validation.get((hname, name))})
    for suffix, store in ((ADJUSTED, weights), (PRUDENT, prudent)):
        if store is None:
            continue
        w = store[hname][name]
        record(results, data, hname, h, origins, name + suffix, w * log_ret,
               {**extra, "peso": w, "validacion_rmse_relativo": validation.get((hname, name + suffix))})


def test_job(hname: str, h: int, round_: int) -> tuple[dict, list]:
    """Train on everything before the test and evaluate one horizon."""
    out = results_dir(round_)
    weights = json.loads((out / "pesos.json").read_text())
    prudent_path = out / "pesos_prudentes.json"
    prudent = json.loads(prudent_path.read_text()) if prudent_path.exists() else None
    validation = pd.read_csv(out / "validacion_resumen.csv").set_index(["horizonte", "modelo"])["rmse_relativo"]

    data = load_model_data()
    results = {"summary": [], "predictions": []}
    per_member = []
    train_pos, test_pos = train_test_split(data.index, h, TEST_START)
    p = prepare(data, h, train_pos, test_pos)
    origins = p["eval_pos"]
    print(f"\n== Horizonte {hname} ({h} d): {len(train_pos):,} orígenes de train, {len(origins):,} de test", flush=True)

    record(results, data, hname, h, origins, "Ingenuo", baselines.naive(p), {"n_params": 0})
    record(results, data, hname, h, origins, "Media histórica", baselines.historical_mean(p), {"n_params": 1})
    alpha = choose_ridge_alpha(data, h)
    n_ridge = p["X_eval"].shape[1] * p["X_eval"].shape[2] + 1
    record(results, data, hname, h, origins, "Ridge", baselines.ridge(p, alpha),
           {"n_params": n_ridge, "alpha": alpha, "validacion_rmse_relativo": validation.get((hname, "Ridge"))})

    for variant in TEST_VARIANTS[round_]:
        ensembles, n_params, train_time = {}, 0, 0.0
        for cell in CELLS:
            name = model_name(cell, variant)
            pos, preds, infos = fit_members(data, cell, h, members(cell, h, round_, variant), train_pos, origins)
            assert np.array_equal(pos, origins)
            rows = []
            for yhat, info in zip(preds, infos):
                m = evaluate_forecast(data.price, h, origins, yhat)
                rows.append({"horizonte": hname, "h": h, "modelo": name, **m, **info})
            per_member += rows
            rows = pd.DataFrame(rows)
            ensembles[name] = np.mean(preds, axis=0)
            extra = {
                "n_params": int(rows["n_params"].mean()),
                "ventana": "/".join(str(w) for w in sorted(rows["ventana"].unique())),
                "tiempo_entrenamiento_s": rows["train_time_s"].mean(),
                "epocas_medias": rows["best_epoch"].mean(),
                "RMSE_desv_semillas": rows["RMSE"].std(),
                "Mejora_RMSE_desv_semillas": rows["Mejora_RMSE_vs_ingenuo_%"].std(),
            }
            n_params += extra["n_params"]
            train_time += extra["tiempo_entrenamiento_s"]
            record_adjusted(results, data, hname, h, origins, name, ensembles[name], extra,
                            weights, prudent, validation)

        combo = np.mean(list(ensembles.values()), axis=0)
        record_adjusted(results, data, hname, h, origins, model_name(COMBINATION, variant), combo,
                        {"n_params": n_params, "tiempo_entrenamiento_s": train_time},
                        weights, prudent, validation)
    return results, per_member


def run_test(round_: int, cores: int | None = None) -> None:
    out = results_dir(round_)
    if not (out / "pesos.json").exists():
        raise SystemExit("Falta pesos.json: ejecuta antes `scripts/train.py validacion`.")
    # One process per horizon (one CPU thread each, so training times stay comparable).
    jobs = [(hname, h, round_) for hname, h in HORIZONS.items()]
    with ProcessPoolExecutor(max_workers=n_workers(len(jobs), cores)) as pool:
        done = list(pool.map(test_job, *zip(*jobs)))

    summary = [r for res, _ in done for r in res["summary"]]
    predictions = [d for res, _ in done for d in res["predictions"]]
    per_member = [r for _, pm in done for r in pm]
    pd.DataFrame(summary).to_csv(out / "comparativa.csv", index=False)
    pd.DataFrame(per_member).to_csv(out / "metricas_por_semilla.csv", index=False)
    pd.concat(predictions).to_csv(out / "predicciones_test.csv", index=False)
    print(f"\nResultados del test guardados en {out}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("stage", choices=["importancia", "validacion", "test"])
    parser.add_argument("--round", type=int, choices=ROUNDS, default=CURRENT_ROUND)
    parser.add_argument("--nucleos", type=int, default=None,
                        help="máximo de procesos a la vez (menos = más lento pero se calienta menos)")
    args = parser.parse_args()
    if args.stage == "importancia":
        run_importance(args.round, args.nucleos)
    elif args.stage == "validacion":
        run_validation(args.round, args.nucleos)
    else:
        run_test(args.round, args.nucleos)


if __name__ == "__main__":
    main()
