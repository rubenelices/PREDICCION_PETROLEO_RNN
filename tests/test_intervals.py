import numpy as np
import pandas as pd

from oil_forecast.intervals import (
    calibration_pool,
    choose_method,
    interval_score,
    quantile_offsets,
    summarize,
    yearly_intervals,
)


def _frame(n_years=6, per_year=250, seed=0, scale=0.05):
    rng = np.random.default_rng(seed)
    dates = pd.bdate_range("2010-01-01", periods=n_years * per_year)
    objetivo = dates + pd.offsets.BDay(5)
    real_ret = rng.normal(0, scale, len(dates))
    p0 = np.full(len(dates), 80.0)
    return pd.DataFrame({
        "origen": dates, "objetivo": objetivo, "año": dates.year, "p0": p0,
        "real": p0 * np.exp(real_ret), "real_ret": real_ret,
        "pred": np.zeros(len(dates)), "vol": np.full(len(dates), scale),
    })


def test_calibration_only_uses_targets_known_before_the_cutoff():
    frame = _frame()
    cutoff = pd.Timestamp("2012-01-01")
    before = calibration_pool("conformal", frame, frame, cutoff)
    # make every later error enormous: the pool must not change
    later = frame["objetivo"] >= cutoff
    frame.loc[later, "real_ret"] = 10.0
    after = calibration_pool("conformal", frame, frame, cutoff)
    np.testing.assert_array_equal(before, after)


def test_conformal_interval_covers_about_80_percent_of_iid_errors():
    frame = _frame(n_years=8)
    iv = yearly_intervals("conformal", frame, frame, sorted(frame["año"].unique()))
    assert iv["año"].min() == 2011  # 2010 has no past errors
    assert abs(summarize(iv)["cobertura"] - 0.8) < 0.03


def test_interval_score_penalises_misses():
    assert interval_score(5.0, 4.0, 6.0) == 2.0
    # 1 below the lower bound: width 2 + (2 / 0.2) * 1
    assert np.isclose(interval_score(3.0, 4.0, 6.0), 12.0)
    lo, hi = quantile_offsets(np.arange(101))
    assert np.allclose((lo, hi), (10.0, 90.0))


def test_rule_prefers_the_simpler_method_when_scores_are_close():
    table = pd.DataFrame(
        {"cobertura": [0.80, 0.79, 0.78], "puntuacion": [10.1, 10.0, 9.0]},
        index=["historico", "conformal", "conformal_vol"],
    )
    assert choose_method(table) == "conformal_vol"  # clearly better
    table.loc["conformal_vol", "puntuacion"] = 9.95
    assert choose_method(table) == "historico"  # within 2 % of the best
    table.loc["historico", "cobertura"] = 0.70  # out of the coverage range
    assert choose_method(table) == "conformal"
