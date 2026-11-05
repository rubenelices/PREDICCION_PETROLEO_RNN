"""Single source of truth for the experimental setup.

Every model (RNN, LSTM, GRU and baselines) reads its settings from here so
that the comparison is made under identical conditions.
"""

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
