import { nivel } from './fiabilidad.js?v=20261115';
// Capa de contenido: guion de paradas, paneles y gráficas sobre la escena 3D.
// Los datos vienen de datos/*.json; con el backend de Python serán los mismos JSON servidos por FastAPI.

const fmt = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt0 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });
const fmtFecha = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
const fmtMes = new Intl.DateTimeFormat('es-ES', { month: 'short', year: '2-digit' });
const fmt1 = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dolares = v => `${fmt.format(v)} $`;
// las previsiones van redondeadas, igual que en el panel: con rangos tan anchos los céntimos serían precisión falsa
const pct1 = v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt1.format(Math.abs(v))} %`;
const pct = v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt.format(Math.abs(v))} %`;
const fecha = s => fmtFecha.format(new Date(s + 'T12:00:00'));
const NS = 'http://www.w3.org/2000/svg';
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
// mezcla de lineal y suavizado: arranca y frena con algo de velocidad para enlazar con la deriva de las paradas
const suave = t => 0.45 * t + 0.55 * t * t * (3 - 2 * t);
const DERIVA = 0.14; // en una parada la cámara avanza un poco hacia el siguiente punto, para no quedarse congelada

// ---------------------------------------------------------------------------
// Guion: cada bloque ocupa un tramo de scroll. "parada" deja la cámara quieta en
// un punto (k) y muestra un panel; "viaje" mueve la cámara de un punto a otro.
// Los puntos de cámara (k) están definidos en escena.js.
// ---------------------------------------------------------------------------
const ERAS = [
  { anio: '2026', eventos: ['2026-04-07'], tiempo: 2026.3 },
  { anio: '2022', eventos: ['2022-03-08'], tiempo: 2022.2 },
  { anio: '2020', eventos: ['2020-04-21'], tiempo: 2020.3 },
  { anio: '2014–2016', eventos: ['2016-01-20'], tiempo: 2015.4 },
  { anio: '2008', eventos: ['2008-07-03', '2008-12-26'], tiempo: 2008.6 },
  { anio: '2000', eventos: [], tiempo: 2000.05 },
];
const K_ERA0 = 4, K_RIESGOS = 10, K_CAVERNA = 11;

const GUION = [
  // la portada y los plazos se mantienen hasta que la cámara cruza el suelo (bloque 3, al 60 %)
  { tipo: 'parada', k: 0, alto: 100, panel: 'portada', hasta: [3, 0.6] },
  { tipo: 'viaje', a: 1, alto: 70 },
  { tipo: 'parada', k: 1, alto: 100, panel: 'plazos', hasta: [3, 0.6] },
  // el cruce del suelo es corto: así no queda un tramo oscuro y sin texto antes de la primera capa
  { tipo: 'viaje', a: 3, alto: 70 },
  { tipo: 'parada', k: 3, alto: 80, panel: 'bajada' },
  ...ERAS.flatMap((_, i) => [
    { tipo: 'viaje', a: K_ERA0 + i, alto: 45 },
    { tipo: 'parada', k: K_ERA0 + i, alto: 85, panel: `era-${i}` },
  ]),
  { tipo: 'viaje', a: K_RIESGOS, alto: 45 },
  { tipo: 'parada', k: K_RIESGOS, alto: 95, panel: 'riesgos' },
  { tipo: 'viaje', a: K_CAVERNA, alto: 100 },
  { tipo: 'parada', k: K_CAVERNA, alto: 140, panel: 'modelo' },
  { tipo: 'parada', k: K_CAVERNA, alto: 180, panel: 'prevision' },
  { tipo: 'parada', k: K_CAVERNA, alto: 150, panel: 'fiabilidad' },
  { tipo: 'parada', k: K_CAVERNA, alto: 110, panel: 'cierre' },
];

const PLAZOS = {
  corto: { nombre: '1 semana', cuando: 'la semana que viene', uso: 'Para decidir una compra inminente o fijar un precio esta semana.' },
  medio: { nombre: '3 meses', cuando: 'dentro de tres meses', uso: 'Para cerrar el presupuesto de energía del trimestre.' },
  largo: { nombre: '1 año', cuando: 'dentro de un año', uso: 'Para planificar el año y decidir coberturas.' },
};
// Notas por plazo, resumen del test del notebook 07.
const NOTAS = {
  corto: 'A una semana el modelo empata con suponer que el precio no cambia. Lo útil aquí es el rango, no la cifra exacta.',
  medio: 'Acertó más que suponer que el precio no cambia en 2025, pero falló en 2024 y en el shock de 2026, y en conjunto queda por detrás.',
  largo: 'Falla menos en los errores grandes que suponer que el precio no cambia, pero su error medio es parecido y acierta si subirá o bajará la mitad de las veces.',
};


// ---------------------------------------------------------------------------
// Construcción de paneles
// ---------------------------------------------------------------------------
let datos, plazoActual = 'medio';
export const datosHistoria = () => ({ serie, eventos: datos.eventos });
const bloques = [];
const paneles = {};

function html(strings, ...vals) { return strings.reduce((s, x, i) => s + x + (i < vals.length ? vals[i] : ''), ''); }

function panelPortada() {
  const p = datos.prediccion;
  const cambio = (p.precio_hoy / p.precio_anterior - 1) * 100;
  return html`
    <h1>¿Cuánto costará el barril de Brent?</h1>
    <p class="entradilla">Bajamos a un pozo para contártelo: arriba, el precio de hoy; en la roca, su historia; al fondo, la previsión.</p>
    <div class="precio-hoy">
      <span class="cifra-grande">${dolares(p.precio_hoy)}</span>
      <span class="detalle">por barril, ${fecha(p.fecha_dato)}<br>${pct(cambio)} respecto al día anterior</span>
    </div>`;
}

function panelPlazos() {
  return html`
    <h2>Tres preguntas, tres plazos</h2>
    <ul class="plazos-lista">
      ${Object.values(PLAZOS).map(z => `<li><strong>${z.nombre}</strong><span>${z.uso}</span></li>`).join('')}
    </ul>
    <p class="nota">Al fondo del pozo verás para cada plazo el precio esperado, un rango probable y cuánto puedes fiarte.</p>`;
}

function panelBajada() {
  return html`
    <h2>Cada capa de roca es una época</h2>
    <p>Cuanto más bajas, más atrás en el tiempo. La veta ámbar de la pared es el precio del barril: cuanto más a la derecha, más caro. Cada punto claro es una crisis.</p>`;
}

function panelEra(i) {
  const era = ERAS[i];
  const evs = era.eventos.map(d => datos.eventos.find(e => e.date === d));
  if (!evs.length) {
    const p0 = datos.historico.precios[0];
    return html`
      <div class="anio">${era.anio}</div>
      <h2>El punto de partida</h2>
      <p>Aquí empiezan nuestros datos: el 4 de enero de 2000 un barril costaba ${dolares(p0)}. Desde entonces se ha multiplicado, desplomado y recuperado varias veces.</p>
      <p>Toda la veta que has seguido al bajar es lo que el modelo ha estudiado para aprender cómo se mueve el precio.</p>`;
  }
  return html`
    <div class="anio">${era.anio}</div>
    <h2>${evs[0].title.replace(/\s*\(.*\)$/, '')}</h2>
    ${evs.map(e => `<p>${e.text}</p>`).join('')}
    <div class="hitos">
      ${evs.map(e => `<div class="hito"><span class="flecha ${e.kind}" aria-hidden="true">${e.kind === 'pico' ? '▲' : '▼'}</span><span class="cifra">${dolares(e.precio)}</span><span class="detalle">${e.kind === 'pico' ? 'máximo' : 'mínimo'} el ${fecha(e.date)}</span></div>`).join('')}
    </div>`;
}

function panelRiesgos() {
  const r = [
    ['OPEP+', 'Un recorte o un aumento de producción mueve el precio en horas.'],
    ['Guerras y bloqueos', 'Como el estrecho de Ormuz en 2026 o las sanciones a Rusia en 2022.'],
    ['Recesión mundial', 'Si la economía frena, se consume menos petróleo.'],
    ['El dólar', 'El crudo se paga en dólares: si el dólar se mueve, el precio también.'],
    ['Inventarios', 'Los depósitos llenos o vacíos en EE. UU. adelantan subidas y bajadas.'],
    ['Huracanes', 'Pueden parar plataformas y refinerías del golfo de México.'],
  ];
  return html`
    <h2>Lo que puede romper cualquier previsión</h2>
    <p>Ningún modelo ve venir estas sacudidas. Cuando ocurren, el precio puede salirse del rango previsto.</p>
    <ul class="riesgos">${r.map(([t, d]) => `<li><strong>${t}</strong><span>${d}</span></li>`).join('')}</ul>`;
}

function panelPrevision() {
  return html`
    <div class="prevision">
      <div class="prevision-texto">
        <h2>La previsión</h2>
        <div class="selector" role="tablist" aria-label="Plazo de la previsión">
          ${Object.entries(PLAZOS).map(([k, z], i) => `<button role="tab" data-plazo="${k}" aria-selected="${i === 1}">${z.nombre}</button>`).join('')}
        </div>
        <div class="resultado" aria-live="polite"></div>
      </div>
      <figure class="grafica-prevision">
        <svg class="g-prev" role="img" aria-label="Precio del Brent en los dos últimos años y previsión"></svg>
        <div class="tooltip" hidden></div>
        <figcaption class="nota">Precio diario del Brent y rango donde caería 8 de cada 10 veces. El crudo del fondo sube o baja con la previsión.</figcaption>
      </figure>
    </div>`;
}

function rellenarPrevision(clave) {
  const p = datos.prediccion, h = p.horizontes[clave], z = PLAZOS[clave], n = nivel(h);
  const sube = h.variacion_pct >= 0;
  const cont = paneles.prevision.querySelector('.resultado');
  cont.innerHTML = html`
    <p class="pregunta">¿Cuánto costará ${z.cuando}?</p>
    <div class="cifra-grande">${fmt0.format(h.precio)} $</div>
    <p class="variacion"><span aria-hidden="true">${sube ? '▲' : '▼'}</span> ${pct1(h.variacion_pct)} frente a hoy (${dolares(p.precio_hoy)}), hacia el ${fecha(h.fecha_objetivo)}</p>
    <p class="rango">Lo más probable: <strong>entre ${fmt0.format(h.rango80[0])} y ${fmt0.format(h.rango80[1])} $</strong></p>
    <div class="semaforo ${n.clase}"><span class="icono" aria-hidden="true">${n.icono}</span><span><strong>${n.etiqueta}.</strong> ${n.frase}</span></div>
    <p class="explicacion">${NOTAS[clave]} Puede romperla una decisión de la OPEP+, un conflicto como el de Ormuz, una recesión o un giro del dólar.</p>`;
  for (const b of paneles.prevision.querySelectorAll('[role=tab]')) b.setAttribute('aria-selected', b.dataset.plazo === clave);
  dibujarPrevision(clave);
  // el plazo elegido viaja al panel, y el crudo del fondo reacciona a la previsión (lo escucha escena.js)
  plazoActual = clave;
  document.getElementById('atajo').href = `index.html?plazo=${clave}`;
  const ir = paneles.cierre?.querySelector('#cierre-panel');
  if (ir) { ir.href = `index.html?plazo=${clave}`; ir.textContent = `Abrir el panel con la previsión a ${z.nombre}`; }
  const sim = paneles.cierre?.querySelector('#cierre-sim');
  if (sim) sim.href = `index.html?plazo=${clave}#escenarios`;
  dispatchEvent(new CustomEvent('prevision', { detail: { variacion: h.variacion_pct, ancho: Math.log(h.rango80[1] / h.rango80[0]) } }));
}

function panelFiabilidad() {
  const filas = datos.comparativa.filas;
  const H = [['corto', '1 semana'], ['medio', '3 meses'], ['largo', '1 año']];
  const redes = ['RNN simple', 'LSTM', 'GRU'];
  // misma forma que en el panel: RMSE relativo a no usar modelo, dicho con palabras
  const frente = v => (Math.abs(v) < 0.05 ? 'igual' : `${fmt1.format(Math.abs(v))} % ${v > 0 ? 'menos' : 'más'}`);
  const nombre = m => m.replace(/^(.*), peso (.*)$/, '$1 ajustada');
  const max = Math.max(...filas.filter(f => f.modelo !== 'Ingenuo').map(f => Math.abs(f.mejora_pct)));
  const barra = f => {
    const w = (Math.abs(f.mejora_pct) / max) * 50;
    return `<div class="barra-div" aria-hidden="true"><span class="${f.mejora_pct >= 0 ? 'pos' : 'neg'}" style="${f.mejora_pct >= 0 ? 'left:50%' : `left:${50 - w}%`};width:${w}%"></span></div>`;
  };
  const celda = f => `<td${f.final ? ' class="elegida"' : ''}>${barra(f)}<span class="valor">${frente(f.mejora_pct)}</span></td>`;
  const busca = (h, m) => filas.find(f => f.horizonte === h && f.modelo === m);
  const final = h => filas.find(f => f.horizonte === h && f.final);
  // la frase sale de los datos: qué red se eligió en cada plazo
  const porRed = {};
  for (const [h, n] of H) { const f = final(h); (porRed[nombre(f.modelo)] ??= []).push(n === '1 semana' ? 'a una semana' : n === '3 meses' ? 'a tres meses' : 'a un año'); }
  const eleccion = Object.entries(porRed).map(([r, hs]) => `la <strong>${r}</strong> ${hs.join(' y ')}`).join(' y ');
  const ajustada = filas.find(f => f.final && f.modelo.includes(', peso'));
  return html`
    <h2>¿Me puedo fiar?</h2>
    <p>Probamos tres tipos de red neuronal con los mismos datos, de 2024 a hoy, y las comparamos con lo más sencillo: suponer que el precio no cambia. Cada celda dice cuánto error tiene la red frente a eso: barra a la derecha, menos error; a la izquierda, más.</p>
    <table class="comparativa">
      <thead><tr><th scope="col">Plazo</th>${redes.map(r => `<th scope="col">${r}</th>`).join('')}<th scope="col" class="elegida">Elegido</th></tr></thead>
      <tbody>${H.map(([h, n]) => `<tr><th scope="row">${n}</th>${redes.map(r => celda(busca(h, r))).join('')}<td class="elegida"><strong>${nombre(final(h).modelo)}</strong><span class="valor">${frente(final(h).mejora_pct)}</span></td></tr>`).join('')}</tbody>
    </table>
    <p>El modelo de cada plazo se eligió con una regla fijada de antemano y solo con los años de validación (2019-2023): ${eleccion}.${ajustada ? ` La versión ajustada modera los cambios que predice la red multiplicándolos por ${ajustada.modelo.split('peso ')[1]}.` : ''} Las cifras de esta tabla son las de las pruebas, que ninguna red vio al aprender.</p>
    <details>
      <summary>Ver el detalle técnico</summary>
      <table class="tecnica">
        <thead><tr><th scope="col">Plazo</th><th scope="col">Modelo</th><th scope="col">MAE ($)</th><th scope="col">RMSE ($)</th><th scope="col">Parámetros</th><th scope="col">Entrenamiento</th></tr></thead>
        <tbody>${filas.map(f => `<tr><td>${H.find(x => x[0] === f.horizonte)[1]}</td><td>${f.modelo === 'Ingenuo' ? 'Sin modelo' : f.modelo.replace(/, peso (.*)$/, ' ajustada (peso $1)')}${f.final ? ' <small>elegido</small>' : ''}</td><td>${fmt.format(f.mae)}</td><td>${fmt.format(f.rmse)}</td><td>${f.parametros.toLocaleString('es-ES')}</td><td>${f.tiempo_s == null ? '—' : `${fmt.format(f.tiempo_s)} s`}</td></tr>`).join('')}</tbody>
      </table>
    </details>`;
}

function panelModelo() {
  const e = datos.estado;
  return html`
    <h2>Cómo lee todo esto el modelo</h2>
    <p>Una red neuronal recurrente recorre los últimos ${e.ventana_dias} días de mercado, uno a uno, y recuerda lo importante de los anteriores, igual que tú al leer una frase.</p>
    <p>Lo ha hecho miles de veces sobre la veta que acabas de bajar: cada tramo de ${e.ventana_dias} días, comparado con lo que pasó después. De ahí salen tres previsiones: a una semana, a tres meses y a un año.</p>
    <figure class="lectura-modelo">
      <svg class="g-modelo" role="img" aria-label="Una ventana de ${e.ventana_dias} días recorre el precio del Brent"></svg>
      <figcaption class="nota">La franja ámbar es lo que la red mira cada vez: ${e.ventana_dias} días de ${e.variables_modelo} señales (precios, dólar, agitación del mercado, tipos de interés). Sigue bajando y verás cómo avanza.</figcaption>
    </figure>`;
}

function dibujarModelo() {
  const svg = paneles.modelo.querySelector('.g-modelo');
  const W = 520, H = 150, n = 420, tramo = serie.slice(-n), ventana = datos.estado.ventana_dias;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const vmin = Math.min(...tramo.map(d => d.v)), vmax = Math.max(...tramo.map(d => d.v));
  const x = i => 4 + (i / (n - 1)) * (W - 8), y = v => 12 + (1 - (v - vmin) / (vmax - vmin)) * (H - 24);
  const ancho = x(ventana) - x(0);
  const g = el('g', { class: 'ventana' }, svg);
  g.style.transform = `translateX(calc(var(--f, 1) * ${(W - 8 - ancho).toFixed(1)}px))`;
  el('rect', { x: 4, y: 4, width: ancho, height: H - 8, rx: 3 }, g);
  el('path', { d: 'M' + tramo.map((d, i) => `${x(i).toFixed(1)},${y(d.v).toFixed(1)}`).join('L'), class: 'linea-historico' }, svg);
}

function panelCierre() {
  return html`
    <h2>Ahora, pruébalo tú</h2>
    <p>En el panel puedes cambiar de plazo, simular una crisis, calcular cuánto te costaría y ver cuánto ha acertado el modelo.</p>
    <div class="acciones">
      <a class="principal" id="cierre-panel" href="index.html">Abrir el panel</a>
      <a id="cierre-sim" href="index.html#escenarios">Simular un suceso</a>
    </div>
    <p class="nota">Último precio real: ${fecha(datos.prediccion.fecha_dato)}. La agencia de energía de EE. UU. lo publica con uno o dos días de retraso.</p>`;
}

const CONSTRUCTORES = {
  portada: panelPortada, plazos: panelPlazos, bajada: panelBajada, riesgos: panelRiesgos,
  modelo: panelModelo, prevision: panelPrevision, fiabilidad: panelFiabilidad, cierre: panelCierre,
};

// ---------------------------------------------------------------------------
// Gráfica de la previsión (una serie + abanico)
// ---------------------------------------------------------------------------
function el(tag, attrs, padre) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  padre?.appendChild(e);
  return e;
}

let serie; // [{t: Date, v: number}]
function dibujarPrevision(clave) {
  const svg = paneles.prevision.querySelector('.g-prev');
  const tip = paneles.prevision.querySelector('.tooltip');
  const estrecho = innerWidth < 860;
  const W = estrecho ? 340 : 560, H = estrecho ? 220 : 320, m = { l: estrecho ? 38 : 44, r: estrecho ? 48 : 70, t: 16, b: 28 };
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = '';
  const p = datos.prediccion, h = p.horizontes[clave];
  const hoy = new Date(p.fecha_dato + 'T12:00:00'), fin = new Date(h.fecha_objetivo + 'T12:00:00');
  const desde = new Date(hoy); desde.setFullYear(desde.getFullYear() - 2);
  const hist = serie.filter(d => d.t >= desde);
  const vmin = Math.min(...hist.map(d => d.v), h.rango80[0]), vmax = Math.max(...hist.map(d => d.v), h.rango80[1]);
  const y0 = Math.floor(vmin / 20) * 20, y1 = Math.ceil(vmax / 20) * 20;
  const x = t => m.l + ((t - desde) / (fin - desde)) * (W - m.l - m.r);
  const y = v => m.t + (1 - (v - y0) / (y1 - y0)) * (H - m.t - m.b);

  const ejes = el('g', { class: 'ejes' }, svg);
  for (let v = y0; v <= y1; v += 20) {
    el('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: 'rejilla' }, ejes);
    el('text', { x: m.l - 8, y: y(v) + 4, 'text-anchor': 'end' }, ejes).textContent = `${v} $`;
  }
  const marcas = [];
  for (let d = new Date(desde.getFullYear(), desde.getMonth() + 1, 1); d <= fin; d.setMonth(d.getMonth() + (estrecho ? 12 : 6))) marcas.push(new Date(d));
  for (const d of marcas) el('text', { x: x(d), y: H - 8, 'text-anchor': 'middle' }, ejes).textContent = fmtMes.format(d);

  // abanico: se abre con la raíz del tiempo, como la incertidumbre real
  const pasos = 24, sup = [], inf = [], centro = [];
  for (let i = 0; i <= pasos; i++) {
    const f = i / pasos, t = new Date(+hoy + f * (fin - hoy)), s = Math.sqrt(f);
    const c = p.precio_hoy * Math.exp(Math.log(h.precio / p.precio_hoy) * f);
    sup.push(`${x(t)},${y(c * Math.exp(Math.log(h.rango80[1] / h.precio) * s))}`);
    inf.push(`${x(t)},${y(c * Math.exp(Math.log(h.rango80[0] / h.precio) * s))}`);
    centro.push(`${x(t)},${y(c)}`);
  }
  el('polygon', { points: [...sup, ...inf.reverse()].join(' '), class: 'abanico' }, svg);
  el('polyline', { points: centro.join(' '), class: 'linea-prevision' }, svg);
  el('path', { d: 'M' + hist.map(d => `${x(d.t).toFixed(1)},${y(d.v).toFixed(1)}`).join('L'), class: 'linea-historico' }, svg);

  el('circle', { cx: x(hoy), cy: y(p.precio_hoy), r: 4.5, class: 'punto-hoy' }, svg);
  el('circle', { cx: x(fin), cy: y(h.precio), r: 5, class: 'punto-prevision' }, svg);
  el('text', { x: x(fin) + 9, y: y(h.precio) + 4, class: 'etiqueta' }, svg).textContent = `${fmt0.format(h.precio)} $`;
  el('text', { x: x(fin) + 9, y: y(h.rango80[1]) + 4, class: 'etiqueta tenue' }, svg).textContent = `${fmt0.format(h.rango80[1])} $`;
  el('text', { x: x(fin) + 9, y: y(h.rango80[0]) + 4, class: 'etiqueta tenue' }, svg).textContent = `${fmt0.format(h.rango80[0])} $`;
  el('line', { x1: x(hoy), x2: x(hoy), y1: m.t, y2: H - m.b, class: 'rejilla', 'stroke-dasharray': '2 4' }, svg);
  el('text', { x: x(hoy) - 5, y: m.t + 4, 'text-anchor': 'end', class: 'etiqueta tenue' }, svg).textContent = 'Hoy';

  // capa de hover: cruz + tooltip sobre el histórico
  const cruz = el('line', { y1: m.t, y2: H - m.b, class: 'cruz', visibility: 'hidden' }, svg);
  const punto = el('circle', { r: 4, class: 'punto-hover', visibility: 'hidden' }, svg);
  const zona = el('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: 'transparent' }, svg);
  zona.addEventListener('pointermove', ev => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    const t = +desde + ((px - m.l) / (W - m.l - m.r)) * (fin - desde);
    let txt, cx, cy;
    if (t <= +hoy) {
      let lo = 0, hi = hist.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (+hist[mid].t < t) lo = mid + 1; else hi = mid; }
      const d = hist[lo]; cx = x(d.t); cy = y(d.v);
      txt = `<strong>${dolares(d.v)}</strong>${fmtFecha.format(d.t)}`;
    } else {
      cx = x(fin); cy = y(h.precio);
      txt = `<strong>${fmt0.format(h.precio)} $</strong>previsión para el ${fecha(h.fecha_objetivo)}<br>rango ${fmt0.format(h.rango80[0])}–${fmt0.format(h.rango80[1])} $`;
    }
    cruz.setAttribute('x1', cx); cruz.setAttribute('x2', cx); cruz.setAttribute('visibility', 'visible');
    punto.setAttribute('cx', cx); punto.setAttribute('cy', cy); punto.setAttribute('visibility', 'visible');
    tip.innerHTML = txt; tip.hidden = false;
    const izq = (cx / W) * r.width, arriba = (cy / H) * r.height;
    tip.style.left = `${clamp(izq, 70, r.width - 70)}px`; tip.style.top = `${arriba}px`;
  });
  zona.addEventListener('pointerleave', () => { cruz.setAttribute('visibility', 'hidden'); punto.setAttribute('visibility', 'hidden'); tip.hidden = true; });
}

// ---------------------------------------------------------------------------
// Línea del tiempo vertical (arriba hoy, abajo 2000) que se dibuja al bajar
// ---------------------------------------------------------------------------
let linea;
function montarLinea() {
  const aside = document.getElementById('linea-tiempo');
  const svg = aside.querySelector('svg');
  const W = 140, H = 600, m = { t: 10, b: 10, l: 34, r: 8 };
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const anio = t => t.getFullYear() + (t.getMonth() + t.getDate() / 31) / 12;
  const top = 2026.9, bot = 2000;
  const y = a => m.t + ((top - a) / (top - bot)) * (H - m.t - m.b);
  const x = v => m.l + (v / 150) * (W - m.l - m.r);
  for (const a of [2025, 2020, 2015, 2010, 2005, 2000]) {
    el('line', { x1: m.l, x2: W - m.r, y1: y(a), y2: y(a), class: 'rejilla' }, svg);
    el('text', { x: m.l - 6, y: y(a) + 4, 'text-anchor': 'end' }, svg).textContent = a;
  }
  const semanal = serie.filter((_, i) => i % 5 === 0);
  const d = 'M' + semanal.map(p => `${x(p.v).toFixed(1)},${y(anio(p.t)).toFixed(1)}`).join('L');
  const defs = el('defs', {}, svg);
  const clip = el('clipPath', { id: 'revelado' }, defs);
  const rect = el('rect', { x: 0, y: 0, width: W, height: 0 }, clip);
  el('path', { d, class: 'linea-historico tenue-fondo' }, svg);
  el('path', { d, class: 'linea-historico', 'clip-path': 'url(#revelado)' }, svg);
  for (const e of datos.eventos) {
    const t = new Date(e.date + 'T12:00:00');
    el('circle', { cx: x(e.precio), cy: y(anio(t)), r: 4, class: `evento ${e.kind}`, 'clip-path': 'url(#revelado)' }, svg);
  }
  const marca = el('line', { x1: m.l, x2: W - m.r, class: 'marca-tiempo' }, svg);
  linea = { aside, rect, marca, y, etiqueta: aside.querySelector('.anio-actual') };
}

function actualizarLinea(u) {
  // año que corresponde a la posición de la cámara
  const hitos = [[3, 2026.85], ...ERAS.map((e, i) => [K_ERA0 + i, e.tiempo]), [K_RIESGOS, 2000]];
  let a = 2026.85;
  for (let i = 0; i < hitos.length - 1; i++) {
    const [k0, a0] = hitos[i], [k1, a1] = hitos[i + 1];
    if (u >= k0 && u <= k1) { a = a0 + (a1 - a0) * clamp(((u - k0) / (k1 - k0) - 0.5) / 0.5, 0, 1); break; }
    if (u > k1) a = a1;
  }
  const visible = u > 2.6 && u < K_RIESGOS + 0.6;
  linea.aside.classList.toggle('visible', visible);
  const yy = linea.y(a);
  linea.rect.setAttribute('height', yy);
  linea.marca.setAttribute('y1', yy); linea.marca.setAttribute('y2', yy);
  linea.etiqueta.textContent = Math.floor(a);
}

// ---------------------------------------------------------------------------
// Montaje y estado por fotograma
// ---------------------------------------------------------------------------
export async function montar() {
  const leer = n => fetch(`datos/${n}.json`).then(r => r.json());
  const [historico, eventos, prediccion, comparativa, estadoDatos] = await Promise.all(['historico', 'eventos', 'prediccion', 'comparativa', 'estado'].map(leer));
  datos = { historico, eventos, prediccion, comparativa, estado: estadoDatos };
  serie = historico.fechas.map((f, i) => ({ t: new Date(f + 'T12:00:00'), v: historico.precios[i] }));

  const recorrido = document.getElementById('recorrido');
  const capa = document.getElementById('paneles');
  let kActual = 0;
  for (const b of GUION) {
    const div = document.createElement('div');
    div.className = `bloque ${b.tipo}`;
    div.style.height = `${b.alto}vh`;
    recorrido.appendChild(div);
    const reg = { ...b, div, de: b.tipo === 'viaje' ? kActual : b.k };
    if (b.tipo === 'viaje') kActual = b.a; else kActual = b.k;
    if (b.panel) {
      const sec = document.createElement('section');
      sec.className = `panel panel-${b.panel.split('-')[0]}`;
      sec.innerHTML = b.panel.startsWith('era-') ? panelEra(+b.panel.split('-')[1]) : CONSTRUCTORES[b.panel]();
      capa.appendChild(sec);
      paneles[b.panel] = sec;
      reg.sec = sec;
      if (b.panel === 'prevision') div.id = 'prevision';
    }
    bloques.push(reg);
  }
  paneles.prevision.querySelectorAll('[role=tab]').forEach(b => b.addEventListener('click', () => rellenarPrevision(b.dataset.plazo)));
  rellenarPrevision('medio');
  dibujarModelo();
  montarLinea();
  let anchoPrevio = innerWidth;
  addEventListener('resize', () => { if ((innerWidth < 860) !== (anchoPrevio < 860)) dibujarPrevision(plazoActual); anchoPrevio = innerWidth; });
  medir();
  addEventListener('resize', medir);
}

let medidas = [];
function medir() {
  medidas = bloques.map(b => ({ top: b.div.offsetTop, alto: b.div.offsetHeight }));
  // tramo de cada panel: desde su parada hasta que empieza el siguiente panel
  // (incluye el viaje que sigue, para que el texto no desaparezca mientras la cámara se mueve)
  bloques.forEach((b, i) => {
    // deriva: solo si después viene un viaje (en la caverna hay varias paradas seguidas)
    if (b.tipo === 'parada') b.deriva = bloques[i + 1]?.tipo === 'viaje' ? DERIVA : 0;
    if (b.tipo === 'viaje') b.inicio = b.de + (bloques[i - 1]?.deriva ?? 0);
  });
  bloques.forEach((b, i) => {
    if (!b.sec) return;
    let fin;
    if (b.hasta) { const [j, f] = b.hasta; fin = medidas[j].top + medidas[j].alto * f; }
    else {
      const sig = bloques[i + 1];
      fin = sig && sig.tipo === 'viaje' ? medidas[i + 1].top + medidas[i + 1].alto : medidas[i].top + medidas[i].alto;
    }
    b.tramo = [medidas[i].top, fin];
  });
}

// Devuelve la posición de cámara (en unidades de parada) para el scroll actual y actualiza paneles.
export function estado(scrollForzado) {
  if (!medidas.length) return 0;
  const centro = (scrollForzado ?? scrollY) + innerHeight / 2;
  let u = 0;
  bloques.forEach((b, i) => {
    const { top, alto } = medidas[i];
    const f = (centro - top) / alto;
    if (f >= 0 && f < 1) u = b.tipo === 'viaje' ? b.inicio + (b.a - b.inicio) * suave(f) : b.k + b.deriva * clamp(f, 0, 1);
    if (i === bloques.length - 1 && f >= 1) u = b.k;
    if (b.sec) {
      const primero = i === 0, ultimo = i === bloques.length - 1;
      const [ini, fin] = b.tramo;
      const entra = primero ? 1 : clamp((centro - ini) / (innerHeight * 0.14), 0, 1);
      const sale = ultimo ? 1 : clamp((fin - centro) / (innerHeight * 0.22), 0, 1);
      const o = Math.min(entra, sale);
      b.o = o;
      b.sec.style.opacity = o.toFixed(3);
      b.sec.style.setProperty('--dy', `${((1 - entra) * 24 - (1 - sale) * 24).toFixed(1)}px`);
      const activo = o > 0.5;
      if (b.sec.inert === activo) b.sec.inert = !activo;
      b.sec.style.visibility = o > 0.001 ? 'visible' : 'hidden';
      if (b.panel === 'modelo') b.sec.style.setProperty('--f', clamp(f * 1.15, 0, 1).toFixed(3));
    }
  });
  // cuando aparecen los plazos, la portada deja solo el título para no solaparse
  const plazos = bloques.find(b => b.panel === 'plazos');
  paneles.portada.style.setProperty('--resto', (1 - (plazos.o ?? 0)).toFixed(3));
  actualizarLinea(u);
  return u;
}

export const PARADA_PREVISION = () => document.getElementById('prevision');
