import numpy as np
import pytest

from oil_forecast import baselines
from oil_forecast.training import (
    TrainConfig,
    early_stopping_split,
    fit,
    predict,
    sample_weights,
)


def _prepared(n=300, window=10, n_features=3, seed=0):
    rng = np.random.default_rng(seed)
    X = rng.normal(size=(n, window, n_features)).astype(np.float32)
    y = (X[:, -1, 0] * 0.5 + rng.normal(0, 0.1, n)).astype(np.float32)
    return {
        "X_fit": X[:200], "y_fit": y[:200], "X_es": X[200:250], "y_es": y[200:250],
        "X_eval": X[250:], "y_eval": y[250:], "eval_pos": np.arange(50),
        "y_mean": 0.0, "y_std": 1.0,
    }


def test_early_stopping_split_keeps_an_embargo():
    train = np.arange(1000)
    fit_pos, es_pos = early_stopping_split(train, horizon=63)
    assert fit_pos[-1] + 63 < es_pos[0]
    assert es_pos[-1] == train[-1]


@pytest.mark.parametrize("cell", ["rnn", "lstm", "gru"])
def test_training_is_reproducible_and_learns(cell):
    p = _prepared()
    cfg = TrainConfig(hidden_size=8, max_epochs=30, patience=5, batch_size=32, lr=5e-3, dropout=0.0)
    m1, info = fit(cell, cfg, p, seed=1)
    m2, _ = fit(cell, cfg, p, seed=1)
    np.testing.assert_allclose(predict(m1, p), predict(m2, p), rtol=1e-5)
    assert info["es_mse"] < np.var(p["y_es"])  # better than predicting the mean


def test_baselines_shapes():
    p = _prepared()
    assert np.all(baselines.naive(p) == 0)
    assert baselines.historical_mean(p).shape == (50,)
    assert baselines.ridge(p, alpha=1.0).shape == (50,)


def test_sample_weights_halve_every_half_life():
    p = {"y_fit": np.zeros(5), "fit_age": np.array([400, 300, 200, 100, 0])}
    w = sample_weights(p, half_life=100)
    np.testing.assert_allclose(w / w[-1], [1 / 16, 1 / 8, 1 / 4, 1 / 2, 1])
    assert np.isclose(w.mean(), 1)
    assert np.all(sample_weights(p, half_life=None) == 1)


def test_on_epoch_reports_every_epoch_without_changing_the_result():
    p = _prepared()
    cfg = TrainConfig(hidden_size=8, max_epochs=20, patience=3, batch_size=32, lr=5e-3, dropout=0.0)
    history = []
    m1, info = fit("gru", cfg, p, seed=2, on_epoch=history.append)
    m2, _ = fit("gru", cfg, p, seed=2)
    np.testing.assert_allclose(predict(m1, p), predict(m2, p), rtol=1e-5)
    assert [e["epoch"] for e in history] == list(range(1, info["epochs"] + 1))
    best = min(history, key=lambda e: e["val_mse"])
    assert best["epoch"] == info["best_epoch"] and best["best"]
    assert np.isclose(best["val_mse"], info["es_mse"])
