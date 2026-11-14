"""Walk-forward hyperparameter tuning (Optuna) for one network and horizon.

Every network gets the same search space, the same number of trials, the same
sampler seed, the same folds and the same first trial, so the comparison is
made under equal conditions.

Objective: mean over the validation years of RMSE(model) / RMSE(naive), with
prices in USD. Values below 1 mean the network beats the naive forecast.

Two rounds are kept for transparency (reports/tuning/ronda_N/):
    1. first search (window fixed at 60 days);
    2. wider search after reviewing round 1: input window as a hyperparameter,
       lower learning rates (down to 3e-5). Each study starts from the
       default trial and from its own round-1 winner, so round 2 can only
       improve on round 1 in validation.
    5. after the learning curves (LSTM and GRU memorise within a few epochs)
       and the assignment's rule of one input window shared by the three
       networks: the search is run twice, with a 20-day and a 60-day window,
       over a smaller and more regularised space (up to 64 neurons, learning
       rate up to 1e-3). Every trial is the mean of 2 seeds, so a configuration
       is less likely to win by luck. Studies are named <red>_h<h>_v<window>.
       At the end the window of each horizon is chosen (``ventana_decision.json``):
       for each window, mean over the three networks of the mean of their 5
       best trials; the lower wins, and within 0.01 the 20-day window (3 times
       cheaper to train). Forecasts leave out the training-period drift
       (``DETREND_ROUNDS`` in config.py).

Usage:
    poetry run python scripts/tune.py --cell lstm --horizon 63
    poetry run python scripts/tune.py --all              # 9 studies in parallel
    poetry run python scripts/tune.py --all --round 1    # reproduce round 1
    poetry run python scripts/tune.py --all --nucleos 8  # round 5: 18 studies, 8 at a time
    poetry run python scripts/tune.py --decidir-ventana  # round 5: window per horizon
"""

import argparse
import json
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import optuna
import pandas as pd
from optuna.trial import TrialState

from oil_forecast.config import (
    HORIZONS,
    N_TRIALS,
    SEED,
    TEST_START,
    VAL_YEARS,
    WINDOW,
    detrend,
    n_workers,
    study_name,
    tuning_dir,
)
from oil_forecast.metrics import rmse
from oil_forecast.models import CELLS
from oil_forecast.splits import walk_forward_folds
from oil_forecast.training import TrainConfig, fit, load_model_data, predict, prepare

DEFAULT_TRIAL = {
    "hidden_size": 32, "num_layers": 1, "dropout": 0.2, "lr": 1e-3,
    "batch_size": 128, "weight_decay": 1e-5, "loss": "mse",
}


SEARCH_SPACES = {
    1: {"hidden_size": [16, 32, 64, 128], "lr": (1e-4, 3e-3), "window": None},
    2: {"hidden_size": [16, 32, 64, 128], "lr": (3e-5, 3e-3), "window": [20, 60, 120]},
    5: {"hidden_size": [16, 32, 64], "lr": (3e-5, 1e-3), "window": None, "windows": (20, 60), "seeds": 2},
}
WINDOW_TOP_K = 5
WINDOW_TOLERANCE = 0.01


def in_space(params: dict, round_: int) -> bool:
    space = SEARCH_SPACES[round_]
    lo, hi = space["lr"]
    return params["hidden_size"] in space["hidden_size"] and lo <= params["lr"] <= hi


def suggest(trial: optuna.Trial, round_: int, fixed_window: int | None = None) -> TrainConfig:
    space = SEARCH_SPACES[round_]
    if fixed_window is not None:
        window = fixed_window
    else:
        window = trial.suggest_categorical("window", space["window"]) if space["window"] else WINDOW
    return TrainConfig(
        hidden_size=trial.suggest_categorical("hidden_size", space["hidden_size"]),
        num_layers=trial.suggest_int("num_layers", 1, 2),
        dropout=trial.suggest_float("dropout", 0.0, 0.5),
        lr=trial.suggest_float("lr", *space["lr"], log=True),
        batch_size=trial.suggest_categorical("batch_size", [64, 128, 256]),
        weight_decay=trial.suggest_float("weight_decay", 1e-6, 1e-3, log=True),
        loss=trial.suggest_categorical("loss", ["mse", "huber"]),
        window=window,
    )


def initial_trials(cell: str, horizon: int, round_: int) -> list[dict]:
    """Default configuration, plus the previous search's winner when it fits the space."""
    window = {"window": WINDOW} if SEARCH_SPACES[round_]["window"] else {}
    trials = [{**DEFAULT_TRIAL, **window}]
    previous_round = 2 if round_ == 5 else round_ - 1
    previous = tuning_dir(previous_round) / f"{study_name(cell, horizon)}_best.json"
    if round_ > 1 and previous.exists():
        params = json.loads(previous.read_text())["params"]
        best = {**window, **{k: v for k, v in params.items() if k != "window" or window}}
        if best not in trials and in_space(best, round_):
            trials.append(best)
    return trials


def run_study(cell: str, horizon: int, n_trials: int, round_: int, window: int | None = None) -> None:
    data = load_model_data()
    seeds = [SEED + i for i in range(SEARCH_SPACES[round_].get("seeds", 1))]
    folds = walk_forward_folds(data.index, horizon, VAL_YEARS, TEST_START)
    cache: dict[int, list] = {}  # prepared folds for each input window
    price = data.price

    def objective(trial: optuna.Trial) -> float:
        cfg = suggest(trial, round_, window)
        if cfg.window not in cache:
            cache[cfg.window] = [prepare(data, horizon, f.train, f.val, cfg.window) for f in folds]
        rel, times = [], []
        for step, (fold, p) in enumerate(zip(folds, cache[cfg.window])):
            preds = []
            for seed in seeds:
                model, info = fit(cell, cfg, p, seed=seed)
                preds.append(predict(model, p, detrend(round_)))
            pos = p["eval_pos"]
            pred = price[pos] * np.exp(np.mean(preds, axis=0))
            rel.append(rmse(price[pos + horizon], pred) / rmse(price[pos + horizon], price[pos]))
            times.append(info["train_time_s"])
            trial.set_user_attr(f"rel_rmse_{fold.name}", rel[-1])
            trial.report(float(np.mean(rel)), step)
            if trial.should_prune():
                raise optuna.TrialPruned()
        trial.set_user_attr("n_params", info["n_params"])
        trial.set_user_attr("mean_train_time_s", float(np.mean(times)))
        return float(np.mean(rel))

    out = tuning_dir(round_)
    out.mkdir(parents=True, exist_ok=True)
    name = study_name(cell, horizon, window)
    study = optuna.create_study(
        study_name=name,
        direction="minimize",
        storage=f"sqlite:///{out / (name + '.db')}",
        load_if_exists=True,
        sampler=optuna.samplers.TPESampler(seed=SEED, n_startup_trials=8),
        pruner=optuna.pruners.MedianPruner(n_startup_trials=8, n_warmup_steps=1),
    )
    if len(study.trials) == 0:
        for params in initial_trials(cell, horizon, round_):
            study.enqueue_trial(params)
    # A study interrupted mid-trial leaves it "running": mark it as failed so it
    # is ignored and the study can be resumed.
    for t in study.trials:
        if t.state == TrialState.RUNNING:
            study.tell(t.number, state=TrialState.FAIL)

    finished = lambda: [t for t in study.trials if t.state in (TrialState.COMPLETE, TrialState.PRUNED)]
    remaining = n_trials - len(finished())

    def progress(study: optuna.Study, trial: optuna.trial.FrozenTrial) -> None:
        done = len(finished())
        value = f"{trial.value:.4f}" if trial.value is not None else "cortado (va peor que la mediana)"
        best = min((t.value for t in study.trials if t.state == TrialState.COMPLETE), default=float("nan"))
        print(f"{name}: intento {done}/{n_trials} · {value} · mejor hasta ahora {best:.4f}", flush=True)

    if remaining > 0:
        study.optimize(objective, n_trials=remaining, callbacks=[progress])

    # Identical budget: only the first ``n_trials`` finished trials count.
    budget = finished()[:n_trials]
    best_trial = min((t for t in budget if t.state == TrialState.COMPLETE), key=lambda t: t.value)
    trials = study.trials_dataframe()
    trials = trials[trials["number"].isin([t.number for t in budget])]
    trials.to_csv(out / f"{name}_trials.csv", index=False)
    fixed = {"window": window} if window else {}
    best = {
        "cell": cell, "horizon": horizon, "value": best_trial.value,
        "params": {**best_trial.params, **fixed}, "user_attrs": best_trial.user_attrs,
        "trial": best_trial.number, "n_trials": len(budget), "round": round_,
    }
    (out / f"{name}_best.json").write_text(json.dumps(best, indent=2))
    print(f"{name}: best mean relative RMSE = {best_trial.value:.4f} with {best_trial.params}")


def decide_window(round_: int) -> dict:
    """Round 5: window of each horizon from the searches with every candidate window.

    Score of a window = mean over the three networks of the mean of their
    ``WINDOW_TOP_K`` best trials (within the budget). The lower score wins;
    within ``WINDOW_TOLERANCE`` the shortest window wins (cheaper to train).
    """
    space = SEARCH_SPACES[round_]
    out = tuning_dir(round_)
    decision = {}
    for h in HORIZONS.values():
        scores = {}
        for w in space["windows"]:
            per_net = {}
            for cell in CELLS:
                name = study_name(cell, h, w)
                trials = pd.read_csv(out / f"{name}_trials.csv")
                done = trials[trials["state"] == "COMPLETE"].nsmallest(WINDOW_TOP_K, "value")
                per_net[cell] = float(done["value"].mean())
            scores[w] = {"media_3_redes": float(np.mean(list(per_net.values()))), **per_net}
        best = min(s["media_3_redes"] for s in scores.values())
        chosen = min(w for w, s in scores.items() if s["media_3_redes"] <= best + WINDOW_TOLERANCE)
        decision[str(h)] = {"ventana": chosen, "puntuaciones": scores}
        print(f"\n== h={h}: media de los {WINDOW_TOP_K} mejores intentos de cada red (1 = ingenuo)")
        print(pd.DataFrame(scores).T.round(4).to_string())
        print(f"→ ventana elegida: {chosen} días")
    rule = (f"Por horizonte, media de las tres redes de la media de sus {WINDOW_TOP_K} mejores intentos; "
            f"gana la menor y, a menos de {WINDOW_TOLERANCE}, la ventana más corta.")
    (out / "ventana_decision.json").write_text(json.dumps({"regla": rule, "horizontes": decision}, indent=2))
    return decision


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--cell", choices=list(CELLS))
    parser.add_argument("--horizon", type=int, choices=list(HORIZONS.values()))
    parser.add_argument("--round", type=int, choices=list(SEARCH_SPACES), default=max(SEARCH_SPACES),
                        help="search round (round 3 does not search: see scripts/train.py)")
    parser.add_argument("--trials", type=int, help="default: the budget of the round")
    parser.add_argument("--window", type=int, help="round 5: input window of the study")
    parser.add_argument("--all", action="store_true", help="launch every network x horizon in parallel")
    parser.add_argument("--decidir-ventana", action="store_true", help="round 5: choose the window per horizon")
    parser.add_argument("--nucleos", type=int, default=None,
                        help="with --all: studies running at once (fewer = slower but cooler)")
    args = parser.parse_args()
    optuna.logging.set_verbosity(optuna.logging.WARNING)
    n_trials = args.trials or N_TRIALS[args.round]
    windows = SEARCH_SPACES[args.round].get("windows", (None,))

    if args.decidir_ventana:
        decide_window(args.round)
        return
    if args.all:
        out = tuning_dir(args.round)
        out.mkdir(parents=True, exist_ok=True)

        def launch(cell: str, h: int, w: int | None) -> int:
            """Run one study in its own process; its lines go to its log and to this terminal."""
            cmd = [sys.executable, "-u", __file__, "--cell", cell, "--horizon", str(h),
                   "--trials", str(n_trials), "--round", str(args.round)] + (["--window", str(w)] if w else [])
            name = study_name(cell, h, w)
            with open(out / f"{name}.log", "w") as log:
                proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
                for line in proc.stdout:
                    log.write(line)
                    log.flush()
                    print(f"  {line.rstrip()}", flush=True)
                code = proc.wait()
            print(f"  ✓ {name} terminado (código {code})", flush=True)
            return code

        # Slowest studies first (long windows, LSTM) so the pool stays busy until the end
        studies = sorted(((cell, h, w) for w in windows for cell in CELLS for h in HORIZONS.values()),
                         key=lambda j: (-(j[2] or 0), ["lstm", "gru", "rnn"].index(j[0])))
        workers = n_workers(len(studies), args.nucleos)
        print(f"{len(studies)} búsquedas de {n_trials} intentos, {workers} a la vez", flush=True)
        with ThreadPoolExecutor(max_workers=workers) as pool:
            codes = list(pool.map(lambda job: launch(*job), studies))
        if max(codes) == 0 and windows != (None,):
            decide_window(args.round)
        sys.exit(max(codes))
    if args.cell is None or args.horizon is None:
        parser.error("use --cell and --horizon, or --all")
    run_study(args.cell, args.horizon, n_trials, args.round, args.window)


if __name__ == "__main__":
    main()
