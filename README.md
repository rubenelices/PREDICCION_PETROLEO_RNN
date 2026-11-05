# Predicción del precio del petróleo Brent con RNN, LSTM y GRU

Caso práctico de Aprendizaje Automático: comparación de tres redes neuronales recurrentes (RNN simple, LSTM y GRU) para predecir el precio del Brent a corto (5 días hábiles), medio (63) y largo plazo (252), e integración del mejor modelo en una aplicación que calcula la predicción, su rango de incertidumbre y una explicación en lenguaje sencillo.

El enunciado completo está en [`docs/assignment/ENUNCIADO.pdf`](docs/assignment/ENUNCIADO.pdf).

> Proyecto en desarrollo.

## Instalación

Requisitos: Python 3.12 o 3.13 y [Poetry](https://python-poetry.org/docs/#installation).

```bash
poetry install
```

## Descarga de datos

```bash
poetry run python scripts/download_data.py
```

Descarga los precios diarios del Brent y del WTI y las variables de mercado (FRED y Yahoo Finance) desde el 1 de enero de 2000 y los guarda en `data/petroleo_dataset.csv`.
