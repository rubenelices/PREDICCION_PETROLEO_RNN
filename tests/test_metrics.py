import numpy as np

from oil_forecast.metrics import bootstrap_block, bootstrap_skill, r2, skill


def _series(n=600, seed=0):
    rng = np.random.default_rng(seed)
    y = 80 + np.cumsum(rng.normal(0, 1, n))
    naive = y + rng.normal(0, 2, n)
    return y, naive


def test_bootstrap_interval_contains_the_point_estimate():
    y, naive = _series()
    pred = y + np.random.default_rng(1).normal(0, 1.5, len(y))
    point = skill(np.sqrt(np.mean((y - pred) ** 2)), np.sqrt(np.mean((y - naive) ** 2)))
    low, high = bootstrap_skill(y, pred, naive, block=20)
    assert low < point < high
    assert low > 0  # a clearly better model is better in the whole interval


def test_bootstrap_interval_is_zero_when_the_model_is_the_naive_one():
    y, naive = _series()
    low, high = bootstrap_skill(y, naive, naive, block=20)
    assert low == high == 0


def test_bootstrap_is_reproducible_and_blocks_cover_the_horizon():
    y, naive = _series()
    pred = y + 0.5
    assert bootstrap_skill(y, pred, naive, block=10, seed=3) == bootstrap_skill(y, pred, naive, block=10, seed=3)
    assert bootstrap_block(252, 468) == 252
    assert bootstrap_block(5, 715) == 9


def test_r2_reference_values():
    y = np.array([1.0, 2.0, 3.0, 4.0])
    assert r2(y, y) == 1.0
    assert r2(y, np.full(4, y.mean())) == 0.0  # predicting the mean explains nothing
    assert r2(y, y[::-1]) < 0  # worse than the mean
