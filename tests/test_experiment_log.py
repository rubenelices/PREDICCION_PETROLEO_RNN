import pandas as pd

from oil_forecast.experiment_log import _wide


def test_wide_splits_raw_and_adjusted_by_horizon():
    rows = pd.DataFrame({
        "horizonte": ["corto", "corto", "medio", "medio", "corto"],
        "modelo": ["RNN simple", "RNN simple ajustada", "RNN simple", "RNN simple ajustada", "Ridge"],
        "rmse_relativo": [1.01, 0.99, 0.90, 0.90, 1.0],
    })
    t = _wide(rows, "rmse_relativo")
    assert list(t.columns) == [("1 semana", "red"), ("1 semana", "ajustada"), ("3 meses", "red"), ("3 meses", "ajustada")]
    assert t.loc["RNN simple", ("1 semana", "ajustada")] == 0.99
    assert pd.isna(t.loc["Ridge", ("1 semana", "ajustada")])
