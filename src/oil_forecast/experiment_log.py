"""Compact views of every round of experiments, for the experiment log notebook.

Everything is read from ``reports/results/ronda_N`` (and the tuning of round 1),
so a new round shows up as soon as its files exist. Every number is the RMSE
relative to the naive forecast: 1 is the naive level, below 1 beats it.
"""

import json

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.lines import Line2D

from oil_forecast.config import HORIZONS, results_dir, tuning_dir
from oil_forecast.plotting import COLORS, INK_2

H_LABELS = {"corto": "1 semana", "medio": "3 meses", "largo": "1 año"}
NETS = ["RNN simple", "LSTM", "GRU"]
ADJUSTED = " ajustada"
PRUDENT = " prudente"


def _style(df: pd.DataFrame, caption: str):
    """Green below 1 (beats the naive forecast), red above, blank when missing."""
    return (df.style.format("{:.3f}", na_rep="—")
            .background_gradient(cmap="RdYlGn_r", vmin=0.85, vmax=1.15, axis=None)
            .set_caption(caption)
            .set_table_styles([{"selector": "caption", "props": "caption-side: top; text-align: left; font-weight: bold"}]))


def _wide(rows: pd.DataFrame, value: str) -> pd.DataFrame:
    """Rows: model; columns: horizon, split into the raw network and its adjusted version when there is one."""
    rows = rows.assign(
        version=np.where(rows.modelo.str.endswith(ADJUSTED), "ajustada", "red"),
        base=rows.modelo.str.removesuffix(ADJUSTED),
    )
    t = rows.pivot_table(index="base", columns=["horizonte", "version"], values=value, sort=False)
    versions = ["red", "ajustada"] if (rows.version == "ajustada").any() else ["red"]
    cols = [(h, v) for h in HORIZONS for v in versions if (h, v) in t.columns]
    t = t.reindex(columns=pd.MultiIndex.from_tuples(cols))
    t.columns = pd.MultiIndex.from_tuples([(H_LABELS[h], v) for h, v in cols])
    if len(versions) == 1:
        t.columns = t.columns.droplevel(1)
    return t.rename_axis(index=None)


def validation(round_: int) -> pd.DataFrame | None:
    """Mean relative RMSE over the validation years (2019-2023), long format."""
    path = results_dir(round_) / "validacion_resumen.csv"
    if path.exists():
        return pd.read_csv(path)
    if round_ == 1:  # round 1 only has the tuning score (one seed per trial)
        rows = []
        for hname, h in HORIZONS.items():
            for cell, net in zip(["rnn", "lstm", "gru"], NETS):
                best = json.loads((tuning_dir(1) / f"{cell}_h{h}_best.json").read_text())
                rows.append({"horizonte": hname, "h": h, "modelo": net, "rmse_relativo": best["value"]})
        return pd.DataFrame(rows)
    return None


def test(round_: int) -> pd.DataFrame | None:
    """Relative RMSE on the hold-out test, long format (only rounds that ran it)."""
    path = results_dir(round_) / "comparativa.csv"
    if not path.exists():
        return None
    df = pd.read_csv(path)
    df["rmse_relativo"] = 1 - df["Mejora_RMSE_vs_ingenuo_%"] / 100
    return df[~df.modelo.isin(["Ingenuo", "Media histórica"])]


def validation_table(round_: int, prudent: bool = False):
    df = validation(round_)
    if df is None:
        return None
    if not prudent:
        df = df[~df.modelo.str.endswith(PRUDENT)]
    note = " (puntuación del ajuste, 1 semilla)" if round_ == 1 else " (media 2019-2023)"
    return _style(_wide(df, "rmse_relativo"), f"Ronda {round_} · validación{note}")


def test_table(round_: int, prudent: bool = False):
    df = test(round_)
    if df is None:
        return None
    if not prudent:
        df = df[~df.modelo.str.endswith(PRUDENT)]
    return _style(_wide(df, "rmse_relativo"), f"Ronda {round_} · test (2024-2026)")


def _best(df: pd.DataFrame, hname: str) -> pd.Series:
    rows = df[(df.horizonte == hname) & (df.modelo != "Ridge")]
    return rows.loc[rows.rmse_relativo.idxmin()]


def summary(rounds) -> pd.DataFrame:
    """One row per round: best model in validation for each horizon, and its test if it was run."""
    out = []
    for r in rounds:
        val, tst = validation(r), test(r)
        if val is None:
            continue
        row = {"Ronda": r}
        for hname in HORIZONS:
            b = _best(val, hname)
            row[f"{H_LABELS[hname]} · mejor en validación"] = b.modelo
            row[f"{H_LABELS[hname]} · val"] = b.rmse_relativo
            t = None if tst is None else tst[(tst.horizonte == hname) & (tst.modelo == b.modelo)]
            row[f"{H_LABELS[hname]} · test"] = t.rmse_relativo.item() if t is not None and len(t) else np.nan
        out.append(row)
    return pd.DataFrame(out).set_index("Ronda")


def summary_table(rounds):
    s = summary(rounds)
    num = [c for c in s.columns if c.endswith(("· val", "· test"))]
    return (s.style.format("{:.3f}", subset=num, na_rep="—")
            .background_gradient(cmap="RdYlGn_r", vmin=0.85, vmax=1.15, subset=num))


def evolution_plot(rounds):
    """Best network in validation per round and horizon, with its test when there is one."""
    s = summary(rounds)
    fig, axes = plt.subplots(1, 3, figsize=(13, 3.2), sharex=True)
    for ax, hname in zip(axes, HORIZONS):
        label = H_LABELS[hname]
        ax.axhline(1, color=COLORS["Ingenuo"], ls="--", lw=1)
        ax.plot(s.index, s[f"{label} · val"], marker="o", color=INK_2, lw=2)
        ax.scatter(s.index, s[f"{label} · test"], marker="D", s=60, facecolor="white", edgecolor=INK_2, lw=1.5,
                   zorder=3)
        ax.set_title(label)
        ax.set_xticks(s.index, [f"R{r}" for r in s.index])
    axes[0].set_ylabel("error relativo al ingenuo")
    handles = [Line2D([], [], color=INK_2, marker="o", lw=2, label="mejor en validación"),
               Line2D([], [], color=INK_2, marker="D", ls="", markerfacecolor="white", label="ese modelo en el test"),
               Line2D([], [], color=COLORS["Ingenuo"], ls="--", label="ingenuo")]
    fig.legend(handles=handles, loc="upper center", ncol=3, bbox_to_anchor=(0.5, 1.08))
    plt.tight_layout()
    return fig


def importance_table(round_: int, k: int = 5):
    """Top ``k`` variables per horizon by permutation importance (mean over the years)."""
    path = results_dir(round_) / "importancia_variables.csv"
    if not path.exists():
        return None
    imp = pd.read_csv(path).groupby(["h", "variable"])["aumento_error"].mean().reset_index()
    cols = {}
    for hname, h in HORIZONS.items():
        top = imp[imp.h == h].nlargest(k, "aumento_error")
        cols[H_LABELS[hname]] = [f"{v}  (+{x:.3f})" for v, x in zip(top.variable, top.aumento_error)]
    t = pd.DataFrame(cols, index=range(1, k + 1))
    return t.style.set_caption(f"Ronda {round_} · variables más útiles (aumento del error al desordenarlas)")


def curves(round_: int) -> dict:
    """Learning curves saved by scripts/curvas.py: {(cell, h): (summary, history)}."""
    folder = results_dir(round_) / "curvas"
    out = {}
    for path in sorted(folder.glob("*.json")) if folder.exists() else []:
        s = json.loads(path.read_text())
        out[s["cell"], s["h"]] = (s, pd.read_csv(path.with_suffix(".csv")))
    return out


def curves_grid(round_: int):
    """Small multiples of the learning curves: rows horizons, columns networks."""
    data = curves(round_)
    if not data:
        return None
    hs = list(HORIZONS.values())
    fig, axes = plt.subplots(3, 3, figsize=(13, 7))
    for i, h in enumerate(hs):
        for j, cell in enumerate(["rnn", "lstm", "gru"]):
            ax = axes[i, j]
            if (cell, h) not in data:
                ax.axis("off")
                continue
            s, hh = data[cell, h]
            color = COLORS[s["red"]]
            ax.plot(hh.epoch, hh.train_rel, color=color, lw=1, ls="--", alpha=0.7)
            ax.plot(hh.epoch, hh.val_rel, color=color, lw=2)
            ax.scatter(s["mejor_epoca"], s["val_rel_mejor"], marker="*", s=120, color=color, zorder=3)
            ax.axhline(1, color=COLORS["Ingenuo"], ls="--", lw=0.8)
            vals = pd.concat([hh.train_rel, hh.val_rel])
            ax.set_ylim(vals.min() - 0.03, min(vals.max(), 1.4) + 0.03)
            ax.set_title(f"{s['red']} · {s['horizonte']}  —  val {s['val_rel_mejor']:.3f} (época {s['mejor_epoca']})",
                         fontsize=9.5, color=color)
            ax.tick_params(labelsize=8)
    handles = [Line2D([], [], color=INK_2, lw=1, ls="--", label="entrenamiento"),
               Line2D([], [], color=INK_2, lw=2, label="validación"),
               Line2D([], [], color=INK_2, marker="*", ls="", markersize=10, label="época elegida")]
    fig.legend(handles=handles, loc="upper center", ncol=3, bbox_to_anchor=(0.5, 1.03))
    plt.tight_layout()
    return fig
