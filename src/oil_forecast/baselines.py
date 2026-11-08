"""Reference models evaluated with exactly the same data as the networks."""

import numpy as np
from sklearn.linear_model import Ridge

RIDGE_ALPHAS = (1e3, 1e4, 1e5, 1e6, 1e7)


def naive(prepared: dict) -> np.ndarray:
    """Future price = today's price (log return 0)."""
    return np.zeros(len(prepared["eval_pos"]))


def historical_mean(prepared: dict) -> np.ndarray:
    """Average h-day log return of the training period."""
    return np.full(len(prepared["eval_pos"]), prepared["y_mean"])


def ridge(prepared: dict, alpha: float) -> np.ndarray:
    """Linear model on the flattened 60-day window of the same features."""
    X = np.concatenate([prepared["X_fit"], prepared["X_es"]])
    y = np.concatenate([prepared["y_fit"], prepared["y_es"]])
    model = Ridge(alpha=alpha).fit(X.reshape(len(X), -1), y)
    z = model.predict(prepared["X_eval"].reshape(len(prepared["X_eval"]), -1))
    return z * prepared["y_std"] + prepared["y_mean"]
