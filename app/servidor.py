"""Web server of the app: serves the panel and runs the Python side.

Endpoints (the panel's "Datos" section calls the two POST ones):
    POST /api/actualizar   download the latest data, forecast again with the
                           saved models and rewrite the web's data (~1 min)
    POST /api/reentrenar   retrain the networks on all the data in the
                           background, then forecast again (several minutes)
    GET  /api/estado       what the server is doing and how far it has got

Run locally:
    poetry run uvicorn app.servidor:app --port 7860
"""

import re
import subprocess
import sys
import threading
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from oil_forecast.app_model import train_app_models
from oil_forecast.data import run_etl

APP_DIR = Path(__file__).resolve().parent
WEB_DIR = APP_DIR / "web"

app = FastAPI(title="Previsión del Brent")
lock = threading.Lock()
state = {"tarea": None, "progreso": None, "ultimo_mensaje": None, "error": None}


def regenerate() -> None:
    """Rewrite the web's JSON files (separate process, so it always reads fresh modules and data)."""
    subprocess.run([sys.executable, str(APP_DIR / "generar_datos.py")], check=True)


def finish(message: str | None = None, error: str | None = None) -> None:
    stamp = datetime.now().strftime("%d/%m/%Y %H:%M")
    state.update(tarea=None, progreso=None, error=error,
                 ultimo_mensaje=f"{message} ({stamp})" if message else state["ultimo_mensaje"])


def busy() -> JSONResponse:
    return JSONResponse({"mensaje": f"Ya hay una tarea en marcha: {state['tarea']}. "
                                    f"{state['progreso'] or ''} Prueba de nuevo en unos minutos."}, status_code=409)


@app.post("/api/actualizar")
def update_data():
    if not lock.acquire(blocking=False):
        return busy()
    try:
        state.update(tarea="actualizar datos", progreso="Descargando datos de FRED y Yahoo Finance…", error=None)
        data = run_etl()
        state["progreso"] = "Calculando la previsión…"
        regenerate()
        last = f"{data.index.max():%d/%m/%Y}"
        finish(f"Datos actualizados hasta el {last} y previsión recalculada")
        return {"mensaje": f"Datos actualizados hasta el {last} y previsión recalculada. Recarga la página para verla."}
    except Exception as e:  # noqa: BLE001 (any failure is reported to the user in the panel)
        finish(error=str(e))
        return JSONResponse({"mensaje": f"No se pudieron actualizar los datos: {e}"}, status_code=502)
    finally:
        lock.release()


def retrain_job() -> None:
    try:
        train_app_models(progress=lambda d, t, txt: state.update(progreso=f"Modelo {d} de {t} ({txt})."))
        state["progreso"] = "Calculando la previsión…"
        regenerate()
        finish("Redes reentrenadas con todos los datos y previsión recalculada")
    except Exception as e:  # noqa: BLE001 (reported through /api/estado)
        finish(error=str(e))
    finally:
        lock.release()


@app.post("/api/reentrenar")
def retrain():
    if not lock.acquire(blocking=False):
        return busy()
    state.update(tarea="reentrenar", progreso="Empezando…", error=None)
    threading.Thread(target=retrain_job, daemon=True).start()
    return {"mensaje": "Reentrenando las tres redes de cada plazo con todos los datos (45 modelos pequeños). "
                       "Tarda varios minutos; cuando acabe, recarga la página para ver la nueva previsión."}


@app.get("/api/estado")
def status():
    return state


# Page code (HTML, JS, CSS) is served with a version stamp in every "?v=" of its links and
# imports: the newest modification time of those files. Any edit changes the stamp, so the
# browser always loads the new files and can never reuse a stale copy; the page itself is
# never cached. Data are never cached either; textures keep the default caching.
VERSION_RE = re.compile(r"\?v=[0-9A-Za-z]+")
CODE_TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8"}


def code_version() -> str:
    return str(int(max(p.stat().st_mtime for p in WEB_DIR.iterdir() if p.suffix in CODE_TYPES)))


@app.middleware("http")
async def versioned_code(request, call_next):
    path = request.url.path
    if request.method == "GET" and not path.startswith(("/api/", "/datos/")):
        name = "index.html" if path == "/" else path.lstrip("/")
        file = (WEB_DIR / name).resolve()
        if file.suffix in CODE_TYPES and file.parent == WEB_DIR and file.is_file():
            text = VERSION_RE.sub(f"?v={code_version()}", file.read_text(encoding="utf-8"))
            cache = "no-store" if file.suffix == ".html" else "no-cache"
            return Response(text, media_type=CODE_TYPES[file.suffix], headers={"Cache-Control": cache})
    response = await call_next(request)
    if path.startswith("/datos/"):
        response.headers["Cache-Control"] = "no-store"
    return response


app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")
