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

Descarga los precios diarios del Brent y del WTI y las variables de mercado (FRED y Yahoo Finance) desde el 1 de enero de 2000 y genera:

| Fichero | Contenido |
|---|---|
| `data/raw/fred.csv`, `data/raw/yahoo.csv` | Series originales, sin modificar |
| `data/petroleo_dataset.csv` | Dataset diario alineado al calendario real del Brent |
| `data/metadata.json` | Fecha de descarga y último dato real de cada serie |

## Entrenamiento y comparativa de las redes

El modelo se construye por rondas: cada ronda prueba una mejora, se decide siempre con la validación walk-forward (2019-2023) y el test (2024-2026) solo se usa para comprobar el modelo elegido. Todas las rondas están resumidas en el notebook 08.

```bash
poetry run python scripts/tune.py --all                 # búsqueda de hiperparámetros (Optuna, mismo presupuesto para las 3 redes)
poetry run python scripts/train.py validacion           # validación walk-forward de las variantes de la ronda
poetry run python scripts/train.py test                 # evaluación en el test del modelo elegido
poetry run python scripts/curvas.py                     # curvas de aprendizaje, época a época
```

Todos aceptan `--nucleos N` para limitar los procesos en paralelo. Los resultados se guardan en `reports/tuning/ronda_N/` y `reports/results/ronda_N/`.

**Estado:** en curso (ronda 5: misma ventana de entrada para las tres redes y nueva búsqueda). Por ahora, las redes solo mejoran al modelo ingenuo de forma estable a 3 meses en validación.

## Notebooks

| Notebook | Contenido |
|---|---|
| [`01_etl_calidad_datos`](notebooks/01_etl_calidad_datos.ipynb) | Extracción, alineación de calendarios, antigüedad del dato, outliers y decisiones de limpieza |
| [`02_eda`](notebooks/02_eda.ipynb) | Ciclo económico, propiedades estadísticas, estacionalidad, relación con otros mercados e incertidumbre por horizonte |
| [`03_feature_engineering`](notebooks/03_feature_engineering.ipynb) | 30 variables candidatas, redundancia, relevancia, estabilidad y selección final de 16 |
| [`04_preprocesamiento`](notebooks/04_preprocesamiento.ipynb) | Objetivo por horizonte, walk-forward con embargo, escalado sin fugas y secuencias de 60 días |
| [`05_baselines`](notebooks/05_baselines.ipynb) | Modelo ingenuo, media histórica y Ridge: el listón para las redes |
| [`06_ajuste_hiperparametros`](notebooks/06_ajuste_hiperparametros.ipynb) | Ronda 1: cómo funciona cada celda, condiciones iguales, los 180 ensayos y las arquitecturas ganadoras |
| [`07_comparativa_modelos`](notebooks/07_comparativa_modelos.ipynb) | Ronda 1: primer test, estabilidad entre semillas y coste de cada red |
| [`08_registro_experimentos`](notebooks/08_registro_experimentos.ipynb) | Todas las rondas en formato compacto: qué se probó, qué salió y qué se decidió, más las curvas de aprendizaje |

## Tests

```bash
poetry run pytest
```
