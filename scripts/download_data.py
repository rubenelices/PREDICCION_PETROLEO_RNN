"""Download the oil price dataset (FRED + Yahoo Finance) from 2000-01-01 to today.

Outputs:
    data/raw/fred.csv, data/raw/yahoo.csv  raw series, exactly as downloaded
    data/petroleo_dataset.csv              daily dataset on the real Brent calendar
    data/metadata.json                     download date and last real value per series

Usage:
    poetry run python scripts/download_data.py
"""

from oil_forecast.config import DATASET_PATH
from oil_forecast.data import load_metadata, run_etl


def main() -> None:
    print("Descargando FRED y Yahoo Finance...")
    data = run_etl()
    meta = load_metadata()
    print(f"Dataset: {data.shape[0]:,} días x {data.shape[1]} columnas -> {DATASET_PATH}")
    print(f"Periodo: {meta['first_date']} a {meta['last_brent_date']} (último Brent publicado por la EIA)")
    print("Último dato real por serie:")
    for name, date in meta["last_observation"].items():
        print(f"  {name:<18} {date}")


if __name__ == "__main__":
    main()
