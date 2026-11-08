"""Evaluation metrics, all computed on prices in USD unless stated otherwise."""

import numpy as np
from scipy import stats


def mse(y_true, y_pred) -> float:
    return float(np.mean((np.asarray(y_true) - np.asarray(y_pred)) ** 2))


def mae(y_true, y_pred) -> float:
    return float(np.mean(np.abs(np.asarray(y_true) - np.asarray(y_pred))))


def rmse(y_true, y_pred) -> float:
    return float(np.sqrt(mse(y_true, y_pred)))


def mape(y_true, y_pred) -> float:
    y_true, y_pred = np.asarray(y_true), np.asarray(y_pred)
    return float(np.mean(np.abs((y_true - y_pred) / y_true)) * 100)


def directional_accuracy(price_now, y_true, y_pred) -> float:
    """Share of origins where the predicted direction of change is right.

    Origins where the prediction is exactly flat (naive model) are ignored,
    so the naive model has no defined directional accuracy.
    """
    true_dir = np.sign(np.asarray(y_true) - np.asarray(price_now))
    pred_dir = np.sign(np.asarray(y_pred) - np.asarray(price_now))
    mask = pred_dir != 0
    if not mask.any():
        return float("nan")
    return float(np.mean(true_dir[mask] == pred_dir[mask]) * 100)


def skill(model_error: float, naive_error: float) -> float:
    """Improvement over the naive model in % (positive = better than naive)."""
    return float((1 - model_error / naive_error) * 100)


def evaluate(price_now, y_true, y_pred, naive_pred=None) -> dict:
    out = {
        "MSE": mse(y_true, y_pred),
        "MAE": mae(y_true, y_pred),
        "RMSE": rmse(y_true, y_pred),
        "MAPE": mape(y_true, y_pred),
        "Direccion_%": directional_accuracy(price_now, y_true, y_pred),
    }
    if naive_pred is not None:
        out["Mejora_RMSE_vs_ingenuo_%"] = skill(out["RMSE"], rmse(y_true, naive_pred))
        out["Mejora_MAE_vs_ingenuo_%"] = skill(out["MAE"], mae(y_true, naive_pred))
    return out


def diebold_mariano(e_model, e_naive, horizon: int) -> tuple[float, float]:
    """Diebold-Mariano test with squared loss and Harvey et al. correction.

    Uses a Newey-West variance with ``horizon - 1`` lags because h-step
    forecast errors are autocorrelated. Negative statistic = model better.
    Returns (statistic, two-sided p-value).
    """
    d = np.asarray(e_model) ** 2 - np.asarray(e_naive) ** 2
    n = len(d)
    d_mean = d.mean()
    d_c = d - d_mean
    lags = max(horizon - 1, 0)
    gamma0 = np.dot(d_c, d_c) / n
    var = gamma0
    for k in range(1, min(lags, n - 1) + 1):
        w = 1 - k / (lags + 1)
        var += 2 * w * np.dot(d_c[k:], d_c[:-k]) / n
    dm = d_mean / np.sqrt(var / n)
    correction = np.sqrt((n + 1 - 2 * horizon + horizon * (horizon - 1) / n) / n)
    dm *= correction
    p = 2 * stats.t.sf(np.abs(dm), df=n - 1)
    return float(dm), float(p)


def evaluate_forecast(price: np.ndarray, horizon: int, origins: np.ndarray, log_return_pred) -> dict:
    """All metrics for h-day log-return forecasts made at ``origins``.

    Prices are reconstructed as P[t] * exp(prediction) and compared with the
    real P[t+h] and with the naive forecast P[t].
    """
    origins = np.asarray(origins)
    p_now, p_true = price[origins], price[origins + horizon]
    p_pred = p_now * np.exp(np.asarray(log_return_pred))
    out = evaluate(p_now, p_true, p_pred, naive_pred=p_now)
    if np.any(p_pred != p_now):
        out["DM_estadistico"], out["DM_p_valor"] = diebold_mariano(p_true - p_pred, p_true - p_now, horizon)
    else:
        out["DM_estadistico"], out["DM_p_valor"] = np.nan, np.nan
    return out
