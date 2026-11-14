// Fondo de la cabecera: superficie de crudo espeso con brillo tornasolado (película fina).
// WebGL puro, a media resolución, y solo se anima mientras la cabecera está a la vista.
const canvas = document.getElementById('crudo');
const gl = canvas.getContext('webgl', { antialias: false, alpha: false, premultipliedAlpha: false });
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

if (gl) {
  const vert = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;
  const frag = `
    precision highp float;
    uniform vec2 uRes; uniform float uT; uniform vec2 uLuz;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float ruido(vec2 p){
      vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
    }
    float fbm(vec2 p){
      float v = 0.0, a = 0.5;
      for (int i = 0; i < 5; i++){ v += a * ruido(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
      return v;
    }
    // altura de la superficie: ruido deformado por otro ruido, que se desliza muy despacio
    float altura(vec2 p){
      vec2 q = vec2(fbm(p + vec2(0.0, uT * 0.035)), fbm(p + vec2(5.2, 1.3) - uT * 0.028));
      return fbm(p + 1.7 * q);
    }
    void main(){
      vec2 uv = gl_FragCoord.xy / uRes.y;
      vec2 p = uv * 1.6 + vec2(3.0, 1.0);
      float e = 0.006;
      float h = altura(p);
      float hx = altura(p + vec2(e, 0.0)), hy = altura(p + vec2(0.0, e));
      vec3 n = normalize(vec3((h - hx) / e * 0.09, (h - hy) / e * 0.09, 1.0));
      vec3 v = vec3(0.0, 0.0, 1.0);
      vec2 luzPlano = (uLuz - gl_FragCoord.xy / uRes) * vec2(uRes.x / uRes.y, 1.0);
      vec3 l = normalize(vec3(luzPlano * 1.2, 0.9));
      vec3 m = normalize(l + v);
      float spec = pow(max(dot(n, m), 0.0), 90.0);
      float brillo = pow(max(dot(n, m), 0.0), 9.0);
      float fres = pow(1.0 - max(n.z, 0.0), 1.6);
      // película fina: el grosor cambia con la altura y da los colores de arcoíris del aceite
      float grosor = h * 2.6 + uT * 0.015;
      vec3 pelicula = 0.5 + 0.5 * cos(6.28318 * (grosor + vec3(0.0, 0.33, 0.67)));
      vec3 base = vec3(0.032, 0.025, 0.019);
      vec3 col = base;
      col += pelicula * (0.035 + 0.5 * fres) * smoothstep(0.38, 0.72, h) * 0.55;
      col += vec3(0.95, 0.7, 0.42) * brillo * 0.045;
      col += vec3(1.0, 0.86, 0.66) * spec * 0.55;
      gl_FragColor = vec4(col, 1.0);
    }`;
  const compilar = (tipo, src) => { const s = gl.createShader(tipo); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s)); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, compilar(gl.VERTEX_SHADER, vert));
  gl.attachShader(prog, compilar(gl.FRAGMENT_SHADER, frag));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const uRes = gl.getUniformLocation(prog, 'uRes'), uT = gl.getUniformLocation(prog, 'uT'), uLuz = gl.getUniformLocation(prog, 'uLuz');

  const ESCALA = 0.5; // media resolución: el CSS la estira y el desenfoque natural sienta bien
  const luz = { x: 0.78, y: 0.72, ox: 0.78, oy: 0.72 };
  function medir() {
    const r = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(r.width * ESCALA));
    canvas.height = Math.max(1, Math.round(r.height * ESCALA));
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  let visible = true, t0 = performance.now(), id = 0;
  function dibujar(ahora) {
    luz.x += (luz.ox - luz.x) * 0.04; luz.y += (luz.oy - luz.y) * 0.04;
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uT, reduceMotion ? 12 : (ahora - t0) / 1000);
    gl.uniform2f(uLuz, luz.x, luz.y);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function bucle(ahora) { dibujar(ahora); if (visible && !reduceMotion) id = requestAnimationFrame(bucle); }
  medir(); dibujar(performance.now());
  if (!reduceMotion) id = requestAnimationFrame(bucle);

  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    cancelAnimationFrame(id);
    if (visible && !reduceMotion) id = requestAnimationFrame(bucle);
  }).observe(canvas);
  new ResizeObserver(() => { medir(); dibujar(performance.now()); }).observe(canvas);
  // el reflejo sigue al puntero muy despacio
  canvas.parentElement.addEventListener('pointermove', ev => {
    const r = canvas.getBoundingClientRect();
    luz.ox = (ev.clientX - r.left) / r.width; luz.oy = 1 - (ev.clientY - r.top) / r.height;
    if (reduceMotion) dibujar(performance.now());
  });
}
