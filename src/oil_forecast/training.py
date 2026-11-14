"""Training of the recurrent networks under identical conditions.

The same data preparation, early-stopping rule, optimiser and loss are used
for RNN, LSTM and GRU; only the recurrent cell and the tuned
hyperparameters change.
"""

import random
import time
from dataclasses import asdict, dataclass

import numpy as np
import pandas as pd
import torch
from torch import nn

from oil_forecast.config import HORIZONS, TARGET, WINDOW
from oil_forecast.data import load_dataset, log_return_targets
from oil_forecast.features import FoldScaler, build_features
from oil_forecast.models import RecurrentRegressor, count_parameters
from oil_forecast.sequences import make_sequences

# Same device and thread count for every model so training times are comparable
# (with these small networks one CPU thread is as fast as four).
DEVICE = "cpu"
THREADS = 1


@dataclass
class TrainConfig:
    hidden_size: int = 32
    num_layers: int = 1
    dropout: float = 0.2
    lr: float = 1e-3
    batch_size: int = 128
    weight_decay: float = 1e-5
    loss: str = "mse"  # "mse" or "huber"
    max_epochs: int = 150
    patience: int = 15
    window: int = WINDOW  # days of history in each input sequence
    half_life: float | None = None  # if set, recent samples weigh more (business days)
    linear_skip: bool = False  # linear model in parallel to the recurrent part
    features: tuple[str, ...] | None = None  # subset of input variables (None: all)

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class ModelData:
    """Everything a model needs, computed once and shared by all experiments."""

    feats: pd.DataFrame
    targets: pd.DataFrame
    price: np.ndarray

    @property
    def index(self) -> pd.DatetimeIndex:
        return self.feats.index


def load_model_data() -> ModelData:
    df = load_dataset()
    feats = build_features(df)
    targets = log_return_targets(df[TARGET], HORIZONS).loc[feats.index]
    price = df[TARGET].loc[feats.index].to_numpy()
    return ModelData(feats, targets, price)


def set_seed(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)


def early_stopping_split(train_pos: np.ndarray, horizon: int, frac: float = 0.15):
    """Last ``frac`` of the training origins for early stopping, with embargo.

    Early stopping never looks at the validation/test block that is being
    evaluated, so the reported scores are not optimistically biased.
    """
    cut = int(len(train_pos) * (1 - frac))
    return train_pos[: cut - horizon], train_pos[cut:]


def prepare(data: ModelData, horizon: int, train_pos, eval_pos, window: int = WINDOW, features=None) -> dict:
    """Scale (train statistics only), build sequences and standardise the target."""
    fit_pos, es_pos = early_stopping_split(np.asarray(train_pos), horizon)
    feats = data.feats if features is None else data.feats[list(features)]
    scaler = FoldScaler().fit(feats.iloc[: train_pos[-1] + 1])
    X = scaler.transform(feats).to_numpy(dtype=np.float32)
    y = data.targets[f"y_{horizon}"].to_numpy(dtype=np.float32)

    eval_pos = np.asarray(eval_pos)
    eval_pos = eval_pos[eval_pos >= window - 1]
    X_fit, y_fit = make_sequences(X, y, fit_pos, window)
    fit_used = fit_pos[fit_pos >= window - 1]
    X_es, y_es = make_sequences(X, y, es_pos, window)
    X_ev, y_ev = make_sequences(X, np.nan_to_num(y), eval_pos, window)
    y_mean, y_std = float(y_fit.mean()), float(y_fit.std())
    return {
        "X_fit": X_fit, "y_fit": (y_fit - y_mean) / y_std, "fit_age": fit_used[-1] - fit_used,
        "X_es": X_es, "y_es": (y_es - y_mean) / y_std,
        "X_eval": X_ev, "y_eval": y_ev, "eval_pos": eval_pos,
        "y_mean": y_mean, "y_std": y_std, "scaler": scaler,
    }


def _loss(name: str) -> nn.Module:
    """Per-sample loss (averaged, possibly weighted, inside ``fit``)."""
    return nn.HuberLoss(delta=1.0, reduction="none") if name == "huber" else nn.MSELoss(reduction="none")


def sample_weights(prepared: dict, half_life: float | None) -> np.ndarray:
    """Exponential decay with the age of each training sample (mean 1).

    A sample ``half_life`` business days older than the most recent one
    weighs half as much. Without ``half_life`` every sample weighs 1.
    """
    n = len(prepared["y_fit"])
    if half_life is None or "fit_age" not in prepared:
        return np.ones(n, dtype=np.float32)
    w = 0.5 ** (prepared["fit_age"] / half_life)
    return (w / w.mean()).astype(np.float32)


def fit(cell: str, cfg: TrainConfig, prepared: dict, seed: int = 0, on_epoch=None):
    """Train one network with early stopping. Returns (model, info).

    ``on_epoch``, if given, is called after every epoch with a dict holding
    the epoch number, the mean training loss of its batches, the training MSE
    (evaluation mode, comparable with the validation one), the early-stopping
    MSE, whether it is the best epoch so far, the patience used and the
    elapsed time. It is used to draw learning curves; when it is ``None``
    nothing extra is computed.
    """
    torch.set_num_threads(THREADS)
    set_seed(seed)
    n_features = prepared["X_fit"].shape[-1]
    model = RecurrentRegressor(
        cell, n_features, cfg.hidden_size, cfg.num_layers, cfg.dropout, cfg.linear_skip
    ).to(DEVICE)
    opt = torch.optim.Adam(model.parameters(), lr=cfg.lr, weight_decay=cfg.weight_decay)
    loss_fn = _loss(cfg.loss)

    X_fit = torch.from_numpy(prepared["X_fit"])
    y_fit = torch.from_numpy(prepared["y_fit"].astype(np.float32))
    w_fit = torch.from_numpy(sample_weights(prepared, cfg.half_life))
    X_es = torch.from_numpy(prepared["X_es"])
    y_es = torch.from_numpy(prepared["y_es"].astype(np.float32))
    gen = torch.Generator().manual_seed(seed)

    best_loss, best_state, best_epoch, wait = float("inf"), None, 0, 0
    start = time.perf_counter()
    for epoch in range(cfg.max_epochs):
        model.train()
        order = torch.randperm(len(X_fit), generator=gen)
        batch_losses = []
        for i in range(0, len(order), cfg.batch_size):
            idx = order[i : i + cfg.batch_size]
            opt.zero_grad()
            loss = (loss_fn(model(X_fit[idx]), y_fit[idx]) * w_fit[idx]).mean()
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            batch_losses.append(loss.item())
        model.eval()
        with torch.no_grad():
            es_loss = nn.functional.mse_loss(model(X_es), y_es).item()
        improved = es_loss < best_loss - 1e-5
        if improved:
            best_loss, best_epoch, wait = es_loss, epoch, 0
            best_state = {k: v.detach().clone() for k, v in model.state_dict().items()}
        else:
            wait += 1
        if on_epoch is not None:
            with torch.no_grad():
                train_mse = nn.functional.mse_loss(model(X_fit), y_fit).item()
            on_epoch({
                "epoch": epoch + 1, "train_loss": float(np.mean(batch_losses)), "train_mse": train_mse,
                "val_mse": es_loss, "best": improved, "wait": wait,
                "elapsed_s": time.perf_counter() - start,
            })
        if wait >= cfg.patience:
            break
    model.load_state_dict(best_state)
    info = {
        "train_time_s": time.perf_counter() - start,
        "epochs": epoch + 1,
        "best_epoch": best_epoch + 1,
        "es_mse": best_loss,
        "n_params": count_parameters(model),
    }
    return model, info


def predict(model: nn.Module, prepared: dict, detrend: bool = False) -> np.ndarray:
    """Predicted log return (original scale) for the evaluation origins.

    The network learns the return minus the training-period average. With
    ``detrend`` that average is not added back, so the forecast assumes zero
    drift, like the naive forecast.
    """
    model.eval()
    with torch.no_grad():
        z = model(torch.from_numpy(prepared["X_eval"])).numpy()
    return z * prepared["y_std"] + (0.0 if detrend else prepared["y_mean"])
