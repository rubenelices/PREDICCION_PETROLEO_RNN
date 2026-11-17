import { nivel } from './fiabilidad.js?v=20261115';

// Panel ejecutivo: lee los JSON de datos/ (los mismos que servirá FastAPI) y pinta
// cada bloque. El plazo elegido en las tarjetas de arriba manda en todo el panel.

// ---------------------------------------------------------------------------
// Formatos
// ---------------------------------------------------------------------------
const nf = (min, max = min) => new Intl.NumberFormat('es-ES', { minimumFractionDigits: min, maximumFractionDigits: max });
const f0 = nf(0), f1 = nf(1), f2 = nf(2);
const dolares = (x, d = 2) => `${nf(d).format(x)} $`;
const signo = x => (x > 0 ? '+' : x < 0 ? '−' : '');
const pct = (x, d = 1) => `${signo(x)}${nf(d).format(Math.abs(x))} %`;
const aFecha = s => new Date(`${s}T12:00:00`);
const fechaLarga = s => new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }).format(typeof s === 'string' ? aFecha(s) : s);
const fechaCorta = s => new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }).format(typeof s === 'string' ? aFecha(s) : s).replace('.', '');
// las previsiones se dan redondeadas: con rangos tan anchos, los céntimos serían precisión falsa
const euros = x => {
  const a = Math.abs(x);
  if (a >= 1e6) return `${f2.format(x / 1e6)} M€`;
  return `${f0.format(a >= 1e4 ? Math.round(x / 1000) * 1000 : Math.round(x / 10) * 10)} €`;
};

const PLAZOS = {
  corto: { nombre: '1 semana', dentro: 'Dentro de una semana', corto: 'a una semana' },
  medio: { nombre: '3 meses', dentro: 'Dentro de tres meses', corto: 'a tres meses' },
  largo: { nombre: '1 año', dentro: 'Dentro de un año', corto: 'a un año' },
};
const NOTAS = {
  corto: 'A una semana el modelo empata con suponer que el precio no cambia. Lo útil aquí es el rango, no la cifra exacta.',
  medio: 'Acertó más que suponer que el precio no cambia en 2025, pero falló en 2024 y en el shock de 2026, y en conjunto queda por detrás.',
  largo: 'Falla menos en los errores grandes que suponer que el precio no cambia, pero su error medio es parecido y acierta si subirá o bajará la mitad de las veces.',
};
// nombres cortos para rotular los ciclos sobre las gráficas
const NOMBRE_CORTO = {
  '2008-07-03': 'Máximo de 2008', '2008-12-26': 'Crisis financiera', '2016-01-20': 'Exceso de oferta',
  '2020-04-21': 'COVID-19', '2022-03-08': 'Ucrania', '2026-04-07': 'Ormuz',
};
// comparación con no usar modelo: siempre el RMSE relativo, y siempre dicho igual
const frente = (v, corto = false) => (Math.abs(v) < 0.05 ? 'igual que sin modelo'
  : `${f1.format(Math.abs(v))} % ${v > 0 ? 'menos' : 'más'} error${corto ? '' : ' que sin modelo'}`);
// nombre del modelo final tal como se muestra (la versión ajustada lleva su peso)
const nombreModelo = m => m.replace(/^(.*), peso (.*)$/, '$1 ajustada (peso $2)');
const chip = n => `<span class="chip ${n.clase}"><i aria-hidden="true">${n.icono}</i>${n.etiqueta}</span>`;

// ---------------------------------------------------------------------------
// Estado y datos
// ---------------------------------------------------------------------------
const estado = { plazo: 'medio', barriles: 10000, umbral: null, vista: 'panel' };
{ // el plazo viaja en la dirección (?plazo=largo) para poder compartir el enlace tal cual se ve
  const q = new URLSearchParams(location.search).get('plazo');
  if (['corto', 'medio', 'largo'].includes(q)) estado.plazo = q;
}
let D;
const $ = id => document.getElementById(id);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

async function cargar() {
  const nombres = ['prediccion', 'historico', 'mercado', 'backtest', 'comparativa', 'eventos', 'estado', 'resultados'];
  const res = await Promise.all(nombres.map(n => fetch(`datos/${n}.json`).then(r => r.json())));
  D = Object.fromEntries(nombres.map((n, i) => [n, res[i]]));
  D.activos = await fetch('datos/activos.json').then(r => (r.ok ? r.json() : null)).catch(() => null);
  D.historico.t = D.historico.fechas.map(f => aFecha(f).getTime());
  D.usdPorEur = D.mercado.indicadores.find(i => i.nombre.startsWith('Euro')).hoy;
  D.eventos.forEach(e => { e.t = aFecha(e.date).getTime(); e.corto = NOMBRE_CORTO[e.date] ?? e.title; });
}

// ---------------------------------------------------------------------------
// Utilidades SVG
// ---------------------------------------------------------------------------
const NS = 'http://www.w3.org/2000/svg';
function el(tag, attrs = {}, padre) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (padre) padre.append(e);
  return e;
}
const escala = (d0, d1, r0, r1) => x => r0 + ((x - d0) / (d1 - d0)) * (r1 - r0);
function marcas(min, max, n = 5) {
  const paso0 = (max - min) / n, mag = 10 ** Math.floor(Math.log10(paso0));
  const paso = [1, 2, 2.5, 5, 10].map(k => k * mag).find(k => k >= paso0);
  const lista = [];
  for (let v = Math.ceil(min / paso) * paso; v <= max + 1e-9; v += paso) lista.push(+v.toFixed(6));
  return { lista, ini: Math.floor(min / paso) * paso, fin: Math.ceil(max / paso) * paso };
}
const camino = pts => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
function marcasTiempo(t0, t1) {
  const anios = (t1 - t0) / (365.25 * 864e5);
  const res = [];
  const d = new Date(t0); d.setDate(1); d.setHours(12, 0, 0, 0);
  if (anios > 3) {
    const salto = anios > 12 ? 4 : anios > 6 ? 2 : 1;
    d.setMonth(0); d.setFullYear(d.getFullYear() + 1);
    while (d.getTime() <= t1) { if (d.getFullYear() % salto === 0) res.push([d.getTime(), String(d.getFullYear())]); d.setFullYear(d.getFullYear() + 1); }
  } else {
    const salto = anios > 1.5 ? 6 : 3;
    d.setMonth(d.getMonth() + 1);
    while (d.getTime() <= t1) {
      if (d.getMonth() % salto === 0) res.push([d.getTime(), new Intl.DateTimeFormat('es-ES', { month: 'short', year: '2-digit' }).format(d).replace('.', '')]);
      d.setMonth(d.getMonth() + 1);
    }
  }
  return res;
}
function busqueda(arr, x) { // índice del valor más cercano en un array ordenado
  let lo = 0, hi = arr.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (arr[m] < x) lo = m; else hi = m; }
  return Math.abs(arr[lo] - x) <= Math.abs(arr[hi] - x) ? lo : hi;
}
function ejes(svg, { W, H, m, y, yMarcas, x, xMarcas, formatoY = v => f0.format(v) }) {
  for (const v of yMarcas) {
    el('line', { class: 'rejilla-h', x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }, svg);
    el('text', { x: m.l - 8, y: y(v) + 4, 'text-anchor': 'end' }, svg).textContent = formatoY(v);
  }
  for (const [t, etq] of xMarcas) {
    const xx = x(t);
    if (xx < m.l + 12 || xx > W - m.r - 12) continue;
    el('text', { x: xx, y: H - 6, 'text-anchor': 'middle' }, svg).textContent = etq;
  }
}
function tooltipEn(tip, cont, px, py, html) {
  tip.hidden = false;
  tip.innerHTML = html;
  const w = tip.offsetWidth / 2, ancho = cont.clientWidth;
  tip.style.left = `${Math.min(Math.max(px, w), ancho - w)}px`;
  tip.style.top = `${py}px`;
}

// ---------------------------------------------------------------------------
// Previsión: centro y rango en cualquier instante entre hoy y la fecha objetivo
// (el rango se abre con la raíz del tiempo, como la incertidumbre de un paseo aleatorio)
// ---------------------------------------------------------------------------
function trayectoria(h) {
  const p = D.prediccion, t0 = D.historico.t.at(-1), t1 = aFecha(h.fecha_objetivo).getTime();
  return t => {
    const f = Math.min(Math.max((t - t0) / (t1 - t0), 0), 1);
    const c = p.precio_hoy * Math.exp(Math.log(h.precio / p.precio_hoy) * f);
    return { c, lo: c * Math.exp(Math.log(h.rango80[0] / h.precio) * Math.sqrt(f)), hi: c * Math.exp(Math.log(h.rango80[1] / h.precio) * Math.sqrt(f)) };
  };
}

// ---------------------------------------------------------------------------
// Cabecera y plazos
// ---------------------------------------------------------------------------
function pintarCabecera() {
  const p = D.prediccion;
  const dif = p.precio_hoy - p.precio_anterior, cambio = (p.precio_hoy / p.precio_anterior - 1) * 100;
  D.cambioHoy = `${dif < 0 ? '▼' : '▲'} ${pct(cambio, 2)} frente al día anterior`;
  const dias = Math.round((Date.now() - aFecha(p.fecha_dato).getTime()) / 864e5);
  $('cinta-hoy').innerHTML = `Brent hoy<strong>${dolares(p.precio_hoy)}</strong><span class="${dif < 0 ? 'baja' : 'sube'}">${dif < 0 ? '▼' : '▲'} ${pct(cambio, 2)}</span> frente al día anterior <small>· datos del ${fechaCorta(p.fecha_dato)}</small>`;
  $('hoy-mini').innerHTML = `${f2.format(p.precio_hoy)}<small>$</small>`;
  const vol = D.mercado.indicadores[0];
  const palabra = vol.percentil < 0.4 ? 'baja' : vol.percentil < 0.7 ? 'normal' : vol.percentil < 0.9 ? 'alta' : 'muy alta';
  $('agitacion').innerHTML = `Agitación del mercado <strong>${palabra}</strong>: se mueve más que el ${f0.format(vol.percentil * 100)} % de los días desde 2000`;
  // la respuesta al título, en una línea: la previsión de los tres plazos
  $('portada-cifras').innerHTML = Object.entries(PLAZOS).map(([k, z]) =>
    `<button type="button" data-plazo="${k}"><span>${z.nombre}</span><strong>${f0.format(p.horizontes[k].precio)}<small>$</small></strong></button>`).join('');
}

function pintarPlazos() {
  $('nav-plazo').innerHTML = Object.entries({ corto: '1 semana', medio: '3 meses', largo: '1 año' })
    .map(([k, n]) => `<button type="button" data-plazo="${k}" aria-pressed="${k === estado.plazo}">${n}</button>`).join('');
  $('nav-plazo').addEventListener('click', ev => { const b = ev.target.closest('button'); if (b) elegir(b.dataset.plazo); });
}

// ---------------------------------------------------------------------------
// Portada: la foto se desplaza un poco con el puntero, y la llama de la antorcha titila y
// suelta chispas. El punto de la llama se calcula igual que el navegador encuadra la foto
// (object-fit: cover con su object-position), para que el resplandor caiga siempre encima.
// ---------------------------------------------------------------------------
const LLAMA = { x: 0.872, y: 0.212 }; // dónde está la llama dentro de la foto (0 a 1)
function colocarLlama() {
  const img = document.querySelector('.portada-img'), llama = $('llama');
  if (!img.naturalWidth || !img.clientWidth) return;
  const W = img.clientWidth, H = img.clientHeight, s = Math.max(W / img.naturalWidth, H / img.naturalHeight);
  const [ox, oy] = getComputedStyle(img).objectPosition.split(' ').map(v => parseFloat(v) / 100);
  const x = (W - img.naturalWidth * s) * ox + LLAMA.x * img.naturalWidth * s;
  const y = (H - img.naturalHeight * s) * oy + LLAMA.y * img.naturalHeight * s;
  llama.style.setProperty('--lx', `${x.toFixed(1)}px`);
  llama.style.setProperty('--ly', `${y.toFixed(1)}px`);
  llama.style.setProperty('--ld', `${(img.naturalHeight * s * 0.42).toFixed(0)}px`);
  if (!llama.firstChild && !reduceMotion) {
    // chispas: cada una con su recorrido, su duración y su retraso (fijos, para que no cambie al recargar)
    const esc = img.naturalHeight * s / 900;
    llama.innerHTML = Array.from({ length: 9 }, (_, i) => {
      const a = (i * 0.618) % 1, b = (i * 0.381 + 0.2) % 1;
      return `<i style="--x0:${((a - 0.5) * 34 * esc).toFixed(0)}px;--dx:${(-(20 + b * 70) * esc).toFixed(0)}px;--dy:${(-(110 + a * 120) * esc).toFixed(0)}px;--t:${(3.2 + b * 3).toFixed(1)}s;--r:${(-(i * 0.9)).toFixed(1)}s"></i>`;
    }).join('');
  }
}
{
  const img = document.querySelector('.portada-img'), portada = document.querySelector('.portada');
  if (img.complete) colocarLlama(); else img.addEventListener('load', colocarLlama);
  new ResizeObserver(colocarLlama).observe(img);
  if (!reduceMotion) document.querySelector('.cabecera').addEventListener('pointermove', ev => {
    portada.style.setProperty('--px', (ev.clientX / innerWidth - 0.5).toFixed(3));
    portada.style.setProperty('--py', (ev.clientY / innerHeight - 0.5).toFixed(3));
  });
}

// ---------------------------------------------------------------------------
// Portada: gráfica pequeña del test del plazo elegido, previsto frente a real
// ---------------------------------------------------------------------------
function graficaMiniPortada() {
  const caja = $('portada-mini'), svg = caja.querySelector('svg');
  const W = svg.clientWidth, H = svg.clientHeight;
  if (!W || !H) return;
  const b = D.backtest.horizontes[estado.plazo], z = PLAZOS[estado.plazo];
  $('pm-titulo').textContent = `Test ${aFecha(b.fechas[0]).getFullYear()}-${aFecha(b.fechas.at(-1)).getFullYear()}, ${z.corto}`;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.replaceChildren();
  const T = b.fechas.map(f => aFecha(f).getTime()), paso = Math.max(1, Math.floor(T.length / 260));
  const idx = T.map((_, i) => i).filter(i => i % paso === 0 || i === T.length - 1);
  const m = { t: 4, b: 16, l: 0, r: 0 };
  const lo = Math.min(...b.real, ...b.previsto), hi = Math.max(...b.real, ...b.previsto);
  const x = escala(T[0], T.at(-1), m.l, W - m.r), y = escala(lo, hi, H - m.b, m.t);
  for (const [t, etq] of marcasTiempo(T[0], T.at(-1))) {
    if (x(t) < 22 || x(t) > W - 22) continue;
    el('line', { class: 'pm-marca', x1: x(t), x2: x(t), y1: m.t, y2: H - m.b }, svg);
    el('text', { class: 'pm-eje', x: x(t), y: H - 3, 'text-anchor': 'middle' }, svg).textContent = etq;
  }
  el('path', { class: 'pm-real', d: camino(idx.map(i => [x(T[i]), y(b.real[i])])) }, svg);
  el('path', { class: 'pm-modelo', d: camino(idx.map(i => [x(T[i]), y(b.previsto[i])])) }, svg);
}

// ---------------------------------------------------------------------------
// Puerta a la terminal, al final del recorrido: una ventana con el último año del Brent en
// velas semanales (apertura, máximo, mínimo y cierre de cada semana, de los cierres diarios)
// ---------------------------------------------------------------------------
function pintarPuertaTerminal() {
  const svg = $('pt-svg'), T = D.historico.t, P = D.historico.precios;
  const W = 560, H = 250, m = { t: 14, r: 52, b: 22, l: 8 };
  const desde = T.at(-1) - 365 * 864e5, semanas = [];
  for (let i = busqueda(T, desde); i < T.length; i++) {
    const d = new Date(T[i]), lunes = T[i] - ((d.getDay() + 6) % 7) * 864e5, clave = Math.floor(lunes / 864e5);
    const s = semanas.at(-1);
    if (s && s.clave === clave) { s.max = Math.max(s.max, P[i]); s.min = Math.min(s.min, P[i]); s.cierre = P[i]; }
    else semanas.push({ clave, t: T[i], abre: s ? s.cierre : P[i], max: Math.max(P[i], s ? s.cierre : P[i]), min: Math.min(P[i], s ? s.cierre : P[i]), cierre: P[i] });
  }
  const yM = marcas(Math.min(...semanas.map(s => s.min)), Math.max(...semanas.map(s => s.max)), 4);
  const paso = (W - m.l - m.r) / semanas.length, y = escala(yM.ini, yM.fin, H - m.b, m.t);
  svg.replaceChildren();
  for (const v of yM.lista) {
    el('line', { class: 'pt-rejilla', x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }, svg);
    el('text', { class: 'pt-eje', x: W - m.r + 8, y: y(v) + 4 }, svg).textContent = f0.format(v);
  }
  semanas.forEach((s, i) => {
    const x = m.l + paso * (i + 0.5), sube = s.cierre >= s.abre;
    const g = el('g', { class: `pt-vela ${sube ? 'sube' : 'baja'}`, style: `--i:${i}` }, svg);
    el('line', { x1: x, x2: x, y1: y(s.max), y2: y(s.min) }, g);
    el('rect', { x: x - paso * 0.32, width: paso * 0.64, y: y(Math.max(s.abre, s.cierre)), height: Math.max(1.5, Math.abs(y(s.abre) - y(s.cierre))), rx: 1 }, g);
  });
  // el último precio, marcado en el eje como en la terminal
  const ult = P.at(-1), yu = y(ult);
  el('line', { class: 'pt-ultimo', x1: m.l, x2: W - m.r, y1: yu, y2: yu }, svg);
  el('rect', { class: 'pt-etq', x: W - m.r + 2, y: yu - 9, width: 46, height: 18, rx: 4 }, svg);
  el('text', { class: 'pt-etq-t', x: W - m.r + 25, y: yu + 4, 'text-anchor': 'middle' }, svg).textContent = f1.format(ult);
  $('pt-precio').textContent = `${dolares(ult)}  ${D.cambioHoy.split(' frente')[0]}`;
  // las velas se dibujan de izquierda a derecha la primera vez que la ventana entra en pantalla
  const caja = $('pt-ventana');
  if (reduceMotion) { caja.classList.add('visto'); return; }
  new IntersectionObserver(([e], obs) => { if (e.isIntersecting) { caja.classList.add('visto'); obs.disconnect(); } }, { threshold: 0.3 }).observe(caja);
}

// las cifras de la portada y «Ver la previsión» bajan a las tarjetas (la cifra, además, elige su plazo)
const bajarAPrevision = () => $('t-prevision').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
$('portada-cifras').addEventListener('click', ev => {
  const b = ev.target.closest('button');
  if (!b) return;
  elegir(b.dataset.plazo); bajarAPrevision();
});
$('bajar').addEventListener('click', ev => { ev.preventDefault(); bajarAPrevision(); });

function elegir(k) {
  if (k === estado.plazo) return;
  estado.plazo = k;
  term.dom = null;
  if (!term.rango) term.rango = '1A';
  const url = new URL(location.href);
  url.searchParams.set('plazo', k);
  history.replaceState(null, '', url);
  $('nav-plazo').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.plazo === k)));
  pintarDependiente();
}

function pintarDependiente() {
  pintarResumen();
  pintarCoste();
  pintarUmbral();
  pintarSimulador();
  graficaBacktest();
  graficaErrores();
  pintarFiabilidad();
  pintarTerminal();
  pintarComparacion();
  pintarLaboratorio();
  graficaMiniPortada();
}

// ---------------------------------------------------------------------------
// Portada, bajo la gráfica: la previsión de hoy en los tres plazos
// ---------------------------------------------------------------------------
function pintarResumen() {
  const p = D.prediccion;
  $('resumen').innerHTML = Object.entries(PLAZOS).map(([k, z]) => {
    const h = p.horizontes[k], n = nivel(h);
    return `<button type="button" class="res-plazo" data-plazo="${k}" aria-pressed="${k === estado.plazo}">
      <span class="res-cab"><strong>${z.nombre}</strong><span>${fechaCorta(h.fecha_objetivo)}</span></span>
      <span class="num">${f0.format(h.precio)} $<small>${pct(h.variacion_pct)}</small></span>
      <span class="res-rango">Entre ${f0.format(h.rango80[0])} y ${f0.format(h.rango80[1])} $, 8 de cada 10 veces</span>
      ${chip(n)}
      <span class="res-uso">${n.uso}</span>
    </button>`;
  }).join('');
}

// ---------------------------------------------------------------------------
// Portada: el oleoducto del trabajo. El crudo avanza por el tubo según se baja por la
// página y cada etapa se enciende cuando le llega.
// ---------------------------------------------------------------------------
function pintarOleoducto() {
  const e = D.estado, B = D.backtest.horizontes;
  const anio = s => aFecha(s.slice(0, 10)).getFullYear();
  const etapas = [
    ['Datos', `${e.series} series de mercado`, `${f0.format(e.filas)} días, desde ${anio(e.desde)}`],
    ['Variables', `${e.variables_modelo} señales por día`, `En ventanas de ${e.ventana_dias} días`],
    ['Redes', 'RNN simple, LSTM y GRU', 'Para cada plazo: semana, trimestre y año'],
    ['Validación', '2019-2023, avanzando en el tiempo', 'Aquí se elige la red de cada plazo'],
    ['Test', `${anio(e.inicio_test)}-${anio(B.corto.fechas.at(-1))}, datos que ninguna red vio`, `${f0.format(B.corto.fechas.length)} previsiones a una semana`],
    ['Previsión', 'El precio a tres plazos', 'Con el rango donde cae 8 de cada 10 veces'],
  ];
  $('etapas').innerHTML = etapas.map(([t, a, b], i) => `<li class="etapa">
    <span class="valvula" aria-hidden="true"></span>
    <span class="etapa-n">${String(i + 1).padStart(2, '0')}</span>
    <h3>${t}</h3><p>${a}</p><p class="sec">${b}</p></li>`).join('');

  const zona = $('tubo-zona'), tubo = zona.querySelector('.tubo'), lis = [...zona.querySelectorAll('.etapa')];
  let pendiente = 0;
  const avanzar = () => {
    pendiente = 0;
    const r = tubo.getBoundingClientRect();
    if (!r.width) return; // otra vista
    const vertical = r.height > r.width, largo = vertical ? r.height : r.width;
    // en horizontal se llena mientras la sección cruza la pantalla; en vertical, al ritmo de la lectura
    const p = reduceMotion ? 1 : vertical
      ? (innerHeight * 0.62 - r.top) / largo
      : (innerHeight * 0.86 - r.top) / (innerHeight * 0.46);
    const lleno = Math.min(Math.max(p, 0), 1);
    tubo.style.setProperty('--p', lleno.toFixed(4));
    lis.forEach(li => {
      const v = li.querySelector('.valvula').getBoundingClientRect();
      const pos = vertical ? (v.top + v.height / 2 - r.top) / largo : (v.left + v.width / 2 - r.left) / largo;
      li.classList.toggle('llena', lleno >= pos - 0.002);
    });
  };
  const pedir = () => { if (!pendiente) pendiente = requestAnimationFrame(avanzar); };
  addEventListener('scroll', pedir, { passive: true });
  addEventListener('resize', pedir);
  addEventListener('hashchange', () => setTimeout(pedir, 0));
  pedir();
}

// ---------------------------------------------------------------------------
// Portada: resultados del test, el modelo final de cada plazo frente a no usar modelo
// ---------------------------------------------------------------------------
function pintarResultados() {
  const B = D.backtest.horizontes, P = D.prediccion.horizontes;
  const anio = s => aFecha(s.slice(0, 10)).getFullYear();
  $('res-sub').textContent = `Previsiones de ${anio(D.estado.inicio_test)} a ${anio(B.corto.fechas.at(-1))}, hechas con datos que el modelo no había visto y comparadas con lo que pasó. Error medio, en dólares por barril.`;
  const tope = Math.max(...Object.values(B).flatMap(b => [b.error_medio, b.error_medio_ingenuo]));
  const barra = (nombre, v, cls) => `<div class="res-barra ${cls}"><span>${nombre}</span>
    <div class="pista"><i style="width:${((v / tope) * 100).toFixed(1)}%"></i></div>
    <b class="num" data-cuenta="${v}">${dolares(v)}</b></div>`;
  $('res-filas').innerHTML = Object.entries(PLAZOS).map(([k, z]) => {
    const b = B[k], h = P[k];
    return `<div class="res-fila">
      <div class="res-quien"><strong>${z.nombre}</strong><span>${h.modelo}</span>${chip(nivel(h))}</div>
      <div class="res-barras">${barra('Modelo', b.error_medio, 'modelo')}${barra('Sin modelo', b.error_medio_ingenuo, 'sin')}</div>
      <div class="res-lectura"><p>${NOTAS[k]}</p>
        <p class="sec">En los fallos grandes (RMSE): ${frente(h.mejora_vs_ingenuo_pct)}. Acertó si subiría o bajaría el ${f0.format(b.acierto_direccion_pct)} % de las veces.</p></div>
    </div>`;
  }).join('');
  // las barras crecen y las cifras cuentan hasta su valor la primera vez que se ven
  const caja = $('res-filas');
  if (reduceMotion) { caja.classList.add('visto'); return; }
  const cifras = [...caja.querySelectorAll('[data-cuenta]')];
  cifras.forEach(c => { c.textContent = dolares(0); });
  new IntersectionObserver(([e], obs) => {
    if (!e.isIntersecting) return;
    obs.disconnect();
    caja.classList.add('visto');
    const t0 = performance.now(), DUR = 900;
    const paso = ahora => {
      const u = Math.min((ahora - t0) / DUR, 1), s = 1 - (1 - u) ** 3;
      cifras.forEach(c => { c.textContent = dolares(Number(c.dataset.cuenta) * s); });
      if (u < 1) requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
  }, { threshold: 0.35 }).observe(caja);
}

// ---------------------------------------------------------------------------
// Escenario 1: coste en euros
// ---------------------------------------------------------------------------
function montarCoste() {
  $('coste').innerHTML = `
    <h3>¿Cuánto me cuesta a mí?</h3>
    <p class="ayuda" id="coste-ayuda"></p>
    <div class="campo">
      <label for="barriles">Barriles que compras al mes</label>
      <div class="entrada"><input id="barriles" inputmode="numeric" autocomplete="off" value="${f0.format(estado.barriles)}"><span>barriles</span></div>
    </div>
    <div class="tres" id="coste-casos"></div>
    <p class="nota" id="coste-nota"></p>`;
  const input = $('barriles');
  input.addEventListener('input', () => {
    estado.barriles = Number(input.value.replace(/\D/g, '')) || 0;
    pintarCoste();
    pintarSimulador();
  });
  input.addEventListener('blur', () => { input.value = f0.format(estado.barriles); });
}
function pintarCoste() {
  const p = D.prediccion, h = p.horizontes[estado.plazo], b = estado.barriles, cambio = D.usdPorEur;
  const coste = precio => (b * precio) / cambio;
  const hoy = coste(p.precio_hoy);
  const caso = (clase, etq, precio) => {
    const c = coste(precio), d = c - hoy;
    return `<div class="caso ${clase}"><span class="etq">${etq}</span><span class="num">${euros(c)}</span>
      <span class="dif">${signo(d)}${euros(Math.abs(d))} al mes frente a hoy</span><span class="dif">Barril a ${f0.format(precio)} $</span></div>`;
  };
  $('coste-ayuda').textContent = `Lo que pagarías por un mes de compras si el barril estuviera al precio previsto para el ${fechaLarga(h.fecha_objetivo)}.`;
  $('coste-casos').innerHTML =
    caso('', 'Escenario barato', h.rango80[0]) + caso('central', 'Lo esperado', h.precio) + caso('', 'Escenario caro', h.rango80[1]);
  $('coste-nota').textContent = `Hoy te costaría ${euros(hoy)} al mes. Los escenarios barato y caro son los extremos del rango probable: solo 1 de cada 10 veces quedaría por fuera de cada uno. Se usa el cambio de hoy (1 € = ${nf(3).format(cambio)} $) y no incluye impuestos ni transporte.`;
}

// ---------------------------------------------------------------------------
// Escenario 2: probabilidad de superar un precio
// Lognormal asimétrica: mediana en la previsión y percentiles 10 y 90 en los extremos
// del rango. La dispersión pasa suavemente de la de abajo a la de arriba alrededor de
// la mediana, así la curva no tiene saltos y respeta que el rango no es simétrico.
// ---------------------------------------------------------------------------
const Z90 = 1.2815515655;
function erf(x) { // Abramowitz y Stegun 7.1.26
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
const Phi = z => 0.5 * (1 + erf(z / Math.SQRT2));
function distribucion(h) {
  const mu = Math.log(h.precio);
  const sLo = (mu - Math.log(h.rango80[0])) / Z90, sHi = (Math.log(h.rango80[1]) - mu) / Z90;
  const w = 0.5 * Math.min(sLo, sHi);
  const z = x => { const y = Math.log(x) - mu; return y / (sLo + (sHi - sLo) * (0.5 + 0.5 * Math.tanh(y / w))); };
  const superar = x => 1 - Phi(z(x));
  return { superar, densidad: x => (superar(x) - superar(x * 1.001)) / (x * 0.001) };
}
function montarUmbral() {
  $('umbral').innerHTML = `
    <div class="cab-grafica">
      <div>
        <h3>¿Y si cruza un precio?</h3>
        <p class="ayuda">Probabilidad de que el barril acabe por encima o por debajo del precio que elijas.</p>
      </div>
      <div class="segmentos" role="group" aria-label="Sentido" id="sentido">
        <button type="button" data-sentido="arriba" aria-pressed="true">Por encima</button>
        <button type="button" data-sentido="abajo" aria-pressed="false">Por debajo</button>
      </div>
    </div>
    <div class="deslizador">
      <label for="umbral-r">Precio del barril</label>
      <input type="range" id="umbral-r" step="1">
      <output class="umbral-valor" for="umbral-r" id="umbral-v"></output>
    </div>
    <div class="probabilidad"><div class="num" id="prob"></div><p id="prob-texto"></p></div>
    <div class="grafica" id="g-dist" style="margin-top:10px"><svg role="img" aria-label="Probabilidad de cada precio al final del plazo"></svg></div>
    <p class="nota">Aproximación a partir del rango probable del modelo. Útil para comparar umbrales, no como cifra exacta.</p>`;
  estado.umbral = Math.ceil((D.prediccion.precio_hoy + 10) / 5) * 5;
  estado.sentido = 'arriba';
  $('umbral-r').addEventListener('input', ev => { estado.umbral = Number(ev.target.value); pintarUmbral(false); });
  $('sentido').addEventListener('click', ev => {
    const b = ev.target.closest('button'); if (!b) return;
    estado.sentido = b.dataset.sentido;
    $('sentido').querySelectorAll('button').forEach(o => o.setAttribute('aria-pressed', String(o === b)));
    pintarUmbral(false);
  });
}
function pintarUmbral(reajustar = true) {
  const p = D.prediccion, h = p.horizontes[estado.plazo], dist = distribucion(h);
  const min = Math.floor((h.rango80[0] * 0.8) / 5) * 5, max = Math.ceil((h.rango80[1] * 1.15) / 5) * 5;
  const r = $('umbral-r');
  if (reajustar) { r.min = min; r.max = max; }
  estado.umbral = Math.min(Math.max(estado.umbral, min), max);
  r.value = estado.umbral;
  $('umbral-v').textContent = `${estado.umbral} $`;
  const arriba = estado.sentido === 'arriba';
  const pr = (arriba ? dist.superar(estado.umbral) : 1 - dist.superar(estado.umbral)) * 100;
  $('prob').textContent = pr < 1 ? '< 1 %' : pr > 99 ? '> 99 %' : `${f0.format(pr)} %`;
  $('prob-texto').textContent = `de que el barril ${arriba ? 'esté por encima de' : 'baje de'} ${estado.umbral} $ el ${fechaLarga(h.fecha_objetivo)}. Dicho de otra forma: unas ${f0.format(Math.round(pr / 10))} de cada 10 veces.`;

  // curva de probabilidad con la cola sombreada
  const cont = $('g-dist'), svg = cont.querySelector('svg');
  if (!cont.clientWidth) return;
  const W = cont.clientWidth, H = 110, m = { t: 14, r: 8, b: 22, l: 8 };
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('height', H);
  svg.replaceChildren();
  const xs = Array.from({ length: 160 }, (_, i) => min + ((max - min) * i) / 159);
  const ds = xs.map(dist.densidad), dMax = Math.max(...ds);
  const x = escala(min, max, m.l, W - m.r), y = escala(0, dMax * 1.08, H - m.b, m.t);
  const curva = xs.map((v, i) => [x(v), y(ds[i])]);
  el('path', { class: 'curva', d: `${camino(curva)}L${x(max)},${y(0)}L${x(min)},${y(0)}Z` }, svg);
  const cola = xs.map((v, i) => [v, ds[i]]).filter(([v]) => (arriba ? v >= estado.umbral : v <= estado.umbral));
  if (cola.length > 1) {
    const bordeA = arriba ? estado.umbral : min, bordeB = arriba ? max : estado.umbral;
    el('path', { class: 'curva-cola', d: `M${x(bordeA)},${y(0)}${camino(cola.map(([v, d]) => [x(v), y(d)])).replace('M', 'L')}L${x(bordeB)},${y(0)}Z` }, svg);
  }
  el('line', { class: 'marca-hoy', x1: x(p.precio_hoy), x2: x(p.precio_hoy), y1: m.t, y2: H - m.b }, svg);
  el('line', { class: 'marca-umbral', x1: x(estado.umbral), x2: x(estado.umbral), y1: m.t - 4, y2: H - m.b }, svg);
  el('text', { x: x(p.precio_hoy), y: H - 6, 'text-anchor': 'middle' }, svg).textContent = `Hoy ${f0.format(p.precio_hoy)} $`;
  for (const v of [min, max]) el('text', { x: x(v), y: H - 6, 'text-anchor': v === min ? 'start' : 'end' }, svg).textContent = `${v} $`;
}

// ---------------------------------------------------------------------------
// Simulador de sucesos: miles de caminos posibles del precio con un golpe hipotético
// Cada camino acaba en un precio sacado de la distribución del modelo (la misma de
// «¿Y si cruza un precio?») y llega hasta él con ruido diario (puente browniano).
// Encima se suma el suceso: entra poco a poco, llega a su tamaño y luego se disipa
// hasta quedarse en la parte que persiste.
// ---------------------------------------------------------------------------
const SUCESOS = {
  base: { nombre: 'Sin sorpresas', golpe: 0, cuando: 0.2, persiste: 0.5, agitacion: 1, rampa: 10, semivida: 40,
    texto: 'La previsión del modelo tal cual, sin añadir nada.' },
  opep: { nombre: 'La OPEP+ recorta producción', golpe: 12, cuando: 0.2, persiste: 0.75, agitacion: 1.1, rampa: 15, semivida: 60,
    texto: 'Un recorte de oferta sube el precio en pocas semanas y buena parte de la subida se mantiene.' },
  recesion: { nombre: 'Recesión mundial', golpe: -30, cuando: 0.3, persiste: 0.9, agitacion: 1.3, rampa: 80, semivida: 150,
    texto: 'Cae la demanda de transporte e industria: el precio baja de forma sostenida, como en 2008 o 2020.' },
  ormuz: { nombre: 'Se cierra el estrecho de Ormuz', golpe: 40, cuando: 0.15, persiste: 0.3, agitacion: 1.7, rampa: 5, semivida: 30,
    texto: 'Por Ormuz pasa una quinta parte del crudo mundial: subida brusca que se relaja cuando se reabre la ruta.' },
};
const N_CAMINOS = 600, N_DIBUJO = 40;
const sim = { suceso: 'base', golpe: 0, cuando: 0.2, persiste: 0.5, agitacion: 1, rampa: 10, semivida: 40, semilla: 7, animar: true };

function aleatorio(semilla) { // mulberry32 + Box-Muller: con la misma semilla salen los mismos caminos
  let a = semilla >>> 0;
  const u = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return () => Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u());
}

function simular(h, cfg) {
  const p0 = D.prediccion.precio_hoy, mu = Math.log(h.precio), l0 = Math.log(p0);
  const sLo = (mu - Math.log(h.rango80[0])) / Z90, sHi = (Math.log(h.rango80[1]) - mu) / Z90;
  const n = Math.max(h.dias_habiles, 60), normal = aleatorio(cfg.semilla);
  // la rampa y la semivida van en días de mercado: un suceso tarda lo mismo en notarse sea cual sea el plazo
  const pasosDia = n / h.dias_habiles;
  const k0 = Math.round(cfg.cuando * n), rampa = Math.max(1, cfg.rampa * pasosDia), semivida = Math.max(1, cfg.semivida * pasosDia);
  const J = Math.log(1 + cfg.golpe / 100);
  const efecto = new Float64Array(n + 1);
  for (let k = k0; k <= n; k++) {
    const tau = k - k0, sube = Math.min(tau / rampa, 1), resto = Math.max(tau - rampa, 0);
    efecto[k] = J * sube * (cfg.persiste + (1 - cfg.persiste) * Math.exp(-resto / semivida));
  }
  const sd = ((sLo + sHi) / 2) * cfg.agitacion / Math.sqrt(n);
  const caminos = [];
  for (let i = 0; i < N_CAMINOS; i++) {
    const z = normal(), desvio = z * (z < 0 ? sLo : sHi) * cfg.agitacion;
    const w = new Float64Array(n + 1);
    for (let k = 1; k <= n; k++) w[k] = w[k - 1] + normal() * sd;
    const c = new Float64Array(n + 1);
    for (let k = 0; k <= n; k++) {
      const f = k / n;
      c[k] = Math.exp(l0 + f * (mu - l0) + Math.sqrt(f) * desvio + (w[k] - f * w[n]) + efecto[k]);
    }
    caminos.push(c);
  }
  // percentiles por día para la banda y la mediana
  const banda = [];
  const col = new Float64Array(N_CAMINOS);
  for (let k = 0; k <= n; k++) {
    for (let i = 0; i < N_CAMINOS; i++) col[i] = caminos[i][k];
    col.sort();
    banda.push([col[Math.floor(N_CAMINOS * 0.1)], col[Math.floor(N_CAMINOS * 0.5)], col[Math.floor(N_CAMINOS * 0.9)],
      col[Math.floor(N_CAMINOS * 0.25)], col[Math.floor(N_CAMINOS * 0.75)]]);
  }
  return { n, caminos, banda, k0 };
}

function montarSimulador() {
  const ctl = (id, etq, min, max, paso, pista) => `
    <div class="control"><label for="${id}">${etq}</label><output id="${id}-v" for="${id}"></output>
      <input type="range" id="${id}" min="${min}" max="${max}" step="${paso}"><span class="pista">${pista}</span></div>`;
  $('simulador').innerHTML = `
    <h3>Simula un suceso</h3>
    <p class="ayuda">El modelo no sabe qué va a pasar en el mundo. Añade un suceso a su previsión y mira cómo cambiarían ${N_CAMINOS} caminos posibles del precio (se dibujan ${N_DIBUJO} de muestra).</p>
    <div class="sim">
      <div class="sim-ctl">
        <div class="presets" role="group" aria-label="Sucesos de ejemplo" id="presets">
          ${Object.entries(SUCESOS).map(([k, v]) => `<button type="button" data-suceso="${k}" aria-pressed="${k === sim.suceso}">${v.nombre}</button>`).join('')}
        </div>
        <p class="sim-desc" id="sim-desc"></p>
        ${ctl('s-golpe', 'Tamaño del golpe en el precio', -50, 60, 1, 'Negativo si baja el precio, positivo si sube')}
        ${ctl('s-cuando', 'Cuándo ocurre', 0, 0.9, 0.05, 'Desde hoy hasta casi el final del plazo')}
        ${ctl('s-persiste', 'Cuánto dura', 0, 1, 0.05, 'De pasajero a permanente')}
        ${ctl('s-agitacion', 'Agitación del mercado', 0.5, 2, 0.1, 'Cuánto se mueve el precio cada día')}
      </div>
      <div class="sim-graf">
        <div class="grafica" id="g-sim"><svg role="img" aria-label="Caminos simulados del precio"></svg><div class="tooltip" hidden></div></div>
        <div class="leyenda" aria-hidden="true">
          <span><i class="l"></i>Precio real</span>
          <span><i class="l prev"></i>Camino más probable con el suceso</span>
          <span><i class="b"></i>8 de cada 10 caminos</span>
          <span><i class="b" style="background:rgba(243,180,65,.38)"></i>La mitad de los caminos</span>
          <span id="leyenda-base"><i class="l" style="background:repeating-linear-gradient(90deg,var(--texto-2) 0 4px,transparent 4px 8px)"></i>Sin el suceso</span>
        </div>
      </div>
      <div class="sim-resto">
        <div class="sim-stats" id="sim-stats"></div>
        <div class="sim-pie"><span class="nota" style="margin:0">Simulación ilustrativa: el tamaño de cada suceso es una hipótesis, no una previsión del modelo.</span>
          <button class="boton boton-borde" type="button" id="sim-otra">Simular otra vez</button></div>
      </div>
    </div>`;
  $('presets').addEventListener('click', ev => {
    const b = ev.target.closest('button'); if (!b) return;
    elegirSuceso(b.dataset.suceso);
  });
  const enlazar = (id, campo) => $(id).addEventListener('input', ev => {
    sim[campo] = Number(ev.target.value);
    sim.suceso = null; sim.animar = false;
    $('presets').querySelectorAll('button').forEach(o => o.setAttribute('aria-pressed', 'false'));
    $('sim-desc').textContent = 'Suceso a tu medida.';
    pintarSimulador();
  });
  enlazar('s-golpe', 'golpe'); enlazar('s-cuando', 'cuando'); enlazar('s-persiste', 'persiste'); enlazar('s-agitacion', 'agitacion');
  $('sim-otra').addEventListener('click', () => { sim.semilla = (sim.semilla * 48271) % 2147483647; sim.animar = true; pintarSimulador(); });
  elegirSuceso('base', false);
}
function elegirSuceso(k, animar = true) {
  const v = SUCESOS[k];
  Object.assign(sim, { suceso: k, golpe: v.golpe, cuando: v.cuando, persiste: v.persiste, agitacion: v.agitacion, rampa: v.rampa, semivida: v.semivida, animar });
  $('presets').querySelectorAll('button').forEach(o => o.setAttribute('aria-pressed', String(o.dataset.suceso === k)));
  $('sim-desc').textContent = v.texto;
  pintarSimulador();
}

let simBase = null;
function pintarSimulador() {
  const h = D.prediccion.horizontes[estado.plazo], z = PLAZOS[estado.plazo];
  // controles
  const dias = h.dias_habiles;
  const set = (id, v, txt) => { $(id).value = v; $(`${id}-v`).textContent = txt; };
  set('s-golpe', sim.golpe, `${sim.golpe > 0 ? '+' : sim.golpe < 0 ? '−' : ''}${Math.abs(sim.golpe)} %`);
  const diaSuceso = Math.round(sim.cuando * dias);
  set('s-cuando', sim.cuando, diaSuceso === 0 ? 'Hoy' : dias <= 5 ? `En ${diaSuceso} día${diaSuceso > 1 ? 's' : ''}` : `En ${Math.max(1, Math.round(diaSuceso / 5))} semanas`);
  set('s-persiste', sim.persiste, sim.persiste < 0.25 ? 'Pasajero' : sim.persiste < 0.7 ? 'Se relaja' : 'Se queda');
  set('s-agitacion', sim.agitacion, sim.agitacion === 1 ? 'Como ahora' : `×${f1.format(sim.agitacion)}`);

  const r = simular(h, sim);
  const sinSuceso = sim.golpe === 0 && sim.agitacion === 1;
  simBase = sinSuceso ? r : simular(h, { ...sim, golpe: 0, agitacion: 1 });
  $('leyenda-base').hidden = sinSuceso;

  // gráfica
  const cont = $('g-sim'), svg = cont.querySelector('svg'), tip = cont.querySelector('.tooltip');
  if (!cont.clientWidth) return;
  const W = cont.clientWidth, H = W < 560 ? 240 : 300, m = { t: 14, r: 50, b: 26, l: 40 };
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('height', H);
  svg.replaceChildren();
  const T = D.historico.t, P = D.historico.precios, tHoy = T.at(-1), tObj = aFecha(h.fecha_objetivo).getTime();
  const tIni = tHoy - (tObj - tHoy) * 0.7;
  const i0 = busqueda(T, tIni);
  const tk = k => tHoy + ((tObj - tHoy) * k) / r.n;
  const finales = r.caminos.map(c => c[r.n]).sort((a, b) => a - b);
  const ys = [...P.slice(i0), ...r.banda.flatMap(b => [b[0], b[2]]), ...simBase.banda.map(b => b[1])];
  const yM = marcas(Math.min(...ys), Math.max(...ys), 4);
  const x = escala(tIni, tObj, m.l, W - m.r), y = escala(yM.ini, yM.fin, H - m.b, m.t);
  ejes(svg, { W, H, m, y, yMarcas: yM.lista, x, xMarcas: marcasTiempo(tIni, tObj) });
  const franja = (cls, a, b) => el('path', { class: cls, d: `${camino(r.banda.map((q, k) => [x(tk(k)), y(q[b])]))}${camino(r.banda.slice().reverse().map((q, k) => [x(tk(r.n - k)), y(q[a])])).replace('M', 'L')}Z` }, svg);
  franja('banda-sim', 0, 2);
  franja('banda-sim-50', 3, 4);
  // los caminos extremos se recortan al área de la gráfica para no invadir el resto de la página
  const recorte = el('clipPath', { id: 'recorte-sim' }, el('defs', {}, svg));
  el('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b }, recorte);
  const g = el('g', { 'clip-path': 'url(#recorte-sim)' }, svg);
  for (let i = 0; i < N_DIBUJO; i++) {
    const c = r.caminos[i], paso = Math.max(1, Math.floor(r.n / 120)), pts = [];
    for (let k = 0; k <= r.n; k += paso) pts.push([x(tk(k)), y(c[k])]);
    pts.push([x(tk(r.n)), y(c[r.n])]);
    const path = el('path', { class: `trayecto${sim.animar && !reduceMotion ? ' anima' : ''}`, d: camino(pts), pathLength: 1 }, g);
    if (sim.animar) path.style.animationDelay = `${(i % 14) * 25}ms`;
  }
  sim.animar = false;
  if (!sinSuceso) el('path', { class: 'base-sim', d: camino(simBase.banda.map((b, k) => [x(tk(k)), y(b[1])])) }, svg);
  el('path', { class: 'mediana-sim', d: camino(r.banda.map((b, k) => [x(tk(k)), y(b[1])])) }, svg);
  el('path', { class: 'linea-real', d: camino(T.slice(i0).map((t, j) => [x(t), y(P[i0 + j])])) }, svg);
  el('line', { class: 'divisoria', x1: x(tHoy), x2: x(tHoy), y1: m.t, y2: H - m.b }, svg);
  el('text', { x: x(tHoy) - 6, y: m.t + 4, 'text-anchor': 'end' }, svg).textContent = 'Hoy';
  if (sim.golpe !== 0) {
    el('line', { class: 'marca-suceso', x1: x(tk(r.k0)), x2: x(tk(r.k0)), y1: m.t, y2: H - m.b }, svg);
    el('text', { x: x(tk(r.k0)) + 6, y: m.t + 4 }, svg).textContent = 'Suceso';
  }
  const med = r.banda[r.n][1];
  el('circle', { class: 'punto', cx: x(tObj), cy: y(med), r: 5, fill: 'var(--ambar)' }, svg);
  el('text', { class: 'etq-dato', x: x(tObj) + 9, y: y(med) + 4 }, svg).textContent = `${f0.format(med)} $`;

  // tooltip con la banda en cada día
  const cruz = el('line', { class: 'cruz', y1: m.t, y2: H - m.b, visibility: 'hidden' }, svg);
  const zona = el('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: 'transparent' }, svg);
  const mover = ev => {
    const b = svg.getBoundingClientRect(), t = tIni + ((ev.clientX - b.left - m.l) / (W - m.r - m.l)) * (tObj - tIni);
    let html, xx, yy;
    if (t <= tHoy) { const i = busqueda(T, Math.max(t, tIni)); xx = x(T[i]); yy = y(P[i]); html = `${fechaLarga(D.historico.fechas[i])}<strong>${dolares(P[i])}</strong>`; }
    else { const k = Math.round(((t - tHoy) / (tObj - tHoy)) * r.n), bb = r.banda[k]; xx = x(tk(k)); yy = y(bb[1]); html = `${fechaLarga(new Date(tk(k)))}<strong>${f0.format(bb[1])} $</strong>8 de cada 10 caminos entre ${f0.format(bb[0])} y ${f0.format(bb[2])} $`; }
    cruz.setAttribute('x1', xx); cruz.setAttribute('x2', xx); cruz.setAttribute('visibility', 'visible');
    tooltipEn(tip, cont, xx, yy, html);
  };
  zona.addEventListener('pointermove', mover);
  zona.addEventListener('pointerdown', mover);
  zona.addEventListener('pointerleave', ev => { if (ev.pointerType === 'touch') return; tip.hidden = true; cruz.setAttribute('visibility', 'hidden'); });

  // cifras
  const medBase = simBase.banda[simBase.n][1], dif = med - medBase;
  const masCaro = finales.filter(v => v > D.prediccion.precio_hoy).length / finales.length * 100;
  const coste = (estado.barriles * med) / D.usdPorEur, costeBase = (estado.barriles * medBase) / D.usdPorEur;
  $('sim-stats').innerHTML = `
    <div class="caso central"><span class="etq">Precio más probable ${z.corto}</span><span class="num">${f0.format(med)} $</span>
      <span class="dif">${sinSuceso ? 'Igual que la previsión' : `${signo(dif)}${f0.format(Math.abs(dif))} $ por el suceso`}</span></div>
    <div class="caso"><span class="etq">8 de cada 10 caminos</span><span class="num">${f0.format(r.banda[r.n][0])}–${f0.format(r.banda[r.n][2])} $</span>
      <span class="dif">Sin el suceso: ${f0.format(simBase.banda[simBase.n][0])}–${f0.format(simBase.banda[simBase.n][2])} $</span></div>
    <div class="caso"><span class="etq">Acaba más caro que hoy</span><span class="num">${f0.format(masCaro)} %</span>
      <span class="dif">de los caminos</span></div>
    <div class="caso"><span class="etq">Tus ${f0.format(estado.barriles)} barriles al mes</span><span class="num">${euros(coste)}</span>
      <span class="dif">${sinSuceso ? 'Precio más probable' : `${signo(coste - costeBase)}${euros(Math.abs(coste - costeBase))} por el suceso`}</span></div>`;
}

// ---------------------------------------------------------------------------
// Mercado
// ---------------------------------------------------------------------------
function lecturaPercentil(p) {
  if (p < 0.1) return 'Muy por debajo de lo habitual';
  if (p < 0.3) return 'Por debajo de lo habitual';
  if (p < 0.7) return 'En lo habitual';
  if (p < 0.9) return 'Por encima de lo habitual';
  return 'Muy por encima de lo habitual';
}
// qué supone cada señal para quien mira la previsión
function implicacion(i) {
  const alto = i.percentil >= 0.7, bajo = i.percentil <= 0.3;
  if (i.nombre.startsWith('Agitación')) return alto ? 'El precio puede salirse del rango previsto más a menudo de lo normal.' : bajo ? 'Mercado tranquilo: el rango previsto suele bastar.' : 'El rango previsto es tan fiable como en las pruebas.';
  if (i.nombre.startsWith('Miedo')) return alto ? 'Inversores nerviosos: otras veces ha precedido a caídas de la demanda de crudo.' : bajo ? 'Mercados confiados, sin señales de pánico.' : 'Sin señales de pánico en los mercados.';
  if (i.nombre.startsWith('Euro')) return bajo ? 'Euro débil: el barril sale más caro a quien paga en euros.' : alto ? 'Euro fuerte: suaviza las subidas del barril a quien paga en euros.' : 'El cambio ni abarata ni encarece especialmente el barril.';
  return alto ? 'El crudo europeo está caro frente al de EE. UU.: suele indicar tensión en el suministro fuera de América.' : bajo ? 'El Brent está barato frente al crudo de EE. UU.' : 'Diferencia normal entre los dos crudos.';
}
function pintarMercado() {
  const M = D.mercado;
  $('mercado-sub').textContent = `Cuatro señales que suelen acompañar a los movimientos fuertes del crudo. Dato del ${fechaLarga(M.fecha_dato)}.`;
  const valor = i => (i.unidad === '%' ? `${nf(i.decimales).format(i.hoy)} %` : i.unidad === '$' ? `${nf(i.decimales).format(i.hoy)} $` : nf(i.decimales).format(i.hoy));
  const corto = (i, v) => (i.unidad === '%' ? `${nf(i.decimales).format(v)} %` : i.unidad === '$' ? `${nf(i.decimales).format(v)} $` : nf(i.decimales).format(v));
  // lectura de un vistazo: cuántas señales se salen de lo habitual y cuáles
  const fuera = M.indicadores.filter(i => i.percentil >= 0.7 || i.percentil <= 0.3);
  $('mercado-lectura').innerHTML = `
    <div class="ml-cuenta"><span class="num">${fuera.length}<small> de ${M.indicadores.length}</small></span>
      <span>${fuera.length === 1 ? 'señal fuera' : 'señales fuera'} de lo habitual</span></div>
    <ul class="ml-lista">${M.indicadores.map(i => {
      const raro = fuera.includes(i);
      return `<li class="${raro ? 'fuera' : ''}"><i aria-hidden="true"></i><div><strong>${i.nombre}</strong>
        <span>${lecturaPercentil(i.percentil)}. ${implicacion(i)}</span></div></li>`;
    }).join('')}</ul>`;
  $('indicadores').innerHTML = M.indicadores.map((i, k) => `
    <div class="tarjeta s3 indicador">
      <h3>${i.nombre}</h3>
      <p class="ayuda">${i.texto}</p>
      <div class="valor"><span class="num">${valor(i)}</span><span class="lectura-ind">${lecturaPercentil(i.percentil)}</span></div>
      <div class="comp">Lo habitual desde 2000: ${corto(i, i.mediana_historica)}. Hace tres meses: ${corto(i, i.hace_3m)}.</div>
      <p class="implica">${implicacion(i)}</p>
      <div>
        <div class="percentil" role="img" aria-label="Más alto que el ${f0.format(i.percentil * 100)} % de los días desde 2000"><b style="left:${(i.percentil * 100).toFixed(1)}%"></b></div>
        <div class="percentil-etq"><span>Mínimo</span><span>Más alto que el ${f0.format(i.percentil * 100)} % de los días</span></div>
      </div>
      <svg class="mini" data-k="${k}" height="44" role="img" aria-label="Evolución en el último año"></svg>
      <span class="mini-etq">Último año</span>
    </div>`).join('');
  dibujarMinis();
}
function dibujarMinis() {
  document.querySelectorAll('svg.mini').forEach(svg => {
    const serie = D.mercado.indicadores[svg.dataset.k].serie;
    const W = svg.parentElement.clientWidth - 2 * parseFloat(getComputedStyle(svg.parentElement).paddingLeft), H = 44;
    if (W <= 0) return;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('width', W);
    svg.replaceChildren();
    const x = escala(0, serie.length - 1, 2, W - 6), y = escala(Math.min(...serie), Math.max(...serie), H - 4, 4);
    el('path', { class: 'linea-mini', d: camino(serie.map((v, i) => [x(i), y(v)])) }, svg);
    el('circle', { cx: x(serie.length - 1), cy: y(serie.at(-1)), r: 3.5, fill: 'var(--texto)' }, svg);
  });
}

// ---------------------------------------------------------------------------
// Fiabilidad: lo que dijo el modelo y lo que pasó
// ---------------------------------------------------------------------------
function graficaBacktest() {
  if (!$('g-backtest').clientWidth) return;
  const b = D.backtest.horizontes[estado.plazo], z = PLAZOS[estado.plazo];
  $('b-titulo').textContent = `Previsiones ${z.corto} frente al precio real`;
  const cont = $('g-backtest'), svg = cont.querySelector('svg'), tip = cont.querySelector('.tooltip');
  const W = cont.clientWidth, H = W < 560 ? 230 : 290, m = { t: 14, r: 16, b: 26, l: 40 };
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('height', H);
  svg.replaceChildren();
  const T = b.fechas.map(f => aFecha(f).getTime());
  const ing = b.ingenuo ?? [];
  const yM = marcas(Math.min(...b.real, ...b.previsto, ...ing), Math.max(...b.real, ...b.previsto, ...ing), 4);
  const x = escala(T[0], T.at(-1), m.l, W - m.r), y = escala(yM.ini, yM.fin, H - m.b, m.t);
  ejes(svg, { W, H, m, y, yMarcas: yM.lista, x, xMarcas: marcasTiempo(T[0], T.at(-1)) });
  // "sin modelo" es el precio del día en que se hizo la previsión: la misma línea real, retrasada h días
  if (ing.length) el('path', { class: 'linea-ingenuo', d: camino(T.map((t, i) => [x(t), y(ing[i])])) }, svg);
  el('path', { class: 'linea-real', d: camino(T.map((t, i) => [x(t), y(b.real[i])])) }, svg);
  el('path', { class: 'linea-prev fina', d: camino(T.map((t, i) => [x(t), y(b.previsto[i])])) }, svg);

  const cruz = el('line', { class: 'cruz', y1: m.t, y2: H - m.b, visibility: 'hidden' }, svg);
  const pr = el('circle', { class: 'punto', r: 4.5, fill: 'var(--texto)', visibility: 'hidden' }, svg);
  const pp = el('circle', { class: 'punto', r: 4.5, fill: 'var(--ambar)', visibility: 'hidden' }, svg);
  const zona = el('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: 'transparent' }, svg);
  const mover = ev => {
    const r = svg.getBoundingClientRect(), px = ev.clientX - r.left;
    const i = busqueda(T, T[0] + ((px - m.l) / (W - m.r - m.l)) * (T.at(-1) - T[0]));
    const xx = x(T[i]);
    for (const [c, v] of [[pr, b.real[i]], [pp, b.previsto[i]]]) { c.setAttribute('cx', xx); c.setAttribute('cy', y(v)); c.setAttribute('visibility', 'visible'); }
    cruz.setAttribute('x1', xx); cruz.setAttribute('x2', xx); cruz.setAttribute('visibility', 'visible');
    const err = b.previsto[i] - b.real[i], errI = ing.length ? ing[i] - b.real[i] : null;
    const gana = errI == null ? '' : Math.abs(err) < Math.abs(errI) ? '<br>Aquí acertó más el modelo' : Math.abs(err) > Math.abs(errI) ? '<br>Aquí acertó más no usar modelo' : '';
    tooltipEn(tip, cont, xx, y(Math.max(b.real[i], b.previsto[i])),
      `${fechaLarga(b.fechas[i])}<strong>Real ${dolares(b.real[i])}</strong>El modelo dijo ${dolares(b.previsto[i])} (${signo(err)}${f2.format(Math.abs(err))} $)${errI == null ? '' : `<br>Sin modelo ${dolares(ing[i])} (${signo(errI)}${f2.format(Math.abs(errI))} $)`}${gana}`);
  };
  zona.addEventListener('pointermove', mover);
  zona.addEventListener('pointerdown', mover);
  zona.addEventListener('pointerleave', ev => { if (ev.pointerType === 'touch') return; tip.hidden = true; [cruz, pr, pp].forEach(e => e.setAttribute('visibility', 'hidden')); });
}
function pintarFiabilidad() {
  const b = D.backtest.horizontes[estado.plazo], h = D.prediccion.horizontes[estado.plazo], z = PLAZOS[estado.plazo];
  $('fiab-cifras').innerHTML = `
    <h3>En el test, ${z.corto}</h3>
    <p class="ayuda">Modelo: ${h.modelo}</p>
    <div class="cifras" style="margin-top:12px">
      <div class="cifra"><div class="etq">Frente a no usar modelo</div><div class="num">${frente(h.mejora_vs_ingenuo_pct, true)}</div>
        <div class="dif">Error cuadrático (RMSE), la medida con la que se eligió el modelo</div></div>
      <div class="cifra"><div class="etq">Se equivocó de media</div><div class="num">${dolares(b.error_medio)}</div>
        <div class="dif">Suponiendo que el precio no cambia: ${dolares(b.error_medio_ingenuo)}</div></div>
      <div class="cifra"><div class="etq">Acertó si subiría o bajaría</div><div class="num">${f0.format(b.acierto_direccion_pct)} %</div>
        <div class="dif">Tirando una moneda sería un 50 %</div></div>
    </div>
    ${porAnios(b)}`;
}
// error medio de cada año de las pruebas, del modelo y de no usar modelo
function porAnios(b) {
  if (!b.ingenuo) return '';
  const A = new Map();
  b.fechas.forEach((f, i) => {
    const a = A.get(f.slice(0, 4)) ?? { m: 0, s: 0, n: 0 };
    a.m += Math.abs(b.previsto[i] - b.real[i]); a.s += Math.abs(b.ingenuo[i] - b.real[i]); a.n += 1;
    A.set(f.slice(0, 4), a);
  });
  const filas = [...A].filter(([, a]) => a.n >= 20).map(([anio, a]) => ({ anio, m: a.m / a.n, s: a.s / a.n, n: a.n }));
  const tope = Math.max(...filas.flatMap(f => [f.m, f.s]));
  const barra = (v, cls) => `<div class="aa-barra ${cls}"><i style="width:${((v / tope) * 100).toFixed(1)}%"></i><b>${dolares(v)}</b></div>`;
  return `<h3 class="aa-titulo">Año a año</h3>
    <p class="ayuda">Error medio de las previsiones que vencían cada año.</p>
    <div class="aa">${filas.map(f => {
      const dif = Math.abs(f.m - f.s) < 0.05 ? 'Empate' : f.m < f.s ? 'Gana el modelo' : 'Gana sin modelo';
      return `<div class="aa-fila"><strong>${f.anio}</strong>
        <div>${barra(f.m, 'modelo')}${barra(f.s, 'sin')}</div>
        <span class="${f.m < f.s - 0.05 ? 'bien' : ''}">${dif}</span></div>`;
    }).join('')}</div>
    <div class="leyenda aa-leyenda" aria-hidden="true"><span><i class="b aa-m"></i>Modelo</span><span><i class="b aa-s"></i>Sin modelo</span></div>`;
}

// ---------------------------------------------------------------------------
// Ciclos del mercado: todo el histórico con los grandes picos y caídas
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Resultados del trabajo: entrenamiento, validación y test del plazo elegido.
// Todo sale de datos/resultados.json, que generar_datos.py escribe desde los informes.
// ---------------------------------------------------------------------------
const lab = { red: null, plazo: null };
// mejora frente a no usar modelo, a partir del error relativo (1 = igual que sin modelo)
const mejoraRel = rel => (1 - rel) * 100;
// celda de la tabla de validación: la cifra, con un fondo más intenso cuanto mayor es la diferencia
const celdaCalor = (p, tope) => `<div class="celda ${p > 0 ? 'mejor' : 'peor'}" style="--a:${(0.1 + 0.5 * Math.min(1, Math.abs(p) / tope)).toFixed(2)}"><b class="num">${pct(p)}</b></div>`;

function pintarLaboratorio() {
  const R = D.resultados, r = R.horizontes[estado.plazo], z = PLAZOS[estado.plazo];
  const elegida = r.validacion.find(f => f.final);
  const celdaElegida = Object.keys(r.curvas).find(c => elegida.modelo.startsWith(r.curvas[c].red));
  if (lab.plazo !== estado.plazo) { lab.plazo = estado.plazo; lab.red = celdaElegida; }

  // los tres tramos de datos
  const c0 = r.curvas[celdaElegida], a0 = Number(c0.aprende[0].slice(0, 4)), v0 = R.años[0], v1 = R.años.at(-1);
  const t0 = new Date(D.estado.inicio_test).getFullYear(), t1 = aFecha(D.estado.hasta).getFullYear();
  const tramos = [
    { cls: 'aprende', nombre: 'Aprender', años: `${a0}-${v0 - 1}`, n: v0 - a0, texto: 'Años que las redes usan solo para aprender.' },
    { cls: 'valida', nombre: 'Validar y elegir', años: `${v0}-${v1}`, n: v1 - v0 + 1, texto: 'Aquí se eligieron la ventana, la red y el ajuste de cada plazo.' },
    { cls: 'test', nombre: 'Test', años: `${t0}-${t1}`, n: t1 - t0 + 1, texto: 'Guardado hasta el final. Nada se eligió mirándolo.' },
  ];
  $('lab-periodos').innerHTML = tramos.map(t => `<div class="lab-tramo ${t.cls}" style="flex:${t.n} 1 0">
    <i class="valvula" aria-hidden="true"></i><div class="tubo-t" aria-hidden="true"></div>
    <strong>${t.nombre}</strong><span class="num">${t.años}</span><p>${t.texto}</p></div>`).join('');

  // selector de red y fichas del entrenamiento
  $('lab-red').innerHTML = Object.entries(r.curvas).map(([c, v]) =>
    `<button type="button" data-red="${c}" aria-pressed="${c === lab.red}">${v.red}</button>`).join('');
  const w = r.ventana, otras = Object.entries(w.puntuaciones).map(([k, v]) => `${k} días: ${f2.format(v)}`).join(' · ');
  $('lab-fichas').innerHTML = `<h3>Las tres redes, ${z.corto}</h3>
    <p class="ayuda">Cada red deja de entrenar cuando lleva ${c0.paciencia} épocas sin mejorar en validación y se queda con su mejor época. La curva es la de uno de sus cinco entrenamientos.</p>
    <div class="lab-fichas">${Object.entries(r.curvas).map(([c, v]) => `<button type="button" class="lab-ficha" data-red="${c}" aria-pressed="${c === lab.red}">
      <span class="nombre">${v.red}${c === celdaElegida ? '<small>elegida</small>' : ''}</span>
      <span class="dato"><b class="num">${v.mejor_epoca}</b> mejor época de ${v.epocas}</span>
      <span class="dato"><b class="num">${f0.format(v.parametros)}</b> parámetros</span>
      <span class="dato"><b class="num">${f1.format(v.tiempo_s)} s</b> de entrenamiento</span>
      <span class="manometro" aria-hidden="true"><i style="width:${((v.mejor_epoca / v.epocas) * 100).toFixed(0)}%"></i></span></button>`).join('')}</div>
    <p class="nota-tabla">Ventana de ${w.elegida} días, elegida en validación entre ${Object.keys(w.puntuaciones).join(', ')} (error relativo medio de las tres redes: ${otras}).</p>`;

  // validación año a año, en una tabla de calor
  const tope = Math.max(1, ...r.validacion.flatMap(f => f.por_año.filter(v => v != null).map(v => Math.abs(mejoraRel(v)))));
  $('lab-v-sub').textContent = `Antes de tocar el test, cada red se probó año a año de ${v0} a ${v1}. Con esto se eligió el modelo ${z.corto}: el de menor error medio.`;
  $('lab-validacion').innerHTML = `<h3>Año a año frente a no usar modelo, ${z.corto}</h3>
    <p class="ayuda">Diferencia de error (RMSE) frente a suponer que el precio no cambia. En positivo, la red se equivocó menos ese año; en negativo, más.</p>
    <div class="desplazable"><div class="lab-val" style="--n:${R.años.length}">
      <div class="lab-val-cab"><span></span>${R.años.map(a => `<span class="num">${a}</span>`).join('')}<span>Media</span></div>
      ${r.validacion.map(f => {
        const hay = f.por_año.filter(v => v != null), gana = hay.filter(v => v < 1).length, m = mejoraRel(f.media);
        return `<div class="lab-val-fila ${f.final ? 'elegida' : ''}">
          <div class="quien"><strong>${nombreModelo(f.modelo)}${f.final ? '<small>elegida</small>' : ''}</strong><span>Gana ${gana} de ${hay.length} años</span></div>
          ${f.por_año.map(v => {
            if (v == null) return '<div class="celda vacia"><span>sin dato</span></div>';
            return celdaCalor(mejoraRel(v), tope);
          }).join('')}
          <div class="media"><b class="num ${m > 0 ? 'bien' : ''}">${pct(m)}</b><span>${m > 0 ? 'menos error' : 'más error'}</span></div>
        </div>`;
      }).join('')}
    </div></div>
    ${r.validacion.some(f => f.por_año.includes(null)) ? `<p class="nota-tabla">${z.corto[0].toUpperCase()}${z.corto.slice(1)} no hay dato del último año: hace falta un año entero por delante para comprobar cada previsión.</p>` : ''}`;

  // test: semillas e intervalo (la tabla la pinta pintarComparacion)
  $('lab-t-sub').textContent = `Lo que pasó de ${t0} a ${t1}, con datos que ninguna red había visto. Es la nota final del trabajo, tal como salió.`;
  const S = r.semillas, topeS = Math.max(1, ...Object.values(S).flatMap(s => s.mejora_rmse_pct.map(Math.abs)));
  $('lab-semillas').innerHTML = `<h3>Variación entre semillas</h3>
    <p class="ayuda">Cada red se entrenó cinco veces con distinta semilla. Cada punto es el resultado de una en el test, frente a no usar modelo (RMSE). A la derecha de la raya, mejor.</p>
    <div class="lab-sem">${Object.entries(S).map(([red, s]) => {
      const v = s.mejora_rmse_pct, lo = Math.min(...v), hi = Math.max(...v);
      return `<div class="lab-sem-fila"><strong>${red}</strong>
        <div class="pista" aria-hidden="true">${v.map(x => `<i class="${x > 0 ? 'bien' : ''}" style="left:${(50 + (x / topeS) * 48).toFixed(1)}%"></i>`).join('')}</div>
        <span class="num">de ${pct(lo)} a ${pct(hi)}</span></div>`;
    }).join('')}</div>
    <p class="nota-tabla">En la tabla, cada red es el promedio de las previsiones de sus cinco entrenamientos.</p>`;
  const I = r.intervalo, nivelI = R.nivel_intervalo * 100;
  $('lab-intervalo').innerHTML = `<h3>Cobertura del intervalo</h3>
    <p class="ayuda">Un rango al ${f0.format(nivelI)} % debería contener el precio real ${f0.format(nivelI / 10)} de cada 10 veces. Comprobado en ${I.años}, calibrando cada año solo con lo ya conocido.</p>
    <div class="lab-int">${I.metodos.map(mt => `<div class="lab-int-fila ${mt.metodo === I.elegido ? 'elegida' : ''}">
      <strong>${mt.nombre}${mt.metodo === I.elegido ? '<small>elegido</small>' : ''}</strong>
      <div class="deposito" aria-hidden="true"><i style="width:${mt.cobertura_pct}%"></i><b style="left:${nivelI}%"></b></div>
      <span><b class="num">${f1.format(mt.cobertura_pct)} %</b> de aciertos · ancho medio ${f0.format(mt.anchura_pct)} % del precio</span></div>`).join('')}</div>
    <p class="nota-tabla">La raya marca el ${f0.format(nivelI)} % prometido.</p>`;
  graficaCurvas();
}

function graficaCurvas() {
  const cont = $('g-curvas');
  if (!cont.clientWidth || !lab.red) return;
  const c = D.resultados.horizontes[estado.plazo].curvas[lab.red], z = PLAZOS[estado.plazo];
  $('lab-c-titulo').textContent = `${c.red} ${z.corto}: el error, época a época`;
  const svg = cont.querySelector('svg'), tip = cont.querySelector('.tooltip');
  const W = cont.clientWidth, H = W < 560 ? 240 : 310, m = { t: 26, r: 18, b: 30, l: 46 };
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('height', H);
  svg.replaceChildren();
  const E = c.entrenamiento, V = c.validacion, n = E.length;
  const yM = marcas(Math.min(...E, ...V, 1), Math.max(...E, ...V, 1), 4);
  const x = escala(1, Math.max(n, 2), m.l, W - m.r), y = escala(yM.ini, yM.fin, H - m.b, m.t);
  const pasoX = Math.max(1, Math.ceil(n / 8));
  ejes(svg, { W, H, m, y, yMarcas: yM.lista, x, formatoY: v => f2.format(v),
    xMarcas: Array.from({ length: n }, (_, i) => i + 1).filter(e => e === 1 || e % pasoX === 0).map(e => [e, String(e)]) });
  el('text', { class: 'eje-nombre', x: W - m.r, y: H - 6, 'text-anchor': 'end' }, svg).textContent = 'época';
  // 1 = igual que no usar modelo
  el('line', { class: 'linea-umbral', x1: m.l, x2: W - m.r, y1: y(1), y2: y(1) }, svg);
  el('text', { class: 'eje-nombre', x: m.l + 6, y: y(1) - 6 }, svg).textContent = 'igual que sin modelo';
  // desde la mejor época ya no se aprovecha nada
  const xb = x(c.mejor_epoca);
  if (c.mejor_epoca < n) el('rect', { class: 'zona-cerrada', x: xb, y: m.t, width: W - m.r - xb, height: H - m.t - m.b }, svg);
  el('path', { class: 'linea-curva-e', d: camino(E.map((v, i) => [x(i + 1), y(v)])) }, svg);
  el('path', { class: 'linea-prev', d: camino(V.map((v, i) => [x(i + 1), y(v)])) }, svg);
  el('line', { class: 'linea-mejor', x1: xb, x2: xb, y1: m.t - 4, y2: H - m.b }, svg);
  const yb = y(V[c.mejor_epoca - 1]);
  el('circle', { class: 'punto-mejor', cx: xb, cy: yb, r: 5.5 }, svg);
  const aDcha = xb < W * 0.6;
  el('text', { class: 'rotulo-mejor', x: xb + (aDcha ? 10 : -10), y: m.t + 6, 'text-anchor': aDcha ? 'start' : 'end' }, svg).textContent = `Mejor época: ${c.mejor_epoca}`;

  const cruz = el('line', { class: 'cruz', y1: m.t, y2: H - m.b, visibility: 'hidden' }, svg);
  const pe = el('circle', { class: 'punto', r: 4, fill: 'var(--texto-2)', visibility: 'hidden' }, svg);
  const pv = el('circle', { class: 'punto', r: 4, fill: 'var(--ambar)', visibility: 'hidden' }, svg);
  const zona = el('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: 'transparent' }, svg);
  const mover = ev => {
    const px = ev.clientX - svg.getBoundingClientRect().left;
    const i = Math.min(n - 1, Math.max(0, Math.round(((px - m.l) / (W - m.r - m.l)) * (Math.max(n, 2) - 1))));
    const xx = x(i + 1);
    for (const [p, v] of [[pe, E[i]], [pv, V[i]]]) { p.setAttribute('cx', xx); p.setAttribute('cy', y(v)); p.setAttribute('visibility', 'visible'); }
    cruz.setAttribute('x1', xx); cruz.setAttribute('x2', xx); cruz.setAttribute('visibility', 'visible');
    tooltipEn(tip, cont, xx, y(Math.max(E[i], V[i])), `Época ${i + 1}${i + 1 === c.mejor_epoca ? ' (la mejor)' : ''}<strong>Validación ${nf(3).format(V[i])}</strong>Entrenamiento ${nf(3).format(E[i])}`);
  };
  zona.addEventListener('pointermove', mover);
  zona.addEventListener('pointerdown', mover);
  zona.addEventListener('pointerleave', ev => { if (ev.pointerType === 'touch') return; tip.hidden = true; [cruz, pe, pv].forEach(e => e.setAttribute('visibility', 'hidden')); });
}
// elegir red: desde el selector o desde su ficha
$('resultados').addEventListener('click', ev => {
  const b = ev.target.closest('[data-red]');
  if (!b) return;
  lab.red = b.dataset.red;
  $('resultados').querySelectorAll('[data-red]').forEach(e => e.setAttribute('aria-pressed', String(e.dataset.red === lab.red)));
  graficaCurvas();
});

function pintarCiclos() {
  $('eventos').innerHTML = D.eventos.map((e, i) => `
    <li class="evento" data-i="${i}" tabindex="0">
      <div class="cab"><span class="anio">${e.date.slice(0, 4)}</span><span class="precio">${e.kind === 'pico' ? 'Pico' : 'Caída'} en <b>${f0.format(e.precio)} $</b></span></div>
      <h3>${e.title}</h3>
      <p>${e.text}</p>
    </li>`).join('');
  $('eventos').querySelectorAll('.evento').forEach(li => {
    const on = () => resaltarEvento(Number(li.dataset.i)), off = () => resaltarEvento(null);
    li.addEventListener('pointerenter', on); li.addEventListener('pointerleave', off);
    li.addEventListener('focus', on); li.addEventListener('blur', off);
  });
  graficaCiclos();
}
function resaltarEvento(i) {
  document.querySelectorAll('#g-ciclos .marca-evento').forEach((c, k) => c.classList.toggle('activa', k === i));
  document.querySelectorAll('#g-ciclos .tramo-evento').forEach((c, k) => c.classList.toggle('activa', k === i));
  document.querySelectorAll('#eventos .evento').forEach((li, k) => li.classList.toggle('activa', k === i));
}
function graficaCiclos() {
  if (!$('g-ciclos').clientWidth) return;
  const cont = $('g-ciclos'), svg = cont.querySelector('svg'), tip = cont.querySelector('.tooltip');
  const W = cont.clientWidth, H = W < 560 ? 260 : 340, m = { t: 34, r: 12, b: 26, l: 40 };
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('height', H);
  svg.replaceChildren();
  const T = D.historico.t, P = D.historico.precios;
  const paso = Math.max(1, Math.floor(T.length / 800));
  const pts = [];
  for (let i = 0; i < T.length; i += paso) pts.push([T[i], P[i]]);
  pts.push([T.at(-1), P.at(-1)]);
  const yM = marcas(0, Math.max(...P), 4);
  const x = escala(T[0], T.at(-1), m.l, W - m.r), y = escala(0, yM.fin, H - m.b, m.t);
  ejes(svg, { W, H, m, y, yMarcas: yM.lista, x, xMarcas: marcasTiempo(T[0], T.at(-1)) });
  const linea = pts.map(d => [x(d[0]), y(d[1])]);
  // tramo de cada suceso: medio año antes y después, oculto hasta pasar por su tarjeta
  for (const e of D.eventos) {
    const a = x(Math.max(T[0], e.t - 182 * 864e5)), b2 = x(Math.min(T.at(-1), e.t + 182 * 864e5));
    el('rect', { class: 'tramo-evento', x: a, y: m.t - 6, width: b2 - a, height: H - m.b - m.t + 6 }, svg);
  }
  el('path', { class: 'area-ciclos', d: `${camino(linea)}L${x(T.at(-1))},${y(0)}L${x(T[0])},${y(0)}Z` }, svg);
  el('path', { class: 'linea-ciclos', d: camino(linea) }, svg);
  const ultimo = { pico: -1e9, valle: -1e9 }, nivelEtq = { pico: 0, valle: 0 };
  D.eventos.forEach((e, i) => {
    const arriba = e.kind === 'pico', lado = arriba ? 'pico' : 'valle', xe = x(e.t);
    // si el rótulo anterior del mismo lado está demasiado cerca, este se desplaza una línea
    nivelEtq[lado] = xe - ultimo[lado] < 90 ? nivelEtq[lado] + 1 : 0;
    ultimo[lado] = xe;
    const dy = (arriba ? -10 : 18) + (arriba ? -13 : 13) * nivelEtq[lado];
    el('text', { class: 'etq-evento', x: xe, y: y(e.precio) + dy, 'text-anchor': 'middle' }, svg).textContent = W < 560 ? e.date.slice(0, 4) : e.corto;
    const c = el('circle', { class: 'marca-evento', cx: x(e.t), cy: y(e.precio), r: 5, tabindex: -1 }, svg);
    c.addEventListener('pointerenter', () => { resaltarEvento(i); tooltipEn(tip, cont, x(e.t), y(e.precio) - 8, `${fechaLarga(e.date)}<strong>${e.title}</strong>${dolares(e.precio)}`); });
    c.addEventListener('pointerleave', () => { resaltarEvento(null); tip.hidden = true; });
  });
}

// ---------------------------------------------------------------------------
// Cómo funciona el modelo
// ---------------------------------------------------------------------------
function pintarModelo() {
  const e = D.estado;
  $('pasos').innerHTML = `
    <li class="paso">
      <h3>Lee los últimos ${e.ventana_dias} días del mercado</h3>
      <p>Cada día le llegan ${e.variables_modelo} señales, agrupadas en cuatro familias:</p>
      <ul>
        <li>Cómo se movieron el Brent, el WTI, el gas, el oro y el cobre</li>
        <li>El dólar y el yuan</li>
        <li>Cuánto se agita el precio y lo lejos que está de su máximo del año</li>
        <li>El miedo en bolsa (VIX) y los tipos del Banco Central Europeo</li>
      </ul>
    </li>
    <li class="paso">
      <h3>Una red recurrente las recorre en orden</h3>
      <p>Igual que al leer una frase, la red avanza día a día y recuerda lo que fue importante de los días anteriores.</p>
      <p>Probamos tres tipos de red (RNN simple, LSTM y GRU) en las mismas condiciones, y elegimos la que mejor funcionó en años que no usó para aprender.</p>
    </li>
    <li class="paso">
      <h3>Calcula cuánto cambiará el precio</h3>
      <p>Hay un modelo para cada plazo: 5, 63 y 252 días de mercado, es decir, una semana, tres meses y un año.</p>
      <p>El rango probable sale de los errores que cometió en los años de validación, y está pensado para acertar 8 de cada 10 veces.</p>
    </li>`;
}
function pintarComparacion() {
  const z = PLAZOS[estado.plazo];
  const filas = D.comparativa.filas.filter(f => f.horizonte === estado.plazo);
  const tope = Math.max(2, ...filas.map(f => Math.abs(f.mejora_pct)));
  const barra = v => {
    const w = (Math.abs(v) / tope) * 50;
    return `<div class="barra-div" aria-hidden="true"><span class="${v >= 0 ? 'pos' : 'neg'}" style="left:${v >= 0 ? 50 : 50 - w}%;width:${w}%"></span></div>`;
  };
  const ajustada = filas.find(f => f.final && f.modelo.includes(', peso'));
  const nombre = m => (m === 'Ingenuo' ? 'Sin modelo (el precio de hoy)' : nombreModelo(m));
  $('comparacion').innerHTML = `
    <h3>Las tres redes frente a no usar modelo, ${z.corto}</h3>
    <p class="ayuda">Mismos datos de prueba (${new Date(D.estado.inicio_test).getFullYear()}-2026), que ninguna vio al entrenar. El modelo de cada plazo se eligió antes, con los años de validación. Barra a la derecha: se equivoca menos que sin modelo.</p>
    <div class="desplazable">
      <table class="tabla">
        <thead><tr><th>Modelo</th><th>Error medio (MAE)</th><th>RMSE</th><th class="col-mejora">Frente a no usar modelo (RMSE)</th><th>Parámetros</th><th>Entrenamiento</th></tr></thead>
        <tbody>${filas.map(f => `<tr class="${f.final ? 'elegido' : ''}">
          <th scope="row">${nombre(f.modelo)}${f.final ? '<small>elegida</small>' : ''}</th>
          <td>${dolares(f.mae)}</td><td>${dolares(f.rmse)}</td>
          <td class="col-mejora">${f.modelo === 'Ingenuo' ? '—' : `${barra(f.mejora_pct)}${frente(f.mejora_pct, true)}`}</td>
          <td>${f.parametros ? f0.format(f.parametros) : '—'}</td>
          <td>${f.tiempo_s == null ? '—' : `${f1.format(f.tiempo_s)} s`}</td></tr>`).join('')}</tbody>
      </table>
    </div>
    ${ajustada ? `<p class="nota-tabla">La versión ajustada multiplica el cambio que predice la red por ${ajustada.modelo.split('peso ')[1]}, un peso fijado en validación para no sobreactuar cuando la red aporta poco.</p>` : ''}`;
  $('lab-test').innerHTML = $('comparacion').innerHTML;
}

// ---------------------------------------------------------------------------
// Datos: estado, descargas y actualización (las acciones las atiende el servidor de Python)
// ---------------------------------------------------------------------------
function pintarDatos() {
  const e = D.estado;
  const descargado = new Date(e.descargado);
  $('estado-datos').innerHTML = `
    <h3>Qué datos usa</h3>
    <dl class="ficha">
      <dt>Último precio</dt><dd>${fechaLarga(e.hasta)}</dd>
      <dt>Descargados</dt><dd>${fechaLarga(descargado)}, a las ${descargado.toTimeString().slice(0, 5)}</dd>
      <dt>Histórico</dt><dd>Desde el ${fechaLarga(e.desde)}, ${f0.format(e.filas)} días de mercado</dd>
      <dt>Fuentes</dt><dd>${e.series} series de Yahoo Finance y de la Reserva Federal de St. Louis (FRED)</dd>
      <dt>Modelo</dt><dd>${e.modelo}</dd>
    </dl>
    <div class="botones">
      <button class="boton boton-borde" type="button" id="csv-prevision">Descargar la previsión (CSV)</button>
      <button class="boton boton-borde" type="button" id="csv-historico">Descargar el histórico (CSV)</button>
    </div>`;
  $('actualizar').innerHTML = `
    <h3>Traer los datos de hoy</h3>
    <div class="accion">
      <div class="fila"><strong>Actualizar los datos</strong><button class="boton boton-claro" type="button" data-accion="actualizar">Actualizar datos</button></div>
      <p>Descarga los precios hasta hoy y recalcula la previsión con el modelo actual. Tarda unos segundos.</p>
    </div>
    <div class="accion">
      <div class="fila"><strong>Reentrenar el modelo</strong><button class="boton boton-borde" type="button" data-accion="reentrenar">Reentrenar</button></div>
      <p>Vuelve a entrenar la red con todos los datos disponibles. Tarda varios minutos; mientras tanto el panel sigue mostrando la previsión anterior.</p>
    </div>
    <p class="aviso" id="aviso-datos" role="status"></p>`;
  $('csv-prevision').addEventListener('click', () => {
    const p = D.prediccion;
    const filas = [['plazo', 'fecha_objetivo', 'precio_previsto_usd', 'rango_bajo_usd', 'rango_alto_usd', 'variacion_pct', 'fiabilidad']];
    for (const [k, h] of Object.entries(p.horizontes)) filas.push([PLAZOS[k].nombre, h.fecha_objetivo, h.precio, h.rango80[0], h.rango80[1], h.variacion_pct, nivel(h).etiqueta]);
    descargar(`prevision_brent_${p.fecha_dato}.csv`, filas);
  });
  $('csv-historico').addEventListener('click', () => {
    const h = D.historico;
    descargar(`brent_historico_${D.estado.hasta}.csv`, [['fecha', 'brent_usd'], ...h.fechas.map((f, i) => [f, h.precios[i]])]);
  });
  $('actualizar').querySelectorAll('[data-accion]').forEach(b => b.addEventListener('click', () => accion(b)));
}
function descargar(nombre, filas) {
  const csv = filas.map(f => f.join(',')).join('\n');
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: nombre });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function accion(boton) {
  const aviso = $('aviso-datos'), tipo = boton.dataset.accion, texto = boton.textContent;
  boton.disabled = true;
  boton.textContent = tipo === 'actualizar' ? 'Actualizando…' : 'Reentrenando…';
  aviso.textContent = '';
  try {
    const r = await fetch(`api/${tipo}`, { method: 'POST' });
    if (!r.ok) throw new Error(String(r.status));
    const res = await r.json();
    aviso.textContent = res.mensaje ?? 'Hecho. Recarga la página para ver las cifras nuevas.';
  } catch {
    aviso.textContent = 'Esta copia de la web no tiene el servidor de Python encendido, así que solo muestra los datos guardados. En la versión publicada este botón descarga los datos nuevos y recalcula la previsión.';
  } finally {
    boton.disabled = false;
    boton.textContent = texto;
  }
}

// ---------------------------------------------------------------------------
// Navegación: barra sólida al bajar y sección activa
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Terminal: la página "trader". Gráfica avanzada con capas, zoom y comparación,
// cinta de mercados, libro de previsiones y atajos de teclado (solo en esta página).
// Los datos extra (velas, comparación) se cargan la primera vez que se abre.
// ---------------------------------------------------------------------------
const term = { rango: '1A', dom: null, log: false, medias: false, redes: false, velas: false, comparar: '', listo: false,
  herr: 'mover', borrador: null, dibujos: [], juego: null, calc: null };
const clase = x => (x > 0 ? 'sube' : x < 0 ? 'baja' : '');
const flecha = x => (x > 0 ? '▲' : x < 0 ? '▼' : '=');
function mediaMovil(P, n) {
  const out = new Array(P.length).fill(null);
  let s = 0;
  for (let i = 0; i < P.length; i++) { s += P[i]; if (i >= n) s -= P[i - n]; if (i >= n - 1) out[i] = s / n; }
  return out;
}
let preparando = null;
function prepararTerminal() {
  preparando ??= (async () => {
    const leer = n => fetch(`datos/${n}.json`).then(r => (r.ok ? r.json() : null)).catch(() => null);
    const [comparar, velas] = await Promise.all([leer('comparar'), leer('velas')]);
    Object.assign(D, { comparar, velas });
    D.mm50 = mediaMovil(D.historico.precios, 50);
    D.mm200 = mediaMovil(D.historico.precios, 200);
    if (D.velas) D.velas.t = D.velas.fechas.map(f => aFecha(f).getTime());
    D.indice = new Map(D.historico.fechas.map((f, i) => [f, i]));
    montarTerminal();
    montarHerramientas();
    montarPractica();
    term.listo = true;
  })();
  return preparando;
}

function pintarCinta() {
  const A = D.activos?.activos ?? [];
  $('cinta-items').innerHTML = A.map(a => `<span class="tic"><b>${a.corto}</b><span class="v">${nf(a.decimales).format(a.hoy)}${a.unidad ? ` ${a.unidad}` : ''}</span><span class="${clase(a.d1_pct)}">${flecha(a.d1_pct)} ${pct(a.d1_pct, 2)}</span></span>`).join('');
  const p = D.prediccion, dias = Math.round((Date.now() - aFecha(p.fecha_dato).getTime()) / 864e5);
  const fresco = dias <= 2 ? 'verde' : dias <= 5 ? 'naranja' : 'rojo';
  $('cinta-dato').innerHTML = `<i class="punto-estado ${fresco}" aria-hidden="true"></i>Cierre del ${fechaCorta(p.fecha_dato)}${dias > 1 ? `, hace ${dias} días` : ''}`;
}

// lateral: libro de previsiones, precio de referencia y señales
function pintarLateral() {
  const p = D.prediccion;
  $('t-libro').innerHTML = `
    <h3>Previsiones del modelo</h3>
    <table class="tabla tabla-libro">
      <thead><tr><th>Plazo</th><th>Previsión</th><th>Var.</th><th>Rango 80 %</th><th><span class="oculto">Fiabilidad</span></th></tr></thead>
      <tbody>${Object.entries(PLAZOS).map(([k, z]) => {
        const h = p.horizontes[k], n = nivel(h);
        return `<tr class="${k === estado.plazo ? 'elegido' : ''}" data-plazo="${k}" tabindex="0" aria-label="${z.nombre}: ${f0.format(h.precio)} dólares">
          <th scope="row">${z.nombre}<small>${fechaCorta(h.fecha_objetivo)}</small></th>
          <td>${f2.format(h.precio)}</td><td class="${clase(h.variacion_pct)}">${pct(h.variacion_pct)}</td>
          <td>${f0.format(h.rango80[0])}–${f0.format(h.rango80[1])}</td>
          <td><i class="punto-estado ${n.clase}" title="${n.etiqueta}"></i></td></tr>`;
      }).join('')}</tbody>
    </table>`;
  $('t-libro').querySelectorAll('tr[data-plazo]').forEach(tr => {
    tr.addEventListener('click', () => elegir(tr.dataset.plazo));
    tr.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); elegir(tr.dataset.plazo); } });
  });

  const h = p.horizontes[estado.plazo], dist = distribucion(h), u = estado.umbral;
  const arriba = dist.superar(u) * 100, sube = dist.superar(p.precio_hoy) * 100;
  const b = D.backtest.horizontes[estado.plazo];
  $('t-ref').innerHTML = `
    <h3>Precio de referencia ${PLAZOS[estado.plazo].corto}</h3>
    <div class="ref-fila">
      <button class="mini-boton" type="button" data-paso="-5" aria-label="Bajar 5 dólares">−5</button>
      <span class="num ref-valor">${u} $</span>
      <button class="mini-boton" type="button" data-paso="5" aria-label="Subir 5 dólares">+5</button>
    </div>
    <dl class="datos-ficha">
      <dt>Acaba por encima</dt><dd>${f0.format(arriba)} %</dd>
      <dt>Acaba por debajo</dt><dd>${f0.format(100 - arriba)} %</dd>
      <dt>Probabilidad de que suba</dt><dd>${f0.format(sube)} %</dd>
      <dt>Sin modelo</dt><dd>${f2.format(p.precio_hoy)} $</dd>
      <dt>Modelo</dt><dd>${h.modelo}</dd>
      <dt>Frente a sin modelo (RMSE)</dt><dd>${frente(h.mejora_vs_ingenuo_pct, true)}</dd>
      <dt>Error medio (MAE)</dt><dd>${f2.format(b.error_medio)} $ <small class="pctl">sin modelo ${f2.format(b.error_medio_ingenuo)}</small></dd>
      <dt>Acierto de dirección</dt><dd>${f0.format(b.acierto_direccion_pct)} %</dd>
    </dl>`;
  $('t-ref').querySelectorAll('[data-paso]').forEach(btn => btn.addEventListener('click', () => {
    const lim = limitesUmbral(h);
    estado.umbral = Math.min(Math.max(estado.umbral + Number(btn.dataset.paso), lim.min), lim.max);
    pintarLateral(); graficaTerminal(); pintarUmbral(false);
  }));

  $('t-senales').innerHTML = `<h3>Señales</h3><dl class="datos-ficha">${D.mercado.indicadores.map(i =>
    `<dt>${i.nombre.replace(' (VIX)', '')}</dt><dd>${i.unidad === '%' ? `${nf(i.decimales).format(i.hoy)} %` : i.unidad === '$' ? `${nf(i.decimales).format(i.hoy)} $` : nf(i.decimales).format(i.hoy)} <small class="pctl">p${f0.format(i.percentil * 100)}</small></dd>`).join('')}</dl>
    <p class="nota">p = percentil desde 2000: p92 es más alto que el 92 % de los días.</p>`;
}

function pintarTablaTerminal() {
  const A = D.activos, tabla = $('t-tabla');
  if (!A) { tabla.closest('.tarjeta').hidden = true; return; }
  const celda = v => `<td class="${clase(v)}">${pct(v, 1)}</td>`;
  tabla.innerHTML = `<thead><tr><th>Activo</th><th>Último</th><th>1 día</th><th>1 mes</th><th>3 meses</th><th>Percentil</th><th class="col-mini">Último año</th></tr></thead>
    <tbody>${A.activos.map(a => {
      const x = escala(0, a.serie.length - 1, 2, 116), y = escala(Math.min(...a.serie), Math.max(...a.serie), 25, 3);
      return `<tr><th scope="row">${a.nombre}</th><td>${nf(a.decimales).format(a.hoy)}${a.unidad ? ` ${a.unidad}` : ''}</td>${celda(a.d1_pct)}${celda(a.m1_pct)}${celda(a.m3_pct)}
        <td>p${f0.format(a.percentil * 100)}</td>
        <td class="col-mini"><svg class="chispa" width="120" height="28" viewBox="0 0 120 28" aria-hidden="true"><path d="${camino(a.serie.map((v, i) => [x(i), y(v)]))}"/></svg></td></tr>`;
    }).join('')}</tbody>`;
}

function pintarTerminal() {
  if (!term.listo) return;
  graficaTerminal();
  pintarLateral();
}

const RANGOS = { '1M': 30, '3M': 91, '6M': 182, '1A': 365, '5A': 1826, 'Máx': 0 };
const DIA = 864e5;
function limitesUmbral(h) {
  return { min: Math.floor((h.rango80[0] * 0.8) / 5) * 5, max: Math.ceil((h.rango80[1] * 1.15) / 5) * 5 };
}
const iHoyT = () => (term.juego?.activo ? term.juego.i : D.historico.t.length - 1);
function dominioT() {
  if (term.dom) return term.dom;
  const T = D.historico.t;
  if (term.juego?.activo) { // en el juego la gráfica sigue al día actual y deja un hueco a la derecha
    const t1 = T[term.juego.i] + 30 * DIA, d = RANGOS[term.rango] || 182;
    return { t0: t1 - d * DIA, t1 };
  }
  const tHoy = T.at(-1), tObj = aFecha(D.prediccion.horizontes[estado.plazo].fecha_objetivo).getTime();
  const d = RANGOS[term.rango] ?? 365;
  const t0 = d ? tHoy - d * DIA : T[0];
  return { t0, t1: tObj + (tObj - t0) * 0.02 };
}
function fijarDominioT(t0, t1) {
  const min = D.historico.t[0], max = aFecha(D.prediccion.horizontes.largo.fecha_objetivo).getTime() + 40 * DIA;
  const ancho = Math.min(Math.max(t1 - t0, 20 * DIA), max - min);
  t0 = Math.min(Math.max(t0, min), max - ancho);
  term.dom = { t0, t1: t0 + ancho };
  term.rango = null;
  marcarRangoT();
}
function marcarRangoT() {
  $('t-rangos').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.rango === term.rango)));
}
function zoomT(f, tc) {
  const d = dominioT();
  tc ??= (d.t0 + d.t1) / 2;
  fijarDominioT(tc - (tc - d.t0) * f, tc + (d.t1 - tc) * f);
  graficaTerminal();
}

let tg = null; // lo que necesita la interacción de la última pintura
function graficaTerminal() {
  const cont = $('t-g'), svg = cont.querySelector('svg');
  if (!cont.clientWidth) return;
  const p = D.prediccion, h = p.horizontes[estado.plazo], z = PLAZOS[estado.plazo];
  const T = D.historico.t, P = D.historico.precios, iHoy = iHoyT(), tHoy = T[iHoy], tObj = aFecha(h.fecha_objetivo).getTime();
  const enJuego = !!term.juego?.activo;
  const { t0: tIni, t1: tFin } = dominioT();
  svg.setAttribute('aria-label', `Precio del Brent hoy ${dolares(p.precio_hoy)}. Previsión ${z.corto}: ${f0.format(h.precio)} $, entre ${f0.format(h.rango80[0])} y ${f0.format(h.rango80[1])} $.`);
  const W = cont.clientWidth, H = W < 560 ? 260 : 380, m = { t: 14, r: W < 560 ? 62 : 84, b: 26, l: 40 };
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('height', H);
  svg.replaceChildren();

  // histórico visible
  const i0 = busqueda(T, Math.max(tIni, T[0])), i1 = busqueda(T, Math.min(Math.max(tFin, T[0]), tHoy));
  const paso = Math.max(1, Math.floor((i1 - i0) / 900));
  const idx = [];
  for (let i = i0; i <= i1; i += paso) idx.push(i);
  if (idx.at(-1) !== i1) idx.push(i1);

  // comparación en base 100: todo lo del Brent se multiplica por k y el otro activo por k2
  const otra = term.comparar ? D.comparar?.[term.comparar] : null;
  let k = 1, k2 = null, j0 = i0;
  if (otra) {
    k = 100 / P[i0];
    while (j0 < i1 && otra.valores[j0] == null) j0++;
    if (otra.valores[j0] != null) k2 = 100 / otra.valores[j0];
  }
  const tr = term.log ? Math.log : v => v;
  const tray = trayectoria(h);
  const prev = Array.from({ length: 41 }, (_, i) => { const t = tHoy + (tObj - tHoy) * i / 40; return [t, tray(t)]; });
  const prevVis = enJuego ? [] : prev.filter(d => d[0] >= tIni && d[0] <= tFin);
  const finVisible = !enJuego && tObj <= tFin && tObj >= tIni;

  // velas: solo si caben (el futuro del Brent tiene dos años de datos diarios)
  let velas = [];
  if (term.velas && D.velas) {
    for (let i = 0; i < D.velas.t.length; i++) if (D.velas.t[i] >= tIni && D.velas.t[i] <= Math.min(tFin, tHoy)) velas.push(i);
    if (velas.length > 420 || tIni < D.velas.t[0] - 20 * DIA) velas = [];
  }

  const redes = term.redes && p.redes && finVisible
    ? [['Hoy', p.precio_hoy], ...Object.entries(p.redes).filter(([n]) => n !== p.horizontes[estado.plazo].red).map(([n, v]) => [n.replace(' simple', ''), v[estado.plazo]])]
    : [];

  const ys = [...idx.map(i => P[i] * k), ...prevVis.flatMap(d => [d[1].lo * k, d[1].hi * k]), ...redes.map(r => r[1] * k)];
  if (term.medias) for (const i of idx) { if (D.mm50[i] != null) ys.push(D.mm50[i] * k); if (D.mm200[i] != null) ys.push(D.mm200[i] * k); }
  if (k2) for (const i of idx) if (otra.valores[i] != null) ys.push(otra.valores[i] * k2);
  for (const i of velas) ys.push(D.velas.h[i] * k, D.velas.l[i] * k);
  const vmin = Math.min(...ys), vmax = Math.max(...ys);
  const yM = marcas(vmin, vmax, H < 300 ? 4 : 5);
  const yLo = term.log ? vmin * 0.96 : yM.ini, yHi = term.log ? vmax * 1.04 : yM.fin;
  const ey = escala(tr(yLo), tr(yHi), H - m.b, m.t), y = v => ey(tr(v));
  const x = escala(tIni, tFin, m.l, W - m.r);
  ejes(svg, { W, H, m, y, yMarcas: yM.lista.filter(v => v >= yLo && v <= yHi), x, xMarcas: marcasTiempo(tIni, tFin) });

  const recorte = el('clipPath', { id: 'recorte-t' }, el('defs', {}, svg));
  el('rect', { x: m.l, y: m.t - 6, width: W - m.l - m.r, height: H - m.t - m.b + 6 }, recorte);
  const g = el('g', { 'clip-path': 'url(#recorte-t)' }, svg);

  if (prevVis.length > 1) el('path', { class: 'banda', d: `${camino(prev.map(d => [x(d[0]), y(d[1].hi * k)]))}${camino(prev.slice().reverse().map(d => [x(d[0]), y(d[1].lo * k)])).replace('M', 'L')}Z` }, g);
  if (tHoy >= tIni && tHoy <= tFin) {
    el('line', { class: 'divisoria', x1: x(tHoy), x2: x(tHoy), y1: m.t, y2: H - m.b }, g);
    el('text', { x: x(tHoy) - 6, y: m.t + 4, 'text-anchor': 'end' }, g).textContent = enJuego ? fechaCorta(new Date(tHoy)) : 'Hoy';
    if (enJuego) {
      el('rect', { class: 'futuro-oculto', x: x(tHoy), y: m.t - 6, width: Math.max(0, W - m.r - x(tHoy)), height: H - m.t - m.b + 6 }, g);
      el('text', { class: 'etq-futuro', x: (x(tHoy) + W - m.r) / 2, y: (m.t + H - m.b) / 2, 'text-anchor': 'middle' }, g).textContent = 'Futuro oculto';
    }
  }
  if (term.medias) {
    for (const [serie, cls] of [[D.mm200, 'mm200'], [D.mm50, 'mm50']]) {
      const pts = idx.filter(i => serie[i] != null).map(i => [x(T[i]), y(serie[i] * k)]);
      if (pts.length > 1) el('path', { class: cls, d: camino(pts) }, g);
    }
  }
  if (k2) {
    const pts = idx.filter(i => otra.valores[i] != null).map(i => [x(T[i]), y(otra.valores[i] * k2)]);
    if (pts.length > 1) el('path', { class: 'linea-comp', d: camino(pts) }, g);
  }
  if (idx.length > 1) el('path', { class: `linea-real${velas.length ? ' tenue' : ''}`, d: camino(idx.map(i => [x(T[i]), y(P[i] * k)])) }, g);
  if (velas.length) {
    const V = D.velas, w = Math.max(1, Math.min(9, ((x(V.t[velas.at(-1)]) - x(V.t[velas[0]])) / velas.length) * 0.62));
    for (const i of velas) {
      const cls = `vela ${V.c[i] >= V.o[i] ? 'sube' : 'baja'}`, xx = x(V.t[i]);
      el('line', { class: cls, x1: xx, x2: xx, y1: y(V.h[i] * k), y2: y(V.l[i] * k) }, g);
      const a = y(Math.max(V.o[i], V.c[i]) * k), b = y(Math.min(V.o[i], V.c[i]) * k);
      el('rect', { class: cls, x: xx - w / 2, y: a, width: w, height: Math.max(1, b - a) }, g);
    }
  }
  if (!otra) for (const e of D.eventos.filter(e => e.t >= tIni && e.t <= Math.min(tHoy, tFin))) {
    el('circle', { class: 'marca-evento', cx: x(e.t), cy: y(e.precio), r: 4 }, g);
    el('text', { class: 'etq-evento', x: x(e.t), y: y(e.precio) + (e.kind === 'pico' ? -10 : 18), 'text-anchor': 'middle' }, g).textContent = e.corto;
  }
  for (const [, v] of redes) el('path', { class: 'linea-red', 'stroke-dasharray': '2 3', d: camino([[x(tHoy), y(p.precio_hoy * k)], [x(tObj), y(v * k)]]) }, g);
  if (prevVis.length > 1) el('path', { class: 'linea-prev disc', d: camino(prev.map(d => [x(d[0]), y(d[1].c * k)])) }, g);
  if (tHoy >= tIni && tHoy <= tFin) el('circle', { class: 'punto', cx: x(tHoy), cy: y(P[iHoy] * k), r: 5, fill: 'var(--texto)' }, g);

  // rótulos al final de la previsión, separados para que no se pisen
  if (finVisible) {
    el('circle', { class: 'punto', cx: x(tObj), cy: y(h.precio * k), r: 5, fill: 'var(--ambar)' }, svg);
    const rot = [
      { yy: y(h.precio * k), txt: `${f0.format(h.precio)} $`, cls: 'etq-dato' },
      { yy: y(h.rango80[1] * k), txt: `${f0.format(h.rango80[1])} $` },
      { yy: y(h.rango80[0] * k), txt: `${f0.format(h.rango80[0])} $` },
      ...redes.map(([n, v]) => ({ yy: y(v * k), txt: `${n} ${f0.format(v)}` })),
    ].sort((a, b) => a.yy - b.yy);
    for (let i = 1; i < rot.length; i++) if (rot[i].yy - rot[i - 1].yy < 13) rot[i].yy = rot[i - 1].yy + 13;
    for (const r of rot) { const t = el('text', { x: x(tObj) + 9, y: r.yy + 4 }, svg); if (r.cls) t.setAttribute('class', r.cls); t.textContent = r.txt; }
  }

  // línea de precio: se arrastra y dice la probabilidad de acabar por encima
  const lim = limitesUmbral(h);
  let yUmbral = null;
  if (!otra && !enJuego && estado.umbral != null && estado.umbral > yLo && estado.umbral < yHi) {
    yUmbral = y(estado.umbral);
    const pr = distribucion(h).superar(estado.umbral) * 100;
    el('line', { class: 'linea-umbral', x1: m.l, x2: W - m.r, y1: yUmbral, y2: yUmbral }, svg);
    el('text', { class: 'etq-umbral', x: m.l + 6, y: yUmbral - 5 }, svg).textContent =
      `${estado.umbral} $: ${pr < 1 ? 'menos del 1' : pr > 99 ? 'más del 99' : f0.format(pr)} % de acabar por encima`;
  }

  const cruz = el('line', { class: 'cruz', y1: m.t, y2: H - m.b, visibility: 'hidden' }, svg);
  const punto = el('circle', { class: 'punto', r: 5, visibility: 'hidden' }, svg);
  const ancho = W - m.r - m.l;
  tg = {
    cont, m, W, H, tIni, tFin, tHoy, tObj, x, y, k, k2, otra, j0, i0, tray, h, lim, yUmbral, cruz, punto, velas: velas.length > 0,
    tDe: px => tIni + ((px - m.l) / ancho) * (tFin - tIni),
    vDe: py => { const u = tr(yLo) + ((py - (H - m.b)) / (m.t - (H - m.b))) * (tr(yHi) - tr(yLo)); return term.log ? Math.exp(u) : u; },
    dentro: (px, py) => px >= m.l && px <= W - m.r && py >= m.t && py <= H - m.b,
  };
  dibujarOperaciones(g);
  dibujarMarcas(g);
  leyendaTerminal();
  lecturaTerminal(null);
}

function leyendaTerminal() {
  const partes = ['<span><i class="l"></i>Precio real</span>', '<span><i class="l disc"></i>Previsión</span>', '<span><i class="b"></i>Rango probable</span>'];
  if (term.medias) partes.push('<span><i class="l mm50"></i>Media de 50 días</span>', '<span><i class="l mm200"></i>Media de 200 días</span>');
  if (tg.otra) partes.push(`<span><i class="l comp"></i>${tg.otra.nombre} (los dos empiezan en 100)</span>`);
  if (term.redes) partes.push('<span><i class="l" style="background:repeating-linear-gradient(90deg,var(--texto-2) 0 2px,transparent 2px 5px)"></i>Otras redes y precio de hoy</span>');
  if (term.velas) partes.push(tg.velas ? '<span>Velas: futuro del Brent, día a día</span>' : '<span>Velas: acerca la gráfica a los dos últimos años</span>');
  $('t-leyenda').innerHTML = partes.join('');
}

// lectura fija sobre la gráfica (en vez de un tooltip que tapa los datos)
function lecturaTerminal(px) {
  const T = D.historico.t, P = D.historico.precios, F = D.historico.fechas;
  const t = px == null ? tg.tHoy : tg.tDe(px);
  let html, tx, vy;
  if (t <= tg.tHoy || term.juego?.activo) {
    const i = Math.min(busqueda(T, Math.max(t, T[0])), iHoyT());
    tx = T[i]; vy = P[i] * tg.k;
    const ev = D.eventos.find(e => Math.abs(e.t - tx) < 12 * DIA);
    html = `<span><b>${fechaCorta(F[i])}</b></span><span>Brent <b>${dolares(P[i])}</b></span>`;
    if (i > 0) { const c = (P[i] / P[i - 1] - 1) * 100; html += `<span class="${clase(c)}">${flecha(c)} ${pct(c, 2)}</span>`; }
    if (term.medias && D.mm50[i] != null) html += `<span>Media 50: <b>${f1.format(D.mm50[i])}</b></span>`;
    if (term.medias && D.mm200[i] != null) html += `<span>Media 200: <b>${f1.format(D.mm200[i])}</b></span>`;
    if (tg.k2 && tg.otra.valores[i] != null) {
      html += `<span>Desde el inicio: Brent <b>${pct(P[i] * tg.k - 100)}</b>, ${tg.otra.nombre} <b>${pct(tg.otra.valores[i] * tg.k2 - 100)}</b></span>`;
    }
    if (ev && px != null) html += `<span>${ev.title}</span>`;
    tg.punto.setAttribute('fill', 'var(--texto)');
  } else {
    tx = Math.min(t, tg.tObj);
    const v = tg.tray(tx); vy = v.c * tg.k;
    html = `<span><b>${fechaCorta(new Date(tx))}</b></span><span>Previsión <b>${f0.format(v.c)} $</b></span><span>entre ${f0.format(v.lo)} y ${f0.format(v.hi)} $</span>`;
    tg.punto.setAttribute('fill', 'var(--ambar)');
  }
  $('t-lectura').innerHTML = html;
  const ver = px == null ? 'hidden' : 'visible';
  tg.cruz.setAttribute('x1', tg.x(tx)); tg.cruz.setAttribute('x2', tg.x(tx)); tg.cruz.setAttribute('visibility', ver);
  tg.punto.setAttribute('cx', tg.x(tx)); tg.punto.setAttribute('cy', tg.y(vy)); tg.punto.setAttribute('visibility', ver);
}

function montarTerminal() {
  const cont = $('t-g');
  $('t-rangos').innerHTML = Object.keys(RANGOS).map(r => `<button type="button" data-rango="${r}" aria-pressed="${r === term.rango}">${r}</button>`).join('');
  $('t-rangos').addEventListener('click', ev => {
    const b = ev.target.closest('button'); if (!b) return;
    term.rango = b.dataset.rango; term.dom = null;
    marcarRangoT(); graficaTerminal();
  });
  $('t-capas').addEventListener('click', ev => { const b = ev.target.closest('button'); if (b) capaTerminal(b.dataset.capa); });
  if (!D.velas) $('t-capas').querySelector('[data-capa="velas"]').hidden = true;
  if (!D.prediccion.redes) $('t-capas').querySelector('[data-capa="redes"]').hidden = true;
  const sel = $('t-comparar');
  if (D.comparar) sel.insertAdjacentHTML('beforeend', Object.entries(D.comparar).map(([c, v]) => `<option value="${c}">${v.nombre}</option>`).join(''));
  else sel.hidden = true;
  sel.addEventListener('change', () => { term.comparar = sel.value; graficaTerminal(); });
  $('t-zoom-mas').addEventListener('click', () => zoomT(0.7));
  $('t-zoom-menos').addEventListener('click', () => zoomT(1 / 0.7));

  let gesto = null;
  const pos = ev => { const r = cont.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
  const cercaUmbral = (px, py) => tg.yUmbral != null && tg.dentro(px, py) && Math.abs(py - tg.yUmbral) < 8;
  cont.addEventListener('pointerdown', ev => {
    const [px, py] = pos(ev);
    if (term.herr !== 'mover') { if (tg.dentro(px, py)) { ev.preventDefault(); clicHerramienta(px, py); } return; }
    if (ev.pointerType === 'touch') { if (tg.dentro(px, py)) lecturaTerminal(px); return; }
    if (!tg.dentro(px, py)) return;
    gesto = cercaUmbral(px, py) ? { tipo: 'umbral' } : { tipo: 'mover', x: ev.clientX, t0: tg.tIni, t1: tg.tFin, ancho: tg.W - tg.m.l - tg.m.r };
    cont.setPointerCapture(ev.pointerId);
  });
  cont.addEventListener('pointermove', ev => {
    const [px, py] = pos(ev);
    if (!gesto) {
      if (term.borrador && tg.dentro(px, py)) { term.borrador.cursor = puntoDesde(px, py, term.borrador.tipo); graficaTerminal(); }
      if (ev.pointerType === 'touch') return;
      cont.style.cursor = term.herr !== 'mover' ? 'crosshair' : cercaUmbral(px, py) ? 'ns-resize' : '';
      if (tg.dentro(px, py)) lecturaTerminal(px); else lecturaTerminal(null);
      return;
    }
    if (gesto.tipo === 'umbral') {
      estado.umbral = Math.round(Math.min(Math.max(tg.vDe(py), tg.lim.min), tg.lim.max));
      graficaTerminal(); pintarUmbral(false); pintarLateral();
    } else {
      const dt = -((ev.clientX - gesto.x) / gesto.ancho) * (gesto.t1 - gesto.t0);
      if (Math.abs(ev.clientX - gesto.x) < 3) return;
      cont.style.cursor = 'grabbing';
      fijarDominioT(gesto.t0 + dt, gesto.t1 + dt);
      graficaTerminal();
    }
  });
  const soltar = () => { gesto = null; if (term.herr === 'mover') cont.style.cursor = ''; };
  cont.addEventListener('pointerup', soltar);
  cont.addEventListener('pointercancel', soltar);
  cont.addEventListener('pointerleave', ev => { if (!gesto && ev.pointerType !== 'touch') lecturaTerminal(null); });
  cont.addEventListener('dblclick', () => { term.dom = null; term.rango = '1A'; marcarRangoT(); graficaTerminal(); });
  cont.addEventListener('wheel', ev => {
    if (!(ev.ctrlKey || ev.metaKey)) return; // sin tecla, la rueda sigue moviendo la página
    ev.preventDefault();
    const [px] = pos(ev);
    zoomT(Math.exp(ev.deltaY * 0.01), tg.tDe(px));
  }, { passive: false });
}
function capaTerminal(nombre) {
  const b = $('t-capas').querySelector(`[data-capa="${nombre}"]`);
  if (!b || b.hidden) return;
  term[nombre] = !term[nombre];
  b.setAttribute('aria-pressed', String(term[nombre]));
  graficaTerminal();
}


// ---------------------------------------------------------------------------
// Terminal: herramientas de análisis (puntos, líneas, niveles y comparar dos días)
// Las marcas se guardan en el navegador con su fecha y su precio, así siguen en su
// sitio al mover o acercar la gráfica, y al volver otro día.
// ---------------------------------------------------------------------------
const HERRAMIENTAS = {
  mover: { nombre: 'Mover', ayuda: 'Arrastra para desplazarte. Ctrl + rueda para acercar.' },
  punto: { nombre: 'Punto', ayuda: 'Pulsa en la gráfica para marcar un día con su precio.' },
  linea: { nombre: 'Línea', ayuda: 'Pulsa dos puntos para trazar una línea de tendencia.' },
  horizontal: { nombre: 'Nivel', ayuda: 'Pulsa a la altura de un precio para fijar un soporte o una resistencia.' },
  medir: { nombre: 'Comparar días', ayuda: 'Pulsa dos días para ver cuánto cambió el precio entre ellos.' },
};
const CLAVE_MARCAS = 'brent-marcas';
function cargarMarcas() { try { return JSON.parse(localStorage.getItem(CLAVE_MARCAS) || '[]'); } catch { return []; } }
function guardarMarcas() { try { localStorage.setItem(CLAVE_MARCAS, JSON.stringify(term.dibujos)); } catch { /* sin almacenamiento: duran hasta recargar */ } }

// punto anclado al cierre del día más cercano (nunca más allá del día actual del juego)
function anclaDia(t) {
  const T = D.historico.t, P = D.historico.precios;
  const i = Math.min(busqueda(T, t), iHoyT());
  return { t: T[i], v: P[i], i };
}
function puntoDesde(px, py, tipo) {
  if (tipo === 'punto' || tipo === 'medir') return anclaDia(tg.tDe(px));
  if (tipo === 'horizontal') return { v: tg.vDe(py) / tg.k };
  return { t: tg.tDe(px), v: tg.vDe(py) / tg.k };
}
function medida(a, b) {
  const [p, q] = a.t <= b.t ? [a, b] : [b, a];
  return { p, q, dif: q.v - p.v, pct: (q.v / p.v - 1) * 100, dias: Math.round((q.t - p.t) / DIA), habiles: Math.abs(q.i - p.i) };
}
function clicHerramienta(px, py) {
  const tipo = term.herr, pt = puntoDesde(px, py, tipo);
  if (tipo === 'punto' || tipo === 'horizontal') term.dibujos.push({ tipo, ...pt });
  else if (!term.borrador) term.borrador = { tipo, a: pt, cursor: pt };
  else { term.dibujos.push({ tipo, a: term.borrador.a, b: pt }); term.borrador = null; }
  guardarMarcas(); graficaTerminal(); pintarMarcas();
}
function elegirHerramienta(h) {
  term.herr = h; term.borrador = null;
  $('t-herr').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.herr === h)));
  $('t-herr-ayuda').textContent = HERRAMIENTAS[h].ayuda;
  $('t-g').style.cursor = h === 'mover' ? '' : 'crosshair';
  graficaTerminal();
}
function montarHerramientas() {
  term.dibujos = cargarMarcas();
  $('t-herr').innerHTML = Object.entries(HERRAMIENTAS).map(([k, v]) => `<button type="button" data-herr="${k}" aria-pressed="${k === term.herr}">${v.nombre}</button>`).join('');
  $('t-herr').addEventListener('click', ev => { const b = ev.target.closest('button'); if (b) elegirHerramienta(b.dataset.herr); });
  $('t-deshacer').addEventListener('click', () => { if (term.borrador) term.borrador = null; else term.dibujos.pop(); guardarMarcas(); graficaTerminal(); pintarMarcas(); });
  $('t-borrar').addEventListener('click', () => { term.dibujos = []; term.borrador = null; guardarMarcas(); graficaTerminal(); pintarMarcas(); });
  $('t-marcas').addEventListener('click', ev => {
    const b = ev.target.closest('[data-quitar]'); if (!b) return;
    term.dibujos.splice(Number(b.dataset.quitar), 1); guardarMarcas(); graficaTerminal(); pintarMarcas();
  });
  $('t-herr-ayuda').textContent = HERRAMIENTAS[term.herr].ayuda;
  pintarMarcas();
}
const fechaC = t => fechaCorta(new Date(t));
function textoMarca(d) {
  const P = D.historico.precios;
  if (d.tipo === 'punto') return `<b>${fechaC(d.t)}</b>: ${dolares(d.v)}`;
  if (d.tipo === 'horizontal') {
    const hoy = P[iHoyT()], dif = (d.v / hoy - 1) * 100;
    return `Nivel en <b>${dolares(d.v)}</b>: ${Math.abs(dif) < 0.05 ? 'justo en el precio de hoy' : `un ${f1.format(Math.abs(dif))} % ${dif > 0 ? 'por encima' : 'por debajo'} del precio del día`}`;
  }
  if (d.tipo === 'linea') {
    const [p, q] = d.a.t <= d.b.t ? [d.a, d.b] : [d.b, d.a];
    const meses = Math.max((q.t - p.t) / (30.44 * DIA), 0.01), ritmo = (q.v - p.v) / meses;
    return `Línea del <b>${fechaC(p.t)}</b> al <b>${fechaC(q.t)}</b>: de ${f0.format(p.v)} a ${f0.format(q.v)} $, unos ${signo(ritmo)}${f1.format(Math.abs(ritmo))} $ al mes`;
  }
  const r = medida(d.a, d.b);
  return `Del <b>${fechaC(r.p.t)}</b> al <b>${fechaC(r.q.t)}</b>: <span class="${clase(r.dif)}">${signo(r.dif)}${f2.format(Math.abs(r.dif))} $ (${pct(r.pct)})</span> en ${r.dias} días (${r.habiles} de mercado)`;
}
function pintarMarcas() {
  const lista = $('t-marcas');
  lista.innerHTML = term.dibujos.map((d, i) => `<li><span class="tipo-marca ${d.tipo}" aria-hidden="true"></span><span>${textoMarca(d)}</span>
    <button type="button" class="quitar" data-quitar="${i}" aria-label="Quitar esta marca">×</button></li>`).join('');
  lista.hidden = !term.dibujos.length;
}
// rótulo con fondo para que se lea encima de las líneas
function rotulo(padre, x, y, texto, cls = '', ancla = 'start') {
  const g = el('g', { class: `rotulo-svg ${cls}` }, padre);
  const t = el('text', { x, y, 'text-anchor': ancla }, g);
  t.textContent = texto;
  const b = t.getBBox();
  g.insertBefore(el('rect', { x: b.x - 5, y: b.y - 3, width: b.width + 10, height: b.height + 6, rx: 4 }), t);
  return g;
}
function dibujarMarcas(g) {
  const { x, y, k, m, W, H } = tg;
  const capa = el('g', { class: 'capa-marcas' }, g);
  const lista = term.dibujos.map(d => ({ ...d }));
  if (term.borrador?.cursor) lista.push({ tipo: term.borrador.tipo, a: term.borrador.a, b: term.borrador.cursor, provisional: true });
  for (const d of lista) {
    const prov = d.provisional ? ' provisional' : '';
    if (d.tipo === 'punto') {
      el('circle', { class: 'm-punto', cx: x(d.t), cy: y(d.v * k), r: 5 }, capa);
      rotulo(capa, x(d.t), y(d.v * k) - 12, `${fechaC(d.t)}: ${f2.format(d.v)} $`, '', 'middle');
    } else if (d.tipo === 'horizontal') {
      el('line', { class: 'm-nivel', x1: m.l, x2: W - m.r, y1: y(d.v * k), y2: y(d.v * k) }, capa);
      rotulo(capa, W - m.r - 6, y(d.v * k) - 7, `${f2.format(d.v)} $`, '', 'end');
    } else if (d.tipo === 'linea') {
      el('line', { class: `m-linea${prov}`, x1: x(d.a.t), y1: y(d.a.v * k), x2: x(d.b.t), y2: y(d.b.v * k) }, capa);
      for (const q of [d.a, d.b]) el('circle', { class: 'm-asa', cx: x(q.t), cy: y(q.v * k), r: 3.5 }, capa);
    } else if (d.tipo === 'medir') {
      const r = medida(d.a, d.b), x0 = x(r.p.t), x1 = x(r.q.t);
      el('rect', { class: `m-zona ${r.dif >= 0 ? 'sube' : 'baja'}${prov}`, x: x0, y: m.t - 6, width: Math.max(1, x1 - x0), height: H - m.t - m.b + 6 }, capa);
      el('line', { class: `m-medida${prov}`, x1: x0, y1: y(r.p.v * k), x2: x1, y2: y(r.q.v * k) }, capa);
      for (const q of [r.p, r.q]) el('circle', { class: 'm-asa', cx: x(q.t), cy: y(q.v * k), r: 4 }, capa);
      rotulo(capa, (x0 + x1) / 2, m.t + 14, `${signo(r.dif)}${f2.format(Math.abs(r.dif))} $ (${pct(r.pct)}) en ${r.dias} días`, r.dif >= 0 ? 'sube' : 'baja', 'middle');
    }
  }
  if (term.borrador && !term.borrador.cursor) term.borrador.cursor = term.borrador.a;
}

// ---------------------------------------------------------------------------
// Practicar con dinero ficticio
// Las cuentas se hacen como un producto que sigue al Brent en dólares, pasado a euros
// con el cambio euro/dólar de cada día. Comisión del 0,1 % por operación.
// ---------------------------------------------------------------------------
const COMISION = 0.001;
const fx = i => { // dólares por euro el día i (el último conocido si ese día falta)
  const v = D.comparar?.eurusd?.valores;
  if (!v) return D.usdPorEur;
  for (let j = i; j >= 0; j--) if (v[j] != null) return v[j];
  return D.usdPorEur;
};
const fechaIso = i => D.historico.fechas[i];
const indiceDe = iso => { const T = D.historico.t; return busqueda(T, aFecha(iso).getTime()); };

function montarPractica() {
  $('t-modo').addEventListener('click', ev => {
    const b = ev.target.closest('button'); if (!b) return;
    $('t-modo').querySelectorAll('button').forEach(o => o.setAttribute('aria-selected', String(o === b)));
    $('t-calc').hidden = b.dataset.modo !== 'calc';
    $('t-juego').hidden = b.dataset.modo !== 'juego';
    if (b.dataset.modo === 'juego') { term.calc = null; pintarJuego(); } else { calcular(); }
    graficaTerminal();
  });
  montarCalculadora();
  pintarJuego();
}

// --- «Si hubiera invertido»
function montarCalculadora() {
  const ultimo = D.historico.fechas.length - 1;
  const haceUnAnio = indiceDe(new Date(D.historico.t[ultimo] - 365 * DIA).toISOString().slice(0, 10));
  $('t-calc').innerHTML = `
    <div class="calc">
      <div class="calc-campos">
        <label class="campo-mini">Cantidad<span class="entrada entrada-mini"><input id="c-cantidad" inputmode="decimal" value="100"><span>€</span></span></label>
        <label class="campo-mini">Compras el<input type="date" id="c-desde" min="${fechaIso(0)}" max="${fechaIso(ultimo)}" value="${fechaIso(haceUnAnio)}"></label>
        <label class="campo-mini">Vendes el<input type="date" id="c-hasta" min="${fechaIso(0)}" max="${fechaIso(ultimo)}" value="${fechaIso(ultimo)}"></label>
        <div class="campo-mini">Apuestas a que
          <div class="segmentos" role="group" aria-label="Dirección" id="c-dir">
            <button type="button" data-dir="1" aria-pressed="true">Sube</button><button type="button" data-dir="-1" aria-pressed="false">Baja</button>
          </div></div>
        <div class="campo-mini">Apalancamiento
          <div class="segmentos" role="group" aria-label="Apalancamiento" id="c-apal">
            ${[1, 2, 5, 10].map(a => `<button type="button" data-apal="${a}" aria-pressed="${a === 1}">×${a}</button>`).join('')}
          </div></div>
      </div>
      <div class="calc-atajos">Desde
        ${[['1 mes', 30], ['6 meses', 182], ['1 año', 365], ['5 años', 1826]].map(([n, d]) => `<button type="button" class="mini-boton" data-atras="${d}">hace ${n}</button>`).join('')}
        ${D.eventos.filter(e => e.kind === 'valle').map(e => `<button type="button" class="mini-boton" data-fecha="${e.date}">${e.corto}</button>`).join('')}
      </div>
      <div class="calc-resultado" id="c-resultado" aria-live="polite"></div>
    </div>`;
  const tc = $('t-calc');
  tc.addEventListener('input', () => { term.verCalc = true; calcular(); });
  tc.addEventListener('click', ev => {
    const b = ev.target.closest('button'); if (!b) return;
    term.verCalc = true;
    if (b.dataset.dir) tc.querySelectorAll('[data-dir]').forEach(o => o.setAttribute('aria-pressed', String(o === b)));
    if (b.dataset.apal) tc.querySelectorAll('[data-apal]').forEach(o => o.setAttribute('aria-pressed', String(o === b)));
    if (b.dataset.atras) { $('c-desde').value = fechaIso(indiceDe(new Date(D.historico.t.at(-1) - Number(b.dataset.atras) * DIA).toISOString().slice(0, 10))); $('c-hasta').value = fechaIso(D.historico.fechas.length - 1); }
    if (b.dataset.fecha) { $('c-desde').value = fechaIso(indiceDe(b.dataset.fecha)); $('c-hasta').value = fechaIso(D.historico.fechas.length - 1); }
    calcular();
  });
  calcular();
}
function calcular() {
  if (!$('c-cantidad')) return;
  const P = D.historico.precios;
  const eur = Math.max(0, Number($('c-cantidad').value.replace(/\./g, '').replace(',', '.')) || 0);
  let a = indiceDe($('c-desde').value || fechaIso(0)), b = indiceDe($('c-hasta').value || fechaIso(P.length - 1));
  if (b < a) [a, b] = [b, a];
  const dir = Number($('t-calc').querySelector('[data-dir][aria-pressed="true"]').dataset.dir);
  const apal = Number($('t-calc').querySelector('[data-apal][aria-pressed="true"]').dataset.apal);
  const out = $('c-resultado');
  if (!eur || a === b) { out.innerHTML = '<p class="nota">Elige una cantidad y dos fechas distintas.</p>'; term.calc = null; graficaTerminal(); return; }
  // en dólares: la posición mueve «apal» veces lo que se mueve el barril; si el saldo llega a cero, se liquida
  const usd0 = eur * fx(a), barriles = (usd0 * apal) / P[a], com = usd0 * apal * COMISION;
  let peor = { v: usd0, i: a }, liquidado = null;
  for (let i = a; i <= b; i++) {
    const saldo = usd0 - com + dir * barriles * (P[i] - P[a]);
    if (saldo < peor.v) peor = { v: saldo, i };
    if (saldo <= 0) { liquidado = i; break; }
  }
  // al vender se paga otra vez la comisión, sobre lo que vale la posición ese día
  const saldoUsd = liquidado != null ? 0 : Math.max(0, usd0 - com + dir * barriles * (P[b] - P[a]) - barriles * P[b] * COMISION);
  const finalEur = saldoUsd / fx(b), gan = finalEur - eur, rent = (finalEur / eur - 1) * 100;
  const sinCambio = saldoUsd / fx(a) - eur; // lo que habría sido sin el movimiento del euro
  term.calc = { a, b, ok: true };
  out.innerHTML = `
    <div class="caso central"><span class="etq">Tendrías el ${fechaCorta(fechaIso(b))}</span><span class="num">${f2.format(finalEur)} €</span>
      <span class="dif ${clase(gan)}">${signo(gan)}${f2.format(Math.abs(gan))} € (${pct(rent)})</span></div>
    <div class="caso"><span class="etq">El barril</span><span class="num">${f0.format(P[a])} → ${f0.format(P[b])} $</span>
      <span class="dif">${pct((P[b] / P[a] - 1) * 100)} en ${f1.format((D.historico.t[b] - D.historico.t[a]) / (365.25 * DIA))} años</span></div>
    <div class="caso"><span class="etq">Peor momento</span><span class="num">${f0.format(peor.v / fx(peor.i))} €</span>
      <span class="dif">el ${fechaCorta(fechaIso(peor.i))}${liquidado != null ? ', y ahí se perdió todo' : ''}</span></div>
    <div class="caso"><span class="etq">Efecto del euro</span><span class="num">${signo(gan - sinCambio)}${f0.format(Math.abs(gan - sinCambio))} €</span>
      <span class="dif">por el cambio euro/dólar (${f2.format(fx(a))} → ${f2.format(fx(b))})</span></div>
    ${liquidado != null ? `<p class="aviso-liquidado">Con apalancamiento ×${apal}, el ${fechaCorta(fechaIso(liquidado))} el barril se movió en tu contra lo suficiente para perder todo el dinero: el bróker habría cerrado la operación.</p>` : ''}
    <p class="nota">Supone un producto que sigue al Brent al contado, convertido a euros con el cambio de cada día y con una comisión del 0,1 % al comprar y al vender. No incluye impuestos ni el coste de mantener la posición abierta.</p>`;
  graficaTerminal();
}

// --- «Modo práctica»: un día del pasado, 10.000 € ficticios y el futuro oculto
const INICIOS = [
  ['Crisis de 2008', '2008-07-01'], ['Exceso de oferta', '2014-07-01'], ['COVID-19', '2020-01-15'],
  ['Ucrania', '2022-01-14'], ['Periodo de pruebas del modelo', '2024-01-02'],
];
function senalModelo(i) { // previsión a una semana que dio el modelo ese día (solo en el periodo de pruebas)
  const b = D.backtest.horizontes.corto;
  if (!b || !D.indice) return null;
  b.porOrigen ??= new Map(b.fechas.map((f, j) => [D.indice.get(f) - D.prediccion.horizontes.corto.dias_habiles, j]));
  const j = b.porOrigen.get(i);
  return j == null ? null : b.previsto[j];
}
function valorJuego(j, i) { return (j.cajaUsd + j.barriles * D.historico.precios[i]) / fx(i); }
function pintarJuego() {
  const j = term.juego, cont = $('t-juego');
  if (!cont) return;
  const P = D.historico.precios;
  if (!j?.activo && !j?.fin) {
    cont.innerHTML = `
      <div class="juego-inicio">
        <p>Empiezas un día del pasado con dinero ficticio. La gráfica se corta en ese día, así que no ves lo que pasó después: compras o vendes y avanzas el tiempo para descubrirlo. Al final te comparamos con comprar y no tocar nada.</p>
        <div class="calc-atajos">Empezar en ${INICIOS.map(([n, f]) => `<button type="button" class="mini-boton" data-inicio="${f}">${n}</button>`).join('')}</div>
        <div class="calc-campos">
          <label class="campo-mini">O elige el día<input type="date" id="j-desde" min="${fechaIso(250)}" max="${fechaIso(P.length - 60)}" value="2020-01-15"></label>
          <label class="campo-mini">Dinero inicial<span class="entrada entrada-mini"><input id="j-capital" inputmode="decimal" value="10000"><span>€</span></span></label>
          <button class="boton boton-claro" type="button" id="j-empezar">Empezar</button>
        </div>
      </div>`;
    cont.querySelectorAll('[data-inicio]').forEach(b => b.addEventListener('click', () => { $('j-desde').value = b.dataset.inicio; empezarJuego(); }));
    $('j-empezar').addEventListener('click', empezarJuego);
    $('t-aviso-juego').hidden = true;
    return;
  }
  const i = j.i, valor = valorJuego(j, i), gan = valor - j.capital, expo = j.barriles * P[i] / fx(i);
  const senal = senalModelo(i);
  const ultimo = P.length - 1;
  $('t-aviso-juego').hidden = !j.activo;
  $('t-aviso-juego').innerHTML = `Modo práctica: estás en el <b>${fechaLarga(fechaIso(i))}</b>. Lo que pasó después está oculto.`;
  if (j.fin) { pintarFinJuego(); return; }
  cont.innerHTML = `
    <div class="juego">
      <div class="juego-dia">
        <span class="etq">${fechaLarga(fechaIso(i))}</span>
        <span class="num">${f2.format(P[i])} $</span>
        <span class="dif ${clase(i > 0 ? P[i] - P[i - 1] : 0)}">${i > 0 ? `${pct((P[i] / P[i - 1] - 1) * 100, 2)} en el día` : ''}</span>
        ${senal != null ? `<span class="senal">El modelo decía para dentro de una semana: <b>${f2.format(senal)} $</b> (${senal > P[i] ? 'sube' : 'baja'})</span>` : ''}
      </div>
      <div class="juego-cartera">
        <div><span class="etq">Tu dinero</span><span class="num">${f2.format(valor)} €</span><span class="dif ${clase(gan)}">${signo(gan)}${f2.format(Math.abs(gan))} € (${pct((valor / j.capital - 1) * 100)})</span></div>
        <div><span class="etq">Sin invertir</span><b>${f2.format(j.cajaUsd / fx(i))} €</b></div>
        <div><span class="etq">Invertido en Brent</span><b class="${clase(j.barriles)}">${j.barriles >= 0 ? '' : 'a la baja: '}${f2.format(Math.abs(expo))} €</b><small>${f2.format(Math.abs(j.barriles))} barriles</small></div>
      </div>
      <div class="juego-acciones">
        <label class="campo-mini">Importe<span class="entrada entrada-mini"><input id="j-importe" inputmode="decimal" value="${Math.round(j.capital / 4)}"><span>€</span></span></label>
        <div class="fila-botones">
          <button class="boton boton-compra" type="button" data-op="1">Comprar</button>
          <button class="boton boton-venta" type="button" data-op="-1">Vender</button>
          <button class="mini-boton" type="button" data-op="0">Cerrar posición</button>
        </div>
        <div class="fila-botones">
          <span class="etq">Avanzar</span>
          ${[['1 día', 1], ['1 semana', 5], ['1 mes', 21], ['3 meses', 63]].map(([n, d]) => `<button class="mini-boton" type="button" data-avanzar="${d}" ${i + d > ultimo ? 'disabled' : ''}>${n}</button>`).join('')}
          <button class="mini-boton" type="button" id="j-terminar">Terminar</button>
        </div>
        <p class="nota">Vender sin tener barriles abre una apuesta a la baja: ganas si el precio cae. Máximo, tu dinero: sin apalancamiento.</p>
      </div>
    </div>
    ${j.ops.length ? `<ol class="juego-ops">${j.ops.slice(-6).reverse().map(o => `<li><span class="${o.tipo === 'Compra' ? 'sube' : o.tipo === 'Venta' ? 'baja' : ''}">${o.tipo}</span> el ${fechaCorta(fechaIso(o.i))}: ${f2.format(o.eur)} € a ${f2.format(o.precio)} $</li>`).join('')}</ol>` : ''}`;
  cont.querySelectorAll('[data-op]').forEach(b => b.addEventListener('click', () => operar(Number(b.dataset.op))));
  cont.querySelectorAll('[data-avanzar]').forEach(b => b.addEventListener('click', () => avanzar(Number(b.dataset.avanzar))));
  $('j-terminar').addEventListener('click', () => { term.juego.fin = true; term.juego.activo = false; term.dom = null; pintarJuego(); graficaTerminal(); });
}
function empezarJuego() {
  const P = D.historico.precios;
  const i0 = Math.min(Math.max(indiceDe($('j-desde').value || '2020-01-15'), 250), P.length - 60);
  const capital = Math.max(100, Number(($('j-capital')?.value ?? '10000').replace(/\./g, '').replace(',', '.')) || 10000);
  term.juego = { activo: true, fin: false, i0, i: i0, capital, cajaUsd: capital * fx(i0), barriles: 0, ops: [] };
  term.dom = null; term.rango = '6M'; marcarRangoT();
  pintarJuego(); graficaTerminal(); pintarLateral();
}
function operar(dir) {
  const j = term.juego, P = D.historico.precios, i = j.i, precio = P[i];
  if (dir === 0) { // cerrar: vuelve todo a efectivo
    if (!j.barriles) return;
    const usd = j.barriles * precio;
    j.cajaUsd += usd - Math.abs(usd) * COMISION;
    j.ops.push({ tipo: 'Cierre', i, precio, eur: Math.abs(usd) / fx(i) });
    j.barriles = 0;
  } else {
    let eur = Math.max(0, Number(($('j-importe').value || '0').replace(/\./g, '').replace(',', '.')) || 0);
    // sin apalancamiento: la exposición total no puede pasar del valor de la cartera
    const valor = valorJuego(j, i), expo = j.barriles * precio / fx(i);
    const margen = dir > 0 ? valor - expo : valor + expo;
    eur = Math.min(eur, Math.max(0, margen));
    if (eur < 1) return;
    const usd = eur * fx(i);
    j.barriles += dir * usd / precio;
    j.cajaUsd -= dir * usd + usd * COMISION;
    j.ops.push({ tipo: dir > 0 ? 'Compra' : 'Venta', i, precio, eur });
  }
  pintarJuego(); graficaTerminal();
}
function avanzar(n) {
  const j = term.juego, ultimo = D.historico.precios.length - 1;
  j.i = Math.min(j.i + n, ultimo);
  if (valorJuego(j, j.i) <= 0) { j.barriles = 0; j.cajaUsd = 0; j.ops.push({ tipo: 'Liquidación', i: j.i, precio: D.historico.precios[j.i], eur: 0 }); }
  if (j.i === ultimo) { j.fin = true; j.activo = false; }
  term.dom = null;
  pintarJuego(); graficaTerminal(); pintarLateral();
}
function pintarFinJuego() {
  const j = term.juego, P = D.historico.precios, i0 = j.i0, i1 = j.i;
  const tuyo = valorJuego(j, i1);
  const mantener = (j.capital * fx(i0) * (1 - COMISION) / P[i0]) * P[i1] / fx(i1);
  // seguir al modelo: cada día se queda dentro si la previsión a una semana es mayor que el precio, si no, fuera
  let modelo = null;
  if (senalModelo(i0) != null) {
    let usd = j.capital * fx(i0), dentro = false;
    for (let i = i0; i < i1; i++) {
      const s = senalModelo(i), quiere = s != null ? s > P[i] : dentro;
      if (quiere !== dentro) { usd *= 1 - COMISION; dentro = quiere; }
      if (dentro) usd *= P[i + 1] / P[i];
    }
    modelo = usd / fx(i1);
  }
  const fila = (n, v, cls = '') => `<div class="caso ${cls}"><span class="etq">${n}</span><span class="num">${f2.format(v)} €</span><span class="dif ${clase(v - j.capital)}">${signo(v - j.capital)}${f2.format(Math.abs(v - j.capital))} € (${pct((v / j.capital - 1) * 100)})</span></div>`;
  $('t-aviso-juego').hidden = true;
  $('t-juego').innerHTML = `
    <div class="juego-fin">
      <h4>Del ${fechaLarga(fechaIso(i0))} al ${fechaLarga(fechaIso(i1))}</h4>
      <div class="tres">${fila('Tú', tuyo, 'central')}${fila('Comprar el primer día y no tocar nada', mantener)}${modelo != null ? fila('Seguir la señal del modelo cada día', modelo) : ''}</div>
      ${modelo == null ? '<p class="nota">La comparación con el modelo solo está disponible si empiezas en el periodo de pruebas (desde enero de 2024), donde tenemos lo que predijo cada día.</p>' : '<p class="nota">«Seguir al modelo» compra cuando su previsión a una semana está por encima del precio y vende cuando está por debajo.</p>'}
      <p class="nota">${j.ops.length} operaciones. Ya puedes ver en la gráfica lo que pasó después.</p>
      <button class="boton boton-claro" type="button" id="j-otra">Jugar otra vez</button>
    </div>`;
  $('j-otra').addEventListener('click', () => { term.juego = null; term.rango = '1A'; term.dom = null; marcarRangoT(); pintarJuego(); graficaTerminal(); pintarLateral(); });
}
// operaciones del juego y zona de la calculadora sobre la gráfica
function dibujarOperaciones(g) {
  const { x, y, k, m, H } = tg, P = D.historico.precios, T = D.historico.t;
  if (term.calc?.ok && term.verCalc && !term.juego) {
    const { a, b } = term.calc, x0 = x(T[a]), x1 = x(T[b]);
    el('rect', { class: `zona-calc ${P[b] >= P[a] ? 'sube' : 'baja'}`, x: Math.min(x0, x1), y: m.t - 6, width: Math.abs(x1 - x0), height: H - m.t - m.b + 6 }, g);
    for (const [i, txt] of [[a, 'Compra'], [b, 'Venta']]) {
      if (T[i] < tg.tIni || T[i] > tg.tFin) continue;
      el('circle', { class: 'm-asa', cx: x(T[i]), cy: y(P[i] * k), r: 4.5 }, g);
      const xi = x(T[i]);
      rotulo(g, xi, y(P[i] * k) - 12, txt, '', xi < m.l + 40 ? 'start' : xi > tg.W - tg.m.r - 40 ? 'end' : 'middle');
    }
  }
  for (const o of term.juego?.ops ?? []) {
    const xx = x(T[o.i]), yy = y(o.precio * k), arriba = o.tipo === 'Compra';
    if (o.tipo === 'Cierre' || o.tipo === 'Liquidación') { el('circle', { class: 'op-cierre', cx: xx, cy: yy, r: 5 }, g); continue; }
    el('path', { class: `op ${arriba ? 'sube' : 'baja'}`, d: arriba ? `M${xx},${yy + 6}l-6,10h12z` : `M${xx},${yy - 6}l-6,-10h12z` }, g);
  }
}

const VISTAS = {
  panel: null,
  escenarios: { titulo: 'Escenarios', sub: 'Añade un suceso a la previsión, calcula lo que te costaría y mira la probabilidad de que el barril cruce un precio.' },
  mercado: { titulo: 'Cómo está el mercado', sub: 'Cómo llega hoy el mercado: señales de tensión, otros activos y los ciclos del crudo desde 2000.' },
  fiabilidad: { titulo: 'Fiabilidad en el test', sub: 'Lo que dijo el modelo en el test (2024-2026) frente a lo que pasó de verdad.' },
  resultados: { titulo: 'Resultados del trabajo', sub: 'Entrenamiento, validación y test de las tres redes, con las cifras tal como salieron.' },
  terminal: { titulo: 'Terminal', sub: 'Todo a mano para quien sigue el mercado a diario: gráfica avanzada, capas, comparación con otros activos y atajos de teclado.' },
};
function repintar() {
  graficaBacktest(); graficaErrores(); graficaCiclos(); graficaCurvas(); graficaMiniPortada();
  pintarUmbral(false); pintarSimulador(); dibujarMinis();
}
// La web es un solo recorrido: Panel, Escenarios, Mercado, Fiabilidad y Resultados van uno debajo de
// otro y el menú baja hasta cada uno. La terminal se abre aparte, con su botón.
const RECORRIDO = ['panel', 'escenarios', 'mercado', 'fiabilidad', 'resultados'];
const APARTADOS = { ciclos: 'mercado', modelo: 'fiabilidad', datos: 'fiabilidad' };
let saltoActual = 0;
function marcarSeccion(v) {
  document.documentElement.classList.toggle('en-portada', v === 'panel');
  if (estado.vista === v && document.querySelector('.secciones a[aria-current="true"]')?.getAttribute('href') === `#${v}`) return;
  estado.vista = v;
  const info = VISTAS[v];
  document.title = info ? `${info.titulo} · Previsión Brent` : 'Previsión Brent';
  const enlaces = [...document.querySelectorAll('.secciones a')];
  enlaces.forEach(a => a.setAttribute('aria-current', String(a.getAttribute('href') === `#${v}`)));
  const activo = enlaces.find(a => a.getAttribute('href') === `#${v}`), menu = activo?.parentElement;
  if (menu && menu.scrollWidth > menu.clientWidth) menu.scrollTo({ left: activo.offsetLeft - (menu.clientWidth - activo.offsetWidth) / 2, behavior: 'smooth' });
}
function mostrar(v, suave = false) {
  const apartado = APARTADOS[v] ? v : null;
  if (apartado) v = APARTADOS[v];
  if (!(v in VISTAS)) v = 'panel';
  const terminal = v === 'terminal', modo = terminal ? 'terminal' : 'panel';
  const cambiaModo = document.documentElement.dataset.vista !== modo;
  document.documentElement.dataset.vista = modo;
  document.querySelectorAll('[data-vista]').forEach(e => {
    if (e !== document.documentElement) e.classList.toggle('activa', terminal ? e.dataset.vista === 'terminal' : e.dataset.vista !== 'terminal');
  });
  if (terminal) $('cab-titulo').textContent = VISTAS.terminal.titulo;
  marcarSeccion(v);
  if (cambiaModo) repintar();
  if (terminal) { scrollTo({ top: 0, behavior: 'instant' }); prepararTerminal().then(pintarTerminal); return; }
  // se baja hasta el título de la sección (o hasta el apartado, si la dirección lo nombra)
  const destino = apartado ? $(apartado) : v === 'panel' ? null : ($(v).querySelector('.vista-cab') ?? $(v));
  const comportamiento = suave && !cambiaModo && !reduceMotion ? 'smooth' : 'instant';
  const ir = () => (destino ? destino.scrollIntoView({ behavior: comportamiento, block: 'start' }) : scrollTo({ top: 0, behavior: comportamiento }));
  ir();
  // en un salto directo (al cargar o al volver de la terminal) las gráficas y las fuentes terminan de
  // colocarse un instante después y mueven la página: se reajusta, salvo que la persona ya esté bajando
  if (comportamiento === 'instant') {
    const turno = ++saltoActual;
    const soltar = () => { saltoActual += 1; };
    for (const ev of ['wheel', 'touchstart', 'keydown', 'pointerdown']) addEventListener(ev, soltar, { once: true, passive: true });
    for (const ms of [60, 250, 700, 1500]) setTimeout(() => { if (turno === saltoActual) ir(); }, ms);
  }
}
function navegacion() {
  const nav = $('nav');
  // cada sección del recorrido lleva su título, que antes iba en la cabecera
  for (const v of RECORRIDO.slice(1)) {
    $(v).insertAdjacentHTML('afterbegin', `<header class="vista-cab"><h2>${VISTAS[v].titulo}</h2><p>${VISTAS[v].sub}</p></header>`);
  }
  // al bajar, el menú marca la sección que se está viendo
  let pendienteSeccion = 0;
  const alBajar = () => {
    nav.classList.toggle('solida', scrollY > 40);
    if (document.documentElement.dataset.vista === 'terminal' || pendienteSeccion) return;
    pendienteSeccion = requestAnimationFrame(() => {
      pendienteSeccion = 0;
      const linea = nav.offsetHeight + innerHeight * 0.3;
      let actual = 'panel';
      for (const v of RECORRIDO.slice(1)) if ($(v).getBoundingClientRect().top <= linea) actual = v;
      marcarSeccion(actual);
    });
  };
  addEventListener('scroll', alBajar, { passive: true }); alBajar();
  addEventListener('hashchange', () => mostrar(location.hash.slice(1)));
  // los enlaces internos bajan con suavidad hasta su sección (también si la dirección ya era esa)
  document.addEventListener('click', ev => {
    const a = ev.target.closest('a[href^="#"]');
    if (!a || ev.defaultPrevented || ev.metaKey || ev.ctrlKey) return;
    const v = a.getAttribute('href').slice(1);
    if (!(v in VISTAS) && !(v in APARTADOS)) return;
    ev.preventDefault();
    history.pushState(null, '', `${location.pathname}${location.search}#${v}`);
    mostrar(v, true);
  });
  document.documentElement.style.setProperty('--alto-nav', `${nav.offsetHeight}px`);
}

// ---------------------------------------------------------------------------
// Mercado: tabla compacta de activos
// ---------------------------------------------------------------------------
function pintarTablaMercado() {
  const A = D.activos, tabla = $('tabla-mercado');
  if (!A) { tabla.closest('.tarjeta').hidden = true; tabla.closest('.tarjeta').previousElementSibling.hidden = true; return; }
  const celda = v => `<td>${pct(v, 1)}</td>`;
  tabla.innerHTML = `<thead><tr><th>Activo</th><th>Último</th><th>1 día</th><th>1 mes</th><th>3 meses</th><th class="col-pct">Frente a su historia desde 2000</th><th class="col-mini">Último año</th></tr></thead>
    <tbody>${A.activos.map(a => {
      const x = escala(0, a.serie.length - 1, 2, 116), y = escala(Math.min(...a.serie), Math.max(...a.serie), 25, 3);
      return `<tr><th scope="row">${a.nombre}</th><td>${nf(a.decimales).format(a.hoy)}${a.unidad ? ` ${a.unidad}` : ''}</td>${celda(a.d1_pct)}${celda(a.m1_pct)}${celda(a.m3_pct)}
        <td class="col-pct"><div class="percentil" role="img" aria-label="Más alto que el ${f0.format(a.percentil * 100)} % de los días"><b style="left:${(a.percentil * 100).toFixed(1)}%"></b></div><span class="mini-etq">Más alto que el ${f0.format(a.percentil * 100)} % de los días</span></td>
        <td class="col-mini"><svg class="chispa" width="120" height="28" viewBox="0 0 120 28" aria-hidden="true"><path d="${camino(a.serie.map((v, i) => [x(i), y(v)]))}"/></svg></td></tr>`;
    }).join('')}</tbody>`;
}

// ---------------------------------------------------------------------------
// Ciclos: variación de cada mes (el único sitio con verde y rojo, porque aquí el signo es el dato)
// ---------------------------------------------------------------------------
function pintarCalor() {
  const F = D.historico.fechas, P = D.historico.precios;
  const cierre = new Map(); // último precio de cada mes
  F.forEach((f, i) => cierre.set(f.slice(0, 7), P[i]));
  const meses = [...cierre.keys()];
  const ret = new Map();
  meses.forEach((c, i) => { if (i) ret.set(c, (cierre.get(c) / cierre.get(meses[i - 1]) - 1) * 100); });
  const color = (r, tope) => {
    const a = (Math.min(Math.abs(r) / tope, 1) * 0.75 + 0.08).toFixed(2);
    return r >= 0 ? `rgba(111,179,168,${a})` : `rgba(224,112,79,${a})`;
  };
  const nombres = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  let html = `<span class="cab"></span>${nombres.map(n => `<span class="cab">${n}</span>`).join('')}<span class="cab">año</span>`;
  const a0 = Number(meses[0].slice(0, 4)), a1 = Number(meses.at(-1).slice(0, 4));
  for (let a = a1; a >= a0; a--) {
    html += `<span class="anio">${a}</span>`;
    for (let mes = 1; mes <= 12; mes++) {
      const r = ret.get(`${a}-${String(mes).padStart(2, '0')}`);
      html += r == null ? '<span></span>' : `<span style="background:${color(r, 20)}" title="${nombres[mes - 1]} ${a}: ${pct(r)}">${signo(r)}${f0.format(Math.abs(r))}</span>`;
    }
    const fin = cierre.get(`${a}-12`) ?? cierre.get(meses.at(-1)), ini = cierre.get(`${a - 1}-12`);
    html += ini == null ? '<span></span>' : `<span class="total" style="background:${color((fin / ini - 1) * 100, 60)}" title="${a}: ${pct((fin / ini - 1) * 100)}">${signo(fin / ini - 1)}${f0.format(Math.abs((fin / ini - 1) * 100))}</span>`;
  }
  $('calor').innerHTML = html;
}

// ---------------------------------------------------------------------------
// Fiabilidad: error de cada previsión
// ---------------------------------------------------------------------------
function graficaErrores() {
  const cont = $('g-errores'), svg = cont.querySelector('svg');
  if (!cont.clientWidth) return;
  const b = D.backtest.horizontes[estado.plazo];
  const W = cont.clientWidth, H = 96, m = { t: 8, r: 16, b: 8, l: 40 };
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('height', H);
  svg.replaceChildren();
  const T = b.fechas.map(f => aFecha(f).getTime());
  const err = b.previsto.map((v, i) => v - b.real[i]);
  const tope = Math.ceil(Math.max(...err.map(Math.abs)) / 5) * 5;
  const x = escala(T[0], T.at(-1), m.l, W - m.r), y = escala(-tope, tope, H - m.b, m.t);
  for (const v of [tope, 0, -tope]) el('text', { x: m.l - 8, y: y(v) + 4, 'text-anchor': 'end' }, svg).textContent = `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)} $`;
  el('line', { class: 'linea-cero', x1: m.l, x2: W - m.r, y1: y(0), y2: y(0) }, svg);
  const w = Math.max(1, ((W - m.l - m.r) / T.length) * 0.8);
  for (const [cls, cond] of [['sobre', e => e > 0], ['bajo', e => e < 0]]) {
    el('path', { class: `barra-err ${cls}`, 'stroke-width': w.toFixed(2), d: err.map((e, i) => (cond(e) ? `M${x(T[i]).toFixed(1)},${y(0).toFixed(1)}V${y(e).toFixed(1)}` : '')).join('') }, svg);
  }
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------
try {
  await cargar();
} catch (err) {
  $('carga').innerHTML = '<div style="max-width:34rem;padding:24px;text-align:center"><strong style="color:var(--texto)">No se han podido cargar los datos.</strong><br>Comprueba la conexión y recarga la página. Si abriste el archivo directamente, arranca la web con <code>python3 PROTOTIPO_WEB/servir.py</code>.</div>';
  throw err;
}
pintarCabecera();
pintarPlazos();
pintarOleoducto();
pintarResultados();
// «Ver el detalle» baja al primer bloque sin cambiar de vista
$('resumen').addEventListener('click', ev => { const b = ev.target.closest('[data-plazo]'); if (b) elegir(b.dataset.plazo); });
montarCoste();
montarUmbral();
montarSimulador();
pintarMercado();
pintarCiclos();
pintarCalor();
pintarTablaMercado();
pintarCinta();
pintarTablaTerminal();
pintarModelo();
pintarDatos();
pintarPuertaTerminal();
navegacion();
mostrar(location.hash.slice(1));
pintarDependiente();
// con todo pintado las alturas ya son las definitivas: se vuelve a la sección de la dirección
if (location.hash.length > 1) mostrar(location.hash.slice(1));
// en móvil, tocar fuera de una gráfica cierra su tooltip
document.addEventListener('pointerdown', ev => {
  if (ev.pointerType !== 'touch') return;
  document.querySelectorAll('.grafica').forEach(g => { if (!g.contains(ev.target)) { const t = g.querySelector('.tooltip'); if (t) t.hidden = true; } });
});
document.addEventListener('keydown', ev => {
  if (estado.vista === 'terminal' && ev.key === 'Escape' && term.borrador) { term.borrador = null; graficaTerminal(); return; }
  if (estado.vista !== 'terminal' || ev.ctrlKey || ev.metaKey || ev.altKey || ev.target.closest?.('input, select, textarea, button')) return;
  const plazo = { 1: 'corto', 2: 'medio', 3: 'largo' }[ev.key];
  const capaT = { m: 'medias', r: 'redes', v: 'velas', l: 'log' }[ev.key.toLowerCase()];
  if (plazo) elegir(plazo);
  else if (capaT && term.listo) capaTerminal(capaT);
  else if ((ev.key === '+' || ev.key === '-') && term.listo) zoomT(ev.key === '+' ? 0.7 : 1 / 0.7);
  else if (ev.key === '0' && term.listo) { term.dom = null; term.rango = '1A'; marcarRangoT(); graficaTerminal(); }
});
let pendiente = 0, anchoPrevio = innerWidth;
addEventListener('resize', () => {
  if (innerWidth === anchoPrevio) return;
  anchoPrevio = innerWidth;
  cancelAnimationFrame(pendiente);
  pendiente = requestAnimationFrame(() => { repintar(); pintarTerminal(); document.documentElement.style.setProperty('--alto-nav', `${$('nav').offsetHeight}px`); });
});
$('carga').classList.add('lista');
