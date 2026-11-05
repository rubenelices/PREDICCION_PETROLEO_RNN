"""Time-ordered splits: expanding walk-forward with an embargo of h days.

Targets overlap in time (the 252-day return of consecutive days shares 251
days), so a training origin whose target ends inside the validation period
would leak information. The last ``horizon`` origins before each validation
block are therefore removed from training, and validation origins whose
target reaches the test period are dropped.
"""

from dataclasses import dataclass

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class Fold:
    name: str
    train: np.ndarray  # integer positions of forecast origins
    val: np.ndarray


def _last_origin(n: int, horizon: int) -> int:
    """Last position whose target t+h exists."""
    return n - 1 - horizon


def walk_forward_folds(
    index: pd.DatetimeIndex, horizon: int, val_years, test_start: str
) -> list[Fold]:
    n = len(index)
    test_pos = int(index.searchsorted(pd.Timestamp(test_start)))
    folds = []
    for year in val_years:
        val_pos = np.flatnonzero(index.year == year)
        val_pos = val_pos[val_pos + horizon < test_pos]
        val_pos = val_pos[val_pos <= _last_origin(n, horizon)]
        if len(val_pos) == 0:
            continue
        train_end = val_pos[0] - horizon  # exclusive
        folds.append(Fold(str(year), np.arange(0, train_end), val_pos))
    return folds


def train_test_split(
    index: pd.DatetimeIndex, horizon: int, test_start: str
) -> tuple[np.ndarray, np.ndarray]:
    """Final split: everything before the embargo for training, test after."""
    n = len(index)
    test_pos = int(index.searchsorted(pd.Timestamp(test_start)))
    train = np.arange(0, test_pos - horizon)
    test = np.arange(test_pos, _last_origin(n, horizon) + 1)
    return train, test
