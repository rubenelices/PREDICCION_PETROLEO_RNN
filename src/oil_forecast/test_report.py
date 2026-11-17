"""Tables and figures of the test (2024-2026) of the final round.

Everything is read from ``reports/results/ronda_N`` (written by
``scripts/train.py test``), so the notebook 07 and the README figures show
exactly the same numbers. No model is trained here.
"""

import json

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from oil_forecast.config import CURRENT_ROUND, HORIZONS, results_dir
from oil_forecast.data import load_dataset
from oil_forecast.experiment_log import H_LABELS, METHOD_NAMES, NETS
from oil_forecast.intervals import volatility
from oil_forecast.metrics import bootstrap_block, bootstrap_skill, r2
from oil_forecast.plotting import COLORS, INK, INK_2

BASELINES = ["Ingenuo", "Media histórica", "Ridge"]
SHOCK_START = pd.Timestamp("2026-02-28")  # start of the war with Iran (Strait of Hormuz)


def load(round_: int = CURRENT_ROUND) -> dict:
    """Comparison table, per-seed metrics, test predictions and the final model of a round."""
    out = results_dir(round_)
    preds = pd.read_csv(out / "predicciones_test.csv", parse_dates=["origen", "fecha_objetivo"])
    return {
        "comp": pd.read_csv(out / "comparativa.csv"),
        "seeds": pd.read_csv(out / "metricas_por_semilla.csv"),
        "preds": preds,
        "final": json.loads((out / "modelo_final.json").read_text())["horizontes"],
        "interval": json.loads((out / "intervalo_decision.json").read_text())["horizontes"],
    }


def final_name(f: dict) -> str:
    """Name of a final model; with weight 1 the adjusted version is the network itself."""
    return f["red"] if f["peso"] == 1 else f"{f['red']} (peso {f['peso']:g})".replace(".", ",")


def _relative(comp: pd.DataFrame) -> pd.Series:
    naive = comp[comp.modelo == "Ingenuo"].set_index("horizonte")["RMSE"]
    return comp.RMSE / comp.horizonte.map(naive)


def skill_ci(r: dict, hname: str, model: str, level: float = 0.95) -> tuple[float, float]:
    """Block-bootstrap interval of the RMSE improvement over the naive model, from the test predictions."""
    p = r["preds"][r["preds"].horizonte == hname]
    naive = p[p.modelo == "Ingenuo"].set_index("origen").sort_index()
    q = p[p.modelo == model].set_index("origen").loc[naive.index]
    block = bootstrap_block(HORIZONS[hname], len(naive))
    return bootstrap_skill(naive.precio_real, q.precio_pred, naive.precio_pred, block=block, level=level)


def _ci_text(low: float, high: float) -> str:
    return f"[{low:+.1f}; {high:+.1f}]"


def dollar_table(r: dict) -> pd.DataFrame:
    """Error per barrel (USD) of the naive forecast, the final model and the three networks, per horizon."""
    comp = r["comp"].set_index(["horizonte", "modelo"])
    rows = []
    for hname, f in r["final"].items():
        naive, final = comp.loc[(hname, "Ingenuo")], comp.loc[(hname, f["modelo"])]
        rows.append({
            "Plazo": H_LABELS[hname], "Modelo final": final_name(f),
            "RMSE ingenuo": naive.RMSE, "RMSE final": final.RMSE,
            "MAE ingenuo": naive.MAE, "MAE final": final.MAE,
            "MSE ingenuo": naive.MSE, "MSE final": final.MSE,
            **{f"RMSE {net}": comp.loc[(hname, net), "RMSE"] for net in NETS},
        })
    return pd.DataFrame(rows).set_index("Plazo")


def r2_scores(r: dict, hname: str, model: str) -> tuple[float, float]:
    """R² of a model in the test, on the price and on the log return at h days (what the networks predict)."""
    q = r["preds"][(r["preds"].horizonte == hname) & (r["preds"].modelo == model)]
    change = np.log(q.precio_real / q.precio_hoy)
    return r2(q.precio_real, q.precio_pred), r2(change, q.retorno_pred)


def r2_table(r: dict) -> pd.DataFrame:
    """R² of the naive forecast, the final model and the three networks, per horizon.

    On the price, R² mostly measures that tomorrow's price is close to today's,
    so it is only meaningful next to the naive model's. On the change in price,
    the naive forecast explains nothing by construction, and a positive value is
    information the network adds.
    """
    rows = []
    for hname, f in r["final"].items():
        (p_naive, c_naive), (p_final, c_final) = r2_scores(r, hname, "Ingenuo"), r2_scores(r, hname, f["modelo"])
        rows.append({
            "Plazo": H_LABELS[hname], "Modelo final": final_name(f),
            "R² precio ingenuo": p_naive, "R² precio final": p_final,
            "R² cambio ingenuo": c_naive, "R² cambio final": c_final,
            **{f"R² cambio {net}": r2_scores(r, hname, net)[1] for net in NETS},
        })
    return pd.DataFrame(rows).set_index("Plazo")


def comparison_table(r: dict):
    """The table the brief asks for: baselines, the three networks and their combination, per horizon."""
    comp = r["comp"]
    keep = BASELINES + NETS + ["Combinación"]
    t = comp[comp.modelo.isin(keep)].assign(rel=_relative(comp))
    ci = [_ci_text(*skill_ci(r, h, m)) if m != "Ingenuo" else "—" for h, m in zip(t.horizonte, t.modelo)]
    t = pd.DataFrame({
        "horizonte": pd.Categorical(t.horizonte.map(H_LABELS), list(H_LABELS.values()), ordered=True),
        "modelo": pd.Categorical(t.modelo, keep, ordered=True),
        "MAE ($)": t.MAE, "RMSE ($)": t.RMSE, "RMSE / ingenuo": t.rel,
        "Mejora RMSE %": t["Mejora_RMSE_vs_ingenuo_%"], "IC 95 % mejora": ci,
        "Mejora MAE %": t["Mejora_MAE_vs_ingenuo_%"], "Dirección %": t["Direccion_%"], "p-valor DM": t.DM_p_valor,
        "Parámetros": t.n_params, "Tiempo (s)": t.tiempo_entrenamiento_s,
        "Desv. semillas (pp)": t.Mejora_RMSE_desv_semillas,
    }).sort_values(["horizonte", "modelo"]).set_index(["horizonte", "modelo"])
    return (t.style.format(precision=2, na_rep="—")
            .format("{:.3f}", subset=["RMSE / ingenuo", "p-valor DM"], na_rep="—")
            .format("{:,.0f}", subset=["Parámetros"], na_rep="—")
            .background_gradient(subset=["Mejora RMSE %"], cmap="RdYlGn", vmin=-10, vmax=10))


def interval_frame(r: dict, hname: str) -> pd.DataFrame:
    """Test predictions of the final model of a horizon, with the 80 % interval (same rule as the app)."""
    name = r["final"][hname]["modelo"]
    g = r["preds"][(r["preds"].horizonte == hname) & (r["preds"].modelo == name)].sort_values("fecha_objetivo")
    iv = r["interval"][hname]
    brent = load_dataset()["brent"].dropna()
    vol = pd.Series(volatility(brent.to_numpy()), index=brent.index)
    center = 0.0 if iv["metodo"] == "historico" else g.retorno_pred.to_numpy()
    scale = vol.reindex(g.origen).to_numpy() if iv["metodo"] == "conformal_vol" else 1.0
    g = g.assign(inferior=g.precio_hoy * np.exp(center + iv["q_inferior"] * scale),
                 superior=g.precio_hoy * np.exp(center + iv["q_superior"] * scale))
    return g.assign(dentro=(g.precio_real >= g.inferior) & (g.precio_real <= g.superior))


def final_table(r: dict) -> pd.DataFrame:
    """The final model of each horizon: validation (chosen there) next to the test."""
    rel = r["comp"].assign(rel=_relative(r["comp"])).set_index(["horizonte", "modelo"])
    rows = []
    for hname, f in r["final"].items():
        row = rel.loc[(hname, f["modelo"])]
        iv = interval_frame(r, hname)
        rows.append({
            "Horizonte": H_LABELS[hname], "Modelo": f["red"], "Peso": f["peso"],
            "Validación 2019-2023": f["validacion_rmse_relativo"], "Test 2024-2026": row.rel,
            "Mejora RMSE %": row["Mejora_RMSE_vs_ingenuo_%"], "IC 95 % mejora": _ci_text(*skill_ci(r, hname, f["modelo"])),
            "Mejora MAE %": row["Mejora_MAE_vs_ingenuo_%"], "p-valor DM": row.DM_p_valor,
            "Intervalo 80 %": METHOD_NAMES[r["interval"][hname]["metodo"]],
            "Cobertura test %": iv.dentro.mean() * 100,
            "Anchura media ($)": (iv.superior - iv.inferior).mean(),
        })
    return pd.DataFrame(rows).set_index("Horizonte")


def yearly_table(r: dict, min_dates: int = 20):
    """Relative RMSE per year of the predicted date (years with fewer than ``min_dates`` dates are blank)."""
    keep = {h: set(NETS + ["Ridge"] + ([f["modelo"]] if f["peso"] != 1 else [])) for h, f in r["final"].items()}
    p = r["preds"][[m in keep[h] for h, m in zip(r["preds"].horizonte, r["preds"].modelo)]]
    p = p.assign(año=p.fecha_objetivo.dt.year)

    def rel(g):
        if len(g) < min_dates:
            return np.nan
        return np.sqrt(((g.precio_real - g.precio_pred) ** 2).mean() / ((g.precio_real - g.precio_hoy) ** 2).mean())

    t = p.groupby(["horizonte", "modelo", "año"])[["precio_real", "precio_pred", "precio_hoy"]].apply(rel).unstack("año")
    t = t.loc[list(HORIZONS)].rename(index=H_LABELS, level=0)
    return (t.style.format("{:.3f}", na_rep="—").background_gradient(cmap="RdYlGn_r", vmin=0.8, vmax=1.2, axis=None)
            .set_caption("RMSE relativo al ingenuo según el año de la fecha predicha (— = menos de 20 fechas)"))


def coverage_table(r: dict) -> pd.DataFrame:
    """Coverage of the 80 % interval of the final model, per year of the predicted date (n = predicted dates)."""
    rows = {}
    for hname in HORIZONS:
        g = interval_frame(r, hname)
        by = g.groupby(g.fecha_objetivo.dt.year).dentro.agg(["mean", "size"])
        row = {y: f"{m * 100:.0f} % (n={int(n)})" for y, (m, n) in by.iterrows()}
        rows[H_LABELS[hname]] = {**row, "Total": f"{g.dentro.mean() * 100:.1f} % (n={len(g)})"}
    return pd.DataFrame(rows).T.fillna("—")


def comparison_plot(r: dict):
    """Error per barrel (RMSE, USD) of each network and the linear model against the naive forecast.

    All panels share the dollar axis, so a 0.8 % gain at one week looks as small as it is.
    """
    comp = r["comp"]
    names = ["Ingenuo", *NETS, "Ridge"]

    def num(v, fmt):
        return format(v, fmt).replace(".", ",").replace("-", "−")

    fig, axes = plt.subplots(1, 3, figsize=(13.5, 3.9), sharex=True)
    for ax, hname in zip(axes, HORIZONS):
        g = comp[comp.horizonte == hname].set_index("modelo")
        f = r["final"][hname]
        vals = [g.loc[n, "RMSE"] for n in names]
        bars = ax.barh(names, vals, height=0.62, color=[COLORS[n] for n in names],
                       edgecolor=[INK if n == f["red"] else "none" for n in names], linewidth=1.4)
        ax.axvline(g.loc["Ingenuo", "RMSE"], color=COLORS["Ingenuo"], ls="--", lw=1)
        for b, n, v in zip(bars, names, vals):
            gain = "" if n == "Ingenuo" else f" ({num(g.loc[n, 'Mejora_RMSE_vs_ingenuo_%'], '+.1f')} %)"
            ax.text(v + 0.4, b.get_y() + b.get_height() / 2, f"{num(v, '.2f')} ${gain}", va="center", fontsize=8.5)
        final = g.loc[f["modelo"]]
        ax.set_title(f"{H_LABELS[hname]}\nfinal: {final_name(f)} · {num(final.RMSE, '.2f')} $ "
                     f"({num(final['Mejora_RMSE_vs_ingenuo_%'], '+.1f')} %)", fontsize=10, loc="left")
        ax.set_yticks(range(len(names)), [f"{n} ★" if n == f["red"] else n for n in names])
        ax.grid(axis="y", visible=False)
        ax.set_axisbelow(True)
        ax.invert_yaxis()
    axes[0].set_xlim(0, 33)
    axes[1].set_xlabel("RMSE en el test ($ por barril; más corto, mejor) · ★ red del modelo final · línea: ingenuo")
    plt.tight_layout()
    return fig


def seeds_plot(r: dict):
    """Each seed (dots) and the average of the five (diamond), per network and horizon."""
    comp, seeds = r["comp"], r["seeds"]
    rng = np.random.default_rng(0)
    fig, axes = plt.subplots(1, 3, figsize=(15, 4))
    for ax, hname in zip(axes, HORIZONS):
        s = seeds[seeds.horizonte == hname]
        for i, net in enumerate(NETS):
            vals = s.loc[s.modelo == net, "Mejora_RMSE_vs_ingenuo_%"]
            ax.scatter(i + rng.uniform(-0.08, 0.08, len(vals)), vals, color=COLORS[net], alpha=0.6, s=28)
            ens = comp.loc[(comp.horizonte == hname) & (comp.modelo == net), "Mejora_RMSE_vs_ingenuo_%"].item()
            ax.scatter(i, ens, marker="D", s=80, color=COLORS[net], edgecolor="k", zorder=3)
        ridge = comp.loc[(comp.horizonte == hname) & (comp.modelo == "Ridge"), "Mejora_RMSE_vs_ingenuo_%"].item()
        ax.axhline(ridge, color=COLORS["Ridge"], ls=":", label=f"Ridge ({ridge:+.1f} %)")
        ax.axhline(0, color=COLORS["Ingenuo"], ls="--", lw=0.8, label="ingenuo")
        ax.set_xticks(range(3), NETS)
        ax.set_title(H_LABELS[hname])
        ax.legend(fontsize=8)
    axes[0].set_ylabel("mejora del RMSE frente al ingenuo (%)")
    fig.suptitle("Puntos: cada semilla · rombo: media de las 5 semillas (la predicción que se evalúa)", y=1.02)
    plt.tight_layout()
    return fig


def predictions_plot(r: dict):
    """Final model of each horizon against the real price and the naive forecast, with its 80 % interval."""
    fig, axes = plt.subplots(3, 1, figsize=(12, 9), sharex=True)
    for ax, hname in zip(axes, HORIZONS):
        g = interval_frame(r, hname)
        name, color = final_name(r["final"][hname]), COLORS[r["final"][hname]["red"]]
        ax.fill_between(g.fecha_objetivo, g.inferior, g.superior, color=color, alpha=0.15, lw=0, label="intervalo del 80 %")
        ax.plot(g.fecha_objetivo, g.precio_real, color=COLORS["Real"], lw=1.2, label="precio real")
        ax.plot(g.fecha_objetivo, g.precio_hoy, color=COLORS["Ingenuo"], lw=1, ls="--", label="ingenuo")
        ax.plot(g.fecha_objetivo, g.precio_pred, color=color, lw=1.3, label=f"predicción ({name})")
        ax.set_title(f"{H_LABELS[hname]} · el precio real cae dentro del intervalo el {g.dentro.mean() * 100:.0f} % de las veces")
        ax.set_ylabel("$ / barril")
        ax.legend(loc="upper left", ncol=4, fontsize=8)
    axes[-1].set_xlabel("fecha que se predice")
    plt.tight_layout()
    return fig


def advantage_plot(r: dict):
    """Cumulative difference of squared errors against the naive forecast: rising means the model is gaining."""
    preds = r["preds"]
    fig, axes = plt.subplots(1, 3, figsize=(16, 4.2))
    for ax, hname in zip(axes, HORIZONS):
        p = preds[preds.horizonte == hname]
        naive = p[p.modelo == "Ingenuo"].set_index("fecha_objetivo")
        e_naive = (naive.precio_real - naive.precio_pred) ** 2
        for net in NETS + ["Ridge"]:
            q = p[p.modelo == net].set_index("fecha_objetivo")
            ax.plot(q.index, (e_naive - (q.precio_real - q.precio_pred) ** 2).cumsum(), color=COLORS[net], label=net,
                    ls=":" if net == "Ridge" else "-", lw=1.6)
        ax.axhline(0, color=INK_2, lw=0.6)
        ax.axvspan(SHOCK_START, naive.index.max(), color="0.5", alpha=0.12, lw=0)
        ax.set_title(f"{H_LABELS[hname]}: ventaja acumulada sobre el ingenuo ($²)")
        ax.tick_params(axis="x", rotation=30)
    axes[0].legend(fontsize=8)
    fig.suptitle("Sombreado: guerra con Irán y cierre del estrecho de Ormuz (desde el 28/02/2026)", y=1.02)
    plt.tight_layout()
    return fig


def cost_plot(r: dict):
    """Number of parameters against training time per seed of each network and horizon."""
    cost = r["comp"][r["comp"].modelo.isin(NETS)]
    fig, ax = plt.subplots(figsize=(8, 4.5))
    for _, row in cost.iterrows():
        ax.scatter(row.n_params, row.tiempo_entrenamiento_s, s=90, color=COLORS[row.modelo],
                   marker={"corto": "o", "medio": "s", "largo": "^"}[row.horizonte])
        ax.annotate(f"{row.modelo} · {H_LABELS[row.horizonte]}", (row.n_params, row.tiempo_entrenamiento_s),
                    xytext=(5, -11) if (row.modelo, row.horizonte) == ("RNN simple", "medio") else (5, 3),
                    textcoords="offset points", fontsize=8)
    ax.set_xscale("log")
    ax.set_xlabel("nº de parámetros (escala logarítmica)")
    ax.set_ylabel("tiempo de entrenamiento por semilla (s)")
    ax.set_title("Coste de la configuración final de cada red")
    plt.tight_layout()
    return fig
