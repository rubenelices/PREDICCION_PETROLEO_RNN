"""80 % interval of the app forecast, chosen before the test.

Uses the out-of-sample forecasts of the final model (modelo_final.json) that
are already saved: backward validation 2010-2018 and validation 2019-2023.
No network is trained. Three methods are compared (see oil_forecast.intervals);
at the start of every year each one is calibrated only with what was known
then (scores whose target date is earlier). The rule in config.py picks one
method per horizon, and its final offsets are calibrated with everything
known before the test (target date before 2024-01-01).

Outputs (reports/results/ronda_N/):
    intervalo_resumen.csv      coverage, width and interval score per method
    intervalo_por_año.csv      the same, per year
    predicciones_intervalo.csv the yearly intervals of every forecast
    intervalo_decision.json    chosen method and final offsets per horizon

Usage:
    poetry run python scripts/intervalo.py [--round N]
"""

import argparse
import json

import numpy as np
import pandas as pd

from oil_forecast.config import (
    CURRENT_ROUND,
    HORIZONS,
    INTERVAL_COVERAGE,
    INTERVAL_LEVEL,
    INTERVAL_TIE,
    ROUNDS,
    TEST_START,
    results_dir,
)
from oil_forecast.intervals import (
    METHOD_LABELS,
    METHODS,
    calibration_pool,
    choose_method,
    quantile_offsets,
    summarize,
    volatility,
    yearly_intervals,
)
from oil_forecast.training import load_model_data


def forecast_frame(data, h: int, hname: str, final: dict, out) -> pd.DataFrame:
    """Out-of-sample forecasts of the app model, 2010-2023, with prices and volatility."""
    preds = pd.concat([
        pd.read_csv(out / "predicciones_hacia_atras.csv", parse_dates=["origen"]),
        pd.read_csv(out / "predicciones_validacion.csv", parse_dates=["origen"]),
    ])
    model = final["horizontes"][hname]
    rows = preds[(preds["horizonte"] == hname) & (preds["modelo"] == model["red"])].sort_values("origen")
    pos = data.feats.index.get_indexer(rows["origen"])
    assert (pos >= 0).all()
    price, vol = data.price, volatility(data.price)
    return pd.DataFrame({
        "origen": rows["origen"].to_numpy(),
        "objetivo": data.feats.index[pos + h],
        "año": rows["año"].to_numpy(),
        "p0": price[pos],
        "real": price[pos + h],
        "real_ret": np.log(price[pos + h] / price[pos]),
        "pred": model["peso"] * rows["retorno_pred"].to_numpy(),
        "vol": vol[pos],
    })


def history_frame(data, h: int) -> pd.DataFrame:
    price = data.price
    return pd.DataFrame({
        "objetivo": data.feats.index[h:],
        "real_ret": np.log(price[h:] / price[:-h]),
    })


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--round", type=int, choices=ROUNDS, default=CURRENT_ROUND)
    args = parser.parse_args()
    out = results_dir(args.round)
    final = json.loads((out / "modelo_final.json").read_text())
    data = load_model_data()

    summary, by_year, intervals, decision = [], [], [], {}
    for hname, h in HORIZONS.items():
        frame, history = forecast_frame(data, h, hname, final, out), history_frame(data, h)
        # same years for every method: those with enough past model errors
        years = sorted(yearly_intervals("conformal", frame, history, sorted(frame["año"].unique()))["año"].unique())
        rows = {}
        for method in METHODS:
            iv = yearly_intervals(method, frame, history, years)
            intervals.append(iv.assign(horizonte=hname))
            rows[method] = summarize(iv)
            summary.append({"horizonte": hname, "metodo": method, **rows[method],
                            "años": f"{iv['año'].min()}-{iv['año'].max()}"})
            for year, g in iv.groupby("año"):
                by_year.append({"horizonte": hname, "metodo": method, "año": year, **summarize(g)})
        table = pd.DataFrame(rows).T
        chosen = choose_method(table)
        cutoff = pd.Timestamp(TEST_START)
        pool = calibration_pool(chosen, frame, history, cutoff)
        offsets = quantile_offsets(pool)
        decision[hname] = {
            "modelo": final["horizontes"][hname]["modelo"],
            "metodo": chosen,
            "metodo_nombre": METHOD_LABELS[chosen],
            "centro": "precio de hoy" if chosen == "historico" else "predicción del modelo",
            "escala": "volatilidad de 21 días" if chosen == "conformal_vol" else "ninguna",
            "q_inferior": offsets[0],
            "q_superior": offsets[1],
            "n_calibracion": len(pool),
            "cobertura_2010_2023": rows[chosen]["cobertura"],
            "anchura_pct_2010_2023": rows[chosen]["anchura_pct"],
        }

        years_cov = pd.DataFrame([r for r in by_year if r["horizonte"] == hname]).pivot(
            index="metodo", columns="año", values="cobertura").loc[list(METHODS)]
        print(f"\n== {hname} ({h} d), modelo de la app: {final['horizontes'][hname]['modelo']}")
        show = table[["cobertura", "anchura_pct", "anchura_usd", "puntuacion", "n"]].copy()
        show.index = [METHOD_LABELS[m] for m in show.index]
        print(show.round({"cobertura": 3, "anchura_pct": 1, "anchura_usd": 2, "puntuacion": 2}).to_string())
        print("cobertura por año:")
        print((years_cov * 100).round(0).astype(int).to_string())
        print(f"→ intervalo elegido: {METHOD_LABELS[chosen]}  (cuantiles {offsets[0]:+.4f} / {offsets[1]:+.4f},"
              f" calibrado con {len(pool)} valores anteriores a {TEST_START})")

    pd.DataFrame(summary).to_csv(out / "intervalo_resumen.csv", index=False)
    pd.DataFrame(by_year).to_csv(out / "intervalo_por_año.csv", index=False)
    pd.concat(intervals).to_csv(out / "predicciones_intervalo.csv", index=False)
    rule = (f"Intervalo del {INTERVAL_LEVEL:.0%}. Regla fijada antes de calcular: en cada horizonte, entre los "
            f"métodos con cobertura total entre el {INTERVAL_COVERAGE[0]:.0%} y el {INTERVAL_COVERAGE[1]:.0%} "
            f"(2010-2023, calibrando cada año solo con lo ya conocido), gana el de menor puntuación de intervalo "
            f"media; uno más sencillo a menos del {INTERVAL_TIE:.0%} gana. Si ninguno cubre lo bastante, el de "
            f"cobertura más cercana. Los cuantiles finales se calibran con lo conocido antes de {TEST_START}.")
    (out / "intervalo_decision.json").write_text(json.dumps(
        {"regla": rule, "nivel": INTERVAL_LEVEL, "horizontes": decision}, ensure_ascii=False, indent=2))
    print(f"\nIntervalo guardado en {out}")


if __name__ == "__main__":
    main()
