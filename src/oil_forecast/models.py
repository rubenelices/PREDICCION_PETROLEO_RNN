"""Simple RNN, LSTM and GRU regressors sharing exactly the same structure.

Only the recurrent cell changes between the three models, so any difference
in the comparison comes from the cell itself and not from the surrounding
architecture.
"""

from torch import nn

CELLS = {"rnn": nn.RNN, "lstm": nn.LSTM, "gru": nn.GRU}


class RecurrentRegressor(nn.Module):
    """Recurrent layers -> dropout -> linear head on the last hidden state.

    Input: ``(batch, window, n_features)``. Output: ``(batch,)`` with the
    predicted (scaled) cumulative log return for one horizon.
    """

    def __init__(
        self,
        cell: str,
        n_features: int,
        hidden_size: int = 32,
        num_layers: int = 1,
        dropout: float = 0.0,
    ):
        super().__init__()
        if cell not in CELLS:
            raise ValueError(f"cell must be one of {list(CELLS)}, got {cell!r}")
        self.cell = cell
        self.recurrent = CELLS[cell](
            input_size=n_features,
            hidden_size=hidden_size,
            num_layers=num_layers,
            batch_first=True,
            dropout=dropout if num_layers > 1 else 0.0,
        )
        self.dropout = nn.Dropout(dropout)
        self.head = nn.Linear(hidden_size, 1)

    def forward(self, x):
        out, _ = self.recurrent(x)
        return self.head(self.dropout(out[:, -1])).squeeze(-1)


def count_parameters(model: nn.Module) -> int:
    return sum(p.numel() for p in model.parameters() if p.requires_grad)
