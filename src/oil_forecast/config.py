"""Single source of truth for the experimental setup.

Every model (RNN, LSTM, GRU and baselines) reads its settings from here so
that the comparison is made under identical conditions.
"""

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

SEED = 42

# Hyperparameter tuning: identical budget for every network and horizon.
# Round 1 is the first search; round 2 widens it after reviewing round 1;
# rounds 3 and 4 do not search again: they try changes on top of the round-2
# search. Every choice is made on the validation years, never on the test.
ROUNDS = (1, 2, 3, 4)
CURRENT_ROUND = 4
N_TRIALS = {1: 20, 2: 25, 5: 30}  # round 5 searches with two windows (see tune.py)
TUNED_ROUND = {1: 1, 2: 2, 3: 2, 4: 2}  # round whose tuned configurations are used

# Variants evaluated in each round ("base": the tuned winner with 5 seeds).
#   top5:      the 5 best configurations of the search, one seed each
#   recientes: the winner, with recent years weighing more in the loss
#   lineal:    the winner, plus a linear model in parallel
#   top5_lineal:    top5, each with a linear model in parallel
#   top5_x2:        top5 with 2 seeds per configuration (10 models)
#   top5_menos_var: top5 using only the variables that help in validation
#                   (permutation importance, stage ``importancia``)
VARIANTS = {
    1: ("base",),
    2: ("base",),
    3: ("top5", "recientes", "lineal"),
    4: ("top5_lineal", "top5_x2", "top5_menos_var"),
}
# Variants taken to the test ("recientes" was discarded in validation).
TEST_VARIANTS = {**VARIANTS, 3: ("top5", "lineal")}
TOP_K = 5
HALF_LIFE_DAYS = 756  # 3 years of business days
FINAL_SEEDS = (0, 1, 2, 3, 4)
TUNING_DIR = ROOT / "reports" / "tuning"


def tuning_dir(round_: int = CURRENT_ROUND) -> Path:
    return TUNING_DIR / f"ronda_{round_}"


def results_dir(round_: int = CURRENT_ROUND) -> Path:
    return RESULTS_DIR / f"ronda_{round_}"


def n_workers(n_jobs: int, requested: int | None = None) -> int:
    """Parallel processes: one per job, capped by the CPU count or by ``requested``.

    A lower cap (``--nucleos``) runs slower but keeps a fanless laptop cooler.
    """
    limit = requested or os.cpu_count() or 1
    return max(1, min(n_jobs, limit))
