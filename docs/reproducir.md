[← Volver al README](../README.md) &nbsp;|&nbsp; [Cómo se hizo](metodologia.md) &nbsp;|&nbsp; [Resultados](resultados.md) &nbsp;|&nbsp; [Guía de la web](aplicacion.md) &nbsp;|&nbsp; [Reproducirlo](reproducir.md)

# Reproducirlo

Instalación, los pasos para rehacer todo el trabajo desde la descarga de datos y la estructura del repositorio.

**En esta página:**

- [Cómo reproducirlo](#cómo-reproducirlo)
- [Estructura del repositorio](#estructura-del-repositorio)

---

## Cómo reproducirlo

Requisitos: Python 3.12 o 3.13 y [Poetry](https://python-poetry.org/docs/#installation).

```bash
poetry install
```

| Paso | Comando | Resultado |
|---|---|---|
| 1. Datos | `poetry run python scripts/download_data.py` | `data/petroleo_dataset.csv` y `data/metadata.json` |
| 2. Búsqueda | `poetry run python scripts/tune.py --all` | Estudios de Optuna en `reports/tuning/ronda_5/` |
| 3. Ventana común | `poetry run python scripts/tune.py --decidir-ventana` | `ventana_decision.json` |
| 4. Validación | `poetry run python scripts/train.py validacion` | `validacion_resumen.csv`, `modelo_final.json` |
| 5. Validación hacia atrás | `poetry run python scripts/train.py hacia_atras` | `hacia_atras_resumen.csv` |
| 6. Intervalo | `poetry run python scripts/intervalo.py` | `intervalo_decision.json` |
| 7. Test | `poetry run python scripts/train.py test` | `comparativa.csv`, `predicciones_test.csv` |
| 8. Curvas de aprendizaje | `poetry run python scripts/curvas.py` | `reports/results/ronda_5/curvas/` |
| 9. Modelos de la app | `poetry run python scripts/entrenar_app.py` | `app/modelos/` y `app/web/datos/` |
| 10. Figuras del README | `poetry run python scripts/figuras_readme.py` | `docs/img/` |

Los scripts de entrenamiento aceptan `--nucleos N` para limitar los procesos en paralelo. Los resultados de la ronda final ya están en el repositorio, así que los notebooks se pueden ejecutar sin volver a entrenar (solo necesitan el paso 1).

**Tests y estilo:**

```bash
poetry run pytest
```

```bash
poetry run ruff check .
```

Los tests comprueban, entre otras cosas, que no haya fugas de información del futuro (escalado, embargo, calibración del intervalo), la forma de las redes y el entrenamiento.

## Estructura del repositorio

```
├── app/                      Aplicación web
│   ├── servidor.py           FastAPI: sirve la web y los endpoints /api/*
│   ├── generar_datos.py      Escribe los JSON que lee la web
│   ├── modelos/              Redes entrenadas con todos los datos (.pt) y su especificación
│   ├── web/                  Panel, historia 3D y datos (JSON)
│   ├── Dockerfile            Imagen para Hugging Face Spaces
│   └── requirements.txt      Dependencias del Space (PyTorch para CPU)
├── docs/
│   ├── metodologia.md        Cómo se hizo: datos, validación, rondas e intervalo
│   ├── resultados.md         Resultados del test y conclusiones
│   ├── aplicacion.md         Qué ofrece la web y cómo ejecutarla
│   ├── reproducir.md         Esta página
│   ├── assignment/           Enunciado
│   └── img/                  Figuras del README
├── notebooks/                01-08, del ETL a la comparativa final
├── reports/
│   ├── results/ronda_N/      Validación, decisiones, test, intervalo y curvas
│   └── tuning/ronda_N/       Estudios de Optuna y mejores configuraciones
├── scripts/                  Descarga, búsqueda, entrenamiento, intervalo, app y figuras
├── src/oil_forecast/         Paquete con todo el código reutilizable
│   ├── data.py               Descarga y limpieza
│   ├── features.py           Variables y escalado sin fugas
│   ├── splits.py             Walk-forward con embargo
│   ├── sequences.py          Ventanas de entrada
│   ├── models.py             RNN simple, LSTM y GRU
│   ├── training.py           Entrenamiento con parada temprana
│   ├── metrics.py            MAE, MSE, RMSE, R², dirección, Diebold-Mariano y bootstrap
│   ├── intervals.py          Intervalos del 80 %
│   ├── app_model.py          Modelos de la aplicación
│   ├── experiment_log.py     Tablas y figuras de las rondas (nb 08)
│   └── test_report.py        Tablas y figuras del test (nb 07)
└── tests/                    Tests con pytest
```

---

[← Volver al README](../README.md) &nbsp;|&nbsp; [Cómo se hizo](metodologia.md) &nbsp;|&nbsp; [Resultados](resultados.md) &nbsp;|&nbsp; [Guía de la web](aplicacion.md) &nbsp;|&nbsp; [Reproducirlo](reproducir.md)
