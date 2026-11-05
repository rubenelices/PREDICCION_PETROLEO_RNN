import numpy as np
import pandas as pd

from oil_forecast.data import build_dataset
from oil_forecast.features import SELECTED_FEATURES, build_candidate_features


def _synthetic_market(n=400, seed=0):
    rng = np.random.default_rng(seed)
    idx = pd.bdate_range("2000-01-03", periods=n)
    walk = lambda scale=0.01: 50 * np.exp(np.cumsum(rng.normal(0, scale, n)))
    df = pd.DataFrame(
        {
            "brent": walk(), "wti": walk(), "vix": 20 * np.exp(rng.normal(0, 0.05, n)),
            "tipo_bce": np.repeat([1.0, 1.5], n // 2), "usd_por_eur": walk(0.002),
            "cny_por_usd": walk(0.001), "wti_fut_Close": walk(), "gas_fut": walk(),
            "oro": walk(), "cobre": walk(), "indice_dolar": walk(0.002),
        },
        index=idx,
    )
    df["wti_fut_High"] = df["wti_fut_Close"] * 1.01
    df["wti_fut_Low"] = df["wti_fut_Close"] * 0.99
    df["wti_fut_Volume"] = 1e5
    return df


def test_dataset_rows_are_real_brent_days_and_nothing_is_backfilled():
    days = pd.to_datetime(["2020-01-02", "2020-01-03", "2020-01-06", "2020-01-07"])
    fred = pd.DataFrame({"brent": [60.0, np.nan, 61.0, 62.0], "vix": [12.0, 13.0, np.nan, 14.0]}, index=days)
    yahoo = pd.DataFrame({"oro": [np.nan, np.nan, 1500.0, np.nan]}, index=days)
    out = build_dataset(fred, yahoo, start="2020-01-01")
    assert list(out.index) == [days[0], days[2], days[3]]  # 03/01 had no Brent quote
    assert out.loc[days[2], "vix"] == 13.0  # last known value, published on a non-Brent day
    assert np.isnan(out.loc[days[0], "oro"])  # never filled backwards
    assert out.loc[days[3], "oro"] == 1500.0


def test_features_only_use_past_information():
    df = _synthetic_market()
    t = df.index[300]
    full = build_candidate_features(df).loc[t]
    truncated = build_candidate_features(df.loc[:t]).loc[t]
    pd.testing.assert_series_equal(full, truncated)


def test_selected_features_exist():
    feats = build_candidate_features(_synthetic_market())
    assert set(SELECTED_FEATURES) <= set(feats.columns)
