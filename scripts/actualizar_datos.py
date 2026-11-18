"""Daily update of the web data, without retraining.

1. Downloads the data from FRED and Yahoo Finance up to today (``run_etl``).
2. Writes the forecast of each new day in the follow-up log
   (``reports/seguimiento/previsiones.csv``), to compare it with the real
   price when its target date arrives (notebook ``09_seguimiento`` and the
   Fiabilidad view of the web).
3. Rewrites the JSON files of the web with the saved app models
   (``app/generar_datos.py``): new forecast, prices, market data and follow-up.

GitHub Actions runs it every day (``.github/workflows/actualizar_datos.yml``)
until ``--hasta``; after that date it does nothing. Retraining stays manual:
``scripts/entrenar_app.py``.

Usage:
    poetry run python scripts/actualizar_datos.py [--hasta 2026-11-30] [--sin-descarga]
"""

import argparse
import subprocess
import sys
from datetime import UTC, date, datetime

from oil_forecast.app_model import FOLLOW_LOG, log_forecasts
from oil_forecast.config import ROOT
from oil_forecast.data import run_etl

END = "2026-11-30"  # last day of the follow-up


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--hasta", default=END, help=f"último día en que se actualiza (por defecto {END})")
    parser.add_argument("--sin-descarga", action="store_true", help="usar los datos ya descargados")
    args = parser.parse_args()

    today = datetime.now(UTC).date()
    if today > date.fromisoformat(args.hasta):
        print(f"El seguimiento terminó el {args.hasta}: no se actualiza nada.")
        return
    if not args.sin_descarga:
        data = run_etl()
        print(f"Datos descargados hasta el {data.index.max():%Y-%m-%d}")
    added = log_forecasts()  # first, so that the web's follow-up already has today's forecast
    print(f"{FOLLOW_LOG.relative_to(ROOT)}: {added} día(s) nuevo(s)")
    subprocess.run([sys.executable, str(ROOT / "app" / "generar_datos.py")], check=True)


if __name__ == "__main__":
    main()
