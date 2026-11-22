// Pezzi di shader condivisi: rumore GLSL, nebbia "atmosferica" (più densa in basso, più calda verso il sole)
// e uniform comuni a tutti i materiali (tempo, sole). La nebbia sostituisce quella standard di three.js.
import * as THREE from 'three';

// Uniform condivise. I valori Float32Array vengono copiati per riferimento da three.js quando clona le uniform
// dei materiali standard: così basta aggiornarli qui una volta per fotogramma.
export const FOGU = {
  uFogSunDir: { value: new Float32Array([0, 1, 0]) },
  uFogSunCol: { value: new Float32Array([1, 1, 1]) },
  uFogParams: { value: new Float32Array([0, 120, 0.6, 1]) }, // x quota di base, y spessore, z forza del sole, w densità relativa
};
export const SHARED = { uTime: { value: 0 } };

export function setFog(sunDir, sunColor, base, range, sunAmt) {
  const d = FOGU.uFogSunDir.value, c = FOGU.uFogSunCol.value, p = FOGU.uFogParams.value;
  d[0] = sunDir.x; d[1] = sunDir.y; d[2] = sunDir.z;
  c[0] = sunColor.r; c[1] = sunColor.g; c[2] = sunColor.b;
  p[0] = base; p[1] = Math.max(1, range); p[2] = sunAmt;
}

export const NOISE = /* glsl */ `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3){ p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i), b = hash12(i + vec2(1.0, 0.0)), c = hash12(i + vec2(0.0, 1.0)), d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm3(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 3; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s / 0.875; }
float fbm5(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.01 + 11.7; a *= 0.5; } return s / 0.96875; }
`;

const fogParsVertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorld;
#endif`;

// posizione nel mondo ricavata da mvPosition: funziona per mesh normali, istanziate, punti e sprite
const fogVertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vec3 fogT = mvPosition.xyz - viewMatrix[ 3 ].xyz;
  vFogWorld = vec3( dot( viewMatrix[ 0 ].xyz, fogT ), dot( viewMatrix[ 1 ].xyz, fogT ), dot( viewMatrix[ 2 ].xyz, fogT ) );
#endif`;

const fogParsFragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  uniform vec3 uFogSunDir;
  uniform vec3 uFogSunCol;
  uniform vec4 uFogParams;
  varying float vFogDepth;
  varying vec3 vFogWorld;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  float radFogFactor() {
    vec3 v = vFogWorld - cameraPosition;
    float dist = length(v);
    float avgY = (cameraPosition.y + vFogWorld.y) * 0.5;
    float hf = mix(1.45, 0.4, smoothstep(uFogParams.x, uFogParams.x + uFogParams.y + 0.001, avgY));
    #ifdef FOG_EXP2
      float k = fogDensity * dist;
      return 1.0 - exp(- k * k * hf * max(uFogParams.w, 0.05));
    #else
      return smoothstep(fogNear, fogFar, dist);
    #endif
  }
  vec3 radFogColor() {
    vec3 dir = normalize(vFogWorld - cameraPosition);
    float s = max(dot(dir, uFogSunDir), 0.0);
    return mix(fogColor, uFogSunCol, (pow(s, 7.0) * 0.85 + pow(s, 40.0) * 0.4) * uFogParams.z);
  }
#endif`;

const fogFragment = /* glsl */ `
#ifdef USE_FOG
  gl_FragColor.rgb = mix( gl_FragColor.rgb, radFogColor(), radFogFactor() );
#endif`;

let installed = false;
export function installFog() {
  if (installed) return;
  installed = true;
  THREE.ShaderChunk.fog_pars_vertex = fogParsVertex;
  THREE.ShaderChunk.fog_vertex = fogVertex;
  THREE.ShaderChunk.fog_pars_fragment = fogParsFragment;
  THREE.ShaderChunk.fog_fragment = fogFragment;
  // riflessi speculari molto stretti visti di striscio possono superare il massimo dei float a 16 bit (65504)
  // e diventare infiniti: il bloom li allarga in grandi rettangoli neri. Qui si limita la luce in uscita.
  THREE.ShaderChunk.opaque_fragment = 'outgoingLight = mix(vec3(0.0), min(outgoingLight, vec3(60.0)), greaterThanEqual(outgoingLight, vec3(-1.0e30)));\n' + THREE.ShaderChunk.opaque_fragment;
  for (const k of Object.keys(THREE.ShaderLib)) {
    const u = THREE.ShaderLib[k].uniforms;
    if (u && u.fogColor) Object.assign(u, FOGU);
  }
}

// uniform da mettere nei ShaderMaterial che usano la nebbia (fog: true)
export function fogUniforms() {
  return Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), FOGU);
}

// texture morbide disegnate su canvas (nessun file esterno)
export function glowTexture(size = 64, hard = 0.35) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(hard, 'rgba(255,255,255,0.55)');
  gr.addColorStop(0.7, 'rgba(255,255,255,0.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function puffTexture(size = 128, seed = 7) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2, d = Math.pow(rnd(), 0.7) * size * 0.22;
    const x = size / 2 + Math.cos(a) * d, y = size / 2 + Math.sin(a) * d * 0.85;
    const r = size * (0.12 + rnd() * 0.16);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.22)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.09)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, size, size);
  }
  // bordo morbido: sfuma verso i lati
  g.globalCompositeOperation = 'destination-in';
  const gr = g.createRadialGradient(size / 2, size / 2, size * 0.2, size / 2, size / 2, size / 2);
  gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
