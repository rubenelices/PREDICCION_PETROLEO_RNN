"""Sliding windows for recurrent networks."""

import numpy as np


def make_sequences(
    X: np.ndarray, y: np.ndarray, origins: np.ndarray, window: int
) -> tuple[np.ndarray, np.ndarray]:
    """Build ``(n, window, n_features)`` inputs ending at each origin.

    ``origins`` are integer positions t; the input covers days t-window+1..t
    and the target is ``y[t]`` (already defined as the return from t to t+h).
    """
    origins = np.asarray(origins)
    origins = origins[origins >= window - 1]
    idx = origins[:, None] + np.arange(-window + 1, 1)[None, :]
    return X[idx], y[origins]
