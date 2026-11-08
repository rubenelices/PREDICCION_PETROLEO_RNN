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


def test_linear_skip_adds_a_linear_model_on_the_last_day():
    plain = RecurrentRegressor("gru", 17, hidden_size=16)
    skip = RecurrentRegressor("gru", 17, hidden_size=16, linear_skip=True)
    assert count_parameters(skip) - count_parameters(plain) == 17 + 1
    x = torch.randn(4, 30, 17)
    skip.eval()
    with torch.no_grad():
        rnn_part = skip.head(skip.recurrent(x)[0][:, -1]).squeeze(-1)
        linear_part = skip.skip(x[:, -1]).squeeze(-1)
        torch.testing.assert_close(skip(x), rnn_part + linear_part)
