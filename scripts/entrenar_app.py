"""Train the models of the web app on all the data (after the test).

Writes ``app/modelos/especificacion.json`` from the decisions already taken
(modelo_final.json, the tuned configurations and intervalo_decision.json),
retrains the three networks of every horizon with every origin whose target
is known (5 seeds each), saves their weights in ``app/modelos/`` and then
regenerates the data of the web (``app/generar_datos.py``).

Usage:
    poetry run python scripts/entrenar_app.py [--round N]
"""

import argparse
import json
import subprocess
import sys
import time

from oil_forecast.app_model import APP_MODELS_DIR, SPEC_FILE, train_app_models
from oil_forecast.config import (
    CURRENT_ROUND,
    HORIZONS,
    ROOT,
    ROUNDS,
    TUNED_ROUND,
    results_dir,
    study_name,
    tuned_window,
    tuning_dir,
)

CELLS = {"RNN simple": "rnn", "LSTM": "lstm", "GRU": "gru"}


def tuned_config(cell: str, horizon: int, round_: int) -> dict:
    window = tuned_window(horizon, round_)
    best = json.loads((tuning_dir(TUNED_ROUND[round_]) / f"{study_name(cell, horizon, window)}_best.json").read_text())
    return {**best["params"], **({"window": window} if window else {})}


def write_spec(round_: int) -> dict:
    out = results_dir(round_)
    final = json.loads((out / "modelo_final.json").read_text())
    interval = json.loads((out / "intervalo_decision.json").read_text())
    spec = {"ronda": round_, "horizontes": {}}
    for hname, h in HORIZONS.items():
        m, iv = final["horizontes"][hname], interval["horizontes"][hname]
        spec["horizontes"][hname] = {
            "h": h,
            "redes": {cell: tuned_config(cell, h, round_) for cell in CELLS.values()},
            "modelo_app": {"nombre": m["modelo"], "celda": CELLS[m["red"]], "peso": m["peso"]},
            "intervalo": {k: iv[k] for k in ("metodo", "metodo_nombre", "q_inferior", "q_superior")},
        }
    APP_MODELS_DIR.mkdir(parents=True, exist_ok=True)
    (APP_MODELS_DIR / SPEC_FILE).write_text(json.dumps(spec, ensure_ascii=False, indent=1))
    return spec


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--round", type=int, choices=ROUNDS, default=CURRENT_ROUND)
    args = parser.parse_args()
    write_spec(args.round)
    start = time.perf_counter()
    train_app_models(progress=lambda d, t, txt: print(f"  [{d:>2}/{t}] {txt}", flush=True))
    print(f"Modelos guardados en {APP_MODELS_DIR} ({(time.perf_counter() - start) / 60:.1f} min)")
    subprocess.run([sys.executable, str(ROOT / "app" / "generar_datos.py")], check=True)


if __name__ == "__main__":
    main()
