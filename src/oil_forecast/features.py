"""Feature engineering and leakage-free scaling.

Every feature at date t only uses information available at the close of t.
``build_candidate_features`` creates the full set of candidates analysed in
``notebooks/03_feature_engineering.ipynb``; ``build_features`` returns the
subset selected there (``SELECTED_FEATURES``).
"""

import numpy as np
import pandas as pd

# Daily log returns of every price series (WTI spot excluded: it is almost a
# copy of its future and has the negative price of 2020-04-20).
RETURN_SERIES = {
    "brent": "brent",
    "wti_fut": "wti_fut_Close",
    "gas_fut": "gas_fut",
    "oro": "oro",
    "cobre": "cobre",
    "indice_dolar": "indice_dolar",
    "usd_por_eur": "usd_por_eur",
    "cny_por_usd": "cny_por_usd",
}

FEATURE_GROUPS = {
    "Retornos diarios": [f"ret_{k}" for k in RETURN_SERIES],
    "Momentum del Brent": ["mom_5", "mom_21", "mom_63", "mom_252"],
    "Volatilidad": ["vol_5", "vol_21", "vol_63", "vol_parkinson_21"],
    "Tendencia y reversión": ["dist_ma50", "dist_ma200", "zscore_252", "drawdown_252"],
    "Estructura del mercado": ["spread_brent_wti", "basis_wti", "ratio_oro_z252", "ratio_cobre_z252"],
    "Riesgo y política monetaria": ["log_vix", "vix_chg_5", "tipo_bce", "tipo_bce_chg_63"],
    "Actividad del futuro WTI": ["wti_range", "wti_volume_z63"],
}


def safe_log(s: pd.Series) -> pd.Series:
    """Logarithm that returns NaN for non-positive prices (WTI 2020-04-20)."""
    return np.log(s.where(s > 0))


def log_return(s: pd.Series, periods: int = 1) -> pd.Series:
    return safe_log(s).diff(periods)


def rolling_z(s: pd.Series, window: int) -> pd.Series:
    return (s - s.rolling(window).mean()) / s.rolling(window).std()


def build_candidate_features(df: pd.DataFrame) -> pd.DataFrame:
    """All candidate features (see FEATURE_GROUPS)."""
    f = {}
    log_brent = np.log(df["brent"])
    for name, col in RETURN_SERIES.items():
        f[f"ret_{name}"] = log_return(df[col])

    for w in (5, 21, 63, 252):
        f[f"mom_{w}"] = log_brent.diff(w)

    r = f["ret_brent"]
    for w in (5, 21, 63):
        f[f"vol_{w}"] = r.rolling(w).std()
    # Parkinson range-based volatility from the WTI future high/low
    hl = safe_log(df["wti_fut_High"]) - safe_log(df["wti_fut_Low"])
    f["vol_parkinson_21"] = np.sqrt((hl**2).rolling(21).mean() / (4 * np.log(2)))

    f["dist_ma50"] = log_brent - log_brent.rolling(50).mean()
    f["dist_ma200"] = log_brent - log_brent.rolling(200).mean()
    f["zscore_252"] = rolling_z(log_brent, 252)
    f["drawdown_252"] = log_brent - log_brent.rolling(252).max()

    f["spread_brent_wti"] = log_brent - safe_log(df["wti"])  # relative, scale-free
    f["basis_wti"] = safe_log(df["wti"]) - safe_log(df["wti_fut_Close"])
    f["ratio_oro_z252"] = rolling_z(np.log(df["oro"]) - log_brent, 252)
    f["ratio_cobre_z252"] = rolling_z(np.log(df["cobre"]) - log_brent, 252)

    f["log_vix"] = np.log(df["vix"])
    f["vix_chg_5"] = np.log(df["vix"]).diff(5)
    f["tipo_bce"] = df["tipo_bce"]
    f["tipo_bce_chg_63"] = df["tipo_bce"].diff(63)

    f["wti_range"] = hl
    f["wti_volume_z63"] = rolling_z(np.log1p(df["wti_fut_Volume"]), 63)

    out = pd.DataFrame(f, index=df.index)
    # Isolated NaNs created by the negative WTI price: carry the previous value.
    return out.ffill(limit=2)


# Final set chosen in notebooks/03_feature_engineering.ipynb
SELECTED_FEATURES = [
    # daily returns: raw material for the recurrent layer
    "ret_brent",
    "ret_wti_fut",
    "ret_gas_fut",
    "ret_oro",
    "ret_cobre",
    "ret_indice_dolar",
    "ret_cny_por_usd",
    # regime: volatility and position in the yearly range
    "vol_21",
    "vol_63",
    "drawdown_252",
    # market structure and relative value
    "spread_brent_wti",
    "basis_wti",
    "ratio_cobre_z252",
    "ratio_oro_z252",
    # risk and monetary policy
    "log_vix",
    "tipo_bce_chg_63",
]


def build_features(df: pd.DataFrame, features: list[str] | None = None) -> pd.DataFrame:
    """Selected features, starting on the first date where all are available."""
    cand = build_candidate_features(df)
    cols = features or SELECTED_FEATURES or list(cand.columns)
    out = cand[cols]
    return out.loc[out.apply(lambda s: s.first_valid_index()).max() :]


class FoldScaler:
    """Winsorize with train quantiles, then standardize with train moments.

    It must be fitted on the training part of each fold only.
    """

    def __init__(self, lower: float = 0.005, upper: float = 0.995):
        self.lower = lower
        self.upper = upper

    def fit(self, X: pd.DataFrame) -> "FoldScaler":
        self.lo_ = X.quantile(self.lower)
        self.hi_ = X.quantile(self.upper)
        clipped = X.clip(self.lo_, self.hi_, axis=1)
        self.mean_ = clipped.mean()
        self.std_ = clipped.std().replace(0, 1.0)
        return self

    def transform(self, X: pd.DataFrame) -> pd.DataFrame:
        return (X.clip(self.lo_, self.hi_, axis=1) - self.mean_) / self.std_

    def fit_transform(self, X: pd.DataFrame) -> pd.DataFrame:
        return self.fit(X).transform(X)
