"""ETL: download of the raw series, alignment to the Brent calendar and loading.

Sources (all daily, free, no API key):
- FRED (EIA, ECB, Fed, Cboe): Brent and WTI spot, Henry Hub gas, ECB deposit
  rate, USD/EUR and CNY/USD exchange rates, VIX.
- Yahoo Finance: Brent and WTI futures (OHLCV), natural gas futures, copper,
  gold and the dollar index.
"""

import json
from datetime import datetime

import numpy as np
import pandas as pd

from oil_forecast.config import DATASET_PATH, METADATA_PATH, RAW_DIR, START, TARGET

FRED_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id={series}&cosd={start}"

FRED_SERIES = {
    "DCOILBRENTEU": "brent",  # EIA, Brent spot -> target
    "DCOILWTICO": "wti",  # EIA, WTI spot
    "DHHNGSP": "gas_natural",  # EIA, Henry Hub spot (sparse before 2007)
    "ECBDFR": "tipo_bce",  # ECB deposit facility rate
    "DEXUSEU": "usd_por_eur",  # USD per EUR
    "DEXCHUS": "cny_por_usd",  # CNY per USD
    "VIXCLS": "vix",  # equity market volatility
}
YAHOO_OHLCV = {"BZ=F": "brent_fut", "CL=F": "wti_fut"}
YAHOO_CLOSE = {"NG=F": "gas_fut", "HG=F": "cobre", "GC=F": "oro", "DX-Y.NYB": "indice_dolar"}
OHLCV = ["Open", "High", "Low", "Close", "Volume"]


# ---------------------------------------------------------------- extraction
def fetch_fred_series(series_id: str, start: str = START) -> pd.Series:
    """One FRED series with only its real observations (no filling)."""
    url = FRED_URL.format(series=series_id, start=start)
    s = pd.read_csv(url, index_col=0, parse_dates=True, na_values=".").iloc[:, 0]
    s.index.name = "Date"
    return s.dropna().rename(FRED_SERIES.get(series_id, series_id))


def download_fred(start: str = START) -> pd.DataFrame:
    series = [fetch_fred_series(sid, start) for sid in FRED_SERIES]
    return pd.concat(series, axis=1, sort=True)


def download_yahoo(start: str = START) -> pd.DataFrame:
    import yfinance as yf

    tickers = list(YAHOO_OHLCV) + list(YAHOO_CLOSE)
    raw = yf.download(tickers, start=start, auto_adjust=False, progress=False)
    if raw.empty:
        raise RuntimeError("Yahoo Finance returned no data")
    parts = []
    for ticker, prefix in YAHOO_OHLCV.items():
        block = raw.xs(ticker, axis=1, level=1)[OHLCV]
        parts.append(block.add_prefix(f"{prefix}_"))
    parts.append(raw["Close"][list(YAHOO_CLOSE)].rename(columns=YAHOO_CLOSE))
    out = pd.concat(parts, axis=1)
    out.index = pd.DatetimeIndex(out.index.date, name="Date")
    return out.dropna(how="all")


# ------------------------------------------------------------ transformation
def build_dataset(fred: pd.DataFrame, yahoo: pd.DataFrame, start: str = START) -> pd.DataFrame:
    """Daily dataset on the real Brent calendar.

    1. Rows = days on which Brent was actually quoted by the EIA.
    2. Every other series takes its last value known on or before that day
       (forward fill over the union of all calendars, so a value published on
       a day without Brent is not lost). Only past information is used.
    3. Values before a series starts stay missing (never back-filled).
    """
    brent = fred[TARGET].dropna()
    others = pd.concat([fred.drop(columns=TARGET), yahoo], axis=1, sort=True).ffill()
    data = others.reindex(brent.index)
    data.insert(0, TARGET, brent)
    data.index.name = "Date"
    return data.loc[start:]


def last_observations(fred: pd.DataFrame, yahoo: pd.DataFrame) -> dict[str, str]:
    """Date of the last real (non-filled) value of every series."""
    both = pd.concat([fred, yahoo], axis=1, sort=True)
    return {c: f"{both[c].last_valid_index():%Y-%m-%d}" for c in both.columns}


# ------------------------------------------------------------------- loading
def run_etl(start: str = START) -> pd.DataFrame:
    """Download, transform and save raw series, dataset and metadata."""
    fred = download_fred(start)
    yahoo = download_yahoo(start)
    data = build_dataset(fred, yahoo, start)

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    fred.to_csv(RAW_DIR / "fred.csv")
    yahoo.to_csv(RAW_DIR / "yahoo.csv")
    data.to_csv(DATASET_PATH)
    metadata = {
        "downloaded_at": datetime.now().isoformat(timespec="seconds"),
        "rows": len(data),
        "first_date": f"{data.index.min():%Y-%m-%d}",
        "last_brent_date": f"{data.index.max():%Y-%m-%d}",
        "last_observation": last_observations(fred, yahoo),
    }
    METADATA_PATH.write_text(json.dumps(metadata, indent=2))
    return data


def load_dataset(path=DATASET_PATH) -> pd.DataFrame:
    """Dataset produced by ``scripts/download_data.py``."""
    return pd.read_csv(path, index_col="Date", parse_dates=True).sort_index()


def load_raw() -> tuple[pd.DataFrame, pd.DataFrame]:
    """Raw FRED and Yahoo series exactly as downloaded."""
    read = lambda name: pd.read_csv(RAW_DIR / name, index_col="Date", parse_dates=True)
    return read("fred.csv"), read("yahoo.csv")


def load_metadata() -> dict:
    return json.loads(METADATA_PATH.read_text())


# ------------------------------------------------------------------- targets
def log_return_targets(price: pd.Series, horizons: dict[str, int]) -> pd.DataFrame:
    """Cumulative log return ``ln(P[t+h] / P[t])`` for each horizon.

    The value at date t is only known at t+h, so it must never be used as an
    input feature.
    """
    return pd.DataFrame(
        {f"y_{h}": np.log(price.shift(-h) / price) for h in horizons.values()},
        index=price.index,
    )
