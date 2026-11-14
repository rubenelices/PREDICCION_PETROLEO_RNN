// Semáforo de fiabilidad, compartido por el panel y la historia.
// Compara el modelo con "suponer que el precio no cambia" con las dos medidas de error:
// el error medio (MAE) y el error cuadrático (RMSE), que castiga más los fallos grandes.
// Solo es verde si gana con claridad en las dos; rojo si pierde en las dos.
const CLARO = 2; // % de mejora a partir del cual cuenta como mejora clara

export function nivel(h) {
  const a = h.mejora_mae_vs_ingenuo_pct, b = h.mejora_vs_ingenuo_pct;
  if (a >= CLARO && b >= CLARO) return {
    clase: 'verde', etiqueta: 'Aporta valor', icono: '✓',
    frase: 'En las pruebas se equivocó menos que suponer que el precio se queda igual, se mida como se mida el error.',
    uso: 'Sirve como referencia para planificar, sin perder de vista el rango.',
  };
  if (a < 0 && b < 0) return {
    clase: 'rojo', etiqueta: 'Poco fiable', icono: '✕',
    frase: 'En las pruebas se equivocó más que suponer que el precio se queda igual.',
    uso: 'No planifiques con esta cifra. Usa el rango completo, o el precio de hoy, como referencia.',
  };
  const mixto = (a < 0) !== (b < 0);
  return {
    clase: 'naranja', etiqueta: 'Orientativa', icono: '!',
    frase: mixto
      ? 'En las pruebas no mejoró con claridad a suponer que el precio se queda igual: según cómo se mida el error, sale mejor o peor.'
      : 'En las pruebas mejoró muy poco a suponer que el precio se queda igual.',
    uso: 'Tómala como orientación. Para decidir, pesa más el rango que la cifra central.',
  };
}
