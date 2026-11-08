"""Shared chart style and the diagrams of the recurrent cells and architectures.

Colours: one fixed hue per network (validated for colour-vision deficiency),
neutral greys for the reference models. Every chart that uses them also has a
legend or direct labels, so identity never depends on colour alone.
"""

import matplotlib.pyplot as plt
from cycler import cycler
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch

COLORS = {
    "RNN simple": "#eb6834",
    "LSTM": "#2a78d6",
    "GRU": "#1baf7a",
    "Ridge": "#52514e",
    "Media histórica": "#c3c2b7",
    "Ingenuo": "#8c8a84",
    "Real": "#0b0b0b",
}
# Reference models are grey: line style is their second, non-colour encoding
LINESTYLES = {"Ingenuo": "--", "Ridge": ":", "Media histórica": "-."}
CELL_NAMES = {"rnn": "RNN simple", "lstm": "LSTM", "gru": "GRU"}
SURFACE = "#fcfcfb"
INK = "#0b0b0b"
INK_2 = "#52514e"
GRID = "#e6e5e0"
# Fixed categorical order for charts whose series are not networks
PALETTE = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"]


def set_style() -> None:
    """Light surface, thin lines and recessive axes for every notebook chart."""
    plt.rcParams.update({
        "figure.facecolor": SURFACE, "axes.facecolor": SURFACE, "savefig.facecolor": SURFACE,
        "figure.dpi": 80, "figure.figsize": (12, 4),
        "font.size": 10, "axes.titlesize": 12, "axes.titleweight": "bold", "axes.titlelocation": "left",
        "axes.edgecolor": GRID, "axes.labelcolor": INK_2, "axes.grid": True, "grid.color": GRID,
        "grid.linewidth": 0.8, "axes.spines.top": False, "axes.spines.right": False,
        "xtick.color": INK_2, "ytick.color": INK_2, "lines.linewidth": 2,
        "legend.frameon": False, "text.color": INK, "axes.prop_cycle": cycler(color=PALETTE),
    })


# ------------------------------------------------------------------ diagrams
def _box(ax, x, y, w, h, text, color, alpha=1.0, fontsize=9, text_color="white", weight="bold"):
    ax.add_patch(FancyBboxPatch((x - w / 2, y - h / 2), w, h, boxstyle="round,pad=0.02,rounding_size=0.08",
                                facecolor=color, edgecolor="none", alpha=alpha))
    ax.text(x, y, text, ha="center", va="center", fontsize=fontsize, color=text_color, weight=weight, linespacing=1.3)


def _arrow(ax, start, end, color=INK_2):
    ax.add_patch(FancyArrowPatch(start, end, arrowstyle="-|>", mutation_scale=12, color=color, lw=1.3,
                                 shrinkA=2, shrinkB=2))


CELL_GATES = {
    "rnn": [("estado nuevo", r"$h_t=\tanh(W x_t + U h_{t-1} + b)$")],
    "gru": [
        ("reinicio  $r_t$", "cuánto pasado usar en el candidato"),
        ("actualización  $z_t$", "cuánto conservar del estado anterior"),
        (r"candidato  $\tilde{h}_t$", "propuesta de nuevo estado"),
    ],
    "lstm": [
        ("olvido  $f_t$", "qué borrar de la memoria"),
        ("entrada  $i_t$", "qué información nueva guardar"),
        ("candidato  $g_t$", "contenido nuevo propuesto"),
        ("salida  $o_t$", "qué parte de la memoria mostrar"),
    ],
}
CELL_NOTES = {
    "rnn": "Sin puertas: la información antigua se diluye en pocos pasos\n(el gradiente se desvanece). La más simple y barata.",
    "gru": "Dos puertas deciden cuánto pasado conservar: memoria larga\ncon un 25 % menos de parámetros que la LSTM.",
    "lstm": "Memoria separada (c) que solo se modifica a través de las puertas:\nla que mejor retiene información lejana, y la más costosa.",
}


def draw_cell(ax, cell: str) -> None:
    """Conceptual diagram of one recurrent cell: inputs, gates and outputs."""
    name, color = CELL_NAMES[cell], COLORS[CELL_NAMES[cell]]
    gates = CELL_GATES[cell]
    k = len(gates)
    ax.set_xlim(0, 11)
    ax.set_ylim(-1.2, 6.0)
    ax.axis("off")
    top, bottom = 4.6, (1.35 if cell == "lstm" else 1.0)
    ys = [2.6] if k == 1 else [top - i * (top - bottom) / (k - 1) for i in range(k)]
    inputs = [("$x_t$\nvariables del día", 3.5), ("$h_{t-1}$\nestado anterior", 2.1)]
    for text, y in inputs:
        _box(ax, 1.1, y, 2.0, 0.85, text, "#e6e5e0", text_color=INK, fontsize=8.5, weight="normal")
        for yg in ys:
            _arrow(ax, (2.1, y), (3.2, yg), color="#c3c2b7")
    for i, (gate, desc) in enumerate(gates):
        _box(ax, 5.0, ys[i], 3.4, 0.6, gate, color, alpha=1.0 - 0.17 * i, fontsize=9.5)
        ax.text(5.0, ys[i] - 0.47, desc, ha="center", va="center", fontsize=7.5, color=INK_2)
    out_y = 2.6 if cell != "lstm" else 3.0
    _box(ax, 9.7, out_y, 2.1, 0.85, "$h_t$\nestado nuevo", color, fontsize=8.5)
    for yg in ys:
        _arrow(ax, (6.75, yg), (8.6, out_y), color="#c3c2b7")
    if cell == "lstm":
        _box(ax, 1.1, 0.2, 2.0, 0.7, "$c_{t-1}$  memoria", "#e6e5e0", text_color=INK, fontsize=8.5, weight="normal")
        _box(ax, 9.7, 0.2, 2.1, 0.7, "$c_t$  memoria", color, fontsize=8.5)
        _arrow(ax, (2.15, 0.2), (8.6, 0.2), color=color)
        ax.text(5.0, 0.42, r"$c_t = f_t \odot c_{t-1} + i_t \odot g_t$", ha="center", fontsize=8.5, color=INK)
        _arrow(ax, (9.7, 0.58), (9.7, 2.55), color="#c3c2b7")
    ax.text(0, 5.75, name, fontsize=14, weight="bold", color=color)
    ax.text(0, 5.35, f"{k} bloque{'s' if k > 1 else ''} de pesos  →  parámetros por capa = {k}·(h·d + h² + 2h)",
            fontsize=8.5, color=INK_2)
    ax.text(0, -0.95, CELL_NOTES[cell], fontsize=8.5, color=INK, style="italic", va="center")


def draw_architecture(ax, cell: str, params: dict, n_params: int, window: int = 60, n_features: int = 16,
                      horizon: int | None = None, score: float | None = None) -> None:
    """Pipeline of one trained configuration with the tensor shape at each step."""
    name, color = CELL_NAMES[cell], COLORS[CELL_NAMES[cell]]
    hdim, layers = int(params["hidden_size"]), int(params["num_layers"])
    steps = [("Entrada", f"{window} días ×\n{n_features} variables", "#e6e5e0", INK, f"({window}, {n_features})")]
    for i in range(layers):
        steps.append((f"{name} · capa {i + 1}", f"{hdim} neuronas", color, "white", f"({window}, {hdim})"))
    steps += [
        ("Dropout", f"p = {params['dropout']:.2f}", "#a8a69f", "white", f"({hdim})"),
        ("Lineal", f"{hdim} → 1", "#52514e", "white", "(1)"),
        ("Salida", "retorno\na h días", "#e6e5e0", INK, "→ precio"),
    ]
    ax.set_xlim(-0.2, 6 * 2.2)  # room for the largest network (2 recurrent layers): rows stay aligned
    ax.set_ylim(-1.6, 2.1)
    ax.axis("off")
    for i, (title, body, fc, tc, shape) in enumerate(steps):
        x = 1 + i * 2.2
        _box(ax, x, 0.3, 1.8, 1.25, f"{title}\n{body}", fc, text_color=tc, fontsize=8.5)
        ax.text(x, -0.55, shape, ha="center", fontsize=8, color=INK_2, family="monospace")
        if i:
            _arrow(ax, (x - 1.3, 0.3), (x - 0.9, 0.3))
    head = f"{name}" + (f" · horizonte {horizon} días" if horizon else "")
    ax.text(-0.1, 1.85, head, fontsize=12, weight="bold", color=color)
    sub = f"{n_params:,} parámetros".replace(",", ".")
    if score is not None:
        sub += f"  ·  RMSE relativo en validación = {score:.3f}"
    ax.text(-0.1, 1.45, sub, fontsize=9, color=INK_2)
    hp = (f"learning rate {params['lr']:.1e} · lote {int(params['batch_size'])} · "
          f"weight decay {params['weight_decay']:.1e} · pérdida {params['loss'].upper()}")
    ax.text(-0.1, -1.25, hp, fontsize=8.5, color=INK_2)
