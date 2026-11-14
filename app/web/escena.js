import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { montar, estado, datosHistoria } from './contenido.js';
import Lenis from 'lenis';

// ---------------------------------------------------------------------------
// Constantes del mundo (unidades = metros)
// ---------------------------------------------------------------------------
const POZO = new THREE.Vector3(4.1, 0, 0);   // boca del pozo del balancín principal
const FONDO_POZO = -300;                     // final del tubo de roca
const CRUDO_Y = -330;                        // superficie del crudo en la caverna
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------------------
// Renderizador, escena y cámara
// ---------------------------------------------------------------------------
const canvas = document.getElementById('lienzo');
if (!document.createElement('canvas').getContext('webgl2')) {
  // sin WebGL no hay escena: se ofrece el panel, que tiene la misma previsión
  document.getElementById('carga').innerHTML = '<div style="max-width:30rem;padding:24px;text-align:center;line-height:1.5">Este navegador no puede mostrar la escena en 3D.<br><a href="index.html" style="color:#f3b441">Abrir el panel con la previsión</a></div>';
  throw new Error('WebGL 2 no disponible');
}
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.52;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 12000);

const colorNieblaSuperficie = new THREE.Color('#d39674');
const colorNieblaSubsuelo = new THREE.Color('#120a07');
scene.fog = new THREE.FogExp2(colorNieblaSuperficie.clone(), 0.0011);
scene.background = colorNieblaSubsuelo.clone();

// ---------------------------------------------------------------------------
// Cielo físico de atardecer y luz del sol
// ---------------------------------------------------------------------------
const sky = new Sky();
sky.scale.setScalar(10000);
const elevacion = THREE.MathUtils.degToRad(2.6);
const horiz = new THREE.Vector2(-0.38, -1).normalize();
const sol = new THREE.Vector3(horiz.x * Math.cos(elevacion), Math.sin(elevacion), horiz.y * Math.cos(elevacion));
Object.assign(sky.material.uniforms.turbidity, { value: 6 });
Object.assign(sky.material.uniforms.rayleigh, { value: 3.2 });
Object.assign(sky.material.uniforms.mieCoefficient, { value: 0.0035 });
Object.assign(sky.material.uniforms.mieDirectionalG, { value: 0.82 });
sky.material.uniforms.sunPosition.value.copy(sol);

const pmrem = new THREE.PMREMGenerator(renderer);
const escenaEntorno = new THREE.Scene();
escenaEntorno.add(sky);
const entorno = pmrem.fromScene(escenaEntorno).texture;
scene.environment = entorno;
scene.add(sky);

const luzSol = new THREE.DirectionalLight('#ff9e60', 4.5);
luzSol.position.copy(sol).multiplyScalar(260);
luzSol.target.position.set(0, 0, 0);
luzSol.castShadow = true;
luzSol.shadow.mapSize.set(2048, 2048);
Object.assign(luzSol.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 120, far: 420 });
luzSol.shadow.bias = -0.0004;
luzSol.shadow.normalBias = 0.04;
scene.add(luzSol, luzSol.target);

const luzCielo = new THREE.HemisphereLight('#f5c3a0', '#6b4630', 0.8);
scene.add(luzCielo);
const luzRoca = new THREE.HemisphereLight('#ffb27a', '#2a1610', 0);
scene.add(luzRoca);

// ---------------------------------------------------------------------------
// Texturas PBR (Poly Haven, CC0)
// ---------------------------------------------------------------------------
const gestor = new THREE.LoadingManager();
const barra = document.getElementById('progreso');
gestor.onProgress = (_, cargados, total) => { barra.style.width = `${(cargados / total) * 100}%`; };
const cargador = new THREE.TextureLoader(gestor);
const anisotropia = renderer.capabilities.getMaxAnisotropy();

function texturas(nombre, rx, ry = rx) {
  const t = {};
  for (const tipo of ['diff', 'nor', 'arm']) {
    const tex = cargador.load(`assets/tex/${nombre}/${tipo}.jpg`);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(rx, ry);
    tex.anisotropy = anisotropia;
    if (tipo === 'diff') tex.colorSpace = THREE.SRGBColorSpace;
    t[tipo] = tex;
  }
  return t;
}
function materialPBR(nombre, rx, ry, extra = {}) {
  const t = texturas(nombre, rx, ry);
  return new THREE.MeshStandardMaterial({ map: t.diff, normalMap: t.nor, roughnessMap: t.arm, aoMap: t.arm, ...extra });
}

// ---------------------------------------------------------------------------
// Terreno: dunas con malla más densa cerca del pozo
// ---------------------------------------------------------------------------
const ruido = new ImprovedNoise();
const smooth = (a, b, x) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function altura(x, z) {
  const d = Math.hypot(x, z);
  const llano = smooth(18, 220, d);
  const cresta = 1 - Math.abs(ruido.noise(x / 95, 0.3, z / 150));
  const dunas = 7 * cresta * cresta + 2.2 * ruido.noise(x / 32, 1.7, z / 48) + 0.6 * ruido.noise(x / 9, 4.1, z / 11);
  const lejos = smooth(350, 1800, d) * (55 + 70 * ruido.noise(x / 650, 7.7, z / 650));
  return llano * dunas + lejos - 0.05;
}

const N = 360, EXT = 3200;
const geoTerreno = new THREE.PlaneGeometry(2, 2, N, N);
geoTerreno.rotateX(-Math.PI / 2);
{
  const pos = geoTerreno.attributes.position, uv = geoTerreno.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const gx = pos.getX(i), gz = pos.getZ(i);
    const x = Math.sign(gx) * Math.pow(Math.abs(gx), 2.3) * EXT;
    const z = Math.sign(gz) * Math.pow(Math.abs(gz), 2.3) * EXT;
    pos.setXYZ(i, x, altura(x, z), z);
    uv.setXY(i, x / 9, z / 9);
  }
  geoTerreno.computeVertexNormals();
}
const arena = materialPBR('red_sand', 1, 1, { color: '#ffd7b0', normalScale: new THREE.Vector2(1.4, 1.4) });
const terreno = new THREE.Mesh(geoTerreno, arena);
terreno.receiveShadow = true;
scene.add(terreno);

// rocas sueltas por el desierto
const rocaDesierto = materialPBR('dark_rock', 1, 1, { color: '#b48a6a' });
{
  const rnd = mulberry(5);
  for (let k = 0; k < 70; k++) {
    const g = new THREE.IcosahedronGeometry(1, 3);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(p, i);
      const f = 1 + 0.28 * ruido.noise(v.x * 1.6 + k, v.y * 1.6, v.z * 1.6);
      p.setXYZ(i, v.x * f, v.y * f * 0.7, v.z * f);
    }
    g.computeVertexNormals();
    const roca = new THREE.Mesh(g, rocaDesierto);
    const ang = rnd() * Math.PI * 2, dist = 18 + Math.pow(rnd(), 1.6) * 160;
    const x = Math.cos(ang) * dist, z = Math.sin(ang) * dist;
    if (Math.abs(z) < 6 && x > -10 && x < 40) continue;
    const s = 0.15 + rnd() * (dist < 40 ? 0.45 : 1.2);
    roca.scale.setScalar(s);
    roca.position.set(x, altura(x, z) - s * 0.25, z);
    roca.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
    roca.castShadow = dist < 30;
    roca.receiveShadow = true;
    scene.add(roca);
  }
}

function mulberry(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// ---------------------------------------------------------------------------
// Balancín (bomba de varilla) con cinemática real
// ---------------------------------------------------------------------------
const oxido = texturas('rust_coarse_01', 2, 1);
const pintura = new THREE.MeshStandardMaterial({ color: '#4d5158', metalness: 0.55, roughness: 0.62, normalMap: oxido.nor, roughnessMap: oxido.arm, normalScale: new THREE.Vector2(0.6, 0.6) });
const pinturaCabeza = new THREE.MeshStandardMaterial({ color: '#9c3220', metalness: 0.4, roughness: 0.55, normalMap: oxido.nor, roughnessMap: oxido.arm, normalScale: new THREE.Vector2(0.5, 0.5) });
const oxidado = new THREE.MeshStandardMaterial({ map: oxido.diff, normalMap: oxido.nor, roughnessMap: oxido.arm, metalness: 0.6, color: '#9a8a80' });
const acero = new THREE.MeshStandardMaterial({ color: '#c9ccd1', metalness: 1, roughness: 0.28 });
const aceroOscuro = new THREE.MeshStandardMaterial({ color: '#3a3c40', metalness: 0.8, roughness: 0.45 });
const cableMat = new THREE.MeshStandardMaterial({ color: '#1d1d1f', metalness: 0.7, roughness: 0.5 });
const hormigon = materialPBR('concrete_floor_worn_001', 3, 1.2, { color: '#d9c7b5' });

const Y = new THREE.Vector3(0, 1, 0);
function caja(w, h, d, mat, x, y, z, padre) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; padre.add(m); return m;
}
function cilindro(r, h, mat, padre, seg = 20) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat);
  m.castShadow = m.receiveShadow = true; padre.add(m); return m;
}
function barraEntre(a, b, grosor, mat, padre) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const m = new THREE.Mesh(new THREE.BoxGeometry(grosor, dir.length(), grosor), mat);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(Y, dir.normalize());
  m.castShadow = m.receiveShadow = true; padre.add(m); return m;
}
function sectorExtruido(r0, r1, a0, a1, prof) {
  const s = new THREE.Shape();
  s.absarc(0, 0, r1, a0, a1, false);
  s.absarc(0, 0, r0, a1, a0, true);
  const g = new THREE.ExtrudeGeometry(s, { depth: prof, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 1, curveSegments: 16 });
  g.translate(0, 0, -prof / 2);
  return g;
}

const R_CABEZA = 4.1, PIVOTE_Y = 6.05, EJE = new THREE.Vector3(-3.2, 1.9, 0), R_MANIVELA = 0.95, COLA = -3.7;

function balancin({ varillaLarga = false } = {}) {
  const g = new THREE.Group();

  // patín y bancada
  for (const z of [-0.9, 0.9]) caja(11, 0.35, 0.3, oxidado, -0.4, 0.175, z, g);
  for (const x of [-5, -2.5, 0, 2.5, 4.4]) caja(0.3, 0.3, 2.1, oxidado, x, 0.2, 0, g);

  // poste sansón (dos caballetes en A)
  for (const z of [-0.75, 0.75]) {
    barraEntre(new THREE.Vector3(-1.5, 0.35, z), new THREE.Vector3(-0.08, 5.8, z * 0.55), 0.22, pintura, g);
    barraEntre(new THREE.Vector3(1.5, 0.35, z), new THREE.Vector3(0.08, 5.8, z * 0.55), 0.22, pintura, g);
    barraEntre(new THREE.Vector3(-1.05, 2.1, z * 0.9), new THREE.Vector3(1.05, 2.1, z * 0.9), 0.12, pintura, g);
    barraEntre(new THREE.Vector3(-0.6, 4.0, z * 0.7), new THREE.Vector3(0.6, 4.0, z * 0.7), 0.1, pintura, g);
  }
  barraEntre(new THREE.Vector3(-1.05, 2.1, -0.68), new THREE.Vector3(-0.55, 4.0, 0.52), 0.09, pintura, g);
  barraEntre(new THREE.Vector3(1.05, 2.1, 0.68), new THREE.Vector3(0.55, 4.0, -0.52), 0.09, pintura, g);
  caja(0.7, 0.35, 1.0, aceroOscuro, 0, 5.85, 0, g);

  // reductora, motor y cubrecorreas
  caja(1.9, 0.3, 1.5, oxidado, EJE.x, 0.5, 0, g);
  caja(1.5, 1.0, 1.05, pintura, EJE.x, 1.15, 0, g);
  const carcasa = cilindro(0.78, 1.05, pintura, g, 32);
  carcasa.rotation.x = Math.PI / 2; carcasa.position.set(EJE.x, EJE.y - 0.15, 0);
  const motor = cilindro(0.38, 0.9, aceroOscuro, g, 24);
  motor.rotation.x = Math.PI / 2; motor.position.set(-5.0, 0.85, 0.15);
  caja(0.9, 0.5, 0.9, oxidado, -5.0, 0.45, 0.15, g);
  barraEntre(new THREE.Vector3(-5.0, 0.85, 0.72), new THREE.Vector3(EJE.x, EJE.y, 0.72), 0.55, pintura, g).scale.set(1, 1, 0.18);

  // manivelas con contrapesos
  const manivela = new THREE.Group();
  manivela.position.copy(EJE);
  g.add(manivela);
  const ejeM = cilindro(0.13, 2.0, acero, manivela); ejeM.rotation.x = Math.PI / 2;
  const geoPeso = sectorExtruido(0.55, 1.3, -0.5, 0.5, 0.22);
  for (const z of [-0.74, 0.74]) {
    caja(1.25, 0.3, 0.14, pintura, 0.45, 0, z, manivela);
    const peso = new THREE.Mesh(geoPeso, pintura);
    peso.position.z = z + Math.sign(z) * 0.18; peso.castShadow = peso.receiveShadow = true;
    manivela.add(peso);
    const pin = cilindro(0.07, 0.3, acero, manivela); pin.rotation.x = Math.PI / 2; pin.position.set(R_MANIVELA, 0, z);
  }

  // balancín (viga) con cabeza de caballo
  const viga = new THREE.Group();
  viga.position.set(0, PIVOTE_Y, 0);
  g.add(viga);
  caja(7.9, 0.5, 0.12, pintura, -0.05, 0, 0, viga);
  caja(7.9, 0.07, 0.45, pintura, -0.05, 0.27, 0, viga);
  caja(7.9, 0.07, 0.45, pintura, -0.05, -0.27, 0, viga);
  const cojinete = cilindro(0.24, 0.95, aceroOscuro, viga, 24); cojinete.rotation.x = Math.PI / 2;
  caja(0.35, 0.25, 1.8, pintura, COLA, -0.38, 0, viga);
  caja(0.3, 0.3, 0.3, aceroOscuro, COLA, -0.15, 0, viga);
  {
    const s = new THREE.Shape();
    const a0 = THREE.MathUtils.degToRad(17), a1 = THREE.MathUtils.degToRad(-24);
    s.moveTo(3.15, 0.5);
    s.lineTo(R_CABEZA * Math.cos(a0), R_CABEZA * Math.sin(a0));
    s.absarc(0, 0, R_CABEZA, a0, a1, true);
    s.lineTo(3.25, -1.0);
    s.quadraticCurveTo(2.95, -0.25, 3.15, 0.5);
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.55, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2, curveSegments: 40 });
    geo.translate(0, 0, -0.275);
    const cabeza = new THREE.Mesh(geo, pinturaCabeza);
    cabeza.castShadow = cabeza.receiveShadow = true;
    viga.add(cabeza);
  }

  // bielas
  const bielas = [-0.8, 0.8].map(() => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 1, 12), pintura);
    m.castShadow = true; g.add(m); return m;
  });

  // cabezal del pozo
  const cabezal = new THREE.Group();
  cabezal.position.set(POZO.x, 0, 0);
  g.add(cabezal);
  cilindro(0.34, 0.08, aceroOscuro, cabezal, 24).position.y = 0.42;
  cilindro(0.2, 0.55, pintura, cabezal).position.y = 0.72;
  cilindro(0.32, 0.07, aceroOscuro, cabezal, 24).position.y = 1.02;
  const te = cilindro(0.09, 1.3, pintura, cabezal); te.rotation.x = Math.PI / 2; te.position.y = 0.8;
  for (const z of [-0.55, 0.55]) {
    const volante = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.022, 8, 24), pinturaCabeza);
    volante.position.set(0, 1.05, z); volante.rotation.x = Math.PI / 2; cabezal.add(volante);
    cilindro(0.025, 0.25, acero, cabezal).position.set(0, 0.92, z);
  }
  cilindro(0.12, 0.35, aceroOscuro, cabezal).position.y = 1.25;

  // cables, barra portadora y varilla pulida
  const cables = [-0.1, 0.1].map(z => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1, 6), cableMat);
    m.position.set(POZO.x, 0, z); g.add(m); return m;
  });
  const portadora = caja(0.24, 0.14, 0.5, aceroOscuro, POZO.x, 3, 0, g);
  const largo = varillaLarga ? 3.4 - CRUDO_Y + 3 : 3.2;
  const varilla = new THREE.Group();
  g.add(varilla);
  const vastago = cilindro(0.035, largo, acero, varilla, 10);
  vastago.position.set(POZO.x, -largo / 2, 0);
  if (varillaLarga) {
    const coples = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.055, 0.055, 0.22, 10), acero, Math.floor(largo / 7.5));
    const m = new THREE.Matrix4();
    for (let i = 0; i < coples.count; i++) { m.makeTranslation(POZO.x, -6 - i * 7.5, 0); coples.setMatrixAt(i, m); }
    varilla.add(coples);
    // guías de la sarta cada cierto tramo, para que se lea el movimiento
    const guias = new THREE.InstancedMesh(new THREE.TorusGeometry(0.12, 0.02, 6, 16), aceroOscuro, Math.floor(largo / 30));
    for (let i = 0; i < guias.count; i++) { m.makeRotationX(Math.PI / 2).setPosition(POZO.x, -20 - i * 30, 0); guias.setMatrixAt(i, m); }
    varilla.add(guias);
  }

  // pequeñas tuberías que salen del cabezal
  const linea = cilindro(0.08, 26, aceroOscuro, g, 12);
  linea.rotation.x = Math.PI / 2; linea.position.set(POZO.x, 0.25, 13.6);

  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
  function update(t, fase = 0, periodo = 5) {
    const phi = 2 * Math.PI * t / periodo + fase;
    const theta = -0.25 * Math.sin(phi);
    manivela.rotation.z = phi;
    viga.rotation.z = theta;
    const yPortadora = 3.25 + R_CABEZA * theta;
    for (const [i, z] of [[0, -0.8], [1, 0.8]]) {
      tmp.set(EJE.x + R_MANIVELA * Math.cos(phi), EJE.y + R_MANIVELA * Math.sin(phi), z);
      tmp2.set(COLA * Math.cos(theta) + 0.38 * Math.sin(theta), PIVOTE_Y + COLA * Math.sin(theta) - 0.38 * Math.cos(theta), z);
      const b = bielas[i], dir = tmp2.clone().sub(tmp);
      b.position.copy(tmp).addScaledVector(dir, 0.5);
      b.scale.set(1, dir.length(), 1);
      b.quaternion.setFromUnitVectors(Y, dir.normalize());
    }
    for (const c of cables) { c.position.y = (PIVOTE_Y + yPortadora) / 2; c.scale.y = PIVOTE_Y - yPortadora; }
    portadora.position.y = yPortadora;
    varilla.position.y = yPortadora;
  }
  update(0);
  return { grupo: g, update };
}

// plataforma y balancín principal
caja(16, 0.2, 6, hormigon, -0.3, 0.0, 0, scene).castShadow = false;
const principal = balancin({ varillaLarga: true });
principal.grupo.position.y = 0.1;
scene.add(principal.grupo);

// balancines lejanos
const lejanos = [
  // campo petrolífero: varios balancines repartidos hacia el atardecer
  [-70, -130, 0.3], [55, -210, -0.4], [-170, -280, 0.9], [140, -95, 0.2], [-30, -360, -0.2], [260, -320, 0.5], [-300, -170, 0.1],
  [-42, -38, 0.5], [-95, -22, -0.3], [-30, -80, 0.15], [-140, -75, 0.7], [-65, -185, -0.6], [-215, -120, 0.25],
  [-120, -240, -0.1], [-260, -60, 0.4], [-185, -10, 0.8], [10, -150, -0.25], [-340, -260, 0.2], [-420, -120, -0.5],
].map(([x, z, ry], i) => {
  const b = balancin();
  b.grupo.traverse(o => { o.castShadow = false; o.receiveShadow = false; });
  b.grupo.position.set(x, altura(x, z) - 0.1, z);
  b.grupo.rotation.y = ry;
  scene.add(b.grupo);
  return { ...b, fase: i * 1.7, periodo: 4.6 + (i % 3) * 0.5 };
});

// ---------------------------------------------------------------------------
// Subsuelo: tubo de roca con estratos y caverna con crudo
// ---------------------------------------------------------------------------
const subsuelo = new THREE.Group();
scene.add(subsuelo);

const capas = [
  { tex: 'cliff_side', color: '#d2a273', rep: [7, 3] },
  { tex: 'rock_face_03', color: '#b88560', rep: [6, 3] },
  { tex: 'cliff_side', color: '#9a6a4c', rep: [7, 3] },
  { tex: 'quarry_wall', color: '#8a7663', rep: [6, 3] },
  { tex: 'rock_face_03', color: '#7d5f4c', rep: [6, 3] },
  { tex: 'dark_rock', color: '#6d5a52', rep: [6, 3] },
];
const ALTO_CAPA = -FONDO_POZO / capas.length;
const R_TUBO = 14;
capas.forEach((c, i) => {
  const geo = new THREE.CylinderGeometry(R_TUBO, R_TUBO, ALTO_CAPA + 3, 96, 48, true);
  const p = geo.attributes.position;
  const colores = new Float32Array(p.count * 3);
  const yCentro = -ALTO_CAPA * (i + 0.5);
  for (let k = 0; k < p.count; k++) {
    const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
    const yw = y + yCentro;
    const f = 1 + 0.1 * ruido.noise(x * 0.12, yw * 0.12, z * 0.12) + 0.035 * ruido.noise(x * 0.5, yw * 0.5, z * 0.5);
    p.setXYZ(k, x * f, Math.min(y, -0.4 - yCentro), z * f);
    // bandas horizontales de sedimentación
    const banda = 0.82 + 0.18 * Math.sin(yw * 0.85 + 2.5 * ruido.noise(x * 0.05, yw * 0.05, z * 0.05)) + 0.06 * ruido.noise(0, yw * 0.3, 1);
    colores[k * 3] = colores[k * 3 + 1] = colores[k * 3 + 2] = banda;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colores, 3));
  geo.computeVertexNormals();
  const mat = materialPBR(c.tex, c.rep[0], c.rep[1], { color: c.color, vertexColors: true, side: THREE.BackSide, normalScale: new THREE.Vector2(1.6, 1.6) });
  const tubo = new THREE.Mesh(geo, mat);
  tubo.position.set(POZO.x, yCentro, 0);
  tubo.receiveShadow = true;
  subsuelo.add(tubo);
});
{
  const techo = new THREE.Mesh(new THREE.CircleGeometry(R_TUBO * 1.3, 48), materialPBR('dark_rock', 4, 4, { color: '#7a6455' }));
  techo.rotation.x = Math.PI / 2;
  techo.position.set(POZO.x, -0.35, 0);
  subsuelo.add(techo);
}

// ---------------------------------------------------------------------------
// Veta del precio: la curva del Brent tallada en la pared del pozo.
// La profundidad es el tiempo (las mismas paradas que el guion) y la posición
// a lo ancho de la pared es el precio: más a la derecha, más caro.
// ---------------------------------------------------------------------------
const ANCLAS = [[2026.85, -7], [2026.3, -25], [2022.2, -75], [2020.3, -125], [2015.4, -175], [2008.6, -225], [2000.05, -275]];
function profundidad(anio) {
  for (let i = 0; i < ANCLAS.length - 1; i++) {
    const [a0, y0] = ANCLAS[i], [a1, y1] = ANCLAS[i + 1];
    if (anio >= a1) return y0 + (y1 - y0) * THREE.MathUtils.clamp((a0 - anio) / (a0 - a1), 0, 1);
  }
  return ANCLAS.at(-1)[1];
}
const estrecho = innerWidth / innerHeight < 0.8;
const ANG0 = THREE.MathUtils.degToRad(estrecho ? -19 : -14), ANG_ANCHO = THREE.MathUtils.degToRad(estrecho ? 15 : 26), PRECIO_MAX = 150;
function puntoPared(precio, yw, margen = 0.965) {
  // mismo relieve que el tubo de roca, un poco hacia dentro para que la veta no quede enterrada
  const th = ANG0 + (precio / PRECIO_MAX) * ANG_ANCHO;
  const x0 = R_TUBO * Math.sin(th), z0 = -R_TUBO * Math.cos(th);
  const f = (1 + 0.1 * ruido.noise(x0 * 0.12, yw * 0.12, z0 * 0.12) + 0.035 * ruido.noise(x0 * 0.5, yw * 0.5, z0 * 0.5)) * margen;
  return new THREE.Vector3(POZO.x + x0 * f, yw, z0 * f);
}
function rotulo(texto) {
  const c = document.createElement('canvas'); c.width = 192; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.font = '700 34px Archivo, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(251, 239, 220, .5)'; ctx.fillText(texto, 96, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, fog: false, depthWrite: false }));
  s.scale.set(1.8, 0.6, 1);
  return s;
}
function construirVeta({ serie, eventos }) {
  const anio = t => t.getFullYear() + (t.getMonth() + (t.getDate() - 1) / 31) / 12;
  const pts = [];
  for (let i = serie.length - 1; i >= 0; i -= 6) pts.push(puntoPared(serie[i].v, profundidad(anio(serie[i].t))));
  const veta = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 2, 0.055, 6, false),
    // filón mineral: recibe la luz de la linterna y se pierde en la niebla como el resto de la roca
    new THREE.MeshStandardMaterial({ color: '#b98232', roughness: 0.42, metalness: 0.45, emissive: '#3a2104', emissiveIntensity: 0.9 }));
  subsuelo.add(veta);
  // guías de precio y sus rótulos junto a cada parada
  const guia = new THREE.LineBasicMaterial({ color: '#fbefdc', transparent: true, opacity: 0.08 });
  for (const precio of [50, 100, 150]) {
    const linea = [];
    for (let y = -6; y >= -288; y -= 1.5) linea.push(puntoPared(precio, y, 0.972));
    subsuelo.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(linea), guia));
    for (const [, y] of ANCLAS.slice(1)) { const s = rotulo(`${precio} $`); s.position.copy(puntoPared(precio, y + 3.4, 0.93)); subsuelo.add(s); }
  }
  // cada crisis, un punto claro sobre la veta
  const marca = new THREE.MeshStandardMaterial({ color: '#f6e3c4', roughness: 0.3, metalness: 0.2, emissive: '#7a5a2a', emissiveIntensity: 0.8 });
  for (const e of eventos) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), marca);
    m.position.copy(puntoPared(e.precio, profundidad(anio(new Date(`${e.date}T12:00:00`))), 0.955));
    subsuelo.add(m);
  }
}

// caverna del yacimiento
{
  const geo = new THREE.SphereGeometry(1, 160, 80);
  const p = geo.attributes.position;
  for (let k = 0; k < p.count; k++) {
    const v = new THREE.Vector3().fromBufferAttribute(p, k);
    const f = 1 + 0.12 * ruido.noise(v.x * 3, v.y * 3, v.z * 3) + 0.05 * ruido.noise(v.x * 9, v.y * 9, v.z * 9);
    p.setXYZ(k, v.x * f, v.y * f, v.z * f);
  }
  geo.computeVertexNormals();
  const cueva = new THREE.Mesh(geo, materialPBR('quarry_wall', 12, 6, { color: '#a07c62', side: THREE.BackSide, normalScale: new THREE.Vector2(1.8, 1.8) }));
  cueva.scale.set(58, 24, 58);
  cueva.position.set(POZO.x, CRUDO_Y + 4, 0);
  subsuelo.add(cueva);
}

// crudo: superficie brillante con ondas
function mapaNormalOndas() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const ctx = c.getContext('2d'); const img = ctx.createImageData(256, 256);
  const alt = (x, y) => 0.6 * ruido.noise(x / 22, y / 22, 0.5) + 0.4 * ruido.noise(x / 9, y / 9, 3.3);
  // ruido periódico: mezclar con copias desplazadas para que repita sin costura
  const h = (x, y) => {
    const fx = x / 256, fy = y / 256;
    return alt(x, y) * (1 - fx) * (1 - fy) + alt(x - 256, y) * fx * (1 - fy) + alt(x, y - 256) * (1 - fx) * fy + alt(x - 256, y - 256) * fx * fy;
  };
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const dx = h(x + 1, y) - h(x - 1, y), dy = h(x, y + 1) - h(x, y - 1);
    const n = new THREE.Vector3(-dx * 3, -dy * 3, 1).normalize();
    const i = (y * 256 + x) * 4;
    img.data[i] = (n.x * 0.5 + 0.5) * 255; img.data[i + 1] = (n.y * 0.5 + 0.5) * 255; img.data[i + 2] = (n.z * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(10, 10);
  return t;
}
const ondas = mapaNormalOndas();
const crudoMat = new THREE.MeshPhysicalMaterial({
  color: '#020101', roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03,
  iridescence: 0.55, iridescenceIOR: 1.35, iridescenceThicknessRange: [200, 600],
  normalMap: ondas, normalScale: new THREE.Vector2(0.22, 0.22), envMap: entorno, envMapIntensity: 0.12,
});
const crudo = new THREE.Mesh(new THREE.PlaneGeometry(130, 130), crudoMat);
crudo.rotation.x = -Math.PI / 2;
crudo.position.set(POZO.x, CRUDO_Y, 0);
subsuelo.add(crudo);

// bomba de fondo
const bombaFondo = cilindro(0.16, 7, aceroOscuro, subsuelo, 16);
bombaFondo.position.set(POZO.x, CRUDO_Y - 1.5, 0);

// luces del subsuelo
const linterna = new THREE.PointLight('#ffb27a', 0, 60, 1.4);
scene.add(linterna);
const lucesCrudo = [[0, 0, 10], [-30, -25, 14], [25, -30, 12]].map(([x, z, h]) => {
  const l = new THREE.PointLight('#ff9a48', 0, 120, 1.1);
  l.position.set(POZO.x + x, CRUDO_Y + h, z);
  subsuelo.add(l);
  return l;
});

// polvo en suspensión (superficie y subsuelo)
function polvo(n, generador, color, tam) {
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const v = generador(i); pos.set([v.x, v.y, v.z], i * 3); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.PointsMaterial({ color, size: tam, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
  const pts = new THREE.Points(g, m); scene.add(pts); return pts;
}
const rnd = mulberry(9);
const polvoSubsuelo = polvo(2600, () => {
  const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * (R_TUBO - 2);
  return new THREE.Vector3(POZO.x + Math.cos(a) * r, -rnd() * (-CRUDO_Y), Math.sin(a) * r);
}, '#ffcf9a', 0.06);
const polvoSuperficie = polvo(1200, () => new THREE.Vector3((rnd() - 0.5) * 140, rnd() * 6, (rnd() - 0.7) * 120), '#ffd9b0', 0.08);

// ---------------------------------------------------------------------------
// Postprocesado: un poco de resplandor para el sol y los brillos del crudo
// ---------------------------------------------------------------------------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.22, 0.35, 0.96);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ---------------------------------------------------------------------------
// Recorrido de cámara ligado al scroll
// ---------------------------------------------------------------------------
const v = (x, y, z) => new THREE.Vector3(x, y, z);
// Puntos de cámara. contenido.js decide en qué punto (o entre cuáles) está el scroll.
// 0 desierto · 1 balancín · 2 cabezal · 3 bajo tierra · 4-9 épocas · 10 riesgos · 11 caverna
const eraY = i => -ALTO_CAPA * (i + 0.5);
const puntos = [
  { pos: v(19, 2.0, 30),  mira: v(-30, 6.5, -24) },
  { pos: v(10.5, 5.6, 12.5), mira: v(-7.5, 3.0, -2) },
  { pos: v(6.6, 2.4, 4.4), mira: v(POZO.x, 1.2, 0) },
  { pos: v(5.7, -8, 3.6),  mira: v(POZO.x, -14, 0) },
  ...Array.from({ length: 6 }, (_, i) => ({ pos: v(POZO.x - 2.4, eraY(i) + 1.5, 4.8), mira: v(POZO.x - 3.6, eraY(i) - 1.4, -9) })),
  { pos: v(POZO.x - 2.4, FONDO_POZO + 10, 4.8), mira: v(POZO.x - 3.6, FONDO_POZO + 7, -9) },
  { pos: v(22, CRUDO_Y + 12, 24), mira: v(1, CRUDO_Y + 1.5, -8) },
];
const curvaPos = new THREE.CatmullRomCurve3(puntos.map(k => k.pos), false, 'centripetal');
const curvaMira = new THREE.CatmullRomCurve3(puntos.map(k => k.mira), false, 'centripetal');

// ---------------------------------------------------------------------------
// Bucle
// ---------------------------------------------------------------------------
const fundido = document.getElementById('fundido');
const pista = document.getElementById('pista');
const atajo = document.getElementById('atajo');
let p = 0;
const mira = new THREE.Vector3();
const reloj = new THREE.Clock();

// el crudo del fondo reacciona a la previsión elegida: sube o baja con ella y se agita más cuanto más ancho es el rango
let nivelCrudo = 0, oleaje = 0.22;
addEventListener('prevision', ev => {
  nivelCrudo = THREE.MathUtils.clamp(ev.detail.variacion / 10, -1, 1) * 1.5;
  oleaje = 0.14 + Math.min(ev.detail.ancho, 1) * 0.5;
});

let fijo = null; // solo para depurar: fija la posición de cámara (en unidades de punto)
function paso() {
  const dt = Math.min(reloj.getDelta(), 0.1);
  const t = reduceMotion ? 0 : reloj.elapsedTime;
  principal.update(t, 0, 5);
  for (const b of lejanos) b.update(t, b.fase, b.periodo);

  const objetivo = fijo ?? estado();
  if (fijo !== null) p = fijo;
  else p += (objetivo - p) * (reduceMotion ? 1 : 1 - Math.exp(-dt * 6));
  const u = THREE.MathUtils.clamp(p / (puntos.length - 1), 0, 1);
  curvaPos.getPoint(u, camera.position);
  curvaMira.getPoint(u, mira);
  if (!reduceMotion) {
    // balanceo muy leve, como una cámara en mano: la escena nunca parece congelada
    camera.position.x += Math.sin(t * 0.5) * 0.09;
    camera.position.y += Math.sin(t * 0.37 + 1) * 0.06;
    mira.x += Math.sin(t * 0.29 + 2) * 0.12;
  }
  camera.lookAt(mira);

  // transición superficie → subsuelo según la altura de la cámara
  const y = camera.position.y;
  const bajo = smooth(1.5, -7, y);
  scene.fog.color.lerpColors(colorNieblaSuperficie, colorNieblaSubsuelo, bajo);
  const enCaverna = smooth(FONDO_POZO + 10, FONDO_POZO - 12, y);
  scene.fog.density = THREE.MathUtils.lerp(THREE.MathUtils.lerp(0.0011, 0.022, bajo), 0.006, enCaverna);
  luzSol.intensity = 4.5 * (1 - bajo);
  luzCielo.intensity = 0.8 * (1 - bajo);
  luzRoca.intensity = 0.35 * bajo + 0.9 * smooth(FONDO_POZO + 10, FONDO_POZO - 12, y);
  scene.environmentIntensity = 0.8 * (1 - bajo);
  sky.visible = y > -4;
  terreno.visible = polvoSuperficie.visible = y > -40;
  for (const b of lejanos) b.grupo.visible = y > -6;
  subsuelo.visible = polvoSubsuelo.visible = y < 1.2;
  renderer.toneMappingExposure = THREE.MathUtils.lerp(0.52, 0.95, bajo);

  linterna.position.copy(camera.position).add(new THREE.Vector3(0.8, 1.5, 0.5));
  linterna.intensity = 900 * bajo;
  lucesCrudo.forEach((l, i) => { l.intensity = enCaverna * (i === 0 ? 170 : 110) * (1 + 0.08 * Math.sin(t * 1.3 + i * 2)); });

  bloom.strength = THREE.MathUtils.lerp(0.22, 0.07, enCaverna);
  fundido.style.opacity = (THREE.MathUtils.clamp(1 - Math.abs(y + 0.6) / 3.2, 0, 1) * 0.96).toFixed(3);
  pista.classList.toggle('oculta', scrollY > 40);
  atajo.classList.toggle('oculto', atajoInterno && objetivo > puntos.length - 1.6);

  ondas.offset.set(t * 0.004, t * 0.0025);
  const suave = reduceMotion ? 1 : 1 - Math.exp(-dt * 1.8);
  crudo.position.y += (CRUDO_Y + nivelCrudo - crudo.position.y) * suave;
  crudoMat.normalScale.setScalar(crudoMat.normalScale.x + (oleaje - crudoMat.normalScale.x) * suave);
  polvoSubsuelo.rotation.y = t * 0.01;
  polvoSuperficie.position.x = Math.sin(t * 0.05) * 3;

  composer.render();
}
// scroll con inercia (se desactiva si el sistema pide reducir el movimiento)
const lenis = reduceMotion ? null : new Lenis({ lerp: 0.08, wheelMultiplier: 0.85, touchMultiplier: 1.4 });
const atajoInterno = atajo.getAttribute('href').startsWith('#');
atajo.addEventListener('click', ev => {
  if (!lenis || !atajoInterno) return;
  ev.preventDefault();
  lenis.scrollTo('#prevision', { duration: 4, easing: x => 1 - Math.pow(1 - x, 3) });
});
function fotograma(tiempo) { lenis?.raf(tiempo); paso(); requestAnimationFrame(fotograma); }
// depuración: sin argumento, salta la cámara a donde indica el scroll actual
window.__vista = q => { fijo = q ?? estado(); paso(); fijo = null; };

let texturasListas = false, contenidoListo = false;
const quitarCarga = () => { if (texturasListas && contenidoListo) document.getElementById('carga').classList.add('lista'); };
gestor.onLoad = () => { texturasListas = true; quitarCarga(); };
montar().then(() => { construirVeta(datosHistoria()); contenidoListo = true; quitarCarga(); });
requestAnimationFrame(fotograma);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.fov = camera.aspect < 0.8 ? 55 : 40;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});
dispatchEvent(new Event('resize'));
