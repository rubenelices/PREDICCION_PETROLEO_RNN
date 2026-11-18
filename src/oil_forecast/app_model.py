"""Models of the web app: trained on all the data, saved, and used to forecast from the last day.

After the test, the chosen configurations are retrained with every origin
whose target is already known (same early-stopping rule and seeds as in the
experiments) and saved in ``app/modelos``. The app loads them to forecast from
the latest price, and can retrain them when new data arrive.

``especificacion.json`` (written by ``scripts/entrenar_app.py``) holds, per
horizon, the configuration of each network, the network used by the app, its
adjustment weight and the 80 % interval chosen before the test.
"""

import json
import time
from datetime import UTC, datetime

import numpy as np
import pandas as pd
import torch

from oil_forecast.config import FINAL_SEEDS, ROOT
from oil_forecast.features import FoldScaler
from oil_forecast.intervals import volatility
from oil_forecast.models import RecurrentRegressor
from oil_forecast.training import (
    ModelData,
    TrainConfig,
    fit,
    load_model_data,
    predict,
    prepare,
)

APP_MODELS_DIR = ROOT / "app" / "modelos"
SPEC_FILE = "especificacion.json"


def read_spec(model_dir=APP_MODELS_DIR) -> dict:
    return json.loads((model_dir / SPEC_FILE).read_text())


def _scaler_to_dict(scaler: FoldScaler) -> dict:
    return {k: getattr(scaler, k).round(10).tolist() for k in ("lo_", "hi_", "mean_", "std_")} | {
        "columnas": list(scaler.mean_.index)}


def _scaler_from_dict(d: dict) -> FoldScaler:
    scaler = FoldScaler()
    for k in ("lo_", "hi_", "mean_", "std_"):
        setattr(scaler, k, pd.Series(d[k], index=d["columnas"]))
    return scaler


def train_app_models(data: ModelData | None = None, model_dir=APP_MODELS_DIR, seeds=FINAL_SEEDS,
                     progress=None) -> dict:
    """Retrain every network of every horizon on all known targets and save it.

    ``progress(done, total, text)`` is called after each model (used by the app).
    Returns the metadata written to ``modelos.json``.
    """
    spec = read_spec(model_dir)
    data = data or load_model_data()
    last = len(data.index) - 1
    total = sum(len(s["redes"]) for s in spec["horizontes"].values()) * len(seeds)
    done, meta = 0, {"entrenado": datetime.now().isoformat(timespec="seconds"),
                     "ultimo_dato": f"{data.index[-1]:%Y-%m-%d}", "horizontes": {}}
    for hname, s in spec["horizontes"].items():
        h = s["h"]
        train_pos = np.arange(0, last - h + 1)  # origins whose target is already known
        meta["horizontes"][hname] = {}
        for cell, cfg_dict in s["redes"].items():
            cfg = TrainConfig(**cfg_dict)
            p = prepare(data, h, train_pos, [last], cfg.window, cfg.features)
            times = []
            for seed in seeds:
                start = time.perf_counter()
                model, info = fit(cell, cfg, p, seed=seed)
                times.append(time.perf_counter() - start)
                torch.save(model.state_dict(), model_dir / f"{hname}_{cell}_{seed}.pt")
                done += 1
                if progress:
                    progress(done, total, f"{hname} · {cell} · semilla {seed}")
            meta["horizontes"][hname][cell] = {
                "semillas": list(seeds), "n_features": int(p["X_fit"].shape[-1]),
                "y_mean": p["y_mean"], "y_std": p["y_std"], "escalado": _scaler_to_dict(p["scaler"]),
                "origenes_entrenamiento": len(train_pos), "tiempo_medio_s": float(np.mean(times)),
                "n_params": int(info["n_params"]),
            }
    (model_dir / "modelos.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1))
    return meta


def _load(model_dir, hname: str, cell: str, cfg: TrainConfig, info: dict, seed: int) -> RecurrentRegressor:
    model = RecurrentRegressor(cell, info["n_features"], cfg.hidden_size, cfg.num_layers, cfg.dropout,
                               cfg.linear_skip)
    model.load_state_dict(torch.load(model_dir / f"{hname}_{cell}_{seed}.pt", weights_only=True))
    model.eval()
    return model


def forecast(data: ModelData | None = None, model_dir=APP_MODELS_DIR) -> dict:
    """Forecast from the last day of ``data`` with the saved models.

    Returns, per horizon, the log return of each network (mean of its seeds,
    without the training drift), the app forecast (its network times its
    weight) and the 80 % interval in prices.
    """
    spec, meta = read_spec(model_dir), json.loads((model_dir / "modelos.json").read_text())
    data = data or load_model_data()
    last = len(data.index) - 1
    price, vol = data.price[last], volatility(data.price)[last]
    out = {"fecha_dato": f"{data.index[last]:%Y-%m-%d}", "precio_hoy": float(price), "horizontes": {}}
    for hname, s in spec["horizontes"].items():
        nets = {}
        for cell, cfg_dict in s["redes"].items():
            cfg, info = TrainConfig(**cfg_dict), meta["horizontes"][hname][cell]
            feats = data.feats if cfg.features is None else data.feats[list(cfg.features)]
            X = _scaler_from_dict(info["escalado"]).transform(feats).to_numpy(dtype=np.float32)
            p = {"X_eval": X[None, last - cfg.window + 1: last + 1].copy(), "y_mean": info["y_mean"], "y_std": info["y_std"]}
            preds = [predict(_load(model_dir, hname, cell, cfg, info, seed), p, detrend=True)[0]
                     for seed in info["semillas"]]
            nets[cell] = float(np.mean(preds))
        app = s["modelo_app"]
        ret = app["peso"] * nets[app["celda"]]
        iv = s["intervalo"]
        center = 0.0 if iv["metodo"] == "historico" else ret
        scale = vol if iv["metodo"] == "conformal_vol" else 1.0
        out["horizontes"][hname] = {
            "h": s["h"], "retorno": ret, "precio": float(price * np.exp(ret)),
            "rango80": [float(price * np.exp(center + iv["q_inferior"] * scale)),
                        float(price * np.exp(center + iv["q_superior"] * scale))],
            "redes": {c: float(price * np.exp(r)) for c, r in nets.items()},
        }
    return out


def track(since: str | None = None, data: ModelData | None = None, model_dir=APP_MODELS_DIR) -> pd.DataFrame:
    """Forecasts of the saved app models from each day after their training data, against the real price.

    The models are not retrained: each new day only passes through them, as in
    the app's "update data" button. ``since`` defaults to the last day the
    models were trained with. One row per origin and horizon; the real price,
    the errors and whether it fell in the 80 % interval are empty until the
    target date is in the data.
    """
    data = data or load_model_data()
    rows = [{**r, **_outcome(data, r)} for r in _forecasts_since(data, since, model_dir)]
    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# Follow-up log: the forecast of each day, written down the day it is made
# ---------------------------------------------------------------------------
FOLLOW_LOG = ROOT / "reports" / "seguimiento" / "previsiones.csv"


def _forecasts_since(data: ModelData, since: str | None, model_dir, skip: set | None = None) -> list[dict]:
    """Forecast of every day of ``data`` from ``since`` (default: the last training day), without retraining."""
    meta = json.loads((model_dir / "modelos.json").read_text())
    since = pd.Timestamp(since or meta["ultimo_dato"])
    rows = []
    for k in np.flatnonzero(data.index >= since):
        if skip and data.index[k] in skip:
            continue
        sub = ModelData(data.feats.iloc[: k + 1], data.targets.iloc[: k + 1], data.price[: k + 1])
        f = forecast(sub, model_dir)
        for hname, h in f["horizontes"].items():
            rows.append({"origen": data.index[k], "horizonte": hname, "h": h["h"], "precio_hoy": f["precio_hoy"],
                         "prevision": h["precio"], "ic80_inferior": h["rango80"][0], "ic80_superior": h["rango80"][1]})
    return rows


def _outcome(data: ModelData, r: dict) -> dict:
    """Target date, real price and errors of one forecast, once its target date is in ``data``."""
    k = data.index.searchsorted(r["origen"])
    t = k + r["h"]
    known = k < len(data.index) and data.index[k] == r["origen"] and t < len(data.index)
    real = float(data.price[t]) if known else np.nan
    return {
        "fecha_objetivo": data.index[t] if known else r["origen"] + pd.offsets.BDay(r["h"]),
        "objetivo_conocido": known, "precio_real": real,
        "error_modelo": abs(real - r["prevision"]) if known else np.nan,
        "error_ingenuo": abs(real - r["precio_hoy"]) if known else np.nan,
        "dentro_ic80": bool(r["ic80_inferior"] <= real <= r["ic80_superior"]) if known else None,
    }


def log_forecasts(data: ModelData | None = None, path=FOLLOW_LOG, model_dir=APP_MODELS_DIR) -> int:
    """Append to the follow-up log the forecasts of the days of ``data`` that are not in it yet.

    Each row keeps the date it was written (``registrada``, UTC), so that a
    forecast can later be told apart from one computed after its target was
    known. Rows already in the log are never rewritten, even if the data are
    revised afterwards. Returns the number of days added.
    """
    data = data or load_model_data()
    old = pd.read_csv(path, parse_dates=["origen"]) if path.exists() else None
    done = set(old.origen) if old is not None else set()
    rows = _forecasts_since(data, None, model_dir, skip=done)
    if not rows:
        return 0
    new = pd.DataFrame(rows).assign(registrada=datetime.now(UTC).strftime("%Y-%m-%d"))
    out = new if old is None else pd.concat([old, new], ignore_index=True)
    path.parent.mkdir(parents=True, exist_ok=True)
    out.assign(origen=out.origen.dt.strftime("%Y-%m-%d")).to_csv(path, index=False, float_format="%.4f")
    return new.origen.nunique()


def read_log(data: ModelData | None = None, path=FOLLOW_LOG) -> pd.DataFrame:
    """The follow-up log against the real price, with the same columns as :func:`track`.

    ``a_ciegas`` is true when the forecast was written before its target date,
    i.e. without knowing the price it predicts.
    """
    data = data or load_model_data()
    log = pd.read_csv(path, parse_dates=["origen", "registrada"])
    out = pd.DataFrame([{**r, **_outcome(data, r)} for r in log.to_dict("records")])
    return out.assign(a_ciegas=out.registrada < out.fecha_objetivo)
