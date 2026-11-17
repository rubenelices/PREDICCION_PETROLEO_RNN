<h1 align="center">Predicción del precio del petróleo Brent con RNN, LSTM y GRU</h1>

<p align="center"><b>Tres redes recurrentes para prever el barril a 1 semana, 3 meses y 1 año, con su intervalo del 80 % y una web que lo explica.</b></p>

<p align="center">
  <a href="URL_DEL_SPACE"><img src="https://img.shields.io/badge/Abrir%20la%20aplicaci%C3%B3n-E8A33D?style=for-the-badge&logo=huggingface&logoColor=1a1a1a" alt="Abrir la aplicación"></a>
  <a href="docs/metodologia.md"><img src="https://img.shields.io/badge/C%C3%B3mo%20se%20hizo-2B5A7A?style=for-the-badge&logo=jupyter&logoColor=white" alt="Cómo se hizo"></a>
  <a href="docs/resultados.md"><img src="https://img.shields.io/badge/Resultados-3E7A4A?style=for-the-badge&logo=pytorch&logoColor=white" alt="Resultados"></a>
  <a href="docs/aplicacion.md"><img src="https://img.shields.io/badge/Gu%C3%ADa%20de%20la%20web-8A4B2E?style=for-the-badge&logo=fastapi&logoColor=white" alt="Guía de la web"></a>
  <a href="docs/reproducir.md"><img src="https://img.shields.io/badge/Reproducirlo-4A4F57?style=for-the-badge&logo=python&logoColor=white" alt="Reproducirlo"></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Python-3.12%20%7C%203.13-3776AB?logo=python&logoColor=white" alt="Python">
  <img src="https://img.shields.io/badge/PyTorch-2.x-EE4C2C?logo=pytorch&logoColor=white" alt="PyTorch">
  <img src="https://img.shields.io/badge/Optuna-búsqueda%20de%20hiperparámetros-2C5BB4" alt="Optuna">
  <img src="https://img.shields.io/badge/FastAPI-aplicación%20web-009688?logo=fastapi&logoColor=white" alt="FastAPI">
  <img src="https://img.shields.io/badge/Docker-Hugging%20Face%20Spaces-2496ED?logo=docker&logoColor=white" alt="Docker">
  <img src="https://img.shields.io/badge/tests-27%20pasan-brightgreen" alt="Tests">
</p>

<p align="center">
  <img src="docs/img/web_panel.jpg" width="49%" alt="Panel de la aplicación con la previsión de cada plazo">
  <img src="docs/img/web_historia.jpg" width="49%" alt="Historia en 3D del precio del Brent">
</p>

Caso práctico de Aprendizaje Automático: comparación de tres redes neuronales recurrentes (**RNN simple, LSTM y GRU**) para predecir el precio del Brent a **1 semana (5 días hábiles), 3 meses (63) y 1 año (252)**, e integración del modelo final en una **aplicación web** que da la previsión, su **intervalo del 80 %** y una explicación en lenguaje sencillo de lo fiable que es.

El enunciado completo está en [`docs/assignment/ENUNCIADO.pdf`](docs/assignment/ENUNCIADO.pdf).

## Resultados

Error en el **test (enero de 2024 → noviembre de 2026)**, medido como RMSE en dólares **relativo al modelo ingenuo** («el precio dentro de *h* días será el de hoy»): **1 es empatar con el ingenuo y por debajo de 1 es mejorarlo**.

| Plazo | RNN simple | LSTM | GRU | Ridge (lineal) | Modelo final (elegido en validación) | Intervalo 80 %: cobertura en el test |
|---|---|---|---|---|---|---|
| 1 semana | **0,992** | 0,999 | 0,993 | 1,001 | LSTM → 0,999 | 79 % |
| 3 meses | 1,110 | **0,972** | 1,020 | 1,069 | RNN simple (peso 0,9) → 1,094 | 80 % |
| 1 año | 0,955 | **0,933** | 0,938 | 0,948 | LSTM → **0,933** (RMSE +6,7 %) | 87 % |

- **1 semana:** ninguna red se separa del ingenuo. Lo útil a este plazo es el intervalo, que acierta el 79 % de las veces.
- **3 meses:** la red elegida en validación (RNN simple) no se sostiene en el test. La LSTM sí mejora al ingenuo, un 2,8 %.
- **1 año:** la LSTM, que es el modelo final, baja el RMSE un **6,7 %** con las 5 semillas a favor, aunque no el error medio (MAE −0,7 %).
- Ninguna red mejora al ingenuo de forma estadísticamente significativa (Diebold-Mariano, p > 0,05): batir al ingenuo en el precio del petróleo es muy difícil.

Las cuatro métricas, el R², la comparación año a año y las conclusiones están en [Resultados](docs/resultados.md). Cómo se eligió cada modelo, con todas las rondas y reglas de decisión, en [Cómo se hizo](docs/metodologia.md).

## Notebooks

| Notebook | Contenido |
|---|---|
| [`01_etl_calidad_datos`](notebooks/01_etl_calidad_datos.ipynb) | Extracción, alineación de calendarios, antigüedad del dato, valores atípicos y decisiones de limpieza |
| [`02_eda`](notebooks/02_eda.ipynb) | Ciclos del precio, propiedades estadísticas, estacionalidad, relación con otros mercados e incertidumbre por horizonte |
| [`03_feature_engineering`](notebooks/03_feature_engineering.ipynb) | 30 variables candidatas, redundancia, relevancia, estabilidad en el tiempo y selección final de 16 |
| [`04_preprocesamiento`](notebooks/04_preprocesamiento.ipynb) | Objetivo de cada horizonte, walk-forward con embargo, escalado sin fugas y secuencias de 20 días |
| [`05_baselines`](notebooks/05_baselines.ipynb) | Modelo ingenuo, media histórica y regresión Ridge: el listón para las redes |
| [`06_ajuste_hiperparametros`](notebooks/06_ajuste_hiperparametros.ipynb) | Cómo funciona cada celda, la elección de la ventana común, la búsqueda y las arquitecturas finales |
| [`07_comparativa_modelos`](notebooks/07_comparativa_modelos.ipynb) | Test: tabla comparativa, estabilidad entre semillas, predicciones, intervalo, coste y conclusiones |
| [`08_registro_experimentos`](notebooks/08_registro_experimentos.ipynb) | Todas las rondas de experimentos: qué se probó, qué salió y qué se decidió, con curvas de aprendizaje |

## Ponerlo en marcha

Requisitos: Python 3.12 o 3.13 y [Poetry](https://python-poetry.org/docs/#installation).

```bash
poetry install
```

```bash
poetry run uvicorn servidor:app --app-dir app --port 7860
```

Eso abre la aplicación en <http://localhost:7860> con los modelos ya entrenados. Los pasos para rehacer todo desde la descarga de datos están en [Reproducirlo](docs/reproducir.md).

## Documentación

| Página | Qué contiene |
|---|---|
| [Cómo se hizo](docs/metodologia.md) | El problema, los datos, la validación sin mirar al futuro, las rondas de experimentos, la validación hacia atrás y el intervalo del 80 % |
| [Resultados](docs/resultados.md) | Tabla comparativa del test, R², el modelo final frente a la realidad, conclusiones y limitaciones |
| [Guía de la web](docs/aplicacion.md) | Qué ofrece cada página de la web, cómo está montada y cómo desplegarla en Hugging Face Spaces |
| [Reproducirlo](docs/reproducir.md) | Los diez pasos del trabajo, tests y estructura del repositorio |
