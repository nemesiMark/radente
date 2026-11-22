// Costruzione del mondo di un livello: terreno, percorso, cerchi, scia guida, ostacoli, cielo, acqua/lava, bersagli.
// La parte "di gioco" (rotta, altezze, ostacoli e collisioni) usa la stessa sequenza casuale della versione 1.x:
// i livelli restano identici. Tutto ciò che è solo grafica usa un secondo generatore (R2).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { NOISE, SHARED, fogUniforms, glowTexture, puffTexture } from './shade.js';
import { buildTargets } from './targets.js';

/* ---------- numeri casuali e rumore (deterministici per seme) ---------- */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNoise(seed) {
  const r = rng(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const grad = (h, x, y) => {
    switch (h & 7) {
      case 0: return x + y; case 1: return -x + y; case 2: return x - y; case 3: return -x - y;
      case 4: return x; case 5: return -x; case 6: return y; default: return -y;
    }
  };
  return (x, y) => {
    const fx = Math.floor(x), fy = Math.floor(y);
    const X = fx & 255, Y = fy & 255;
    x -= fx; y -= fy;
    const u = fade(x), v = fade(y);
    const a = perm[X] + Y, b = perm[X + 1] + Y;
    const g00 = grad(perm[a], x, y), g10 = grad(perm[b], x - 1, y);
    const g01 = grad(perm[a + 1], x, y - 1), g11 = grad(perm[b + 1], x - 1, y - 1);
    const l1 = g00 + (g10 - g00) * u, l2 = g01 + (g11 - g01) * u;
    return (l1 + (l2 - l1) * v) * 0.75;
  };
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function dotTexture() { return glowTexture(64, 0.35); }

// facciate: finestre accese e spente (mappate in coordinate del mondo, quindi stessa misura su tutti i palazzi)
function windowTexture(r) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#07080e'; g.fillRect(0, 0, 256, 512);
  const warm = ['#ffd08a', '#ffbf6e', '#ffe6b8', '#ffc98f'], cool = ['#a8dcff', '#c9bcff', '#8ff2ff', '#e6f4ff'];
  for (let y = 0; y < 16; y++) {
    const floorOn = r() < 0.82, floorSet = r() < 0.55 ? warm : cool;
    for (let x = 0; x < 8; x++) {
      const on = floorOn && r() < 0.62;
      if (on) {
        g.fillStyle = r() < 0.75 ? floorSet[Math.floor(r() * 4)] : (floorSet === warm ? cool : warm)[Math.floor(r() * 4)];
        g.globalAlpha = 0.55 + r() * 0.45;
      } else { g.fillStyle = r() < 0.5 ? '#141a2a' : '#0f1220'; g.globalAlpha = 1; }
      g.fillRect(4 + x * 32, 6 + y * 32, 24, 20);
    }
  }
  g.globalAlpha = 1;
  g.fillStyle = 'rgba(255,255,255,0.025)';
  for (let x = 0; x < 8; x++) g.fillRect(x * 32 + 30, 0, 2, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}

/* ---------- distanza con segno da un ostacolo ---------- */
export function sdObstacle(o, x, y, z) {
  if (o.shape === 'box') {
    const dx = x - o.x, dz = z - o.z;
    const lx = o.cos * dx - o.sin * dz, lz = o.sin * dx + o.cos * dz, ly = y - o.y;
    const qx = Math.abs(lx) - o.hx, qy = Math.abs(ly) - o.hy, qz = Math.abs(lz) - o.hz;
    const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
    return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0);
  }
  if (o.shape === 'sphere') return Math.hypot(x - o.x, y - o.y, z - o.z) - o.r;
  let r = o.r;
  if (o.shape === 'cone') { const t = (y - o.y0) / (o.y1 - o.y0); r = o.r * Math.min(1, Math.max(0, 1 - t)); }
  const h = Math.hypot(x - o.x, z - o.z) - r;
  const v = Math.max(o.y0 - y, y - o.y1);
  const hx = Math.max(h, 0), vx = Math.max(v, 0);
  return Math.sqrt(hx * hx + vx * vx) + Math.min(Math.max(h, v), 0);
}

/* ---------- ritocchi ai materiali standard (rumore, strati di roccia, vento, venature di lava) ---------- */
function patchStd(mat, { wind = false, strata = false, cracks = null, detail = 1 } = {}) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = SHARED.uTime;
    if (cracks) sh.uniforms.uCrack = { value: cracks };
    sh.vertexShader = 'uniform float uTime;\nvarying vec3 vWPos;\n' + sh.vertexShader
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        ${wind ? `
        #ifdef USE_INSTANCING
          float wph = instanceMatrix[3].x * 0.05 + instanceMatrix[3].z * 0.037;
        #else
          float wph = 0.0;
        #endif
        float wamt = max(position.y, 0.0);
        transformed.x += sin(uTime * 1.6 + wph) * 0.045 * wamt;
        transformed.z += cos(uTime * 1.3 + wph * 1.3) * 0.03 * wamt;` : ''}`)
      .replace('#include <fog_vertex>', `#include <fog_vertex>
        vec4 rw = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          rw = instanceMatrix * rw;
        #endif
        vWPos = (modelMatrix * rw).xyz;`);
    sh.fragmentShader = `uniform float uTime;\n${cracks ? 'uniform vec3 uCrack;\n' : ''}varying vec3 vWPos;\n${NOISE}\n` + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        float pn1 = vnoise(vWPos.xz * 0.11 + vWPos.y * 0.07);
        float pn2 = vnoise(vWPos.xz * 0.6 + vWPos.y * 0.4);
        diffuseColor.rgb *= 1.0 + (${detail.toFixed(2)}) * (0.22 * pn1 + 0.1 * pn2 - 0.16);
        ${strata ? 'float psb = sin(vWPos.y * 0.95 + pn1 * 2.2) * 0.5 + 0.5; diffuseColor.rgb *= 0.84 + 0.2 * psb;' : ''}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        ${cracks ? `float pc = vnoise(vWPos.xz * 0.32 + vec2(vWPos.y * 0.21, -vWPos.y * 0.13));
        float vein = 1.0 - smoothstep(0.0, 0.05, abs(pc - 0.5));
        totalEmissiveRadiance += uCrack * vein * (0.75 + 0.25 * sin(uTime * 2.0 + vWPos.y * 0.3)) * (0.35 + 0.65 * (1.0 - smoothstep(0.0, 45.0, vWPos.y)));` : ''}`);
  };
  mat.customProgramCacheKey = () => `std-${wind}-${strata}-${!!cracks}-${detail}`;
  return mat;
}

function displaceGeo(geo, noise, amp, freq, seed, topFade = false) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = noise(x * freq + seed + y * 1.7, z * freq - seed * 0.5 + y * 1.3);
    const k = 1 + n * amp * (topFade ? (1 - y * 0.6) : 1);
    p.setXYZ(i, x * k, y, z * k);
  }
  geo.computeVertexNormals();
  return geo;
}

/* ---------- costruzione ---------- */
export function buildWorld(level, opts = {}) {
  const low = !!opts.low;
  const root = new THREE.Group();
  const disposables = [];
  const track = (o) => { disposables.push(o); return o; };
  const envMats = []; // materiali che riflettono il cielo (envMap assegnata da main)

  const R = rng(level.seed);
  const R2 = rng(level.seed * 7 + 3);
  const nA = makeNoise(level.seed + 11), nB = makeNoise(level.seed + 23), nC = makeNoise(level.seed + 37);
  const fbm = (n, x, y, o) => { let s = 0, a = 1, f = 1, t = 0; for (let i = 0; i < o; i++) { s += a * n(x * f, y * f); t += a; a *= 0.5; f *= 2.03; } return s / t; };
  const ridged = (x, y, o) => {
    let s = 0, a = 1, f = 1, t = 0;
    for (let i = 0; i < o; i++) { let v = 1 - Math.abs(nB(x * f, y * f)) * 1.5; v = Math.max(0, v); s += a * v * v; t += a; a *= 0.5; f *= 2.1; }
    return s / t;
  };

  const type = level.type;
  const look = level.look || {};
  const ringR = level.ring.radius;
  const waterY = level.water ? level.water.y : -Infinity;

  /* --- percorso --- */
  function refH(x, z) {
    switch (type) {
      case 'hills': return 35 + fbm(nA, x * 0.0032, z * 0.0032, 2) * 90;
      case 'canyon': return 30;
      case 'volcano': return Math.max(0, -10 + fbm(nA, x * 0.003, z * 0.003, 2) * 80);
      default: return 0;
    }
  }
  const P = level.path, STEP = 240;
  const minY = (type === 'city' || level.water) ? (level.water ? level.water.y : 0) + 1.5 * ringR + 1 : -Infinity;
  const ctrl = [];
  let px = 0, vx = 0;
  for (let i = 0; i < P.points; i++) {
    const z = -i * STEP;
    if (i >= 2) { vx = vx * 0.45 + (R() * 2 - 1) * P.sway; px = Math.max(-P.maxX, Math.min(P.maxX, px + vx)); }
    const alt = P.altMin + R() * (P.altMax - P.altMin);
    ctrl.push(new THREE.Vector3(px, Math.max(minY, refH(px, z) + alt), z));
  }
  ctrl[0].y = ctrl[1].y;
  const curve = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal');
  curve.arcLengthDivisions = 4000;
  const L = curve.getLength();
  const N = Math.ceil(L / 4);
  const sx = new Float32Array(N + 1), sy = new Float32Array(N + 1), sz = new Float32Array(N + 1), sc = new Float32Array(N + 1);
  const tx = new Float32Array(N + 1), tz = new Float32Array(N + 1);
  const tmp = new THREE.Vector3();
  const [c0, c1] = level.clear;
  for (let i = 0; i <= N; i++) {
    curve.getPointAt(i / N, tmp);
    sx[i] = tmp.x; sy[i] = tmp.y; sz[i] = tmp.z;
    const k = Math.min(1, Math.max(0, fbm(nC, i * 0.015, 3.3, 2) * 0.6 + 0.5));
    sc[i] = c0 + k * (c1 - c0);
  }
  for (let i = 0; i <= N; i++) {
    const j = Math.min(i + 1, N), k = Math.max(i - 1, 0);
    const dx = sx[j] - sx[k], dz = sz[j] - sz[k], l = Math.hypot(dx, dz) || 1;
    tx[i] = dx / l; tz[i] = dz / l;
  }

  const near = { i: 0, d: 0 };
  function nearest(x, z) {
    let lo = 0, hi = N;
    while (lo < hi) { const m = (lo + hi) >> 1; if (sz[m] > z) lo = m + 1; else hi = m; }
    const a = Math.max(0, lo - 48), b = Math.min(N, lo + 48);
    let best = Infinity, bi = lo;
    for (let i = a; i <= b; i++) { const dx = sx[i] - x, dz = sz[i] - z, d = dx * dx + dz * dz; if (d < best) { best = d; bi = i; } }
    near.i = bi; near.d = Math.sqrt(best);
    return near;
  }

  /* --- terreno (altezze) --- */
  const cw = level.corridor || 20, bl = level.blend || 60, wallH = level.wallH || 90;
  function heightAt(x, z) {
    nearest(x, z);
    const i = near.i, d = near.d;
    const floor = sy[i] - sc[i];
    switch (type) {
      case 'hills': {
        const base = 35 + fbm(nA, x * 0.0032, z * 0.0032, 5) * 90;
        const w = 1 - smooth(cw, cw + bl, d);
        return base + (floor - base) * w;
      }
      case 'canyon': {
        const w = smooth(cw, cw + 20, d);
        const n = fbm(nA, x * 0.012, z * 0.012, 3);
        const top = floor + wallH + n * 30 - smooth(cw + 150, cw + 420, d) * 40;
        return floor + fbm(nB, x * 0.05, z * 0.05, 2) * 1.5 + (top - floor) * w;
      }
      case 'city': return 0;
      case 'fjord': {
        const m = 20 + ridged(x * 0.0035, z * 0.0035, 4) * 150;
        const w = smooth(cw, cw + bl, d);
        const sea = -12 + fbm(nA, x * 0.02, z * 0.02, 2) * 4;
        return sea + (m - sea) * w;
      }
      case 'volcano': {
        const base = -30 + ridged(x * 0.004, z * 0.004, 4) * 135;
        const w = 1 - smooth(cw, cw + bl, d);
        return base + (floor - base) * w;
      }
    }
    return 0;
  }
  const groundAt = (x, z) => Math.max(heightAt(x, z), waterY);

  const tUniforms = {
    uWaterY: { value: Number.isFinite(waterY) ? waterY : -1000 },
    uLava: { value: new THREE.Color(level.water && level.water.lava ? '#ff4a10' : '#000000') },
    uGrid: { value: new THREE.Vector2(0, 0) },
  };

  let minX = Infinity, maxX = -Infinity;
  for (let i = 0; i <= N; i++) { if (sx[i] < minX) minX = sx[i]; if (sx[i] > maxX) maxX = sx[i]; }
  let depthInfo = null;
  {
    const cell = low ? 15 : 10, margin = 760;
    const x0 = minX - margin, x1 = maxX + margin, z0 = sz[0] + 420, z1 = sz[N] - 520;
    const nx = Math.ceil((x1 - x0) / cell) + 1, nz = Math.ceil((z0 - z1) / cell) + 1;
    const pos = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 3), vari = new Float32Array(nx * nz);
    let v = 0;
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const edge = i === 0 || j === 0 || i === nx - 1 || j === nz - 1;
        const x = x0 + i * cell + (edge ? 0 : (R() - 0.5) * cell * 0.6);
        const z = z0 - j * cell + (edge ? 0 : (R() - 0.5) * cell * 0.6);
        const h = heightAt(x, z);
        pos[v] = x; pos[v + 1] = h; pos[v + 2] = z;
        vari[v / 3] = 0.9 + R() * 0.18;
        v += 3;
      }
    }
    const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
    let q = 0;
    for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      idx[q++] = a; idx[q++] = b; idx[q++] = c;
      idx[q++] = b; idx[q++] = d; idx[q++] = c;
    }
    const geo = track(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    // colori: tavolozza per quota + roccia sui pendii ripidi + chiazze di prato + ombra nelle conche
    const nrm = geo.attributes.normal.array;
    const pal = level.palette.map(([h, c]) => [h, new THREE.Color(c)]);
    const lavaTint = new THREE.Color('#2a0d06');
    const rockC = look.rock ? new THREE.Color(look.rock) : null;
    const meadowC = look.meadow ? new THREE.Color(look.meadow) : null;
    const cc = new THREE.Color();
    const palColor = (h) => {
      if (h <= pal[0][0]) return cc.copy(pal[0][1]);
      for (let k = 1; k < pal.length; k++) if (h <= pal[k][0]) return cc.copy(pal[k - 1][1]).lerp(pal[k][1], (h - pal[k - 1][0]) / (pal[k][0] - pal[k - 1][0]));
      return cc.copy(pal[pal.length - 1][1]);
    };
    for (let j = 0, k = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++, k++) {
        const x = pos[k * 3], h = pos[k * 3 + 1], z = pos[k * 3 + 2];
        let hh = h + nC(x * 0.03, z * 0.03) * 6;
        if (level.stripes) hh += Math.sin(h * 0.32 + nB(x * 0.01, z * 0.01) * 2) * 5;
        palColor(hh);
        const ny = nrm[k * 3 + 1];
        const steep = smooth(0.9, 0.6, ny);
        if (meadowC) cc.lerp(meadowC, smooth(0.0, 0.4, nA(x * 0.011 + 7.3, z * 0.011 - 3.1)) * 0.55 * (1 - steep));
        if (rockC) cc.lerp(rockC, steep * (look.rockAmt ?? 0.8));
        if (level.water && level.water.lava && h < 6) cc.lerp(lavaTint, Math.min(1, (6 - h) / 7));
        let sum = 0, cnt = 0;
        if (i > 0) { sum += pos[(k - 1) * 3 + 1]; cnt++; }
        if (i < nx - 1) { sum += pos[(k + 1) * 3 + 1]; cnt++; }
        if (j > 0) { sum += pos[(k - nx) * 3 + 1]; cnt++; }
        if (j < nz - 1) { sum += pos[(k + nx) * 3 + 1]; cnt++; }
        const ao = Math.min(1.08, Math.max(0.68, 1 + (h - sum / cnt) * 0.035));
        cc.multiplyScalar(vari[k] * ao);
        col[k * 3] = cc.r; col[k * 3 + 1] = cc.g; col[k * 3 + 2] = cc.b;
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeBoundingSphere();
    // profondità dell'acqua/lava per il colore della superficie (dalla griglia del terreno)
    if (level.water) {
      const dd = new Uint8Array(nx * nz);
      for (let k = 0; k < nx * nz; k++) dd[k] = Math.round(Math.min(1, Math.max(0, (waterY - pos[k * 3 + 1]) / 14)) * 255);
      const dt = track(new THREE.DataTexture(dd, nx, nz, THREE.RedFormat, THREE.UnsignedByteType));
      dt.magFilter = dt.minFilter = THREE.LinearFilter; dt.needsUpdate = true;
      depthInfo = { tex: dt, box: new THREE.Vector4(x0, z0, (nx - 1) * cell, (nz - 1) * cell) };
    }
    if (type === 'city') tUniforms.uGrid.value.set(minX - 400 + 17, sz[0] + 150 - 17);
    const mat = track(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.94, metalness: 0 }));
    mat.defines = {};
    if (level.stripes) mat.defines.STRATA = '';
    if (level.water && !level.water.lava) mat.defines.SHORE = '';
    if (level.water && level.water.lava) mat.defines.LAVA = '';
    if (type === 'city') mat.defines.CITY = '';
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, tUniforms, { uTime: SHARED.uTime });
      sh.vertexShader = 'varying vec3 vWPos;\n' + sh.vertexShader.replace('#include <fog_vertex>', '#include <fog_vertex>\n  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = 'uniform float uTime; uniform float uWaterY; uniform vec3 uLava; uniform vec2 uGrid;\nvarying vec3 vWPos;\n' + NOISE + sh.fragmentShader
        .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
          vec3 radEm = vec3(0.0);
          float tn1 = vnoise(vWPos.xz * 0.07);
          float tn2 = vnoise(vWPos.xz * 0.45 + 3.1);
          diffuseColor.rgb *= 0.86 + 0.2 * tn1 + 0.1 * tn2;
          #ifdef STRATA
            float sb = sin(vWPos.y * 0.9 + tn1 * 2.5) * 0.5 + 0.5;
            float sb2 = sin(vWPos.y * 2.7 + tn2 * 1.5) * 0.5 + 0.5;
            diffuseColor.rgb *= 0.84 + 0.18 * sb + 0.07 * sb2;
          #endif
          #ifdef SHORE
            float shD = vWPos.y - uWaterY;
            diffuseColor.rgb *= 1.0 - (1.0 - smoothstep(0.0, 2.5, shD)) * 0.4;
            float foam = (1.0 - smoothstep(0.0, 0.55, abs(shD - 0.3 - 0.25 * sin(uTime * 1.2 + vWPos.x * 0.06 + vWPos.z * 0.04)))) * (0.55 + 0.45 * tn2);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.95, 1.0), foam * 0.85);
          #endif
          #ifdef LAVA
            float lh = 1.0 - smoothstep(-1.0, 8.0, vWPos.y);
            radEm += uLava * lh * lh * (0.6 + 0.4 * sin(uTime * 1.4 + tn1 * 7.0)) * 1.8;
          #endif
          #ifdef CITY
            vec2 q = (vWPos.xz - uGrid) / 34.0;
            vec2 sq = (fract(q + 0.5) - 0.5) * 34.0;
            vec2 dq = abs(sq);
            float road = 1.0 - smoothstep(4.5, 5.5, min(dq.x, dq.y));
            diffuseColor.rgb = mix(diffuseColor.rgb * 1.25, vec3(0.025, 0.027, 0.035), road);
            float onX = step(dq.y, dq.x);
            float along = mix(vWPos.z, vWPos.x, onX);
            float acr = mix(sq.x, sq.y, onX);
            float laneId = floor(mix(q.x + 0.5, q.y + 0.5, onX));
            float dash = step(0.5, fract(along / 6.0)) * (1.0 - smoothstep(0.08, 0.18, abs(acr)));
            radEm += vec3(0.5, 0.45, 0.3) * dash * road * 0.5;
            float h1 = fract(sin(laneId * 12.9898) * 43758.5453);
            float carA = smoothstep(0.92, 1.0, fract(along / 27.0 + h1 - uTime * 0.55)) * (1.0 - smoothstep(0.2, 0.55, abs(acr - 2.2)));
            float carB = smoothstep(0.92, 1.0, fract(-along / 31.0 + h1 * 1.7 - uTime * 0.5)) * (1.0 - smoothstep(0.2, 0.55, abs(acr + 2.2)));
            radEm += vec3(2.6, 2.4, 2.0) * carA * road + vec3(2.4, 0.2, 0.15) * carB * road * 0.8;
            float lamp = 1.0 - smoothstep(0.0, 3.2, length(vec2(fract(along / 18.0 + 0.5) * 18.0 - 9.0, abs(acr) - 5.5)));
            radEm += vec3(1.0, 0.62, 0.3) * lamp * lamp * 0.6;
          #endif`)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += radEm;');
    };
    mat.customProgramCacheKey = () => 'terrain-' + Object.keys(mat.defines).join('-');
    const terrain = new THREE.Mesh(geo, mat);
    terrain.frustumCulled = false;
    terrain.receiveShadow = true;
    terrain.castShadow = !low && (type === 'canyon' || type === 'fjord' || type === 'volcano');
    root.add(terrain);
  }

  /* --- acqua / lava / fondo lontano --- */
  let lavaMat = null;
  if (level.water && level.water.lava) {
    const g = track(new THREE.PlaneGeometry(30000, 30000).rotateX(-Math.PI / 2));
    lavaMat = track(new THREE.ShaderMaterial({
      uniforms: Object.assign(fogUniforms(), { uTime: SHARED.uTime, uDepth: { value: depthInfo.tex }, uBox: { value: depthInfo.box } }),
      vertexShader: /* glsl */ `
        varying vec3 vWPos;
        #include <fog_pars_vertex>
        void main(){
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWPos = wp.xyz;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        ${NOISE}
        uniform float uTime; uniform sampler2D uDepth; uniform vec4 uBox;
        varying vec3 vWPos;
        #include <fog_pars_fragment>
        void main(){
          vec2 duv = vec2((vWPos.x - uBox.x) / uBox.z, (uBox.y - vWPos.z) / uBox.w);
          float dep = (duv.x < 0.0 || duv.x > 1.0 || duv.y < 0.0 || duv.y > 1.0) ? 1.0 : texture2D(uDepth, duv).r;
          vec2 p = vWPos.xz * 0.028;
          vec2 q = vec2(fbm3(p + vec2(0.0, uTime * 0.05)), fbm3(p + vec2(5.2, 1.3) - uTime * 0.04));
          float n = fbm5(p * 1.7 + q * 2.4 + uTime * 0.025);
          float cr = fbm3(p * 6.0 + q * 3.0 - uTime * 0.06);
          float heat = smoothstep(0.38, 0.72, n);
          vec3 crust = vec3(0.045, 0.018, 0.012) * (0.6 + cr);
          vec3 hot = mix(vec3(1.3, 0.16, 0.02), vec3(4.6, 1.7, 0.32), heat * heat);
          float veins = 1.0 - smoothstep(0.0, 0.06, abs(cr - 0.5));
          vec3 col = mix(crust, hot, smoothstep(0.3, 0.62, n));
          col += vec3(3.0, 0.9, 0.15) * veins * (1.0 - heat) * 0.6;
          float shore = 1.0 - smoothstep(0.0, 0.12, dep);
          col = mix(col, vec3(3.6, 1.1, 0.2), shore * 0.55);
          col *= 0.9 + 0.1 * sin(uTime * 1.3 + n * 9.0);
          gl_FragColor = vec4(col, 1.0);
          #include <fog_fragment>
        }`,
      fog: true,
    }));
    const w = new THREE.Mesh(g, lavaMat); w.position.y = level.water.y; root.add(w);
  } else if (level.water) {
    const g = track(new THREE.PlaneGeometry(30000, 30000).rotateX(-Math.PI / 2));
    const m = track(new THREE.MeshStandardMaterial({ color: level.water.color, roughness: 0.16, metalness: 0.0 }));
    envMats.push(m);
    const wu = { uDepth: { value: depthInfo.tex }, uBox: { value: depthInfo.box }, uShallow: { value: new THREE.Color(level.water.shallow || '#2f8f9a') }, uDeep: { value: new THREE.Color(level.water.color) } };
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, wu, { uTime: SHARED.uTime });
      sh.vertexShader = 'varying vec3 vWPos;\n' + sh.vertexShader.replace('#include <fog_vertex>', '#include <fog_vertex>\n  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = 'uniform float uTime; uniform sampler2D uDepth; uniform vec4 uBox; uniform vec3 uShallow; uniform vec3 uDeep;\nvarying vec3 vWPos;\n' + NOISE + `
        vec2 waveG(vec2 p, vec2 d, float f, float sp, float a) { float ph = dot(p, d) * f + uTime * sp; return d * cos(ph) * f * a; }
        ` + sh.fragmentShader
        .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
          vec2 duv = vec2((vWPos.x - uBox.x) / uBox.z, (uBox.y - vWPos.z) / uBox.w);
          float dep = (duv.x < 0.0 || duv.x > 1.0 || duv.y < 0.0 || duv.y > 1.0) ? 1.0 : texture2D(uDepth, duv).r;
          diffuseColor.rgb = mix(uShallow, uDeep, smoothstep(0.0, 0.55, dep));
          float wn = vnoise(vWPos.xz * 0.25 + uTime * 0.3);
          float foamW = (1.0 - smoothstep(0.0, 0.07 + 0.04 * wn, dep)) * (0.5 + 0.5 * vnoise(vWPos.xz * 0.9 - uTime * 0.6));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95, 0.98, 1.0), foamW);`)
        .replace('#include <normal_fragment_maps>', /* glsl */ `#include <normal_fragment_maps>
          {
            vec2 wp = vWPos.xz;
            vec2 gs = waveG(wp, vec2(0.8, 0.6), 0.09, 1.1, 0.22) + waveG(wp, vec2(-0.5, 0.86), 0.14, 1.5, 0.12)
                    + waveG(wp, vec2(0.97, -0.24), 0.23, 2.1, 0.06) + waveG(wp, vec2(-0.2, -0.98), 0.41, 2.8, 0.035);
            float e = 0.6;
            float n0 = vnoise(wp * e + uTime * 0.35), nx = vnoise((wp + vec2(0.4, 0.0)) * e + uTime * 0.35), nz = vnoise((wp + vec2(0.0, 0.4)) * e + uTime * 0.35);
            gs += vec2(nx - n0, nz - n0) * 0.55;
            vec3 nW = normalize(vec3(-gs.x, 1.0, -gs.y));
            normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
          }`);
    };
    m.customProgramCacheKey = () => 'water';
    const w = new THREE.Mesh(g, m); w.position.y = level.water.y; w.receiveShadow = true; root.add(w);
  } else {
    const g = track(new THREE.PlaneGeometry(30000, 30000).rotateX(-Math.PI / 2));
    const m = track(new THREE.MeshBasicMaterial({ color: type === 'city' ? '#0d0e16' : level.sky.bottom }));
    const w = new THREE.Mesh(g, m); w.position.y = type === 'city' ? -0.5 : -60; root.add(w);
  }

  /* --- cielo: gradiente, sole/luna, nuvole procedurali, stelle --- */
  const skyGroup = new THREE.Group();
  const sunDir = new THREE.Vector3(...level.light.dir).normalize();
  const cl = look.clouds || {};
  const skyUniforms = {
    uTop: { value: new THREE.Color(level.sky.top) }, uHorizon: { value: new THREE.Color(level.sky.bottom) },
    uGround: { value: new THREE.Color(look.ground || level.sky.bottom) },
    uSunCol: { value: new THREE.Color(level.sky.sun) }, uSunDir: { value: sunDir }, uTime: SHARED.uTime,
    uSunSize: { value: look.sunSize ?? 0.99965 }, uSunHDR: { value: look.sunHDR ?? 9 }, uMoon: { value: look.moon ? 1 : 0 },
    uCover: { value: cl.cover ?? 0 }, uCloudScale: { value: cl.scale ?? 0.9 }, uCloudAlpha: { value: cl.alpha ?? 0.9 },
    uCloudCol: { value: new THREE.Color(cl.color || '#ffffff') }, uCloudShade: { value: new THREE.Color(cl.shade || '#a0aab8') },
    uStars: { value: level.stars ? 1 : 0 }, uGlow: { value: look.horizonGlow ?? 0.12 },
  };
  const skyFrag = (withClouds) => /* glsl */ `
    ${NOISE}
    uniform vec3 uTop, uHorizon, uGround, uSunCol, uSunDir, uCloudCol, uCloudShade;
    uniform float uTime, uSunSize, uSunHDR, uMoon, uCover, uCloudScale, uCloudAlpha, uStars, uGlow;
    varying vec3 vDir;
    void main(){
      vec3 d = normalize(vDir);
      float h = d.y;
      float t = clamp(h * 1.6 + 0.04, 0.0, 1.0);
      vec3 col = mix(uHorizon, uTop, pow(t, 0.75));
      float s = max(dot(d, uSunDir), 0.0);
      col += uSunCol * (pow(s, 7.0) * 0.3 * (1.0 - t * 0.5) + pow(s, 70.0) * 0.45) * (1.0 - uMoon * 0.75);
      col += uHorizon * uGlow * exp(-abs(h) * 16.0);
      float disc = smoothstep(uSunSize, uSunSize + 0.00022, s);
      vec3 sunC = uSunCol * uSunHDR;
      if (uMoon > 0.5) {
        vec2 mp = (d.xz - uSunDir.xz) * 900.0;
        sunC *= 0.75 + 0.25 * vnoise(mp * 0.6) - 0.2 * smoothstep(0.55, 0.7, vnoise(mp * 0.25 + 4.0));
      }
      col = mix(col, sunC, disc);
      ${withClouds ? `
      if (h > 0.005 && uCover > 0.0) {
        vec2 uv = d.xz / (h + 0.09) * uCloudScale + vec2(uTime * 0.0045, uTime * 0.0028);
        float n = fbm5(uv);
        float c = smoothstep(1.0 - uCover, 1.0 - uCover + 0.3, n);
        float n2 = fbm3(uv + uSunDir.xz * 0.14);
        float lit = clamp(0.55 + (n - n2) * 2.6, 0.0, 1.0);
        vec3 cc = mix(uCloudShade, uCloudCol, lit);
        cc += uSunCol * pow(s, 9.0) * 0.9 * (1.0 - c * 0.5) * (1.0 - uMoon);
        float fade = smoothstep(0.005, 0.22, h);
        col = mix(col, cc, c * fade * uCloudAlpha);
      }
      if (uStars > 0.0 && h > 0.0) {
        vec3 sp = d * 170.0;
        vec3 cell = floor(sp);
        float r = hash13(cell);
        if (r > 0.962) {
          vec3 off = vec3(hash13(cell + 1.7), hash13(cell + 3.1), hash13(cell + 5.3)) - 0.5;
          float dd = length(fract(sp) - 0.5 - off * 0.55);
          float tw = 0.55 + 0.45 * sin(uTime * (1.3 + r * 5.0) + r * 40.0);
          col += vec3(0.85, 0.9, 1.0) * (1.0 - smoothstep(0.0, 0.16, dd)) * tw * uStars * smoothstep(0.0, 0.3, h) * (0.6 + (r - 0.962) * 40.0);
        }
      }` : ''}
      if (h < 0.0) col = mix(col, uGround, 1.0 - smoothstep(-0.25, 0.0, h));
      gl_FragColor = vec4(col, 1.0);
    }`;
  const skyVert = /* glsl */ `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`;
  {
    const g = track(new THREE.SphereGeometry(4000, 48, 24));
    const m = track(new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyUniforms, vertexShader: skyVert, fragmentShader: skyFrag(true) }));
    const sky = new THREE.Mesh(g, m); sky.renderOrder = -10; sky.frustumCulled = false;
    skyGroup.add(sky);
  }
  // la versione 1.2 disegnava le stelle con 1800 numeri casuali del livello: si consumano uguali
  // (le stelle ora sono nello shader del cielo) perché cerchi e ostacoli restino identici
  if (level.stars) for (let i = 0; i < 1800; i++) R();
  root.add(skyGroup);
  // scena del cielo per le riflessioni (PMREM): niente nuvole né stelle
  const envScene = new THREE.Scene();
  {
    const g = track(new THREE.SphereGeometry(100, 32, 16));
    const m = track(new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, uniforms: Object.assign({}, skyUniforms, { uSunHDR: { value: Math.min(4, look.sunHDR ?? 9) } }), vertexShader: /* glsl */ `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`, fragmentShader: skyFrag(false) }));
    envScene.add(new THREE.Mesh(g, m));
  }

  /* --- luci --- */
  const hemi = new THREE.HemisphereLight(level.light.hemiSky, level.light.hemiGround, level.light.hemiI);
  root.add(hemi);
  const sun = new THREE.DirectionalLight(level.light.sun, level.light.sunI);
  const SB = low ? 110 : 150, SMAP = low ? 1024 : 2048;
  sun.castShadow = !!opts.shadows;
  if (opts.shadows) {
    sun.shadow.mapSize.set(SMAP, SMAP);
    const sc2 = sun.shadow.camera;
    sc2.left = -SB; sc2.right = SB; sc2.top = SB; sc2.bottom = -SB; sc2.near = 1; sc2.far = 1500;
    sc2.updateProjectionMatrix();
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.35;
  }
  sun.position.copy(sunDir).multiplyScalar(1000);
  root.add(sun, sun.target);
  const lx = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), sunDir).normalize();
  const ly = new THREE.Vector3().crossVectors(sunDir, lx).normalize();
  const sunTmp = new THREE.Vector3();
  function focusSun(p) {
    const texel = (2 * SB) / SMAP;
    const a = Math.round(p.dot(lx) / texel) * texel, b = Math.round(p.dot(ly) / texel) * texel, c = p.dot(sunDir);
    sunTmp.copy(lx).multiplyScalar(a).addScaledVector(ly, b).addScaledVector(sunDir, c);
    sun.target.position.copy(sunTmp);
    sun.position.copy(sunTmp).addScaledVector(sunDir, 750);
    sun.target.updateMatrixWorld();
  }

  /* --- cerchi --- */
  const rc = level.ring;
  const geoN = track(new THREE.TorusGeometry(rc.radius, 0.42, 12, 96));
  const geoG = track(new THREE.TorusGeometry(rc.radius * 0.7, 0.38, 12, 80));
  const geoF = track(new THREE.TorusGeometry(rc.radius * 1.5, 0.8, 14, 128));
  const startS = 260, endS = L - 120, spacing = (endS - startS) / rc.count;
  const rings = [];
  const ringMat = (color, kind) => new THREE.ShaderMaterial({
    uniforms: Object.assign(fogUniforms(), {
      uColor: { value: color.clone() }, uInt: { value: 1.6 }, uNext: { value: 0 }, uFade: { value: 1 }, uTime: SHARED.uTime,
      uAccent: { value: new THREE.Color(level.accent) },
    }),
    defines: kind === 'gold' ? { GOLD: '' } : kind === 'finish' ? { FINISH: '' } : {},
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vN; varying vec3 vW;
      #include <fog_pars_vertex>
      void main(){
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz; vN = normalize(mat3(modelMatrix) * normal);
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      ${NOISE}
      uniform vec3 uColor, uAccent; uniform float uInt, uNext, uFade, uTime;
      varying vec2 vUv; varying vec3 vN; varying vec3 vW;
      #include <fog_pars_fragment>
      void main(){
        vec3 V = normalize(cameraPosition - vW);
        float fres = 1.0 - abs(dot(V, normalize(vN)));
        float flow = 0.5 + 0.5 * sin(vUv.x * 6.2831 * 10.0 - uTime * 6.0);
        float glow = 0.75 + 0.8 * pow(fres, 1.6) + flow * 0.55 * uNext;
        vec3 col = uColor * uInt * glow;
        #ifdef GOLD
          col += vec3(4.0, 3.2, 1.6) * pow(vnoise(vec2(vUv.x * 70.0, uTime * 4.0)), 10.0) * 3.0;
        #endif
        #ifdef FINISH
          float chk = step(0.5, fract(vUv.x * 28.0 + step(0.5, vUv.y) * 0.5));
          col = mix(uAccent * 2.2, vec3(2.4), chk) * glow;
        #endif
        float a = clamp(0.62 + 0.38 * fres, 0.0, 1.0) * uFade;
        #ifdef USE_FOG
          col = mix(col, radFogColor(), radFogFactor() * 0.6);
        #endif
        gl_FragColor = vec4(col, a);
      }`,
    transparent: true, depthWrite: false, fog: true,
  });
  for (let k = 0; k <= rc.count; k++) {
    const finish = k === rc.count;
    const s = finish ? endS : startS + k * spacing;
    const u = s / L;
    const pos = curve.getPointAt(u);
    const tan = curve.getTangentAt(u).normalize();
    const gold = !finish && k >= 2 && R() < rc.gold;
    const radius = finish ? rc.radius * 1.5 : gold ? rc.radius * 0.7 : rc.radius;
    if (gold) pos.y -= rc.radius * 0.55;
    const color = new THREE.Color(finish ? '#ffffff' : gold ? '#ffc93a' : rc.color);
    const mat = track(ringMat(color, finish ? 'finish' : gold ? 'gold' : 'n'));
    const mesh = new THREE.Mesh(finish ? geoF : gold ? geoG : geoN, mat);
    mesh.position.copy(pos);
    mesh.lookAt(tmp.copy(pos).add(tan));
    mesh.renderOrder = 3;
    root.add(mesh);
    rings.push({ k, u, s, pos, tan, R: radius, gold, finish, mesh, mat, color, state: 0, anim: 0 });
  }
  // disco "portale" dentro il prossimo cerchio
  const discMat = track(new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(rc.color) }, uTime: SHARED.uTime, uOp: { value: 1 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uTime, uOp; varying vec2 vUv;
      void main(){
        vec2 p = vUv * 2.0 - 1.0; float r = length(p);
        float rip = 0.5 + 0.5 * sin(r * 26.0 + uTime * 7.0);
        float a = (1.0 - smoothstep(0.55, 1.0, r)) * (0.05 + 0.1 * rip * smoothstep(0.0, 0.6, r)) + smoothstep(0.82, 1.0, r) * (1.0 - smoothstep(0.97, 1.02, r)) * 0.3;
        gl_FragColor = vec4(uColor * a * 1.6 * uOp, 1.0);
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  }));
  const disc = new THREE.Mesh(track(new THREE.CircleGeometry(1, 64)), discMat);
  disc.renderOrder = 4;
  root.add(disc);

  /* --- scia guida: nastro luminoso con frecce che scorrono verso il prossimo cerchio --- */
  const M = Math.floor(L / 3);
  const gPos = new Float32Array(M * 2 * 3), gTan = new Float32Array(M * 2 * 3), gSide = new Float32Array(M * 2), gS = new Float32Array(M * 2);
  const gIdx = [];
  for (let i = 0; i < M; i++) {
    const u = i / (M - 1);
    curve.getPointAt(u, tmp);
    const t2 = curve.getTangentAt(u);
    for (let s = 0; s < 2; s++) {
      const v = i * 2 + s;
      gPos[v * 3] = tmp.x; gPos[v * 3 + 1] = tmp.y; gPos[v * 3 + 2] = tmp.z;
      gTan[v * 3] = t2.x; gTan[v * 3 + 1] = t2.y; gTan[v * 3 + 2] = t2.z;
      gSide[v] = s ? 1 : -1; gS[v] = u * L;
    }
    if (i < M - 1) { const b = i * 2; gIdx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
  }
  const gGeo = track(new THREE.BufferGeometry());
  gGeo.setAttribute('position', new THREE.BufferAttribute(gPos, 3));
  gGeo.setAttribute('aTan', new THREE.BufferAttribute(gTan, 3));
  gGeo.setAttribute('aSide', new THREE.BufferAttribute(gSide, 1));
  gGeo.setAttribute('aS', new THREE.BufferAttribute(gS, 1));
  gGeo.setIndex(gIdx);
  const guideU = { uA: { value: -1 }, uB: { value: -1 }, uC: { value: -1 }, uColor: { value: new THREE.Color(level.guide || rc.color) }, uTime: SHARED.uTime, uW: { value: 0.75 } };
  const gMat = track(new THREE.ShaderMaterial({
    uniforms: Object.assign(fogUniforms(), guideU),
    vertexShader: /* glsl */ `
      attribute vec3 aTan; attribute float aSide; attribute float aS;
      uniform float uW;
      varying float vS; varying float vSide;
      #include <fog_pars_vertex>
      void main(){
        vec3 c = position;
        vec3 toCam = normalize(cameraPosition - c);
        vec3 sv = normalize(cross(aTan, toCam) + vec3(1e-5));
        vec3 p = c + sv * aSide * uW;
        vS = aS; vSide = aSide;
        vec4 mvPosition = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uA, uB, uC, uTime; uniform vec3 uColor;
      varying float vS; varying float vSide;
      #include <fog_pars_fragment>
      void main(){
        float lum = (vS > uA && vS <= uB) ? min(1.0, (vS - uA) / 30.0) : (vS > uB && vS <= uC) ? 0.28 : 0.0;
        if (lum <= 0.0) discard;
        float as = abs(vSide);
        float chev = fract((vS + as * 2.2) / 7.0 - uTime * 1.1);
        float arrow = smoothstep(0.0, 0.12, chev) * (1.0 - smoothstep(0.32, 0.46, chev));
        float core = 1.0 - smoothstep(0.0, 0.22, as);
        float a = lum * (arrow * (1.0 - smoothstep(0.75, 1.0, as)) * 0.9 + core * 0.35);
        float ff = 0.0;
        #ifdef USE_FOG
          ff = radFogFactor();
        #endif
        gl_FragColor = vec4(uColor * a * 1.8 * (1.0 - ff), 1.0);
      }`,
    transparent: true, depthWrite: false, fog: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  }));
  const guide = new THREE.Mesh(gGeo, gMat); guide.frustumCulled = false; guide.renderOrder = 5; root.add(guide);

  let nextIdx = 0, progS = -1;
  function paintGuide() {
    const k = nextIdx, r = rings[k];
    guideU.uA.value = Math.max(k > 0 ? rings[k - 1].s - 4 : -1, progS + 14);
    guideU.uB.value = r ? r.s : -1;
    guideU.uC.value = rings[k + 1] ? rings[k + 1].s : guideU.uB.value;
  }
  function setProgress(s) {
    if (Math.abs(s - progS) < 1) return;
    progS = s; paintGuide();
  }
  function setNext(k) {
    nextIdx = k;
    const r = rings[k];
    if (r) {
      disc.visible = true;
      disc.position.copy(r.pos); disc.quaternion.copy(r.mesh.quaternion); disc.scale.setScalar(r.R * 0.97);
      discMat.uniforms.uColor.value.copy(r.color);
    } else disc.visible = false;
    paintGuide();
  }

  /* --- ostacoli (stessa sequenza casuale di sempre) --- */
  const obstacles = [];
  const inst = { foliage: [], trunk: [], rock: [], spire: [], box: [], building: [], cloud: [] };
  const beacons = [];
  const archGaps = new Set();
  const pick = (lo = 40) => lo + Math.floor(R() * (N - lo - 30));
  const clearOK = (x, z, rad, need) => { nearest(x, z); return near.d - rad > need; };
  const side = () => (R() < 0.5 ? -1 : 1);
  const lateral = (i, lat) => [sx[i] - tz[i] * lat, sz[i] + tx[i] * lat];
  const O = level.obstacles || {};

  if (O.trees) {
    const greens = ['#2f6a2a', '#3b7a2e', '#4a8a35', '#2a5a28', '#5a8f3a'];
    for (let t = 0; t < O.trees; t++) {
      const i = pick(8);
      const r = 2.6 + R() * 1.6, h = 10 + R() * 9;
      const lat = (ringR + 2 + r + Math.pow(R(), 1.6) * 420) * side();
      const [x, z] = lateral(i, lat);
      if (!clearOK(x, z, r, ringR + 1.5)) continue;
      const g = heightAt(x, z);
      if (g > 78) continue;
      obstacles.push({ shape: 'cone', kind: 'tree', x, z, y0: g, y1: g + h, r, br: r + 1, near: 5 });
      inst.trunk.push({ x, y: g, z, sx: 1, sy: h * 0.3, sz: 1, color: '#4a3322' });
      inst.foliage.push({ x, y: g + h * 0.22, z, sx: r, sy: h * 0.78, sz: r, rot: R() * 6, color: greens[Math.floor(R() * greens.length)] });
    }
  }
  if (O.pillars) {
    const rocks = ['#9c4a30', '#b25a38', '#8a3f2a', '#c06a42'];
    for (let t = 0; t < O.pillars; t++) {
      const i = pick(70);
      const r = 3.5 + R() * 3;
      const lat = (ringR + 2.5 + r + R() * (cw - ringR)) * side();
      const [x, z] = lateral(i, lat);
      if (!clearOK(x, z, r, ringR + 2)) continue;
      const g = heightAt(x, z) - 4;
      const h = 30 + R() * wallH;
      obstacles.push({ shape: 'cyl', kind: 'rock', x, z, y0: g, y1: g + h, r: r * 0.9, br: r + 1, near: 5.5 });
      inst.rock.push({ x, y: g, z, sx: r, sy: h, sz: r, rot: R() * 6, color: rocks[Math.floor(R() * rocks.length)], cap: true });
    }
  }
  if (O.icebergs) {
    const ice = ['#eaf6ff', '#cfe9f7', '#b9e0f2', '#f6fbff'];
    for (let t = 0; t < O.icebergs; t++) {
      const i = pick(60);
      const r = 5 + R() * 8;
      const lat = (ringR + 2.5 + r + Math.pow(R(), 1.3) * (cw + 20)) * side();
      const [x, z] = lateral(i, lat);
      if (!clearOK(x, z, r, ringR + 2)) continue;
      const h = 10 + R() * 50;
      obstacles.push({ shape: 'cone', kind: 'ice', x, z, y0: -8, y1: h, r, br: r + 1, near: 5.5 });
      inst.spire.push({ x, y: -8, z, sx: r, sy: h + 8, sz: r, rot: R() * 6, color: ice[Math.floor(R() * ice.length)] });
    }
  }
  if (O.spires) {
    const dark = ['#1e1a19', '#2a2321', '#352b27', '#18110f'];
    for (let t = 0; t < O.spires; t++) {
      const i = pick(60);
      const r = 4 + R() * 5;
      const lat = (ringR + 2.5 + r + Math.pow(R(), 1.3) * (cw + 40)) * side();
      const [x, z] = lateral(i, lat);
      if (!clearOK(x, z, r, ringR + 2)) continue;
      const g = groundAt(x, z) - 4;
      const h = 24 + R() * 70;
      obstacles.push({ shape: 'cone', kind: 'rock', x, z, y0: g, y1: g + h, r, br: r + 1, near: 5.5 });
      inst.spire.push({ x, y: g, z, sx: r, sy: h, sz: r, rot: R() * 6, color: dark[Math.floor(R() * dark.length)] });
    }
  }
  if (O.buildings) {
    const G = 34;
    const tones = ['#5b6280', '#4a5070', '#6a6f90', '#3e4462', '#7a7f9e'];
    for (let gz = sz[0] + 150; gz > sz[N] - 150; gz -= G) {
      for (let gx = minX - 400; gx < maxX + 400; gx += G) {
        const x = gx + (R() - 0.5) * 6, z = gz + (R() - 0.5) * 6;
        const w = 12 + R() * 16, d = 12 + R() * 16, rad = 0.5 * Math.hypot(w, d);
        nearest(x, z);
        if (near.d - rad < ringR + 5 || near.d > 430) continue;
        const close = 1 - Math.min(1, (near.d - rad) / 220);
        let h = 18 + R() * 55 + close * R() * 95;
        if (R() < 0.07) h += 80;
        const ob = { shape: 'box', kind: 'building', x, y: h / 2, z, hx: w / 2, hy: h / 2, hz: d / 2, cos: 1, sin: 0, br: rad, near: 5.5 };
        obstacles.push(ob);
        inst.building.push({ x, y: 0, z, sx: w, sy: h, sz: d, color: tones[Math.floor(R() * tones.length)], d: near.d, ob });
        if (h > 85) beacons.push(x, h + 1.5, z);
      }
    }
  }
  const nArch = O.arches || O.bridges || 0;
  const archList = [];
  for (let a = 0; a < nArch; a++) {
    const gap = Math.floor((a + 0.5) * rc.count / nArch);
    if (gap >= rc.count - 1) continue;
    archGaps.add(gap);
    const s = startS + (gap + 0.5) * spacing;
    const i = Math.round((s / L) * N);
    const lat = type === 'hills' ? ringR + 9 : type === 'fjord' ? ringR + 14 : type === 'city' ? ringR + 8 : cw + 5;
    const yb = sy[i] + 5 + R() * 4;
    const T = type === 'city' ? 3 : 6, D = type === 'city' ? 7 : 9, W = 2 * (lat + 7);
    const rot = Math.atan2(-tx[i], -tz[i]);
    obstacles.push({ shape: 'box', kind: 'arch', x: sx[i], y: yb + T / 2, z: sz[i], hx: W / 2, hy: T / 2, hz: D / 2, cos: Math.cos(rot), sin: Math.sin(rot), br: W / 2 + D, near: 9 });
    inst.box.push({ x: sx[i], y: yb + T / 2, z: sz[i], sx: W, sy: T, sz: D, rot, color: level.archColor });
    archList.push({ x: sx[i], y: yb, z: sz[i], W, T, D, rot });
    if (type !== 'city') {
      for (const sg of [-1, 1]) {
        const [qx, qz] = lateral(i, lat * sg);
        const g = Math.min(heightAt(qx, qz), yb) - 3;
        obstacles.push({ shape: 'cyl', kind: 'arch', x: qx, z: qz, y0: g, y1: yb, r: 2.8, br: 4, near: 5 });
        inst.rock.push({ x: qx, y: g, z: qz, sx: 3.1, sy: yb - g + 1, sz: 3.1, color: level.archColor, pillar: true });
      }
    }
  }
  if (level.clouds) {
    for (let c = 0; c < level.clouds; c++) {
      const i = pick(0);
      const [x, z] = lateral(i, (R() * 2 - 1) * 650);
      const y = sy[i] + 120 + R() * 90;
      const blobs = 3 + Math.floor(R() * 3);
      for (let b = 0; b < blobs; b++) {
        const s = 10 + R() * 14;
        const bx = x + (R() - 0.5) * 50, by = y + (R() - 0.5) * 10, bz = z + (R() - 0.5) * 30;
        inst.cloud.push({ x: bx, y: by, z: bz, sx: s * 2.6, sy: s * 1.7, sz: 1 });
        for (let e = 0; e < 2; e++) inst.cloud.push({ x: bx + (R2() - 0.5) * s * 2.4, y: by + (R2() - 0.3) * s * 0.7, z: bz + (R2() - 0.5) * s * 1.5, sx: s * (1.4 + R2()), sy: s * (1.0 + R2() * 0.6), sz: 1 });
      }
    }
  }

  /* --- mesh istanziate degli ostacoli --- */
  const dummy = new THREE.Object3D(), icol = new THREE.Color();
  function mkInst(list, geo, mat, { shadow = true, receive = true, colorJitter = 0.08 } = {}) {
    track(geo); track(mat);
    if (!list.length) return null;
    const m = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((e, k) => {
      dummy.position.set(e.x, e.y, e.z); dummy.rotation.set(0, e.rot || 0, 0); dummy.scale.set(e.sx, e.sy, e.sz);
      dummy.updateMatrix(); m.setMatrixAt(k, dummy.matrix);
      if (e.color) { icol.set(e.color); if (colorJitter) icol.multiplyScalar(1 - colorJitter + R2() * colorJitter * 2); m.setColorAt(k, icol); }
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.frustumCulled = false;
    m.castShadow = shadow && !!opts.shadows; m.receiveShadow = receive;
    root.add(m);
    return m;
  }
  const std = (o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color: '#ffffff', flatShading: true, roughness: 0.9, metalness: 0 }, o));

  // alberi: chioma a tre palchi che ondeggia nel vento
  if (inst.foliage.length) {
    const tiers = [[1.0, 0.55, 0.0], [0.8, 0.5, 0.27], [0.55, 0.46, 0.54]].map(([r, h, y]) => new THREE.ConeGeometry(r, h, 8, 1).translate(0, y + h / 2, 0));
    const fg = mergeGeometries(tiers); tiers.forEach((t) => t.dispose());
    mkInst(inst.foliage, fg, patchStd(std({ roughness: 0.82 }), { wind: true, detail: 0.8 }));
    mkInst(inst.trunk, new THREE.CylinderGeometry(0.3, 0.45, 1, 6).translate(0, 0.5, 0), std({ roughness: 0.95 }), { colorJitter: 0.15 });
  }
  // rocce, pilastri e piloni degli archi
  if (inst.rock.length) {
    const rg = displaceGeo(new THREE.CylinderGeometry(0.8, 1, 1, 10, 7).translate(0, 0.5, 0), nA, 0.16, 2.2, level.seed % 97);
    const rockMat = patchStd(std({ roughness: 0.92 }), { strata: type === 'canyon', cracks: type === 'volcano' ? new THREE.Color(3.2, 0.7, 0.12) : null });
    if (type === 'fjord') { rockMat.roughness = 0.35; rockMat.emissive = new THREE.Color('#0f2a38'); envMats.push(rockMat); }
    mkInst(inst.rock, rg, rockMat);
    const caps = inst.rock.filter((e) => e.cap).map((e) => ({ x: e.x, y: e.y + e.sy - 2.6, z: e.z, sx: e.sx * 1.02, sy: 2.8, sz: e.sx * 1.02, rot: e.rot, color: '#5e2a1c' }));
    if (caps.length) mkInst(caps, displaceGeo(new THREE.CylinderGeometry(1, 0.86, 1, 9, 2).translate(0, 0.5, 0), nB, 0.12, 3, 5), patchStd(std({ roughness: 0.95 }), { strata: true }));
  }
  // guglie: iceberg (fiordi) o ossidiana con venature di lava (vulcano)
  if (inst.spire.length) {
    const sg = displaceGeo(new THREE.ConeGeometry(1, 1, 8, 6).translate(0, 0.5, 0), nC, 0.2, 2.6, level.seed % 53, true);
    let sm;
    if (type === 'fjord') {
      // ghiaccio a facce piatte: azzurro e quasi luminoso vicino all'acqua, bianco in cima
      sm = std({ roughness: 0.2, metalness: 0.0, flatShading: true, emissive: new THREE.Color('#0d3346'), emissiveIntensity: 1.0 });
      sm.onBeforeCompile = (sh) => {
        sh.vertexShader = 'varying vec3 vIceW;\n' + sh.vertexShader.replace('#include <fog_vertex>', `#include <fog_vertex>
          vec4 iw = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            iw = instanceMatrix * iw;
          #endif
          vIceW = (modelMatrix * iw).xyz;`);
        sh.fragmentShader = 'varying vec3 vIceW;\n' + sh.fragmentShader
          .replace('#include <color_fragment>', `#include <color_fragment>
            float iceK = smoothstep(-3.0, 16.0, vIceW.y);
            diffuseColor.rgb *= mix(vec3(0.42, 0.76, 0.9), vec3(1.0), iceK);`)
          .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
            totalEmissiveRadiance += vec3(0.04, 0.2, 0.28) * (1.0 - iceK);`);
      };
      sm.customProgramCacheKey = () => 'ice';
      envMats.push(sm);
    } else {
      sm = patchStd(std({ roughness: 0.55, metalness: 0.15 }), { cracks: new THREE.Color(3.4, 0.75, 0.12) });
      envMats.push(sm);
    }
    mkInst(inst.spire, sg, sm);
  }
  // archi e ponti
  if (inst.box.length) {
    const bg = new THREE.BoxGeometry(1, 1, 1, 6, 2, 2);
    let bm;
    if (type === 'city') { bm = std({ color: '#ffffff', roughness: 0.4, metalness: 0.7 }); envMats.push(bm); }
    else if (type === 'fjord') { bm = std({ roughness: 0.3, emissive: new THREE.Color('#14384a'), emissiveIntensity: 0.8 }); envMats.push(bm); }
    else bm = patchStd(std({ roughness: 0.9 }), { strata: type === 'canyon', cracks: type === 'volcano' ? new THREE.Color(3, 0.65, 0.1) : null });
    mkInst(inst.box, type === 'city' ? bg : displaceGeo(bg, nB, 0.04, 1.5, 3), bm);
    if (type === 'city') {
      // strisce luminose lungo i bordi dei ponti
      const strips = [];
      for (const a of archList) for (const sgn of [-1, 1]) {
        const ox = Math.cos(a.rot) * 0, oz = 0;
        const lx2 = Math.sin(a.rot) * (a.D / 2) * sgn, lz2 = Math.cos(a.rot) * (a.D / 2) * sgn;
        strips.push({ x: a.x + lx2 + ox, y: a.y + a.T + 0.12, z: a.z + lz2 + oz, sx: a.W, sy: 0.22, sz: 0.22, rot: a.rot, color: new THREE.Color(0.3, 2.6, 3.2) });
        strips.push({ x: a.x + lx2, y: a.y - 0.05, z: a.z + lz2, sx: a.W, sy: 0.18, sz: 0.18, rot: a.rot, color: new THREE.Color(3.2, 0.5, 2.6) });
      }
      mkInst(strips, new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: '#ffffff' }), { shadow: false, colorJitter: 0 });
    }
  }
  // città: facciate con finestre, insegne al neon, luci sui tetti
  if (inst.building.length) {
    // come sopra: stesso consumo della texture delle finestre della 1.2, poi una sequenza propria
    for (let i = 0; i < 64; i++) if (R() < 0.36) { R(); R(); }
    const wt = track(windowTexture(rng(level.seed * 13 + 5)));
    const bmat = new THREE.MeshStandardMaterial({ color: '#ffffff', map: wt, emissive: '#ffffff', emissiveMap: wt, emissiveIntensity: 1.35, roughness: 0.32, metalness: 0.55 });
    envMats.push(bmat);
    bmat.onBeforeCompile = (sh) => {
      sh.vertexShader = 'varying vec3 vWPos; varying vec3 vWN; varying float vSeed;\n' + sh.vertexShader
        .replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>
          vec3 wn0 = objectNormal;
          #ifdef USE_INSTANCING
            wn0 = mat3(instanceMatrix) * wn0;
            vSeed = instanceMatrix[3].x * 0.131 + instanceMatrix[3].z * 0.071;
          #else
            vSeed = 0.0;
          #endif
          vWN = normalize(mat3(modelMatrix) * wn0);`)
        .replace('#include <fog_vertex>', `#include <fog_vertex>
          vec4 rw = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            rw = instanceMatrix * rw;
          #endif
          vWPos = (modelMatrix * rw).xyz;`);
      sh.fragmentShader = 'varying vec3 vWPos; varying vec3 vWN; varying float vSeed;\n' + sh.fragmentShader
        .replace('#include <map_fragment>', `
          vec2 wuv = abs(vWN.x) > 0.5 ? vec2(vWPos.z, vWPos.y) : vec2(vWPos.x, vWPos.y);
          wuv = wuv / vec2(25.6, 56.0) + vec2(fract(vSeed * 7.13), fract(vSeed * 3.71));
          float roof = step(0.5, vWN.y);
          vec4 wcol = texture2D(map, wuv);
          diffuseColor.rgb *= mix(wcol.rgb * 1.6 + 0.04, vec3(0.05, 0.055, 0.07), roof);`)
        .replace('#include <emissivemap_fragment>', `
          totalEmissiveRadiance *= texture2D(emissiveMap, wuv).rgb * (1.0 - roof) * (0.85 + 0.3 * fract(vSeed * 13.7));`);
    };
    bmat.customProgramCacheKey = () => 'buildings';
    mkInst(inst.building, new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), bmat, { colorJitter: 0.1 });
    const neonCols = [new THREE.Color(0.3, 2.8, 3.4), new THREE.Color(3.4, 0.4, 2.6), new THREE.Color(3.6, 1.6, 0.3), new THREE.Color(1.2, 0.6, 3.6)];
    const neon = [], crowns = [];
    for (const b of inst.building) {
      if (b.d < 240 && R2() < 0.3) {
        const c = neonCols[Math.floor(R2() * neonCols.length)];
        const y = b.sy * (0.35 + R2() * 0.55);
        neon.push({ x: b.x, y, z: b.z, sx: b.sx + 0.25, sy: 0.45, sz: b.sz + 0.25, color: c });
        if (R2() < 0.4) neon.push({ x: b.x, y: y - 2.2, z: b.z, sx: b.sx + 0.25, sy: 0.25, sz: b.sz + 0.25, color: c });
      }
      if (b.sy > 60 && R2() < 0.55) crowns.push({ x: b.x, y: b.sy - 0.2, z: b.z, sx: b.sx + 0.1, sy: 0.35, sz: b.sz + 0.1, color: neonCols[Math.floor(R2() * 2)] });
    }
    const neonMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    mkInst(neon, new THREE.BoxGeometry(1, 1, 1), neonMat, { shadow: false, colorJitter: 0 });
    mkInst(crowns, new THREE.BoxGeometry(1, 1, 1), neonMat.clone(), { shadow: false, colorJitter: 0 });
  }
  // nuvole: grandi sprite morbidi illuminati dal sole
  let cloudMesh = null;
  if (inst.cloud.length) {
    const ptex = track(puffTexture(128, level.seed % 1000 + 3));
    const cm = new THREE.ShaderMaterial({
      uniforms: Object.assign(fogUniforms(), { map: { value: ptex }, uLit: { value: new THREE.Color(level.cloudColor || '#ffffff') }, uShade: { value: new THREE.Color(look.cloudShade || '#9aa6b6') }, uSunCol: { value: new THREE.Color(level.sky.sun) } }),
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying float vSunF;
        uniform vec3 uFogSunDir;
        #include <fog_pars_vertex>
        void main(){
          vUv = uv;
          vec3 center = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          float sx = length(instanceMatrix[0].xyz), sy = length(instanceMatrix[1].xyz);
          vec4 mvPosition = viewMatrix * vec4(center, 1.0);
          mvPosition.xy += position.xy * vec2(sx, sy);
          vSunF = pow(max(dot(normalize(center - cameraPosition), uFogSunDir), 0.0), 5.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map; uniform vec3 uLit, uShade, uSunCol;
        varying vec2 vUv; varying float vSunF;
        #include <fog_pars_fragment>
        void main(){
          vec4 t = texture2D(map, vUv);
          float a = t.a * 0.95;
          if (a < 0.01) discard;
          vec3 col = mix(uShade, uLit, clamp(vUv.y * 1.15 - 0.05, 0.0, 1.0));
          col += uSunCol * vSunF * (1.0 - a) * 0.9;
          gl_FragColor = vec4(col, a);
          #include <fog_fragment>
        }`,
      transparent: true, depthWrite: false, fog: true,
    });
    cloudMesh = mkInst(inst.cloud, new THREE.PlaneGeometry(1, 1), cm, { shadow: false, receive: false, colorJitter: 0 });
    if (cloudMesh) cloudMesh.renderOrder = 2;
  }
  // luci rosse lampeggianti in cima ai grattacieli
  let beaconMat = null;
  if (beacons.length) {
    const g = track(new THREE.BufferGeometry()); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(beacons), 3));
    beaconMat = track(new THREE.PointsMaterial({ color: new THREE.Color(4, 0.25, 0.3), size: 3.8, map: track(glowTexture(64, 0.25)), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    const b = new THREE.Points(g, beaconMat); b.frustumCulled = false; root.add(b);
  }

  /* --- particelle ambientali: braci (vulcano) e neve (fiordi) --- */
  let embers = null, emberV = null, snow = null, snowV = null;
  const softTex = track(glowTexture(64, 0.3));
  if (level.embers) {
    const n = low ? 260 : 480, p = new Float32Array(n * 3); emberV = new Float32Array(n);
    for (let i = 0; i < n; i++) { p[i * 3] = (R2() - 0.5) * 240; p[i * 3 + 1] = (R2() - 0.5) * 120; p[i * 3 + 2] = (R2() - 0.5) * 240; emberV[i] = 3 + R2() * 7; }
    const g = track(new THREE.BufferGeometry()); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const m = track(new THREE.PointsMaterial({ color: new THREE.Color(3.2, 1.1, 0.3), size: 0.85, map: softTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    embers = new THREE.Points(g, m); embers.frustumCulled = false; root.add(embers);
  }
  if (level.snow) {
    const n = low ? 400 : 900, p = new Float32Array(n * 3); snowV = new Float32Array(n);
    for (let i = 0; i < n; i++) { p[i * 3] = (R2() - 0.5) * 160; p[i * 3 + 1] = (R2() - 0.5) * 80; p[i * 3 + 2] = (R2() - 0.5) * 160; snowV[i] = 1.2 + R2() * 1.8; }
    const g = track(new THREE.BufferGeometry()); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const m = track(new THREE.PointsMaterial({ color: '#ffffff', size: 0.32, map: softTex, transparent: true, depthWrite: false, opacity: 0.85 }));
    snow = new THREE.Points(g, m); snow.frustumCulled = false; root.add(snow);
  }

  /* --- bersagli: mine sulla rotta e bersagli a terra --- */
  const targets = buildTargets({
    level, R2, curve, L, N, sx, sy, sz, tx, tz, rings, obstacles, nearest, near, heightAt, groundAt, waterY,
    root, track, envMats, archGaps, startS, spacing, buildings: inst.building, shadows: !!opts.shadows, low,
  });

  /* --- animazione per fotogramma --- */
  const redC = new THREE.Color('#ff3b3b');
  function update(dt, t, camPos) {
    skyGroup.position.copy(camPos);
    if (beaconMat) beaconMat.opacity = 0.3 + 0.7 * (Math.sin(t * 3) > 0.2 ? 1 : 0.15);
    if (embers) {
      const p = embers.geometry.attributes.position.array;
      for (let i = 0; i < emberV.length; i++) {
        p[i * 3 + 1] += emberV[i] * dt;
        p[i * 3] += Math.sin(t + i) * dt * 1.5;
        if (p[i * 3 + 1] > 60) p[i * 3 + 1] -= 120;
      }
      embers.geometry.attributes.position.needsUpdate = true;
      embers.position.set(Math.round(camPos.x / 240) * 240, camPos.y, Math.round(camPos.z / 240) * 240);
    }
    if (snow) {
      const p = snow.geometry.attributes.position.array;
      for (let i = 0; i < snowV.length; i++) {
        p[i * 3 + 1] -= snowV[i] * dt;
        p[i * 3] += Math.sin(t * 0.7 + i) * dt * 0.8;
        if (p[i * 3 + 1] < -40) p[i * 3 + 1] += 80;
      }
      snow.geometry.attributes.position.needsUpdate = true;
      snow.position.set(Math.round(camPos.x / 160) * 160, camPos.y, Math.round(camPos.z / 160) * 160);
    }
    for (let k = 0; k < rings.length; k++) {
      const r = rings[k];
      if (!r.mesh.visible) continue;
      const u = r.mat.uniforms;
      if (r.state === 0) {
        const isNext = k === nextIdx;
        u.uNext.value = isNext ? 1 : 0;
        u.uInt.value = isNext ? 2.3 + 0.5 * Math.sin(t * 7) : 1.15;
        u.uFade.value = isNext ? 1 : 0.7;
        r.mesh.scale.setScalar(isNext ? 1 + 0.035 * Math.sin(t * 7) : 1);
      } else {
        r.anim += dt;
        const a = r.anim / 0.6;
        if (r.state === 2) u.uColor.value.copy(redC);
        r.mesh.scale.setScalar(r.state === 1 ? 1 + a * 1.4 : 1 - a * 0.3);
        u.uInt.value = r.state === 1 ? 5 * (1 - a) + 1 : 1.5;
        u.uFade.value = Math.max(0, 1 - a);
        if (a >= 1) r.mesh.visible = false;
      }
    }
    discMat.uniforms.uOp.value = 0.8 + 0.2 * Math.sin(t * 7);
  }

  function reset() {
    for (const r of rings) { r.state = 0; r.anim = 0; r.mesh.visible = true; r.mesh.scale.setScalar(1); r.mat.uniforms.uColor.value.copy(r.color); r.mat.uniforms.uFade.value = 1; }
    for (const o of obstacles) { o.hit = false; o.minD = undefined; o.seen = -1; }
    targets.reset();
    progS = -1;
    setNext(0);
  }

  function setEnv(tex) {
    for (const m of envMats) { const was = !!m.envMap; m.envMap = tex; if (!was) m.needsUpdate = true; }
  }

  function dispose() {
    root.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
    for (const d of disposables) d.dispose && d.dispose();
  }

  reset();

  return {
    level, look, root, curve, L, N, sx, sy, sz, tx, tz, sunDir, sun, envScene,
    rings, obstacles, targets, nearest, heightAt, groundAt, waterY, setNext, setProgress, update, reset, dispose, focusSun, setEnv,
    fog: new THREE.FogExp2(level.sky.bottom, level.fogDensity),
    bg: new THREE.Color(level.sky.bottom),
  };
}
