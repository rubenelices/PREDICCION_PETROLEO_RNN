import pytest
import torch

from oil_forecast.models import CELLS, RecurrentRegressor, count_parameters


@pytest.mark.parametrize("cell", list(CELLS))
def test_output_shape(cell):
    model = RecurrentRegressor(cell, n_features=17, hidden_size=16, num_layers=2, dropout=0.2)
    assert model(torch.randn(8, 60, 17)).shape == (8,)


def test_same_structure_only_cell_changes():
    # gates multiply the recurrent weights: RNN x1, GRU x3, LSTM x4
    n = {c: count_parameters(RecurrentRegressor(c, 17, hidden_size=32)) for c in CELLS}
    head = 32 + 1
    rnn_core = n["rnn"] - head
    assert n["gru"] - head == 3 * rnn_core
    assert n["lstm"] - head == 4 * rnn_core


def test_unknown_cell_is_rejected():
    with pytest.raises(ValueError):
        RecurrentRegressor("transformer", 17)
