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
from datetime import datetime

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
