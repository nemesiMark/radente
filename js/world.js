// Costruzione del mondo di un livello: terreno, percorso, cerchi, scia guida, ostacoli, cielo.
import * as THREE from 'three';

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

export function dotTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function windowTexture(r) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#0c0e17'; g.fillRect(0, 0, 64, 128);
  const warm = ['#ffd28a', '#ffc070', '#ffe7b5'], cool = ['#9fd8ff', '#c7b8ff', '#7ff0ff'];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 4; x++) {
    const v = r();
    if (v < 0.36) { const set = r() < 0.6 ? warm : cool; g.fillStyle = set[Math.floor(r() * 3)]; }
    else g.fillStyle = '#161a28';
    g.fillRect(4 + x * 15, 3 + y * 8, 10, 5);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
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
  let r = o.r;
  if (o.shape === 'cone') { const t = (y - o.y0) / (o.y1 - o.y0); r = o.r * Math.min(1, Math.max(0, 1 - t)); }
  const h = Math.hypot(x - o.x, z - o.z) - r;
  const v = Math.max(o.y0 - y, y - o.y1);
  const hx = Math.max(h, 0), vx = Math.max(v, 0);
  return Math.sqrt(hx * hx + vx * vx) + Math.min(Math.max(h, v), 0);
}

/* ---------- costruzione ---------- */
export function buildWorld(level, opts = {}) {
  const low = !!opts.low;
  const root = new THREE.Group();
  const disposables = [];
  const track = (o) => { disposables.push(o); return o; };

  const R = rng(level.seed);
  const nA = makeNoise(level.seed + 11), nB = makeNoise(level.seed + 23), nC = makeNoise(level.seed + 37);
  const fbm = (n, x, y, o) => { let s = 0, a = 1, f = 1, t = 0; for (let i = 0; i < o; i++) { s += a * n(x * f, y * f); t += a; a *= 0.5; f *= 2.03; } return s / t; };
  const ridged = (x, y, o) => {
    let s = 0, a = 1, f = 1, t = 0;
    for (let i = 0; i < o; i++) { let v = 1 - Math.abs(nB(x * f, y * f)) * 1.5; v = Math.max(0, v); s += a * v * v; t += a; a *= 0.5; f *= 2.1; }
    return s / t;
  };

  const type = level.type;
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

  /* --- terreno --- */
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

  let minX = Infinity, maxX = -Infinity;
  for (let i = 0; i <= N; i++) { if (sx[i] < minX) minX = sx[i]; if (sx[i] > maxX) maxX = sx[i]; }
  {
    const cell = low ? 15 : 10, margin = 760;
    const x0 = minX - margin, x1 = maxX + margin, z0 = sz[0] + 420, z1 = sz[N] - 520;
    const nx = Math.ceil((x1 - x0) / cell) + 1, nz = Math.ceil((z0 - z1) / cell) + 1;
    const pos = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 3);
    const pal = level.palette.map(([h, c]) => [h, new THREE.Color(c)]);
    const lavaTint = new THREE.Color('#a8320f');
    const cc = new THREE.Color();
    const palColor = (h) => {
      if (h <= pal[0][0]) return cc.copy(pal[0][1]);
      for (let k = 1; k < pal.length; k++) if (h <= pal[k][0]) return cc.copy(pal[k - 1][1]).lerp(pal[k][1], (h - pal[k - 1][0]) / (pal[k][0] - pal[k - 1][0]));
      return cc.copy(pal[pal.length - 1][1]);
    };
    let v = 0;
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const edge = i === 0 || j === 0 || i === nx - 1 || j === nz - 1;
        const x = x0 + i * cell + (edge ? 0 : (R() - 0.5) * cell * 0.6);
        const z = z0 - j * cell + (edge ? 0 : (R() - 0.5) * cell * 0.6);
        const h = heightAt(x, z);
        pos[v] = x; pos[v + 1] = h; pos[v + 2] = z;
        let hh = h + nC(x * 0.03, z * 0.03) * 6;
        if (level.stripes) hh += Math.sin(h * 0.32 + nB(x * 0.01, z * 0.01) * 2) * 5;
        palColor(hh);
        if (level.water && level.water.lava && h < 6) cc.lerp(lavaTint, Math.min(1, (6 - h) / 9));
        cc.multiplyScalar(0.9 + R() * 0.18);
        col[v] = cc.r; col[v + 1] = cc.g; col[v + 2] = cc.b;
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
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const mat = track(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    const terrain = new THREE.Mesh(geo, mat);
    terrain.frustumCulled = false;
    root.add(terrain);
  }

  /* --- acqua / lava / fondo lontano --- */
  let lavaMat = null;
  if (level.water) {
    const g = track(new THREE.PlaneGeometry(30000, 30000).rotateX(-Math.PI / 2));
    let m;
    if (level.water.lava) { m = lavaMat = new THREE.MeshBasicMaterial({ color: level.water.color }); }
    else m = new THREE.MeshPhongMaterial({ color: level.water.color, transparent: true, opacity: level.water.opacity, shininess: 60, specular: '#4a6a7a' });
    track(m);
    const w = new THREE.Mesh(g, m); w.position.y = level.water.y; root.add(w);
  } else {
    const g = track(new THREE.PlaneGeometry(30000, 30000).rotateX(-Math.PI / 2));
    const m = track(new THREE.MeshBasicMaterial({ color: type === 'city' ? '#15161f' : level.sky.bottom }));
    const w = new THREE.Mesh(g, m); w.position.y = type === 'city' ? -0.5 : -60; root.add(w);
  }

  /* --- cielo --- */
  const skyGroup = new THREE.Group();
  const sunDir = new THREE.Vector3(...level.light.dir).normalize();
  {
    const g = track(new THREE.SphereGeometry(4000, 32, 16));
    const m = track(new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new THREE.Color(level.sky.top) }, bottom: { value: new THREE.Color(level.sky.bottom) },
        sunColor: { value: new THREE.Color(level.sky.sun) }, sunDir: { value: sunDir },
      },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }',
      fragmentShader: 'uniform vec3 top; uniform vec3 bottom; uniform vec3 sunColor; uniform vec3 sunDir; varying vec3 vDir;\n' +
        'void main(){ vec3 d = normalize(vDir); float h = clamp(d.y * 1.6 + 0.04, 0.0, 1.0); vec3 c = mix(bottom, top, pow(h, 0.75));\n' +
        'float s = max(dot(d, sunDir), 0.0); c += sunColor * (pow(s, 900.0) * 1.6 + pow(s, 10.0) * 0.22);\n' +
        'gl_FragColor = vec4(c, 1.0);\n#include <colorspace_fragment>\n}',
    }));
    const sky = new THREE.Mesh(g, m); sky.renderOrder = -10; sky.frustumCulled = false;
    skyGroup.add(sky);
  }
  if (level.stars) {
    const n = 900, p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const th = R() * Math.PI * 2, y = 0.12 + R() * 0.88, r = Math.sqrt(1 - y * y);
      p[i * 3] = Math.cos(th) * r * 3500; p[i * 3 + 1] = y * 3500; p[i * 3 + 2] = Math.sin(th) * r * 3500;
    }
    const g = track(new THREE.BufferGeometry()); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const m = track(new THREE.PointsMaterial({ color: '#dfe4ff', size: 1.6, sizeAttenuation: false, fog: false, depthWrite: false, transparent: true, opacity: 0.85 }));
    const s = new THREE.Points(g, m); s.renderOrder = -9; s.frustumCulled = false; skyGroup.add(s);
  }
  root.add(skyGroup);

  /* --- luci --- */
  root.add(new THREE.HemisphereLight(level.light.hemiSky, level.light.hemiGround, level.light.hemiI));
  const sun = new THREE.DirectionalLight(level.light.sun, level.light.sunI);
  sun.position.copy(sunDir).multiplyScalar(1000);
  root.add(sun);

  /* --- cerchi --- */
  const rc = level.ring;
  const geoN = track(new THREE.TorusGeometry(rc.radius, 0.45, 8, 48));
  const geoG = track(new THREE.TorusGeometry(rc.radius * 0.7, 0.4, 8, 40));
  const geoF = track(new THREE.TorusGeometry(rc.radius * 1.5, 0.85, 10, 64));
  const startS = 260, endS = L - 120, spacing = (endS - startS) / rc.count;
  const rings = [];
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
    const mat = track(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5 }));
    const mesh = new THREE.Mesh(finish ? geoF : gold ? geoG : geoN, mat);
    mesh.position.copy(pos);
    mesh.lookAt(tmp.copy(pos).add(tan));
    root.add(mesh);
    rings.push({ k, u, s, pos, tan, R: radius, gold, finish, mesh, mat, color, state: 0, anim: 0 });
  }
  const disc = new THREE.Mesh(track(new THREE.CircleGeometry(1, 48)), track(new THREE.MeshBasicMaterial({ color: rc.color, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false })));
  root.add(disc);

  /* --- scia guida --- */
  const dotTex = track(dotTexture());
  const M = Math.floor(L / 8);
  const gPos = new Float32Array(M * 3), gCol = new Float32Array(M * 3), gS = new Float32Array(M);
  for (let i = 0; i < M; i++) {
    curve.getPointAt(i / M, tmp);
    gPos[i * 3] = tmp.x; gPos[i * 3 + 1] = tmp.y; gPos[i * 3 + 2] = tmp.z; gS[i] = (i / M) * L;
  }
  const gGeo = track(new THREE.BufferGeometry());
  gGeo.setAttribute('position', new THREE.BufferAttribute(gPos, 3));
  gGeo.setAttribute('color', new THREE.BufferAttribute(gCol, 3));
  const gMat = track(new THREE.PointsMaterial({ size: 1.5, map: dotTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  const guide = new THREE.Points(gGeo, gMat); guide.frustumCulled = false; root.add(guide);
  const guideCol = new THREE.Color(level.guide || rc.color);

  let nextIdx = 0, progS = -1;
  function paintGuide() {
    const k = nextIdx, r = rings[k];
    const a = Math.max(k > 0 ? rings[k - 1].s - 4 : -1, progS + 14);
    const b = r ? r.s : -1;
    const c = rings[k + 1] ? rings[k + 1].s : b;
    for (let i = 0; i < M; i++) {
      const s = gS[i];
      const lum = s > a && s <= b ? Math.min(1, (s - a) / 30) : s > b && s <= c ? 0.3 : 0;
      gCol[i * 3] = guideCol.r * lum; gCol[i * 3 + 1] = guideCol.g * lum; gCol[i * 3 + 2] = guideCol.b * lum;
    }
    gGeo.attributes.color.needsUpdate = true;
  }
  function setProgress(s) {
    if (Math.abs(s - progS) < 3) return;
    progS = s; paintGuide();
  }
  function setNext(k) {
    nextIdx = k;
    const r = rings[k];
    if (r) {
      disc.visible = true;
      disc.position.copy(r.pos); disc.quaternion.copy(r.mesh.quaternion); disc.scale.setScalar(r.R);
      disc.material.color.copy(r.color);
    } else disc.visible = false;
    paintGuide();
  }

  /* --- ostacoli --- */
  const obstacles = [];
  const inst = { foliage: [], trunk: [], rock: [], spire: [], box: [], building: [], cloud: [] };
  const beacons = [];
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
      inst.trunk.push({ x, y: g, z, sx: 1, sy: h * 0.3, sz: 1, color: '#5a3d26' });
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
      inst.rock.push({ x, y: g, z, sx: r, sy: h, sz: r, rot: R() * 6, color: rocks[Math.floor(R() * rocks.length)] });
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
        obstacles.push({ shape: 'box', kind: 'building', x, y: h / 2, z, hx: w / 2, hy: h / 2, hz: d / 2, cos: 1, sin: 0, br: rad, near: 5.5 });
        inst.building.push({ x, y: 0, z, sx: w, sy: h, sz: d, color: tones[Math.floor(R() * tones.length)] });
        if (h > 85) beacons.push(x, h + 1.5, z);
      }
    }
  }
  const nArch = O.arches || O.bridges || 0;
  for (let a = 0; a < nArch; a++) {
    const gap = Math.floor((a + 0.5) * rc.count / nArch);
    if (gap >= rc.count - 1) continue;
    const s = startS + (gap + 0.5) * spacing;
    const i = Math.round((s / L) * N);
    const lat = type === 'hills' ? ringR + 9 : type === 'fjord' ? ringR + 14 : type === 'city' ? ringR + 8 : cw + 5;
    const yb = sy[i] + 5 + R() * 4;
    const T = type === 'city' ? 3 : 6, D = type === 'city' ? 7 : 9, W = 2 * (lat + 7);
    const rot = Math.atan2(-tx[i], -tz[i]);
    obstacles.push({ shape: 'box', kind: 'arch', x: sx[i], y: yb + T / 2, z: sz[i], hx: W / 2, hy: T / 2, hz: D / 2, cos: Math.cos(rot), sin: Math.sin(rot), br: W / 2 + D, near: 9 });
    inst.box.push({ x: sx[i], y: yb + T / 2, z: sz[i], sx: W, sy: T, sz: D, rot, color: level.archColor });
    if (type !== 'city') {
      for (const sg of [-1, 1]) {
        const [qx, qz] = lateral(i, lat * sg);
        const g = Math.min(heightAt(qx, qz), yb) - 3;
        obstacles.push({ shape: 'cyl', kind: 'arch', x: qx, z: qz, y0: g, y1: yb, r: 2.8, br: 4, near: 5 });
        inst.rock.push({ x: qx, y: g, z: qz, sx: 3.1, sy: yb - g + 1, sz: 3.1, color: level.archColor });
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
        inst.cloud.push({ x: x + (R() - 0.5) * 50, y: y + (R() - 0.5) * 10, z: z + (R() - 0.5) * 30, sx: s * 1.4, sy: s * 0.8, sz: s, rot: R() * 6, color: level.cloudColor || '#ffffff' });
      }
    }
  }

  const dummy = new THREE.Object3D(), icol = new THREE.Color();
  function mkInst(list, geo, mat) {
    track(geo); track(mat);
    if (!list.length) return;
    const m = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((e, k) => {
      dummy.position.set(e.x, e.y, e.z); dummy.rotation.set(0, e.rot || 0, 0); dummy.scale.set(e.sx, e.sy, e.sz);
      dummy.updateMatrix(); m.setMatrixAt(k, dummy.matrix); m.setColorAt(k, icol.set(e.color));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.frustumCulled = false;
    root.add(m);
  }
  const lam = () => new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true });
  mkInst(inst.foliage, new THREE.ConeGeometry(1, 1, 7, 1).translate(0, 0.5, 0), lam());
  mkInst(inst.trunk, new THREE.CylinderGeometry(0.35, 0.5, 1, 5).translate(0, 0.5, 0), lam());
  mkInst(inst.rock, new THREE.CylinderGeometry(0.78, 1, 1, 6, 1).translate(0, 0.5, 0), lam());
  mkInst(inst.spire, new THREE.ConeGeometry(1, 1, 5, 1).translate(0, 0.5, 0), lam());
  mkInst(inst.box, new THREE.BoxGeometry(1, 1, 1), lam());
  mkInst(inst.cloud, new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true, emissive: '#555555' }));
  if (inst.building.length) {
    const wt = track(windowTexture(R));
    mkInst(inst.building, new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
      new THREE.MeshLambertMaterial({ color: '#ffffff', map: wt, emissive: '#ffffff', emissiveMap: wt, emissiveIntensity: 0.95 }));
  }
  let beaconMat = null;
  if (beacons.length) {
    const g = track(new THREE.BufferGeometry()); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(beacons), 3));
    beaconMat = track(new THREE.PointsMaterial({ color: '#ff3040', size: 3.5, map: dotTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    const b = new THREE.Points(g, beaconMat); b.frustumCulled = false; root.add(b);
  }

  /* --- braci (vulcano) --- */
  let embers = null, emberV = null;
  if (level.embers) {
    const n = 380, p = new Float32Array(n * 3); emberV = new Float32Array(n);
    for (let i = 0; i < n; i++) { p[i * 3] = (R() - 0.5) * 240; p[i * 3 + 1] = (R() - 0.5) * 120; p[i * 3 + 2] = (R() - 0.5) * 240; emberV[i] = 3 + R() * 7; }
    const g = track(new THREE.BufferGeometry()); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const m = track(new THREE.PointsMaterial({ color: '#ff8a3a', size: 0.9, map: dotTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    embers = new THREE.Points(g, m); embers.frustumCulled = false; root.add(embers);
  }

  /* --- animazione per fotogramma --- */
  const lavaA = new THREE.Color('#ff4a12'), lavaB = new THREE.Color('#ff8a24');
  const redC = new THREE.Color('#ff3b3b');
  function update(dt, t, camPos) {
    skyGroup.position.copy(camPos);
    if (lavaMat) lavaMat.color.copy(lavaA).lerp(lavaB, 0.5 + 0.5 * Math.sin(t * 1.3));
    if (beaconMat) beaconMat.opacity = 0.35 + 0.65 * (Math.sin(t * 3) > 0 ? 1 : 0.2);
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
    for (let k = 0; k < rings.length; k++) {
      const r = rings[k];
      if (!r.mesh.visible) continue;
      if (r.state === 0) {
        const isNext = k === nextIdx;
        r.mat.opacity = isNext ? 0.95 : 0.45;
        r.mesh.scale.setScalar(isNext ? 1 + 0.05 * Math.sin(t * 7) : 1);
      } else {
        r.anim += dt;
        const a = r.anim / 0.6;
        if (r.state === 2) r.mat.color.copy(redC);
        r.mesh.scale.setScalar(r.state === 1 ? 1 + a * 1.2 : 1 - a * 0.3);
        r.mat.opacity = Math.max(0, 0.95 * (1 - a));
        if (a >= 1) r.mesh.visible = false;
      }
    }
    disc.material.opacity = 0.08 + 0.05 * Math.sin(t * 7);
  }

  function reset() {
    for (const r of rings) { r.state = 0; r.anim = 0; r.mesh.visible = true; r.mesh.scale.setScalar(1); r.mat.color.copy(r.color); }
    for (const o of obstacles) { o.hit = false; o.minD = undefined; o.seen = -1; }
    progS = -1;
    setNext(0);
  }

  function dispose() {
    root.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
    for (const d of disposables) d.dispose && d.dispose();
  }

  reset();

  return {
    level, root, curve, L, N, sx, sy, sz, tx, tz,
    rings, obstacles, nearest, heightAt, groundAt, waterY, setNext, setProgress, update, reset, dispose,
    fog: new THREE.FogExp2(level.sky.bottom, level.fogDensity),
    bg: new THREE.Color(level.sky.bottom),
  };
}
