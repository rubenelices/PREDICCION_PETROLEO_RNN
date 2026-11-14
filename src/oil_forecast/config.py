"""Single source of truth for the experimental setup.

Every model (RNN, LSTM, GRU and baselines) reads its settings from here so
that the comparison is made under identical conditions.
"""

import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
DATASET_PATH = DATA_DIR / "petroleo_dataset.csv"
METADATA_PATH = DATA_DIR / "metadata.json"
FIGURES_DIR = ROOT / "reports" / "figures"
RESULTS_DIR = ROOT / "reports" / "results"
MODELS_DIR = ROOT / "models"

START = "2000-01-01"
TARGET = "brent"

# Forecast horizons in business days.
HORIZONS = {"corto": 5, "medio": 63, "largo": 252}

# Input window (days of history fed to the recurrent networks).
WINDOW = 60

# Hold-out test: forecast origins from this date on are never used for
# training or model selection.
TEST_START = "2024-01-01"

# Walk-forward validation blocks (one calendar year each, expanding train).
VAL_YEARS = (2019, 2020, 2021, 2022, 2023)
# Backward validation: years never used to choose anything. The final
# configurations, unchanged, are retrained on each year with only the data
# before it (stage ``hacia_atras`` of train.py). Checked once, after writing
# modelo_final.json and before the test; it does not change the final model.
BACKWARD_YEARS = tuple(range(2010, 2019))

SEED = 42

# Hyperparameter tuning: identical budget for every network and horizon.
# Round 1 is the first search; round 2 widens it after reviewing round 1;
# rounds 3 and 4 do not search again: they try changes on top of the round-2
# search. Every choice is made on the validation years, never on the test.
ROUNDS = (1, 2, 3, 4, 5)
CURRENT_ROUND = 5
N_TRIALS = {1: 20, 2: 25, 5: 30}  # round 5 searches with two windows (see tune.py)
TUNED_ROUND = {1: 1, 2: 2, 3: 2, 4: 2, 5: 5}  # round whose tuned configurations are used

# Variants evaluated in each round ("base": the tuned winner with 5 seeds).
#   top5:      the 5 best configurations of the search, one seed each
#   recientes: the winner, with recent years weighing more in the loss
#   lineal:    the winner, plus a linear model in parallel
#   top5_lineal:    top5, each with a linear model in parallel
#   top5_x2:        top5 with 2 seeds per configuration (10 models)
#   top5_menos_var: top5 using only the variables that help in validation
#                   (permutation importance, stage ``importancia``)
#   top3_x2:        the 3 best configurations, 2 seeds each (6 models)
# Round 5 uses the same input window for the three networks (the one chosen
# in its search, ventana_decision.json) and compares how many configurations
# to average: the winner alone (5 seeds), the best 3 and the best 5.
VARIANTS = {
    1: ("base",),
    2: ("base",),
    3: ("top5", "recientes", "lineal"),
    4: ("top5_lineal", "top5_x2", "top5_menos_var"),
    5: ("base", "top3_x2", "top5_x2"),
}
# Rule written down before the round 5 validation, per horizon and with the
# same choice for the three networks (identical conditions):
#   1. the variant with the lowest mean relative RMSE of the three networks
#      wins; a simpler one (earlier in VARIANTS) within VARIANT_TOLERANCE wins;
#   2. the shrunk ("ajustada") forecast is used only if it lowers the mean of
#      the three networks by at least VARIANT_TOLERANCE.
VARIANT_TOLERANCE = 0.01
# Variants taken to the test ("recientes" was discarded in validation; in round 5
# the rule picked "base" in every horizon, see variante_decision.json).
TEST_VARIANTS = {**VARIANTS, 3: ("top5", "lineal"), 5: ("base",)}

# 80 % interval of the app forecast (scripts/intervalo.py). Rule written down
# before computing it: per horizon, among the methods whose total coverage on
# 2010-2023 is inside INTERVAL_COVERAGE, the lowest mean interval score wins; a
# simpler method (earlier in intervals.METHODS) within INTERVAL_TIE of it wins.
# If none covers enough, the coverage closest to the level wins.
INTERVAL_LEVEL = 0.8
INTERVAL_COVERAGE = (0.75, 0.85)
INTERVAL_TIE = 0.02
TOP_K = 5
HALF_LIFE_DAYS = 756  # 3 years of business days
FINAL_SEEDS = (0, 1, 2, 3, 4)
# From round 5 on, forecasts assume zero drift, like the naive forecast: the
# average return of the training period (the 2000-2008 boom weighs a lot in it,
# +3-7 % a year at 252 days) is not added back to the predictions. Checked on
# the saved round 3-4 predictions before adopting it (notebook 08).
DETREND_ROUNDS = (5,)
TUNING_DIR = ROOT / "reports" / "tuning"


def tuning_dir(round_: int = CURRENT_ROUND) -> Path:
    return TUNING_DIR / f"ronda_{round_}"


def study_name(cell: str, horizon: int, window: int | None = None) -> str:
    """Name of a tuning study (round 5 runs one study per input window)."""
    return f"{cell}_h{horizon}" + (f"_v{window}" if window else "")


def tuned_window(horizon: int, round_: int) -> int | None:
    """Common input window chosen in the search used by ``round_``.

    ``None`` for rounds whose search tuned the window of each configuration.
    """
    path = tuning_dir(TUNED_ROUND[round_]) / "ventana_decision.json"
    if not path.exists():
        return None
    return int(json.loads(path.read_text())["horizontes"][str(horizon)]["ventana"])


def detrend(round_: int) -> bool:
    """Whether forecasts of this round leave out the training-period drift."""
    return round_ in DETREND_ROUNDS


def results_dir(round_: int = CURRENT_ROUND) -> Path:
    return RESULTS_DIR / f"ronda_{round_}"


def n_workers(n_jobs: int, requested: int | None = None) -> int:
    """Parallel processes: one per job, capped by the CPU count or by ``requested``.

    A lower cap (``--nucleos``) runs slower but keeps a fanless laptop cooler.
    """
    limit = requested or os.cpu_count() or 1
    return max(1, min(n_jobs, limit))
