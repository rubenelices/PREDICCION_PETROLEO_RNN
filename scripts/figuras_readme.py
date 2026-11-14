"""Figures of the README (docs/img/), drawn from the saved results.

No model is trained. The test figures are drawn only when the test of the
final round has been run.

Usage:
    poetry run python scripts/figuras_readme.py
"""

import matplotlib.pyplot as plt
import pandas as pd

from oil_forecast import experiment_log as log
from oil_forecast import test_report
from oil_forecast.config import CURRENT_ROUND, ROOT, TEST_START, results_dir
from oil_forecast.data import load_dataset
from oil_forecast.events import EVENTS
from oil_forecast.plotting import COLORS, INK_2, set_style

OUT = ROOT / "docs" / "img"


def save(fig, name: str) -> None:
    fig.savefig(OUT / name, dpi=110, bbox_inches="tight")
    plt.close(fig)
    print(f"  {name}")


def price_history() -> None:
    brent = load_dataset()["brent"].dropna()
    fig, ax = plt.subplots(figsize=(12, 3.8))
    ax.plot(brent.index, brent.values, color=COLORS["Real"], lw=1)
    test = pd.Timestamp(TEST_START)
    ax.axvspan(pd.Timestamp("2010-01-01"), pd.Timestamp("2019-01-01"), color=COLORS["GRU"], alpha=0.07, lw=0)
    ax.text(pd.Timestamp("2014-07-01"), 0.97, "validación hacia atrás", transform=ax.get_xaxis_transform(),
            ha="center", va="top", fontsize=9, color=INK_2)
    ax.axvspan(pd.Timestamp("2019-01-01"), test, color=COLORS["LSTM"], alpha=0.08, lw=0)
    ax.axvspan(test, brent.index[-1], color=COLORS["RNN simple"], alpha=0.10, lw=0)
    ax.text(pd.Timestamp("2021-07-01"), 0.97, "validación", transform=ax.get_xaxis_transform(), ha="center",
            va="top", fontsize=9, color=INK_2)
    ax.text(test + (brent.index[-1] - test) / 2, 0.97, "test", transform=ax.get_xaxis_transform(), ha="center",
            va="top", fontsize=9, color=INK_2)
    for e in EVENTS:
        d = pd.Timestamp(e["date"])
        p = float(brent.asof(d))
        ax.scatter([d], [p], s=22, color=COLORS["RNN simple"] if e["kind"] == "pico" else COLORS["LSTM"], zorder=3)
    ax.set_ylabel("dólares por barril")
    ax.set_title("Precio diario del Brent y sus grandes picos y valles")
    save(fig, "precio_brent.png")


def main() -> None:
    set_style()
    OUT.mkdir(parents=True, exist_ok=True)
    price_history()
    for name, fn in (("validacion_hacia_atras.png", log.backward_plot),
                     ("intervalo_cobertura.png", log.interval_plot),
                     ("evolucion_rondas.png", lambda r: log.evolution_plot(range(1, r + 1)))):
        fig = fn(CURRENT_ROUND)
        save(fig, name)
    if (results_dir(CURRENT_ROUND) / "comparativa.csv").exists():
        r = test_report.load(CURRENT_ROUND)
        save(test_report.comparison_plot(r), "test_comparativa.png")
        save(test_report.predictions_plot(r), "test_predicciones.png")
    else:
        print("  (sin test todavía: faltan test_comparativa.png y test_predicciones.png)")


if __name__ == "__main__":
    main()
