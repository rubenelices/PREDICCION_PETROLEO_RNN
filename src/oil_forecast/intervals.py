"""Prediction intervals for the h-day Brent forecast, calibrated only with the past.

All methods work on log prices: the interval is

    [ P_today * exp(center + q_low * scale),  P_today * exp(center + q_high * scale) ]

where ``q_low`` and ``q_high`` are the empirical quantiles of a calibration
score observed *before* the year being forecast (its target date is earlier
than the cutoff), so no future information is used.

Methods, simplest first:
    historico      center 0 (today's price), score = past h-day log returns
    conformal      center = model forecast, score = past model errors
    conformal_vol  as conformal, but errors are divided by the 21-day
                   volatility at their origin and multiplied by today's
"""

import numpy as np
import pandas as pd

from oil_forecast.config import INTERVAL_COVERAGE, INTERVAL_LEVEL, INTERVAL_TIE

METHODS = ("historico", "conformal", "conformal_vol")
METHOD_LABELS = {
    "historico": "Histórico (precio de hoy)",
    "conformal": "Conformal (errores del modelo)",
    "conformal_vol": "Conformal escalado por volatilidad",
}


def volatility(price: np.ndarray, window: int = 21) -> np.ndarray:
    """Rolling standard deviation of daily log returns (known at each day)."""
    r = pd.Series(np.log(price)).diff()
    return r.rolling(window).std().to_numpy()


def quantile_offsets(scores, level: float = INTERVAL_LEVEL) -> tuple[float, float]:
    a = (1 - level) / 2
    lo, hi = np.quantile(np.asarray(scores), [a, 1 - a])
    return float(lo), float(hi)


def interval_score(y, lo, hi, level: float = INTERVAL_LEVEL) -> np.ndarray:
    """Winkler interval score: width plus a penalty when the truth falls outside.

    Lower is better; it rewards narrow intervals that still contain the truth.
    """
    y, lo, hi = map(np.asarray, (y, lo, hi))
    alpha = 1 - level
    return (hi - lo) + 2 / alpha * (lo - y) * (y < lo) + 2 / alpha * (y - hi) * (y > hi)


def method_terms(method: str, frame: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    """Center (log return) and scale of the interval for each row of ``frame``."""
    if method == "historico":
        return np.zeros(len(frame)), np.ones(len(frame))
    if method == "conformal":
        return frame["pred"].to_numpy(), np.ones(len(frame))
    if method == "conformal_vol":
        return frame["pred"].to_numpy(), frame["vol"].to_numpy()
    raise ValueError(method)


def calibration_pool(method: str, frame: pd.DataFrame, history: pd.DataFrame, cutoff) -> np.ndarray:
    """Scores whose target date is before ``cutoff`` (already known then).

    ``frame``: out-of-sample forecasts (columns objetivo, real_ret, pred, vol).
    ``history``: every realised h-day log return of the series (objetivo, real_ret).
    """
    if method == "historico":
        known = history[history["objetivo"] < cutoff]
        return known["real_ret"].to_numpy()
    known = frame[frame["objetivo"] < cutoff]
    err = (known["real_ret"] - known["pred"]).to_numpy()
    return err / known["vol"].to_numpy() if method == "conformal_vol" else err


def bounds(method: str, frame: pd.DataFrame, offsets: tuple[float, float]) -> tuple[np.ndarray, np.ndarray]:
    center, scale = method_terms(method, frame)
    p0 = frame["p0"].to_numpy()
    return p0 * np.exp(center + offsets[0] * scale), p0 * np.exp(center + offsets[1] * scale)


def yearly_intervals(method: str, frame: pd.DataFrame, history: pd.DataFrame, years,
                     min_pool: int = 100) -> pd.DataFrame:
    """Intervals for every forecast of ``years``, recalibrated at the start of each year.

    Years whose calibration pool has fewer than ``min_pool`` scores are skipped.
    """
    out = []
    for year in years:
        rows = frame[frame["año"] == year]
        pool = calibration_pool(method, frame, history, pd.Timestamp(year=year, month=1, day=1))
        if rows.empty or len(pool) < min_pool:
            continue
        lo, hi = bounds(method, rows, quantile_offsets(pool))
        out.append(rows.assign(metodo=method, inf=lo, sup=hi, n_calibracion=len(pool)))
    return pd.concat(out, ignore_index=True)


def summarize(intervals: pd.DataFrame) -> dict:
    y, lo, hi, p0 = (intervals[c].to_numpy() for c in ("real", "inf", "sup", "p0"))
    return {
        "cobertura": float(np.mean((y >= lo) & (y <= hi))),
        "anchura_usd": float(np.mean(hi - lo)),
        "anchura_pct": float(np.mean((hi - lo) / p0) * 100),
        "puntuacion": float(np.mean(interval_score(y, lo, hi))),
        "n": len(intervals),
    }


def choose_method(summary: pd.DataFrame) -> str:
    """The rule of config.py. ``summary`` has one row per method (index = method)."""
    lo, hi = INTERVAL_COVERAGE
    ok = summary[(summary["cobertura"] >= lo) & (summary["cobertura"] <= hi)]
    if ok.empty:
        return str((summary["cobertura"] - INTERVAL_LEVEL).abs().idxmin())
    best = ok["puntuacion"].min()
    for method in METHODS:  # simplest first
        if method in ok.index and ok.loc[method, "puntuacion"] <= best * (1 + INTERVAL_TIE):
            return method
    raise AssertionError("unreachable")
