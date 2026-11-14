import { nivel } from './fiabilidad.js';

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
const chip = n => `<span class="chip ${n.clase}"><i aria-hidden="true">${n.icono}</i>${n.etiqueta}</span>`;

// ---------------------------------------------------------------------------
// Estado y datos
// ---------------------------------------------------------------------------
const estado = { plazo: 'medio', anios: 1, barriles: 10000, umbral: null, redes: false, vista: 'panel' };
{ // el plazo viaja en la dirección (?plazo=largo) para poder compartir el enlace tal cual se ve
  const q = new URLSearchParams(location.search).get('plazo');
  if (['corto', 'medio', 'largo'].includes(q)) estado.plazo = q;
}
let D;
const $ = id => document.getElementById(id);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

async function cargar() {
  const nombres = ['prediccion', 'historico', 'mercado', 'backtest', 'comparativa', 'eventos', 'estado'];
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
  $('hoy-precio').innerHTML = `${f2.format(p.precio_hoy)}<small>$</small>`;
  $('hoy-cambio').textContent = `${dif < 0 ? '▼' : '▲'} ${f2.format(Math.abs(dif))} $ (${pct(cambio, 2)}) frente al día anterior. Dato del ${fechaLarga(p.fecha_dato)}.`;
  const dias = Math.round((Date.now() - aFecha(p.fecha_dato).getTime()) / 864e5);
  $('sello-datos').textContent = `Datos del ${fechaCorta(p.fecha_dato)}${dias > 1 ? `, hace ${dias} días` : ''}. Modelo: ${p.modelo}`;
  $('hoy-mini').innerHTML = `${f2.format(p.precio_hoy)}<small>$</small>`;
}

function pintarPlazos() {
  const p = D.prediccion, vol = D.mercado.indicadores[0];
  const palabra = vol.percentil < 0.4 ? 'Baja' : vol.percentil < 0.7 ? 'Normal' : vol.percentil < 0.9 ? 'Alta' : 'Muy alta';
  $('plazos').innerHTML = Object.entries(PLAZOS).map(([k, z]) => {
    const h = p.horizontes[k];
    return `<button class="plazo" role="tab" type="button" data-plazo="${k}" aria-selected="${k === estado.plazo}" tabindex="${k === estado.plazo ? 0 : -1}">
      <span class="cab"><strong>${z.nombre}</strong><span>${fechaCorta(h.fecha_objetivo)}</span></span>
      <span class="num">${f0.format(h.precio)} $</span>
      <span class="var">${pct(h.variacion_pct)} frente a hoy</span>
      ${chip(nivel(h))}
      <span class="error">Error medio un ${f1.format(Math.abs(h.mejora_mae_vs_ingenuo_pct))} % ${h.mejora_mae_vs_ingenuo_pct >= 0 ? 'menor' : 'mayor'} que sin modelo</span>
    </button>`;
  }).join('') + `<a class="agitacion" href="#mercado">
      <span class="cab">Agitación del mercado</span>
      <span class="num">${palabra}</span>
      <span class="var">El precio se mueve más que el ${f0.format(vol.percentil * 100)} % de los días desde 2000</span>
    </a>`;
  $('nav-plazo').innerHTML = Object.entries({ corto: '1 semana', medio: '3 meses', largo: '1 año' })
    .map(([k, n]) => `<button type="button" data-plazo="${k}" aria-pressed="${k === estado.plazo}">${n}</button>`).join('');
  $('nav-plazo').addEventListener('click', ev => { const b = ev.target.closest('button'); if (b) elegir(b.dataset.plazo); });
  const botones = [...$('plazos').querySelectorAll('.plazo')];
  botones.forEach((b, i) => {
    b.addEventListener('click', () => elegir(b.dataset.plazo));
    b.addEventListener('keydown', ev => {
      const d = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      ev.preventDefault();
      const sig = botones[(i + d + botones.length) % botones.length];
      sig.focus(); elegir(sig.dataset.plazo);
    });
  });
}

function elegir(k) {
  if (k === estado.plazo) return;
  estado.plazo = k;
  term.dom = null;
  if (!term.rango) term.rango = '1A';
  const url = new URL(location.href);
  url.searchParams.set('plazo', k);
  history.replaceState(null, '', url);
  $('plazos').querySelectorAll('.plazo').forEach(b => {
    const si = b.dataset.plazo === k;
    b.setAttribute('aria-selected', si); b.tabIndex = si ? 0 : -1;
  });
  $('nav-plazo').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.plazo === k)));
  pintarDependiente();
}

function pintarDependiente() {
  graficaPrincipal();
  pintarLectura();
  pintarCoste();
  pintarUmbral();
  pintarSimulador();
  graficaBacktest();
  graficaErrores();
  pintarFiabilidad();
  pintarTerminal();
  pintarComparacion();
}

// ---------------------------------------------------------------------------
// Gráfica principal: histórico + abanico
// ---------------------------------------------------------------------------
function graficaPrincipal() {
  const cont = $('g-principal'), svg = cont.querySelector('svg'), tip = cont.querySelector('.tooltip');
  if (!cont.clientWidth) return;
  const h = D.prediccion.horizontes[estado.plazo], z = PLAZOS[estado.plazo];
  svg.setAttribute('aria-label', `Precio del Brent hoy ${dolares(D.prediccion.precio_hoy)}. Previsión ${z.corto}: ${f0.format(h.precio)} $, entre ${f0.format(h.rango80[0])} y ${f0.format(h.rango80[1])} $.`);
  svg.removeAttribute('aria-labelledby');
  $('g-titulo').textContent = `Brent ${estado.anios ? `en los últimos ${estado.anios === 1 ? 'doce meses' : `${estado.anios} años`}` : 'desde 2000'} y previsión ${z.corto}`;
  const W = cont.clientWidth, H = W < 560 ? 250 : 330, m = { t: 18, r: W < 560 ? 54 : 70, b: 26, l: 40 };
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('height', H);
  svg.replaceChildren();

  const T = D.historico.t, P = D.historico.precios, tHoy = T.at(-1);
  const tIni = estado.anios ? tHoy - estado.anios * 365.25 * 864e5 : T[0];
  const i0 = Math.max(0, busqueda(T, tIni));
  const paso = Math.max(1, Math.floor((T.length - i0) / 700));
  const hist = [];
  for (let i = i0; i < T.length; i += paso) hist.push([T[i], P[i]]);
  if (hist.at(-1)[0] !== tHoy) hist.push([tHoy, P.at(-1)]);

  const tObj = aFecha(h.fecha_objetivo).getTime();
  const tray = trayectoria(h);
  const prev = Array.from({ length: 41 }, (_, i) => { const t = tHoy + (tObj - tHoy) * i / 40; return [t, tray(t)]; });
  const tFin = tObj + (tObj - tIni) * 0.015;
  const p = D.prediccion;
  const redes = estado.redes && p.redes ? Object.entries(p.redes).filter(([n]) => n !== p.horizontes[estado.plazo].red).map(([n, v]) => [n.replace(' simple', ''), v[estado.plazo]]) : [];
  $('leyenda-redes').hidden = !redes.length;
  const ys = [...hist.map(d => d[1]), ...prev.flatMap(d => [d[1].lo, d[1].hi]), ...redes.map(r => r[1])];
  const yM = marcas(Math.min(...ys), Math.max(...ys), H < 300 ? 4 : 5);
  const x = escala(tIni, tFin, m.l, W - m.r), y = escala(yM.ini, yM.fin, H - m.b, m.t);

  ejes(svg, { W, H, m, y, yMarcas: yM.lista, x, xMarcas: marcasTiempo(tIni, tFin) });
  // abanico, histórico y previsión
  el('path', { class: 'banda', d: `${camino(prev.map(d => [x(d[0]), y(d[1].hi)]))}${camino(prev.slice().reverse().map(d => [x(d[0]), y(d[1].lo)])).replace('M', 'L')}Z` }, svg);
  el('line', { class: 'divisoria', x1: x(tHoy), x2: x(tHoy), y1: m.t, y2: H - m.b }, svg);
  el('text', { x: x(tHoy) - 6, y: m.t + 4, 'text-anchor': 'end' }, svg).textContent = 'Hoy';
  el('path', { class: 'linea-real', d: camino(hist.map(d => [x(d[0]), y(d[1])])) }, svg);
  for (const e of D.eventos.filter(e => e.t >= tIni && e.t <= tHoy)) {
    const arriba = e.kind === 'pico';
    el('circle', { class: 'marca-evento', cx: x(e.t), cy: y(e.precio), r: 4 }, svg);
    el('text', { class: 'etq-evento', x: x(e.t), y: y(e.precio) + (arriba ? -10 : 18), 'text-anchor': 'middle' }, svg).textContent = e.corto;
  }
  for (const [, v] of redes) el('path', { class: 'linea-red', d: camino([[x(tHoy), y(p.precio_hoy)], [x(tObj), y(v)]]) }, svg);
  el('path', { class: 'linea-prev disc', d: camino(prev.map(d => [x(d[0]), y(d[1].c)])) }, svg);
  el('circle', { class: 'punto', cx: x(tHoy), cy: y(P.at(-1)), r: 5, fill: 'var(--texto)' }, svg);
  el('circle', { class: 'punto', cx: x(tObj), cy: y(h.precio), r: 5, fill: 'var(--ambar)' }, svg);
  // rótulos al final del plazo, separados para que no se pisen
  const rot = [
    { yy: y(h.precio), txt: `${f0.format(h.precio)} $`, cls: 'etq-dato' },
    { yy: y(h.rango80[1]), txt: `${f0.format(h.rango80[1])} $` },
    { yy: y(h.rango80[0]), txt: `${f0.format(h.rango80[0])} $` },
    ...redes.map(([n, v]) => ({ yy: y(v), txt: `${n} ${f0.format(v)}` })),
  ].sort((a, b) => a.yy - b.yy);
  for (let i = 1; i < rot.length; i++) if (rot[i].yy - rot[i - 1].yy < 13) rot[i].yy = rot[i - 1].yy + 13;
  for (const r of rot) { const t = el('text', { x: x(tObj) + 9, y: r.yy + 4 }, svg); if (r.cls) t.setAttribute('class', r.cls); t.textContent = r.txt; }

  // línea de precio de referencia: la misma de «¿Y si cruza un precio?»; se arrastra en vertical
  const vDe = py => yM.ini + ((py - (H - m.b)) / (m.t - (H - m.b))) * (yM.fin - yM.ini);
  gp = { cont, m, W, H, vDe, yUmbral: null };

  // capa de interacción
  const cruz = el('line', { class: 'cruz', y1: m.t, y2: H - m.b, visibility: 'hidden' }, svg);
  const punto = el('circle', { class: 'punto', r: 5, visibility: 'hidden' }, svg);
  const zona = el('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: 'transparent' }, svg);
  if (estado.umbral != null && estado.umbral > yM.ini && estado.umbral < yM.fin) {
    const yu = y(estado.umbral), pr = distribucion(h).superar(estado.umbral) * 100;
    gp.yUmbral = yu;
    el('line', { class: 'linea-umbral', x1: m.l, x2: W - m.r, y1: yu, y2: yu }, svg);
    el('text', { class: 'etq-umbral', x: m.l + 6, y: yu - 6 }, svg).textContent =
      `${estado.umbral} $: ${pr < 1 ? 'menos del 1' : pr > 99 ? 'más del 99' : f0.format(pr)} % de acabar por encima`;
    el('rect', { class: 'asa-umbral', x: m.l, y: yu - 7, width: W - m.l - m.r, height: 14 }, svg);
  }
  const mover = ev => {
    if (arrastre) return;
    const r = svg.getBoundingClientRect(), px = ev.clientX - r.left;
    const t = tIni + ((px - m.l) / (W - m.r - m.l)) * (tFin - tIni);
    let tx, vy, html;
    if (t <= tHoy) {
      const i = busqueda(T, Math.max(t, tIni));
      tx = T[i]; vy = P[i];
      const ev = D.eventos.find(e => Math.abs(e.t - tx) < 20 * 864e5);
      html = `${fechaLarga(D.historico.fechas[i])}<strong>${dolares(vy)}</strong>${ev ? ev.title : ''}`;
      punto.setAttribute('fill', 'var(--texto)');
    } else {
      tx = Math.min(t, tObj);
      const v = tray(tx); vy = v.c;
      html = `Previsión, ${fechaLarga(new Date(tx))}<strong>${f0.format(v.c)} $</strong>Entre ${f0.format(v.lo)} y ${f0.format(v.hi)} $`;
      punto.setAttribute('fill', 'var(--ambar)');
    }
    cruz.setAttribute('x1', x(tx)); cruz.setAttribute('x2', x(tx));
    punto.setAttribute('cx', x(tx)); punto.setAttribute('cy', y(vy));
    cruz.setAttribute('visibility', 'visible'); punto.setAttribute('visibility', 'visible');
    tooltipEn(tip, cont, x(tx), y(vy), html);
  };
  zona.addEventListener('pointermove', mover);
  zona.addEventListener('pointerdown', mover);
  zona.addEventListener('pointerleave', ev => { if (ev.pointerType === 'touch') return; tip.hidden = true; cruz.setAttribute('visibility', 'hidden'); punto.setAttribute('visibility', 'hidden'); });
}

let gp = null, arrastre = false;
function montarGrafica() {
  const cont = $('g-principal');
  const posY = ev => ev.clientY - cont.getBoundingClientRect().top;
  cont.addEventListener('pointerdown', ev => {
    if (!gp || gp.yUmbral == null || Math.abs(posY(ev) - gp.yUmbral) > 8) return;
    arrastre = true;
    cont.setPointerCapture(ev.pointerId);
    cont.querySelector('.tooltip').hidden = true;
    ev.preventDefault();
  });
  cont.addEventListener('pointermove', ev => {
    if (!arrastre) return;
    const h = D.prediccion.horizontes[estado.plazo];
    const min = Math.floor((h.rango80[0] * 0.8) / 5) * 5, max = Math.ceil((h.rango80[1] * 1.15) / 5) * 5;
    const v = Math.round(Math.min(Math.max(gp.vDe(posY(ev)), min), max));
    if (v === estado.umbral) return;
    estado.umbral = v;
    graficaPrincipal();
    pintarUmbral(false);
  });
  const soltar = () => { arrastre = false; };
  cont.addEventListener('pointerup', soltar);
  cont.addEventListener('pointercancel', soltar);
  $('redes').addEventListener('click', () => {
    estado.redes = !estado.redes;
    $('redes').setAttribute('aria-pressed', String(estado.redes));
    graficaPrincipal();
  });
  if (!D.prediccion.redes) $('redes').hidden = true;
}

// ---------------------------------------------------------------------------
// Lectura rápida del plazo elegido
// ---------------------------------------------------------------------------
function pintarLectura() {
  const h = D.prediccion.horizontes[estado.plazo], z = PLAZOS[estado.plazo], n = nivel(h);
  $('lectura').innerHTML = `
    <div>
      <h3>${z.dentro}</h3>
      <p class="ayuda">${fechaLarga(h.fecha_objetivo)}</p>
    </div>
    <div class="num grande">${f0.format(h.precio)} $<small>${pct(h.variacion_pct)}</small></div>
    <dl class="datos-ficha">
      <dt>Rango probable (8 de cada 10 veces)</dt><dd>${f0.format(h.rango80[0])} – ${f0.format(h.rango80[1])} $</dd>
      <dt>Probabilidad de que suba</dt><dd>${f0.format(distribucion(h).superar(D.prediccion.precio_hoy) * 100)} %</dd>
      <dt>Error medio frente a no usar modelo</dt><dd>${f1.format(Math.abs(h.mejora_mae_vs_ingenuo_pct))} % ${h.mejora_mae_vs_ingenuo_pct >= 0 ? 'menos' : 'más'}</dd>
      <dt>Acertó si subiría o bajaría</dt><dd>${f0.format(D.backtest.horizontes[estado.plazo].acierto_direccion_pct)} % de las veces</dd>
    </dl>
    <div class="semaforo ${n.clase}"><i aria-hidden="true">${n.icono}</i><div><strong>${n.etiqueta}</strong>${n.frase}</div></div>
    <p class="uso"><strong>Cómo usarla.</strong> ${n.uso}</p>
    <p class="nota-plazo">${NOTAS[estado.plazo]}</p>
    <p class="riesgos">Puede romperla una decisión de la OPEP+, un conflicto en Oriente Medio, una recesión o un giro brusco del dólar.</p>`;
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
  $('umbral-r').addEventListener('input', ev => { estado.umbral = Number(ev.target.value); pintarUmbral(false); graficaPrincipal(); });
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
const N_CAMINOS = 600, N_DIBUJO = 70;
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
    banda.push([col[Math.floor(N_CAMINOS * 0.1)], col[Math.floor(N_CAMINOS * 0.5)], col[Math.floor(N_CAMINOS * 0.9)]]);
  }
  return { n, caminos, banda, k0 };
}

function montarSimulador() {
  const ctl = (id, etq, min, max, paso, pista) => `
    <div class="control"><label for="${id}">${etq}</label><output id="${id}-v" for="${id}"></output>
      <input type="range" id="${id}" min="${min}" max="${max}" step="${paso}"><span class="pista">${pista}</span></div>`;
  $('simulador').innerHTML = `
    <h3>Simula un suceso</h3>
    <p class="ayuda">El modelo no sabe qué va a pasar en el mundo. Añade un suceso a su previsión y mira cómo cambiarían ${N_CAMINOS} caminos posibles del precio.</p>
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
  el('path', { class: 'banda-sim', d: `${camino(r.banda.map((b, k) => [x(tk(k)), y(b[2])]))}${camino(r.banda.slice().reverse().map((b, k) => [x(tk(r.n - k)), y(b[0])])).replace('M', 'L')}Z` }, svg);
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
  const yM = marcas(Math.min(...b.real, ...b.previsto), Math.max(...b.real, ...b.previsto), 4);
  const x = escala(T[0], T.at(-1), m.l, W - m.r), y = escala(yM.ini, yM.fin, H - m.b, m.t);
  ejes(svg, { W, H, m, y, yMarcas: yM.lista, x, xMarcas: marcasTiempo(T[0], T.at(-1)) });
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
    const err = b.previsto[i] - b.real[i];
    tooltipEn(tip, cont, xx, y(Math.max(b.real[i], b.previsto[i])),
      `${fechaLarga(b.fechas[i])}<strong>Real ${dolares(b.real[i])}</strong>El modelo dijo ${dolares(b.previsto[i])} (${signo(err)}${f2.format(Math.abs(err))} $)`);
  };
  zona.addEventListener('pointermove', mover);
  zona.addEventListener('pointerdown', mover);
  zona.addEventListener('pointerleave', ev => { if (ev.pointerType === 'touch') return; tip.hidden = true; [cruz, pr, pp].forEach(e => e.setAttribute('visibility', 'hidden')); });
}
function pintarFiabilidad() {
  const b = D.backtest.horizontes[estado.plazo], h = D.prediccion.horizontes[estado.plazo], z = PLAZOS[estado.plazo];
  const filas = D.comparativa.filas.filter(f => f.horizonte === estado.plazo && f.modelo !== 'Ingenuo');
  const tope = Math.max(2, ...filas.map(f => Math.abs(f.mejora_pct))) * 1.1;
  const barra = v => {
    const w = (Math.abs(v) / tope) * 50;
    return `<span style="left:${v >= 0 ? 50 : 50 - w}%;width:${w}%"></span>`;
  };
  $('fiab-cifras').innerHTML = `
    <h3>En las pruebas, ${z.corto}</h3>
    <div class="cifras" style="margin-top:12px">
      <div class="cifra"><div class="etq">Se equivocó de media</div><div class="num">${dolares(b.error_medio)}</div>
        <div class="dif">Suponiendo que el precio no cambia: ${dolares(b.error_medio_ingenuo)}</div></div>
      <div class="cifra"><div class="etq">Acertó si subiría o bajaría</div><div class="num">${f0.format(b.acierto_direccion_pct)} %</div>
        <div class="dif">Tirando una moneda sería un 50 %</div></div>
    </div>
    <h3 style="margin-top:20px">Las tres redes probadas</h3>
    <p class="ayuda">Cuánto reducen el error frente a suponer que el precio no cambia. Hacia la derecha, mejor.</p>
    <div class="modelos">
      ${filas.map(f => `<div class="modelo ${f.modelo === D.prediccion.horizontes[estado.plazo].red ? 'elegido' : ''}">
        <strong>${f.modelo}${f.modelo === D.prediccion.horizontes[estado.plazo].red ? ' <small>elegida</small>' : ''}</strong>
        <div class="barra-div">${barra(f.mejora_pct)}</div>
        <span class="v">${pct(f.mejora_pct)}</span></div>`).join('')}
      <div class="modelos-etq"><span>Peor</span><span>Mejor</span></div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Ciclos del mercado: todo el histórico con los grandes picos y caídas
// ---------------------------------------------------------------------------
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
  document.querySelectorAll('#eventos .evento').forEach((li, k) => li.classList.toggle('activa', k === i));
}
function graficaCiclos() {
  if (!$('g-ciclos').clientWidth) return;
  const cont = $('g-ciclos'), svg = cont.querySelector('svg'), tip = cont.querySelector('.tooltip');
  const W = cont.clientWidth, H = W < 560 ? 200 : 240, m = { t: 26, r: 12, b: 26, l: 40 };
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
  el('path', { class: 'area-ciclos', d: `${camino(linea)}L${x(T.at(-1))},${y(0)}L${x(T[0])},${y(0)}Z` }, svg);
  el('path', { class: 'linea-ciclos', d: camino(linea) }, svg);
  D.eventos.forEach((e, i) => {
    const arriba = e.kind === 'pico';
    el('text', { class: 'etq-evento', x: x(e.t), y: y(e.precio) + (arriba ? -10 : 18), 'text-anchor': 'middle' }, svg).textContent = W < 560 ? e.date.slice(0, 4) : e.corto;
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
      <p>El rango probable sale de los errores que cometió en las pruebas: el precio real cayó dentro de ese margen 8 de cada 10 veces.</p>
    </li>`;
}
function pintarComparacion() {
  const z = PLAZOS[estado.plazo], usado = D.prediccion.horizontes[estado.plazo].red;
  const filas = D.comparativa.filas.filter(f => f.horizonte === estado.plazo);
  const nombre = m => (m === 'Ingenuo' ? 'Sin modelo (repetir el precio de hoy)' : m);
  $('comparacion').innerHTML = `
    <h3>Las tres redes frente a no usar modelo, ${z.corto}</h3>
    <p class="ayuda">Probadas con datos de ${new Date(D.estado.inicio_test).getFullYear()} a 2026, que ninguna vio durante el entrenamiento. Cambia de plazo arriba para ver los otros.</p>
    <div class="desplazable">
      <table class="tabla">
        <thead><tr><th>Modelo</th><th>Error medio</th><th>Error cuadrático (RMSE)</th><th>Mejora frente a no usar modelo</th><th>Parámetros</th><th>Tiempo de entrenamiento</th></tr></thead>
        <tbody>${filas.map(f => `<tr class="${f.modelo === usado ? 'elegido' : ''}">
          <th scope="row">${nombre(f.modelo)}${f.modelo === usado ? '<small>elegida</small>' : ''}</th>
          <td>${dolares(f.mae)}</td><td>${dolares(f.rmse)}</td>
          <td>${f.modelo === 'Ingenuo' ? '—' : pct(f.mejora_pct)}</td>
          <td>${f.parametros ? f0.format(f.parametros) : '—'}</td>
          <td>${f.tiempo_s == null ? '—' : `${f1.format(f.tiempo_s)} s`}</td></tr>`).join('')}</tbody>
      </table>
    </div>`;
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
const term = { rango: '1A', dom: null, log: false, medias: false, redes: false, velas: false, comparar: '', listo: false };
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
    montarTerminal();
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
      <dt>MAE frente a sin modelo</dt><dd>${pct(h.mejora_mae_vs_ingenuo_pct)}</dd>
      <dt>RMSE frente a sin modelo</dt><dd>${pct(h.mejora_vs_ingenuo_pct)}</dd>
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
function dominioT() {
  if (term.dom) return term.dom;
  const T = D.historico.t, tHoy = T.at(-1), tObj = aFecha(D.prediccion.horizontes[estado.plazo].fecha_objetivo).getTime();
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
  const T = D.historico.t, P = D.historico.precios, tHoy = T.at(-1), tObj = aFecha(h.fecha_objetivo).getTime();
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
  const prevVis = prev.filter(d => d[0] >= tIni && d[0] <= tFin);
  const finVisible = tObj <= tFin && tObj >= tIni;

  // velas: solo si caben (el futuro del Brent tiene dos años de datos diarios)
  let velas = [];
  if (term.velas && D.velas) {
    for (let i = 0; i < D.velas.t.length; i++) if (D.velas.t[i] >= tIni && D.velas.t[i] <= tFin) velas.push(i);
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
    el('text', { x: x(tHoy) - 6, y: m.t + 4, 'text-anchor': 'end' }, g).textContent = 'Hoy';
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
  if (tHoy >= tIni && tHoy <= tFin) el('circle', { class: 'punto', cx: x(tHoy), cy: y(P.at(-1) * k), r: 5, fill: 'var(--texto)' }, g);

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
  if (!otra && estado.umbral != null && estado.umbral > yLo && estado.umbral < yHi) {
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
  if (t <= tg.tHoy) {
    const i = busqueda(T, Math.max(t, T[0]));
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
    if (ev.pointerType === 'touch') { if (tg.dentro(px, py)) lecturaTerminal(px); return; }
    if (!tg.dentro(px, py)) return;
    gesto = cercaUmbral(px, py) ? { tipo: 'umbral' } : { tipo: 'mover', x: ev.clientX, t0: tg.tIni, t1: tg.tFin, ancho: tg.W - tg.m.l - tg.m.r };
    cont.setPointerCapture(ev.pointerId);
  });
  cont.addEventListener('pointermove', ev => {
    const [px, py] = pos(ev);
    if (!gesto) {
      if (ev.pointerType === 'touch') return;
      cont.style.cursor = cercaUmbral(px, py) ? 'ns-resize' : '';
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
  const soltar = () => { gesto = null; cont.style.cursor = ''; };
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


const VISTAS = {
  panel: null,
  escenarios: { titulo: 'Escenarios', sub: 'Añade un suceso a la previsión, calcula lo que te costaría y mira la probabilidad de que el barril cruce un precio.' },
  mercado: { titulo: 'Cómo está el mercado', sub: 'Las señales que suelen acompañar a los movimientos fuertes del crudo y los activos que más le influyen.' },
  ciclos: { titulo: 'Ciclos del mercado', sub: 'Los grandes picos y caídas desde 2000, qué los provocó y cómo se movió el barril mes a mes.' },
  fiabilidad: { titulo: '¿Me puedo fiar?', sub: 'Lo que dijo el modelo en las pruebas (2024-2026) frente a lo que pasó de verdad.' },
  modelo: { titulo: 'Cómo funciona el modelo', sub: 'Qué mira la red, cómo lo procesa y de dónde sale la previsión, sin tecnicismos.' },
  datos: { titulo: 'Datos y actualización', sub: 'De dónde salen los datos, cuándo se descargaron y cómo traer los de hoy.' },
  terminal: { titulo: 'Terminal', sub: 'Todo a mano para quien sigue el mercado a diario: gráfica avanzada, capas, comparación con otros activos y atajos de teclado.' },
};
function repintar() {
  graficaPrincipal(); graficaBacktest(); graficaErrores(); graficaCiclos();
  pintarUmbral(false); pintarSimulador(); dibujarMinis();
}
// cada sección es una página propia: solo se ve una, con la cabecera de crudo arriba
function mostrar(v) {
  if (!(v in VISTAS)) v = 'panel';
  estado.vista = v;
  document.documentElement.dataset.vista = v;
  document.querySelectorAll('[data-vista]').forEach(e => { if (e !== document.documentElement) e.classList.toggle('activa', e.dataset.vista === v); });
  const info = VISTAS[v];
  if (info) { $('cab-titulo').textContent = info.titulo; $('cab-sub').textContent = info.sub; }
  document.title = info ? `${info.titulo} · Previsión Brent` : 'Previsión Brent';
  const enlaces = [...document.querySelectorAll('.secciones a')];
  enlaces.forEach(a => a.setAttribute('aria-current', String(a.getAttribute('href') === `#${v}`)));
  const activo = enlaces.find(a => a.getAttribute('href') === `#${v}`), menu = activo?.parentElement;
  if (menu && menu.scrollWidth > menu.clientWidth) menu.scrollTo({ left: activo.offsetLeft - (menu.clientWidth - activo.offsetWidth) / 2, behavior: 'smooth' });
  scrollTo(0, 0);
  repintar();
  if (v === 'terminal') prepararTerminal().then(pintarTerminal);
}
function navegacion() {
  const nav = $('nav');
  const alBajar = () => nav.classList.toggle('solida', scrollY > 40);
  addEventListener('scroll', alBajar, { passive: true }); alBajar();
  addEventListener('hashchange', () => mostrar(location.hash.slice(1)));
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
  el('path', { class: 'barra-err', 'stroke-width': w.toFixed(2), d: err.map((e, i) => `M${x(T[i]).toFixed(1)},${y(0).toFixed(1)}V${y(e).toFixed(1)}`).join('') }, svg);
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
montarGrafica();
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
navegacion();
mostrar(location.hash.slice(1));
pintarDependiente();
// en móvil, tocar fuera de una gráfica cierra su tooltip
document.addEventListener('pointerdown', ev => {
  if (ev.pointerType !== 'touch') return;
  document.querySelectorAll('.grafica').forEach(g => { if (!g.contains(ev.target)) { const t = g.querySelector('.tooltip'); if (t) t.hidden = true; } });
});
$('periodo').addEventListener('click', ev => {
  const b = ev.target.closest('button'); if (!b) return;
  estado.anios = Number(b.dataset.anios);
  $('periodo').querySelectorAll('button').forEach(o => o.setAttribute('aria-pressed', String(o === b)));
  graficaPrincipal();
});
document.addEventListener('keydown', ev => {
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
