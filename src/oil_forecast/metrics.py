"""Evaluation metrics, all computed on prices in USD unless stated otherwise."""

import numpy as np
from scipy import stats


def mse(y_true, y_pred) -> float:
    return float(np.mean((np.asarray(y_true) - np.asarray(y_pred)) ** 2))


def mae(y_true, y_pred) -> float:
    return float(np.mean(np.abs(np.asarray(y_true) - np.asarray(y_pred))))


def rmse(y_true, y_pred) -> float:
    return float(np.sqrt(mse(y_true, y_pred)))


def r2(y_true, y_pred) -> float:
    """Coefficient of determination: 1 - SSE / SST, with the mean of ``y_true`` as reference.

    Negative when the forecast is worse than that mean. The mean of the test
    period is not known in advance, so a negative R² is not by itself a failure:
    it must be read next to the naive model's R² on the same data.
    """
    y_true, y_pred = np.asarray(y_true, dtype=float), np.asarray(y_pred, dtype=float)
    sst = np.sum((y_true - y_true.mean()) ** 2)
    return float(1 - np.sum((y_true - y_pred) ** 2) / sst)


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


def bootstrap_skill(y_true, y_pred, y_naive, block: int, n_boot: int = 2000, level: float = 0.95,
                    seed: int = 0) -> tuple[float, float]:
    """Confidence interval of the RMSE improvement over the naive model (in %), by circular block bootstrap.

    Forecasts made on consecutive days share most of their target window, so their
    errors are correlated; resampling whole blocks of ``block`` consecutive origins
    keeps that dependence. With few blocks (e.g. one-year forecasts over a short
    test) the interval is only indicative. Returns (lower, upper) bounds.
    """
    e_model = (np.asarray(y_true) - np.asarray(y_pred)) ** 2
    e_naive = (np.asarray(y_true) - np.asarray(y_naive)) ** 2
    n = len(e_model)
    block = int(min(max(block, 1), n))
    n_blocks = int(np.ceil(n / block))
    rng = np.random.default_rng(seed)
    starts = rng.integers(0, n, size=(n_boot, n_blocks))
    idx = ((starts[:, :, None] + np.arange(block)) % n).reshape(n_boot, -1)[:, :n]
    skills = (1 - np.sqrt(e_model[idx].mean(axis=1) / e_naive[idx].mean(axis=1))) * 100
    alpha = (1 - level) / 2
    low, high = np.quantile(skills, [alpha, 1 - alpha])
    return float(low), float(high)


def bootstrap_block(horizon: int, n: int) -> int:
    """Block length for :func:`bootstrap_skill`: at least the horizon (the overlap of the targets)."""
    return max(horizon, int(np.ceil(n ** (1 / 3))))


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
