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


def validation_table(round_: int, prudent: bool = False):
    df = validation(round_)
    if df is None:
        return None
    if not prudent:
        df = df[~df.modelo.str.endswith(PRUDENT)]
    note = " (puntuación del ajuste, 1 semilla)" if round_ == 1 else " (media 2019-2023)"
    return _style(_wide(df, "rmse_relativo"), f"Ronda {round_} · validación{note}")


def _best(df: pd.DataFrame, hname: str) -> pd.Series:
    rows = df[(df.horizonte == hname) & (df.modelo != "Ridge")]
    return rows.loc[rows.rmse_relativo.idxmin()]


def summary(rounds) -> pd.DataFrame:
    """One row per round: best network in validation for each horizon."""
    out = []
    for r in rounds:
        val = validation(r)
        if val is None:
            continue
        val = val[~val.modelo.str.endswith(PRUDENT)]
        row = {"Ronda": r}
        for hname in HORIZONS:
            b = _best(val, hname)
            row[f"{H_LABELS[hname]} · mejor en validación"] = b.modelo
            row[f"{H_LABELS[hname]} · error"] = b.rmse_relativo
        out.append(row)
    return pd.DataFrame(out).set_index("Ronda")


def summary_table(rounds):
    s = summary(rounds)
    num = [c for c in s.columns if c.endswith("· error")]
    return (s.style.format("{:.3f}", subset=num, na_rep="—")
            .background_gradient(cmap="RdYlGn_r", vmin=0.85, vmax=1.15, subset=num))


def evolution_plot(rounds):
    """Best network in validation per round and horizon."""
    s = summary(rounds)
    fig, axes = plt.subplots(1, 3, figsize=(13, 3.2), sharex=True)
    for ax, hname in zip(axes, HORIZONS):
        label = H_LABELS[hname]
        ax.axhline(1, color=COLORS["Ingenuo"], ls="--", lw=1)
        ax.plot(s.index, s[f"{label} · error"], marker="o", color=INK_2, lw=2)
        for r, v in s[f"{label} · error"].items():
            ax.annotate(f"{v:.3f}", (r, v), textcoords="offset points", xytext=(0, 7), ha="center", fontsize=8)
        ax.set_title(label)
        ax.set_xticks(s.index, [f"R{r}" for r in s.index])
    axes[0].set_ylabel("error relativo al ingenuo")
    handles = [Line2D([], [], color=INK_2, marker="o", lw=2, label="mejor red en validación"),
               Line2D([], [], color=COLORS["Ingenuo"], ls="--", label="ingenuo")]
    fig.legend(handles=handles, loc="upper center", ncol=2, bbox_to_anchor=(0.5, 1.08))
    plt.tight_layout()
    return fig


def window_table(round_: int):
    """Window decision of a search with a common window (round 5)."""
    path = tuning_dir(round_) / "ventana_decision.json"
    if not path.exists():
        return None
    d = json.loads(path.read_text())["horizontes"]
    rows = []
    for hname, h in HORIZONS.items():
        for w, sc in d[str(h)]["puntuaciones"].items():
            rows.append({"horizonte": H_LABELS[hname], "ventana": f"{w} días", **{n: sc[c] for c, n in
                         zip(["rnn", "lstm", "gru"], NETS)}, "media 3 redes": sc["media_3_redes"],
                         "elegida": "✓" if int(w) == d[str(h)]["ventana"] else ""})
    t = pd.DataFrame(rows).set_index(["horizonte", "ventana"])
    num = [*NETS, "media 3 redes"]
    return (t.style.format("{:.3f}", subset=num).background_gradient(cmap="RdYlGn_r", vmin=0.85, vmax=1.15, subset=num)
            .set_caption(f"Ronda {round_} · media de los 5 mejores intentos de cada búsqueda"))


VARIANT_NAMES = {"base": "base (5 semillas)", "top3_x2": "top-3 × 2 semillas", "top5_x2": "top-5 × 2 semillas"}


def variant_table(round_: int):
    """Mean of the three networks per variant, raw and adjusted (variante_decision.json)."""
    path = results_dir(round_) / "variante_decision.json"
    if not path.exists():
        return None
    d = json.loads(path.read_text())["horizontes"]
    rows = []
    for hname, v in d.items():
        for name, sc in v["puntuaciones"].items():
            rows.append({"horizonte": H_LABELS[hname], "variante": VARIANT_NAMES.get(name, name),
                         **{n: sc[c] for c, n in zip(["rnn", "lstm", "gru"], NETS)},
                         "media 3 redes": sc["media_3_redes"], "media ajustada": sc["media_ajustada"],
                         "elegida": "✓" + (" (ajustada)" if v["ajustada"] else "") if name == v["variante"] else ""})
    t = pd.DataFrame(rows).set_index(["horizonte", "variante"])
    num = [*NETS, "media 3 redes", "media ajustada"]
    return (t.style.format("{:.3f}", subset=num).background_gradient(cmap="RdYlGn_r", vmin=0.85, vmax=1.15, subset=num)
            .set_caption(f"Ronda {round_} · validación 2019-2023 de cada variante"))


def final_model_table(round_: int) -> pd.DataFrame | None:
    path = results_dir(round_) / "modelo_final.json"
    if not path.exists():
        return None
    d = json.loads(path.read_text())["horizontes"]
    return pd.DataFrame([{"horizonte": H_LABELS[k], "modelo de la app": v["modelo"], "peso": v["peso"],
                          "validación 2019-2023": round(v["validacion_rmse_relativo"], 3),
                          "años que gana": v["años_que_gana_al_ingenuo"]} for k, v in d.items()]).set_index("horizonte")


def backward(round_: int) -> pd.DataFrame | None:
    path = results_dir(round_) / "hacia_atras_resumen.csv"
    return pd.read_csv(path) if path.exists() else None


def backward_table(round_: int):
    """Backward validation (2010-2018) next to the validation years, with the verdict of each model."""
    b = backward(round_)
    if b is None:
        return None
    b = b.assign(horizonte=b.horizonte.map(H_LABELS), app=np.where(b.modelo_app, "✓", ""))
    t = b.set_index(["horizonte", "modelo"])[["peso", "media_2010_2018", "media_2019_2023", "media_todos",
                                              "gana_todos", "veredicto", "app"]]
    t.columns = ["peso", "2010-2018", "2019-2023", "todos los años", "años que gana", "veredicto", "app"]
    num = ["2010-2018", "2019-2023", "todos los años"]
    colors = {"se sostiene": "background-color: #d8eed9", "dudoso": "background-color: #fbefc9",
              "no se sostiene": "background-color: #f6d5d0"}
    return (t.style.format("{:.3f}", subset=num).format("{:.2f}", subset=["peso"])
            .background_gradient(cmap="RdYlGn_r", vmin=0.85, vmax=1.15, subset=num)
            .map(lambda v: colors.get(v, ""), subset=["veredicto"])
            .set_caption(f"Ronda {round_} · validación hacia atrás"))


def backward_plot(round_: int):
    """Relative error per year (2010-2023) of the three networks, one panel per horizon."""
    b = backward(round_)
    if b is None:
        return None
    years = [c for c in b.columns if c.startswith("rel_")]
    fig, axes = plt.subplots(1, 3, figsize=(15, 3.6), sharex=True)
    for ax, hname in zip(axes, HORIZONS):
        g = b[b.horizonte == hname]
        ax.axvspan(2018.5, 2023.5, color="0.9", zorder=0)
        ax.axhline(1, color=COLORS["Ingenuo"], ls="--", lw=1)
        for net in NETS:
            r = g[g.modelo == net][years].iloc[0]
            x = [int(c[4:]) for c in years]
            ax.plot(x, r.values, marker="o", ms=4, color=COLORS[net], lw=1.6, label=net)
        ax.set_title(H_LABELS[hname])
        ax.text(2014, 0.02, "hacia atrás", transform=ax.get_xaxis_transform(), ha="center", fontsize=8, color=INK_2)
        ax.text(2021, 0.02, "validación", transform=ax.get_xaxis_transform(), ha="center", fontsize=8, color=INK_2)
    axes[0].set_ylabel("error relativo al ingenuo")
    axes[0].legend(fontsize=8, loc="upper left")
    plt.tight_layout()
    return fig


METHOD_NAMES = {"historico": "Histórico (precio de hoy)", "conformal": "Conformal (errores del modelo)",
                "conformal_vol": "Conformal escalado por volatilidad"}


def interval_table(round_: int):
    """Coverage, width and interval score of the three 80 % intervals, and the one chosen."""
    path = results_dir(round_) / "intervalo_resumen.csv"
    if not path.exists():
        return None
    s = pd.read_csv(path)
    chosen = json.loads((results_dir(round_) / "intervalo_decision.json").read_text())["horizontes"]
    s["elegido"] = ["✓" if chosen[h]["metodo"] == m else "" for h, m in zip(s.horizonte, s.metodo)]
    s = s.assign(horizonte=s.horizonte.map(H_LABELS), metodo=s.metodo.map(METHOD_NAMES),
                 cobertura=s.cobertura * 100)
    t = s.set_index(["horizonte", "metodo"])[["cobertura", "anchura_pct", "puntuacion", "años", "elegido"]]
    t.columns = ["cobertura (%)", "anchura (% del precio)", "puntuación ($)", "años", "elegido"]
    return (t.style.format("{:.1f}", subset=["cobertura (%)", "anchura (% del precio)"])
            .format("{:.2f}", subset=["puntuación ($)"])
            .set_caption(f"Ronda {round_} · intervalo del 80 % (calibrado cada año solo con lo ya conocido)"))


def interval_plot(round_: int):
    """Coverage per year of each interval method; the band marks 75-85 %."""
    path = results_dir(round_) / "intervalo_por_año.csv"
    if not path.exists():
        return None
    y = pd.read_csv(path)
    fig, axes = plt.subplots(1, 3, figsize=(15, 3.4), sharey=True)
    styles = {"historico": ("0.55", "--"), "conformal": (COLORS["GRU"], ":"), "conformal_vol": (COLORS["LSTM"], "-")}
    for ax, hname in zip(axes, HORIZONS):
        ax.axhspan(75, 85, color="0.92", zorder=0)
        ax.axhline(80, color=INK_2, lw=0.8)
        for m, (c, ls) in styles.items():
            g = y[(y.horizonte == hname) & (y.metodo == m)]
            ax.plot(g["año"], g.cobertura * 100, marker="o", ms=4, color=c, ls=ls, lw=1.6, label=METHOD_NAMES[m])
        ax.set_title(H_LABELS[hname])
        ax.set_ylim(-3, 103)
    axes[0].set_ylabel("cobertura (%)")
    axes[0].legend(fontsize=8, loc="lower left")
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
