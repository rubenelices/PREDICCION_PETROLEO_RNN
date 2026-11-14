"""Assemble the folder that is uploaded to the Hugging Face Space.

The Space needs the app (server, web and saved models), the ``oil_forecast``
package and the current dataset; it does not need the notebooks, the
experiment results or the tuning studies. Everything is copied to
``build/space/`` (ignored by git), ready to upload:

    poetry run python scripts/preparar_space.py
    hf upload <usuario>/<space> build/space . --repo-type space

Usage:
    poetry run python scripts/preparar_space.py [--destino build/space]
"""

import argparse
import shutil
from pathlib import Path

from oil_forecast.config import DATASET_PATH, METADATA_PATH, ROOT

IGNORE = shutil.ignore_patterns("__pycache__", "*.pyc", ".DS_Store")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--destino", type=Path, default=ROOT / "build" / "space")
    args = parser.parse_args()
    dest: Path = args.destino
    app = ROOT / "app"
    if not (app / "modelos" / "modelos.json").exists():
        raise SystemExit("Faltan los modelos de la app: ejecuta antes `scripts/entrenar_app.py`.")

    if dest.exists():
        shutil.rmtree(dest)
    (dest / "app").mkdir(parents=True)
    for name in ("servidor.py", "generar_datos.py"):
        shutil.copy2(app / name, dest / "app" / name)
    for folder in ("web", "modelos"):
        shutil.copytree(app / folder, dest / "app" / folder, ignore=IGNORE)
    shutil.copytree(ROOT / "src" / "oil_forecast", dest / "src" / "oil_forecast", ignore=IGNORE)
    (dest / "data").mkdir()
    for path in (DATASET_PATH, METADATA_PATH):
        shutil.copy2(path, dest / "data" / path.name)
    shutil.copy2(app / "Dockerfile", dest / "Dockerfile")
    shutil.copy2(app / "requirements.txt", dest / "requirements.txt")
    shutil.copy2(app / "README_SPACE.md", dest / "README.md")

    size = sum(f.stat().st_size for f in dest.rglob("*") if f.is_file()) / 1e6
    print(f"Space listo en {dest} ({size:.1f} MB). Súbelo con:")
    print(f"  hf upload <usuario>/<space> {dest.relative_to(ROOT)} . --repo-type space")


if __name__ == "__main__":
    main()
