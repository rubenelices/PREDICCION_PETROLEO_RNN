"""Write the JSON files that the web reads (app/web/datos/).

Two kinds of files:
- from the data and the saved app models (refreshed by the app whenever the
  data are updated or the models retrained): historico, eventos, prediccion,
  mercado, activos, comparar, velas, estado;
- from the test of the final round (only when its results are available,
  i.e. when run inside the repository): comparativa, backtest.

Usage:
    poetry run python app/generar_datos.py
"""

import ast
import json
from pathlib import Path

import numpy as np
import pandas as pd

from oil_forecast.app_model import APP_MODELS_DIR, forecast, read_spec
from oil_forecast.config import (
    CURRENT_ROUND,
    DATASET_PATH,
    ROOT,
    TEST_START,
    results_dir,
)
from oil_forecast.data import load_metadata
from oil_forecast.training import load_model_data

OUT = Path(__file__).resolve().parent / "web" / "datos"
PLAZOS = {"corto": 5, "medio": 63, "largo": 252}
NAMES = {"rnn": "RNN simple", "lstm": "LSTM", "gru": "GRU"}
ACTIVOS = [  # key in the web, column, name, short name, unit, decimals
    ("brent", "brent", "Brent", "Brent", "$", 2),
    ("wti", "wti", "WTI (crudo de EE. UU.)", "WTI", "$", 2),
    ("gas", "gas_fut", "Gas natural", "Gas", "$", 2),
    ("oro", "oro", "Oro", "Oro", "$", 0),
    ("cobre", "cobre", "Cobre", "Cobre", "$", 2),
    ("dolar", "indice_dolar", "Índice del dólar", "Dólar", "", 1),
    ("eurusd", "usd_por_eur", "Euro frente al dólar", "EUR/USD", "", 3),
    ("vix", "vix", "Miedo en bolsa (VIX)", "VIX", "", 1),
]


def dump(name: str, obj, compact: bool = False) -> None:
    kw = {"separators": (",", ":")} if compact else {"indent": 1}
    (OUT / f"{name}.json").write_text(json.dumps(obj, ensure_ascii=False, **kw))


def model_summary(spec: dict) -> str:
    """Which network the app uses at each horizon, in words."""
    by_net = {}
    for k, s in spec["horizontes"].items():
        by_net.setdefault(NAMES[s["modelo_app"]["celda"]], []).append({"corto": "1 semana", "medio": "3 meses",
                                                                      "largo": "1 año"}[k])
    return " · ".join(f"{net} a {' y '.join(hs)}" for net, hs in by_net.items())


def display_name(s: dict) -> str:
    """Name shown for the app model of a horizon: with weight 1 the adjusted version is the network itself."""
    m = s["modelo_app"]
    return NAMES[m["celda"]] if m["peso"] == 1 else m["nombre"]


def test_metrics(spec: dict) -> dict | None:
    """Test metrics of the app model of each horizon (None outside the repository)."""
    path = results_dir(CURRENT_ROUND) / "comparativa.csv"
    if not path.exists():
        if path.parent.exists():  # inside the repository the test must have been run
            raise SystemExit(f"Falta {path}: ejecuta antes `scripts/train.py test`.")
        return None
    comp = pd.read_csv(path)
    out = {}
    for k, s in spec["horizontes"].items():
        row = comp[(comp.horizonte == k) & (comp.modelo == s["modelo_app"]["nombre"])].iloc[0]
        naive = comp[(comp.horizonte == k) & (comp.modelo == "Ingenuo")].iloc[0]
        out[k] = {"mejora_vs_ingenuo_pct": round(float(row["Mejora_RMSE_vs_ingenuo_%"]), 2),
                  "mejora_mae_vs_ingenuo_pct": round(float((1 - row.MAE / naive.MAE) * 100), 2),
                  "direccion_pct": round(float(row["Direccion_%"]), 1)}
    return out


def write_test_files(spec: dict) -> None:
    out = results_dir(CURRENT_ROUND)
    if not (out / "comparativa.csv").exists():
        print("Sin resultados del test en este entorno: se mantienen comparativa.json y backtest.json.")
        return
    comp = pd.read_csv(out / "comparativa.csv")
    pred = pd.read_csv(out / "predicciones_test.csv")
    filas = []
    for _, f in comp[comp.modelo.isin(["Ingenuo", *NAMES.values()])].iterrows():
        filas.append({"horizonte": f.horizonte, "h": int(f.h), "modelo": f.modelo, "mae": round(f.MAE, 2),
                      "rmse": round(f.RMSE, 2), "mejora_pct": round(f["Mejora_RMSE_vs_ingenuo_%"], 2),
                      "parametros": int(f.n_params),
                      "tiempo_s": None if pd.isna(f.get("tiempo_entrenamiento_s")) else round(f.tiempo_entrenamiento_s, 1)})
    dump("comparativa", {"fuente": f"test {TEST_START[:4]}-2026", "filas": filas})

    backtest = {"horizontes": {}}
    for k, s in spec["horizontes"].items():
        name = s["modelo_app"]["nombre"]
        q = pred[(pred.horizonte == k) & (pred.modelo == name)].sort_values("fecha_objetivo")
        hit = ((q.precio_pred - q.precio_hoy) * (q.precio_real - q.precio_hoy) > 0).mean()
        backtest["horizontes"][k] = {
            "modelo": display_name(s), "fechas": q.fecha_objetivo.tolist(), "real": q.precio_real.round(2).tolist(),
            "previsto": q.precio_pred.round(2).tolist(),
            "error_medio": round(float((q.precio_real - q.precio_pred).abs().mean()), 2),
            "error_medio_ingenuo": round(float((q.precio_real - q.precio_hoy).abs().mean()), 2),
            "acierto_direccion_pct": round(float(hit * 100), 1),
        }
    dump("backtest", backtest, compact=True)


def write_data_files(spec: dict) -> None:
    raw = pd.read_csv(DATASET_PATH, parse_dates=["Date"]).set_index("Date")
    d = raw["brent"].dropna()
    dump("historico", {"fechas": d.index.strftime("%Y-%m-%d").tolist(), "precios": d.round(2).tolist()}, compact=True)

    src = (ROOT / "src" / "oil_forecast" / "events.py").read_text()
    eventos = ast.literal_eval(src[src.index("["):])
    for e in eventos:
        e["precio"] = float(d.asof(pd.Timestamp(e["date"])))
    dump("eventos", eventos)

    full = raw[["brent", "wti", "usd_por_eur", "vix"]].ffill()
    full["volatilidad"] = np.log(full.brent).diff().rolling(21).std() * np.sqrt(252) * 100
    full["diferencial"] = full.brent - full.wti
    semanal = full.loc[full.index[-1] - pd.DateOffset(years=1):].resample("W-FRI").last()

    def indicador(col, nombre, unidad, decimales, texto):
        serie = full[col].dropna()
        hoy = float(serie.iloc[-1])
        return {"nombre": nombre, "unidad": unidad, "decimales": decimales, "texto": texto, "hoy": round(hoy, 4),
                "mediana_historica": round(float(serie.median()), 4), "percentil": round(float((serie < hoy).mean()), 3),
                "hace_3m": round(float(serie.loc[: serie.index[-1] - pd.DateOffset(months=3)].iloc[-1]), 4),
                "serie": [round(float(x), 4) for x in semanal[col].dropna()]}

    dump("mercado", {"fecha_dato": f"{full.index[-1]:%Y-%m-%d}", "desde": f"{semanal.index[0]:%Y-%m-%d}", "indicadores": [
        indicador("volatilidad", "Agitación del Brent", "%", 0, "Cuánto se mueve el precio cada día, en ritmo anual"),
        indicador("vix", "Miedo en bolsa (VIX)", "", 1, "Nervios en los mercados de acciones de EE. UU."),
        indicador("usd_por_eur", "Euro frente al dólar", "$", 3, "Dólares por cada euro; el crudo se paga en dólares"),
        indicador("diferencial", "Brent frente a WTI", "$", 2, "Diferencia con el crudo de referencia de EE. UU."),
    ]})

    todo = raw[raw.brent.notna()]
    activos = []
    for clave, col, nombre, corto, unidad, dec in ACTIVOS:
        s = todo[col].ffill().dropna()
        s = s[s > 0]
        v = float(s.iloc[-1])
        anio = s.loc[s.index[-1] - pd.DateOffset(years=1):].resample("W-FRI").last().dropna()
        activos.append({"clave": clave, "nombre": nombre, "corto": corto, "unidad": unidad, "decimales": dec,
                        "hoy": round(v, 4), **{f"{k}_pct": round(float((v / s.iloc[-1 - n] - 1) * 100), 2)
                                               for k, n in (("d1", 1), ("m1", 21), ("m3", 63))},
                        "percentil": round(float((s < v).mean()), 3), "serie": [round(float(x), 4) for x in anio]})
    dump("activos", {"fecha_dato": f"{todo.index[-1]:%Y-%m-%d}", "activos": activos})

    comparar = {}
    for clave, col, _, corto, *_ in ACTIVOS[1:6]:
        s = todo[col].ffill().where(lambda x: x > 0)
        comparar[clave] = {"nombre": corto, "valores": [None if pd.isna(x) else round(float(x), 3) for x in s]}
    dump("comparar", comparar, compact=True)

    fut = todo[[f"brent_fut_{c}" for c in ("Open", "High", "Low", "Close")]].dropna().tail(520)
    dump("velas", {"fechas": fut.index.strftime("%Y-%m-%d").tolist(),
                   **{k: fut[f"brent_fut_{c}"].round(2).tolist()
                      for k, c in (("o", "Open"), ("h", "High"), ("l", "Low"), ("c", "Close"))}}, compact=True)

    data = load_model_data()
    fc = forecast(data)
    metrics = test_metrics(spec)
    if metrics is None:  # inside the app: keep the test metrics already published
        old = json.loads((OUT / "prediccion.json").read_text())["horizontes"]
        metrics = {k: {m: old[k][m] for m in ("mejora_vs_ingenuo_pct", "mejora_mae_vs_ingenuo_pct", "direccion_pct")}
                   for k in PLAZOS}
    hoy = pd.Timestamp(fc["fecha_dato"])
    prev = {"modelo": model_summary(spec), "fecha_dato": fc["fecha_dato"],
            "precio_hoy": round(fc["precio_hoy"], 2), "precio_anterior": round(float(d.iloc[-2]), 2),
            "horizontes": {}, "redes": {NAMES[c]: {} for c in NAMES}}
    for k, f in fc["horizontes"].items():
        s = spec["horizontes"][k]
        prev["horizontes"][k] = {
            "dias_habiles": f["h"], "fecha_objetivo": f"{pd.bdate_range(hoy, periods=f['h'] + 1)[-1]:%Y-%m-%d}",
            "precio": round(f["precio"], 2), "variacion_pct": round(float(np.expm1(f["retorno"]) * 100), 2),
            "rango80": [round(x, 2) for x in f["rango80"]], "modelo": display_name(s),
            "red": NAMES[s["modelo_app"]["celda"]], "intervalo": s["intervalo"]["metodo_nombre"], **metrics[k],
        }
        for c, v in f["redes"].items():
            prev["redes"][NAMES[c]][k] = round(v, 2)
    dump("prediccion", prev)

    meta, modelos = load_metadata(), json.loads((APP_MODELS_DIR / "modelos.json").read_text())
    any_h = next(iter(spec["horizontes"].values()))
    dump("estado", {
        "descargado": meta["downloaded_at"], "filas": meta["rows"], "desde": meta["first_date"],
        "hasta": meta["last_brent_date"], "series": len(meta["last_observation"]),
        "variables_modelo": int(data.feats.shape[1]), "ventana_dias": int(any_h["redes"]["lstm"]["window"]),
        "inicio_test": TEST_START, "modelo": prev["modelo"],
        "entrenado": modelos["entrenado"], "datos_entrenamiento_hasta": modelos["ultimo_dato"],
    })


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    spec = read_spec()
    write_test_files(spec)
    write_data_files(spec)
    print(f"Datos de la web escritos en {OUT}")


if __name__ == "__main__":
    main()
