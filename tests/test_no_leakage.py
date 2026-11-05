import numpy as np
import pandas as pd

from oil_forecast.features import FoldScaler
from oil_forecast.sequences import make_sequences
from oil_forecast.splits import train_test_split, walk_forward_folds

INDEX = pd.bdate_range("2000-01-03", "2026-10-30")


def test_embargo_separates_train_targets_from_validation():
    for h in (5, 63, 252):
        for fold in walk_forward_folds(INDEX, h, range(2019, 2024), "2024-01-01"):
            # the target of the last training origin ends before validation starts
            assert fold.train[-1] + h < fold.val[0]


def test_validation_targets_do_not_reach_test_period():
    test_pos = INDEX.searchsorted(pd.Timestamp("2024-01-01"))
    for h in (5, 63, 252):
        for fold in walk_forward_folds(INDEX, h, range(2019, 2024), "2024-01-01"):
            assert fold.val[-1] + h < test_pos


def test_final_split_has_embargo_and_valid_targets():
    for h in (5, 63, 252):
        train, test = train_test_split(INDEX, h, "2024-01-01")
        assert train[-1] + h < test[0]
        assert test[-1] + h <= len(INDEX) - 1


def test_scaler_uses_only_training_statistics():
    rng = np.random.default_rng(0)
    train = pd.DataFrame({"x": rng.normal(0, 1, 500)})
    test = pd.DataFrame({"x": rng.normal(100, 1, 50)})
    scaler = FoldScaler().fit(train)
    assert abs(scaler.mean_["x"]) < 0.2
    assert scaler.transform(test)["x"].max() <= (scaler.hi_["x"] - scaler.mean_["x"]) / scaler.std_["x"] + 1e-9


def test_sequences_end_at_origin_and_never_include_future():
    X = np.arange(100, dtype=float)[:, None]
    y = np.arange(100, dtype=float) * 10
    Xs, ys = make_sequences(X, y, np.array([5, 59, 60, 99]), window=60)
    assert Xs.shape == (3, 60, 1)  # origin 5 dropped: not enough history
    assert Xs[0, -1, 0] == 59 and Xs[0, 0, 0] == 0
    assert ys.tolist() == [590, 600, 990]
