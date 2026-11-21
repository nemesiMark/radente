// Radente: ciclo di gioco, volo, punteggio, HUD e schermate.
import * as THREE from 'three';
import { LEVELS } from './levels.js';
import { buildWorld, sdObstacle, dotTexture } from './world.js';
import { makePlane, makeShadow } from './plane.js';
import { Input } from './input.js';
import { Sfx } from './audio.js';

export const VERSIONE = '1.0';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = (n) => Math.round(n).toLocaleString('it-IT');
const isTouch = window.matchMedia('(pointer: coarse)').matches;

/* ---------- regole del punteggio ---------- */
const TURN = 1.3;          // velocità di virata (rad/s)
const PITCH = 1.2;         // velocità di cabrata (rad/s)
const BOOST = 1.45;        // moltiplicatore di velocità del turbo
const OOB_DIST = 230;      // oltre questa distanza dalla rotta parte il conto alla rovescia
const OOB_TIME = 5;
const MAX_MULT = 5;

/* ---------- salvataggi ---------- */
const SAVE_KEY = 'radente.v1';
const save = { unlocked: 1, best: {}, opts: { audio: true, invert: false, low: isTouch } };
try {
  const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
  if (s) { save.unlocked = s.unlocked || 1; save.best = s.best || {}; Object.assign(save.opts, s.opts || {}); }
} catch (e) { /* storage non disponibile */ }
const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* ignora */ } };

/* ---------- rendering ---------- */
const renderer = new THREE.WebGLRenderer({ canvas: $('gl'), antialias: !save.opts.low, powerPreference: 'high-performance' });
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, 1, 0.5, 6000);
let baseFov = 70;
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, save.opts.low ? 1 : 2));
  renderer.setSize(w, h);
  camera.aspect = w / h;
  baseFov = w / h < 0.8 ? 84 : w / h < 1.25 ? 76 : 68;
  camera.fov = baseFov;
  camera.updateProjectionMatrix();
  if (particles) particles.mat.uniforms.scale.value = h * renderer.getPixelRatio() / 2;
}

/* ---------- aereo, ombra, scie ---------- */
const plane = makePlane();
scene.add(plane);
const shadow = makeShadow();
scene.add(shadow);
const dotTex = dotTexture();

function makeTrail() {
  const n = 16, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const c = Math.pow(1 - i / n, 1.6); col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = c; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const line = new THREE.Line(g, m); line.frustumCulled = false;
  scene.add(line);
  return { line, pos, n, init: false };
}
const trails = [makeTrail(), makeTrail()];
const tipW = new THREE.Vector3();
function updateTrails(dt, on) {
  for (let k = 0; k < 2; k++) {
    const tr = trails[k];
    tipW.copy(plane.userData.tips[k]); plane.localToWorld(tipW);
    if (!tr.init) { for (let i = 0; i < tr.n; i++) { tr.pos[i * 3] = tipW.x; tr.pos[i * 3 + 1] = tipW.y; tr.pos[i * 3 + 2] = tipW.z; } tr.init = true; }
    else { tr.pos.copyWithin(3, 0, (tr.n - 1) * 3); tr.pos[0] = tipW.x; tr.pos[1] = tipW.y; tr.pos[2] = tipW.z; }
    tr.line.geometry.attributes.position.needsUpdate = true;
    const m = tr.line.material;
    m.opacity += ((on ? 0.7 : 0) - m.opacity) * Math.min(1, dt * 5);
  }
}

/* ---------- particelle (polvere, spruzzi, esplosioni) ---------- */
class Particles {
  constructor(n) {
    this.n = n; this.cur = 0;
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3);
    this.alpha = new Float32Array(n); this.size = new Float32Array(n);
    this.vel = new Float32Array(n * 3); this.life = new Float32Array(n); this.max = new Float32Array(n);
    this.grav = new Float32Array(n); this.drag = new Float32Array(n); this.s0 = new Float32Array(n); this.grow = new Float32Array(n);
    for (let i = 0; i < n; i++) this.pos[i * 3 + 1] = -99999;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: dotTex }, scale: { value: 400 } },
      vertexShader: 'attribute float alpha; attribute float size; attribute vec3 pcolor; varying float vA; varying vec3 vC; uniform float scale;\n' +
        'void main(){ vA = alpha; vC = pcolor; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * scale / max(1.0, -mv.z); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform sampler2D map; varying float vA; varying vec3 vC;\n' +
        'void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC, t.a * vA);\n#include <colorspace_fragment>\n}',
      transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false;
  }
  spawn(x, y, z, vx, vy, vz, c, life, size, grav = 0, drag = 0, grow = 0) {
    const i = this.cur; this.cur = (this.cur + 1) % this.n;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
    this.life[i] = this.max[i] = life; this.s0[i] = size; this.grav[i] = grav; this.drag[i] = drag; this.grow[i] = grow;
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.alpha[i] = 0; this.pos[i * 3 + 1] = -99999; continue; }
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= d; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt; this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = this.life[i] / this.max[i];
      this.alpha[i] = Math.min(1, t * 1.6) * 0.9;
      this.size[i] = this.s0[i] * (0.6 + (1 - t) * this.grow[i]);
    }
    const a = this.geo.attributes;
    a.position.needsUpdate = a.pcolor.needsUpdate = a.alpha.needsUpdate = a.size.needsUpdate = true;
  }
  clear() { this.life.fill(0); this.alpha.fill(0); for (let i = 0; i < this.n; i++) this.pos[i * 3 + 1] = -99999; }
}
const particles = new Particles(700);
scene.add(particles.points);
resize();
addEventListener('resize', resize);

/* ---------- stato ---------- */
const input = new Input();
input.invert = save.opts.invert;
const sfx = new Sfx();
sfx.enabled = save.opts.audio;

let world = null;
let levelIdx = Math.min(save.unlocked, LEVELS.length) - 1;
let mode = 'menu';            // menu | countdown | play | paused | finished | crashed
let pausedFrom = 'play';
let cdT = 0, cdShown = -1;
let shake = 0;
let frameId = 0;
let time = 0;
const P = { pos: new THREE.Vector3(), prev: new THREE.Vector3(), yaw: 0, pitch: 0, roll: 0, speed: 50, energy: 1, boosting: false, alt: 10, u: 0, risk: 0 };
const run = {};
const activeNear = new Set();
function resetRun() {
  Object.assign(run, { score: 0, shown: 0, combo: 0, maxCombo: 0, ringsHit: 0, centers: 0, nearMiss: 0, chain: 0, chainT: 0, radTime: 0, next: 0, oob: 0, time: 0, msgT: 0 });
  activeNear.clear();
}
resetRun();
const mult = () => Math.min(MAX_MULT, 1 + run.combo * 0.25);

const fwdV = new THREE.Vector3(), tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), upV = new THREE.Vector3();
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
const forward = (yaw, pitch, out) => out.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));

/* ---------- mondo ---------- */
function loadWorld(idx) {
  const lvl = LEVELS[idx];
  if (world && world.level === lvl && !world.stale) return;
  if (world) { scene.remove(world.root); world.dispose(); }
  world = buildWorld(lvl, { low: save.opts.low });
  scene.add(world.root);
  scene.fog = world.fog;
  scene.background = world.bg;
  document.documentElement.style.setProperty('--accent', lvl.accent);
  dustColor.set(lvl.dust || '#ffffff');
}
const dustColor = new THREE.Color();

function autopilot(u, dt) {
  const c = world.curve;
  const uu = clamp(u, 0, 1);
  c.getPointAt(uu, P.pos);
  c.getTangentAt(uu, tmpV);
  const yaw = Math.atan2(-tmpV.x, -tmpV.z);
  const yawRate = dt > 0 ? (yaw - P.yaw) / dt : 0;
  P.yaw = yaw;
  P.pitch = Math.asin(clamp(tmpV.y, -1, 1));
  P.roll += (clamp(-yawRate * 0.9, -0.8, 0.8) - P.roll) * Math.min(1, dt * 3);
}

/* ---------- camera ---------- */
function chaseCam(dt, snap) {
  forward(P.yaw, P.pitch, fwdV);
  tmpV.copy(P.pos).addScaledVector(fwdV, -8.5); tmpV.y += 2.8;
  const k = snap ? 1 : 1 - Math.exp(-dt * 10);
  camPos.lerp(tmpV, k);
  const g = world.groundAt(camPos.x, camPos.z) + 1.2;
  if (camPos.y < g) camPos.y = g;
  camera.position.copy(camPos);
  if (shake > 0) {
    camera.position.x += (Math.random() - 0.5) * shake * 1.4;
    camera.position.y += (Math.random() - 0.5) * shake * 1.4;
    camera.position.z += (Math.random() - 0.5) * shake * 1.4;
    shake = Math.max(0, shake - dt * 1.6);
  }
  camLook.copy(P.pos).addScaledVector(fwdV, 22);
  upV.set(0, 1, 0).applyQuaternion(plane.quaternion);
  camera.up.set(0, 1, 0).lerp(upV, 0.28).normalize();
  camera.lookAt(camLook);
}
function orbitCam(t) {
  const a = t * 0.12;
  camera.position.set(P.pos.x + Math.sin(a) * 24, P.pos.y + 6 + Math.sin(t * 0.3) * 3, P.pos.z + Math.cos(a) * 24);
  const g = world.groundAt(camera.position.x, camera.position.z) + 2;
  if (camera.position.y < g) camera.position.y = g;
  camera.up.set(0, 1, 0);
  camera.lookAt(P.pos);
}

/* ---------- HUD ---------- */
const H = {
  hud: $('hud'), score: $('hScore'), mult: $('hMult'), rings: $('hRings'), level: $('hLevel'), progress: $('hProgress'),
  speed: $('hSpeed'), alt: $('hAlt'), risk: $('hRisk'), riskLbl: $('hRiskLbl'), boost: $('hBoost'),
  msg: $('hMsg'), marker: $('marker'), mDist: $('mDist'), arrow: $('arrow'), popups: $('popups'),
  speedfx: $('speedfx'), riskfx: $('riskfx'),
};
let lastMult = 1;
function popup(text, cls = '') {
  const d = document.createElement('div');
  d.className = 'pop ' + cls; d.textContent = text;
  H.popups.appendChild(d);
  while (H.popups.children.length > 4) H.popups.firstChild.remove();
  setTimeout(() => d.remove(), 1300);
}
function message(text, warn = false, dur = 0) {
  H.msg.textContent = text;
  H.msg.classList.toggle('on', !!text);
  H.msg.classList.toggle('warn', warn);
  run.msgT = dur;
}
function updateHud(dt) {
  run.shown += (run.score - run.shown) * Math.min(1, dt * 8);
  if (Math.abs(run.score - run.shown) < 1) run.shown = run.score;
  H.score.textContent = fmt(run.shown);
  const m = mult();
  H.mult.textContent = 'x' + m.toLocaleString('it-IT', { maximumFractionDigits: 2 });
  if (m > lastMult) { H.mult.classList.remove('bump'); void H.mult.offsetWidth; H.mult.classList.add('bump'); }
  lastMult = m;
  const total = world.rings.length;
  H.rings.textContent = `${run.ringsHit}/${total}`;
  H.progress.style.width = (clamp(world.nearest(P.pos.x, P.pos.z).i / world.N, 0, 1) * 100).toFixed(1) + '%';
  H.speed.textContent = Math.round(P.speed * 4.2);
  H.alt.textContent = Math.max(0, Math.round(P.alt));
  H.alt.parentElement.classList.toggle('danger', P.alt < world.level.radenteH);
  H.risk.style.width = (P.risk * 100).toFixed(0) + '%';
  H.boost.style.width = (P.energy * 100).toFixed(0) + '%';
  H.speedfx.style.opacity = P.boosting ? '1' : '0';
  H.riskfx.style.opacity = (Math.max(0, P.risk - 0.45) * 0.9).toFixed(2);
  if (run.msgT > 0) { run.msgT -= dt; if (run.msgT <= 0) message(''); }
  updateMarker();
}
function updateMarker() {
  const r = world.rings[run.next];
  if (!r || (mode !== 'play' && mode !== 'countdown')) { H.marker.style.display = H.arrow.style.display = 'none'; return; }
  const W = innerWidth, Hh = innerHeight;
  tmpV2.copy(r.pos).project(camera);
  const behind = tmpV2.z > 1;
  let x = tmpV2.x, y = tmpV2.y;
  if (!behind && Math.abs(x) < 0.92 && Math.abs(y) < 0.86) {
    H.marker.style.display = 'block'; H.arrow.style.display = 'none';
    H.marker.style.left = ((x * 0.5 + 0.5) * W) + 'px';
    H.marker.style.top = ((-y * 0.5 + 0.5) * Hh) + 'px';
    H.mDist.textContent = Math.round(P.pos.distanceTo(r.pos)) + ' m';
    return;
  }
  if (behind) { x = -x; y = -y; }
  let dx = x * W / 2, dy = -y * Hh / 2;
  if (Math.abs(dx) < 1e-3 && Math.abs(dy) < 1e-3) dy = 1;
  const s = Math.min((W / 2 - 46) / Math.abs(dx || 1e-6), (Hh / 2 - 90) / Math.abs(dy || 1e-6));
  H.marker.style.display = 'none'; H.arrow.style.display = 'block';
  H.arrow.style.left = (W / 2 + dx * s) + 'px';
  H.arrow.style.top = (Hh / 2 + dy * s) + 'px';
  H.arrow.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
}

/* ---------- volo e punteggio ---------- */
function updateFlight(dt) {
  const lvl = world.level;
  const ix = input.x, iy = input.y;
  P.yaw -= ix * TURN * dt;
  P.pitch += iy * PITCH * dt;
  if (Math.abs(iy) < 0.05) P.pitch -= P.pitch * Math.min(1, dt * 0.9);
  const nr = world.nearest(P.pos.x, P.pos.z);
  const ceil = world.sy[nr.i] + 110;
  if (P.pos.y > ceil) { P.pitch -= dt * 0.9; if (run.msgT <= 0) message('Troppo alto: scendi', true, 1); }
  P.pitch = clamp(P.pitch, -0.9, 0.9);
  P.roll += (-ix * 0.95 - P.roll) * Math.min(1, dt * 5);

  P.boosting = input.boost && P.energy > 0.02;
  if (P.boosting) P.energy = Math.max(0, P.energy - dt * 0.24);
  else P.energy = Math.min(1, P.energy + dt * 0.07);
  const target = lvl.speed * (P.boosting ? BOOST : 1) * (1 - P.pitch * 0.18);
  P.speed += (target - P.speed) * Math.min(1, dt * 2);

  P.prev.copy(P.pos);
  forward(P.yaw, P.pitch, fwdV);
  P.pos.addScaledVector(fwdV, P.speed * dt);
  return nr;
}

function checkRings() {
  const rings = world.rings;
  const end = Math.min(rings.length, run.next + 2);
  for (let k = run.next; k < end; k++) {
    const r = rings[k];
    const s0 = tmpV.copy(P.prev).sub(r.pos).dot(r.tan);
    const s1 = tmpV.copy(P.pos).sub(r.pos).dot(r.tan);
    if (s0 < 0 && s1 >= 0) {
      const t = s0 / (s0 - s1);
      const off = tmpV.copy(P.prev).lerp(P.pos, t).distanceTo(r.pos);
      if (k > run.next) missRing(rings[run.next]);
      if (off <= r.R) passRing(r, off); else missRing(r);
      run.next = k + 1;
      world.setNext(run.next);
      if (r.finish) finishLevel();
      return;
    }
  }
}
function passRing(r, off) {
  const m = mult();
  let base = r.finish ? 500 : r.gold ? 250 : 100;
  let label = r.finish ? 'TRAGUARDO' : r.gold ? 'ORO' : 'CERCHIO';
  const center = off < r.R * 0.35;
  if (center) { base *= 2; label = r.gold ? 'ORO CENTRATO' : r.finish ? 'TRAGUARDO CENTRATO' : 'CENTRO!'; run.centers++; }
  const pts = Math.round(base * m);
  run.score += pts;
  run.combo++; run.maxCombo = Math.max(run.maxCombo, run.combo); run.ringsHit++;
  popup(`${label} +${fmt(pts)}`, r.gold ? 'gold' : center ? 'good' : '');
  P.energy = Math.min(1, P.energy + 0.2);
  r.state = 1; r.anim = 0;
  sfx.ring(r.gold, center);
}
function missRing(r) {
  if (r.state !== 0) return;
  r.state = 2; r.anim = 0;
  if (run.combo >= 3) popup(`MANCATO · combo persa`, 'bad'); else popup('MANCATO', 'bad');
  run.combo = 0;
  sfx.miss();
}

function checkObstacles() {
  frameId++;
  const { x, y, z } = P.pos;
  const obs = world.obstacles;
  for (let k = 0; k < obs.length; k++) {
    const o = obs[k];
    const lim = o.br + 12;
    if (Math.abs(o.x - x) > lim || Math.abs(o.z - z) > lim) continue;
    const d = sdObstacle(o, x, y, z);
    if (d < 0.9) { crash(o.kind); return; }
    if (d < o.near && !o.hit) {
      o.minD = o.minD === undefined ? d : Math.min(o.minD, d);
      o.seen = frameId;
      activeNear.add(o);
    }
  }
  for (const o of activeNear) {
    if (o.seen === frameId) continue;
    activeNear.delete(o);
    o.hit = true;
    const close = 1 - clamp((o.minD - 0.9) / (o.near - 0.9), 0, 1);
    const base = o.kind === 'arch' ? 200 : 120;
    const pts = Math.round(base * (1 + 3 * close) * mult() * (P.boosting ? 1.5 : 1));
    run.score += pts; run.nearMiss++;
    const label = o.kind === 'arch' ? "SOTTO L'ARCO" : close > 0.7 ? 'PER UN PELO' : 'SFIORATO';
    popup(`${label} +${fmt(pts)}`, 'risk');
    sfx.near();
    shake = Math.max(shake, 0.18 + close * 0.25);
  }
}

function updateRisk(dt) {
  const lvl = world.level;
  const { x, y, z } = P.pos;
  const ground = world.groundAt(x, z);
  P.alt = y - ground;
  if (P.alt < 0.7) { crash(ground === world.waterY ? (lvl.water.lava ? 'lava' : 'water') : 'terrain'); return; }
  const Hr = lvl.radenteH;
  const f = clamp((Hr - P.alt) / (Hr - 1.2), 0, 1);
  // pareti vicine alle ali
  let wallF = 0;
  const rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw);
  for (const [dd, w] of [[3.5, 1], [7, 0.55]]) {
    if (wallF >= w) continue;
    for (const sg of [-1, 1]) {
      if (world.heightAt(x + rx * dd * sg, z + rz * dd * sg) > y - 0.5) { wallF = Math.max(wallF, w); break; }
    }
  }
  P.risk += (Math.max(f, wallF * 0.85) - P.risk) * Math.min(1, dt * 8);
  const rate = f * f * 150 + wallF * 120;
  if (rate > 0) {
    const pts = rate * dt * (P.boosting ? 1.5 : 1) * mult();
    run.score += pts; run.chain += pts; run.chainT = 0.5;
    if (f > 0) run.radTime += dt;
  } else if (run.chain > 0) {
    run.chainT -= dt;
    if (run.chainT <= 0) { if (run.chain >= 25) popup(`RISCHIO +${fmt(run.chain)}`, 'risk'); run.chain = 0; }
  }
  const lbl = H.riskLbl;
  const txt = wallF > 0 && f < 0.5 ? 'Parete' : f > 0.72 ? 'Estremo' : 'Radente';
  if (lbl.textContent !== txt) lbl.textContent = txt;
  lbl.classList.toggle('on', rate > 0);
  lbl.classList.toggle('max', f > 0.72);

  // polvere / spruzzi sotto l'aereo
  if (f > 0.15) {
    const n = Math.random() < f * dt * 70 ? 1 + Math.floor(f * 2) : 0;
    for (let i = 0; i < n; i++) {
      particles.spawn(x + (Math.random() - 0.5) * 3, ground + 0.3, z + (Math.random() - 0.5) * 3,
        (Math.random() - 0.5) * 6 - fwdV.x * 8, 2 + Math.random() * 5 * f, (Math.random() - 0.5) * 6 - fwdV.z * 8,
        dustColor, 0.7 + Math.random() * 0.5, 1.2 + Math.random() * 1.2, 4, 1.5, 2.2);
    }
  }
}

function checkBounds(dt, nr) {
  if (nr.d > OOB_DIST) {
    run.oob += dt;
    const left = Math.ceil(OOB_TIME - run.oob);
    message(`Torna sulla rotta · ${Math.max(0, left)}`, true, 0.2);
    if (run.oob >= OOB_TIME) crash('oob');
  } else if (run.oob > 0) { run.oob = Math.max(0, run.oob - dt * 2); }
}

/* ---------- fine volo ---------- */
const CRASH_TXT = {
  terrain: 'Hai toccato terra', water: 'Ammaraggio non previsto', lava: 'Finito nella lava', tree: 'Preso un albero',
  rock: 'Contro la roccia', ice: 'Contro un iceberg', building: 'Contro un palazzo', arch: "Contro l'arco", oob: 'Fuori rotta troppo a lungo',
};
function crash(kind) {
  if (mode !== 'play') return;
  mode = 'crashed';
  plane.visible = false; shadow.visible = false;
  const c1 = new THREE.Color('#ffd27a'), c2 = new THREE.Color('#ff5a1a'), c3 = new THREE.Color('#3a3634');
  if (kind !== 'oob') {
    for (let i = 0; i < 140; i++) {
      const th = Math.random() * Math.PI * 2, ph = Math.random() * Math.PI, sp = 8 + Math.random() * 26;
      const vx = Math.sin(ph) * Math.cos(th) * sp + fwdV.x * P.speed * 0.25, vy = Math.cos(ph) * sp * 0.8 + 6, vz = Math.sin(ph) * Math.sin(th) * sp + fwdV.z * P.speed * 0.25;
      particles.spawn(P.pos.x, P.pos.y, P.pos.z, vx, vy, vz, i % 3 === 0 ? c1 : c2, 0.6 + Math.random() * 0.9, 2.2 + Math.random() * 2.5, 12, 1.2, 1.5);
    }
    for (let i = 0; i < 50; i++) {
      particles.spawn(P.pos.x, P.pos.y, P.pos.z, (Math.random() - 0.5) * 8, 4 + Math.random() * 8, (Math.random() - 0.5) * 8, c3, 1.6 + Math.random() * 1.4, 4 + Math.random() * 3, -1, 0.8, 3);
    }
    sfx.crash();
    shake = 1.3;
  } else sfx.miss();
  sfx.engine(false, 0, false, 0);
  $('touch').classList.add('hidden');
  message('');
  setTimeout(() => showResult({ ok: false, kind }), 1500);
}

// Soglie delle stelle: si parte dal punteggio di un volo "pulito" (tutti i cerchi al centro, nessun rischio).
// Due stelle = 75% di quel volo; tre stelle = 140%, cioè servono parecchi punti di rischio.
function starThresholds() {
  let clean = 0;
  world.rings.forEach((r, k) => { clean += (r.finish ? 500 : r.gold ? 250 : 100) * 2 * Math.min(MAX_MULT, 1 + k * 0.25); });
  const round = (v) => Math.round(v / 500) * 500;
  return [round(clean * 0.75), round(clean * 1.4)];
}
function finishLevel() {
  mode = 'finished';
  const lvl = LEVELS[levelIdx];
  const [t2, t3] = starThresholds();
  const score = Math.round(run.score);
  const stars = 1 + (score >= t2 ? 1 : 0) + (score >= t3 ? 1 : 0);
  const prev = save.best[lvl.id] || { score: 0, stars: 0 };
  const record = score > prev.score;
  save.best[lvl.id] = { score: Math.max(prev.score, score), stars: Math.max(prev.stars, stars) };
  save.unlocked = Math.min(LEVELS.length, Math.max(save.unlocked, levelIdx + 2));
  persist();
  sfx.finish();
  $('touch').classList.add('hidden');
  message('');
  setTimeout(() => showResult({ ok: true, stars, record, t2, t3, score }), 1500);
}

function showResult(r) {
  const lvl = LEVELS[levelIdx];
  $('result').classList.remove('hidden');
  $('rKicker').textContent = `Livello ${levelIdx + 1} · ${lvl.name}`;
  $('rTitle').textContent = r.ok ? 'Traguardo!' : (CRASH_TXT[r.kind] || 'Schianto');
  const st = $('rStars');
  st.innerHTML = r.ok ? [0, 1, 2].map((i) => `<span class="${i < r.stars ? '' : 'off'}">★</span>`).join('') : '';
  st.classList.toggle('hidden', !r.ok);
  $('rScore').textContent = fmt(run.score);
  $('rRecord').classList.toggle('hidden', !r.record);
  const total = world.rings.length;
  const stats = [
    ['Cerchi presi', `${run.ringsHit} / ${total}`],
    ['Centri perfetti', run.centers],
    ['Combo migliore', run.maxCombo],
    ['Sfioramenti', run.nearMiss],
    ['Tempo radente', run.radTime.toFixed(1).replace('.', ',') + ' s'],
  ];
  $('rStats').innerHTML = stats.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
  const hasNext = levelIdx + 1 < LEVELS.length && levelIdx + 1 < save.unlocked;
  $('rNext').classList.toggle('hidden', !(r.ok && hasNext));
  $('rRetry').classList.toggle('primary', !(r.ok && hasNext));
  if (r.ok) {
    const nxt = r.stars < 2 ? `★★ da ${fmt(r.t2)} punti` : r.stars < 3 ? `★★★ da ${fmt(r.t3)} punti` : 'Tre stelle: livello dominato.';
    $('rHint').textContent = r.stars < 3 ? `Prossimo obiettivo: ${nxt}` : nxt;
    if (levelIdx === LEVELS.length - 1) $('rHint').textContent += ' Hai finito tutti i livelli!';
  } else {
    $('rHint').textContent = 'Il punteggio vale solo se arrivi al traguardo.';
  }
  setTimeout(() => (r.ok && hasNext ? $('rNext') : $('rRetry')).focus(), 50);
}

/* ---------- avvio livello / menu ---------- */
function hideModals() { ['result', 'pause', 'how'].forEach((id) => $(id).classList.add('hidden')); }

function startLevel(idx) {
  sfx.init();
  hideModals();
  $('menu').classList.add('hidden');
  const needBuild = !world || world.level !== LEVELS[idx] || world.stale;
  const go = () => {
    loadWorld(idx);
    levelIdx = idx;
    world.reset();
    resetRun();
    particles.clear();
    input.reset();
    P.u = 0; P.roll = 0; P.speed = world.level.speed; P.energy = 1; P.alt = 10; P.risk = 0;
    autopilot(0, 0);
    plane.visible = true; shadow.visible = true;
    trails.forEach((t) => { t.init = false; t.line.material.opacity = 0; });
    H.level.textContent = `${idx + 1} · ${world.level.name}`;
    H.hud.classList.remove('hidden');
    H.popups.innerHTML = '';
    message('');
    if (isTouch) { $('touch').classList.remove('hidden'); if (input.restJoy) input.restJoy(); }
    $('loading').classList.add('hidden');
    plane.rotation.set(P.pitch, P.yaw, P.roll);
    plane.updateMatrixWorld();
    chaseCam(0, true);
    mode = 'countdown'; cdT = 3.3; cdShown = -1;
    $('countdown').classList.remove('hidden');
  };
  if (needBuild) {
    $('loadingTxt').textContent = `Preparo ${LEVELS[idx].name}…`;
    $('loading').classList.remove('hidden');
    setTimeout(go, 40);
  } else go();
}

function showMenu() {
  mode = 'menu';
  hideModals();
  H.hud.classList.add('hidden');
  $('touch').classList.add('hidden');
  $('countdown').classList.add('hidden');
  H.speedfx.style.opacity = H.riskfx.style.opacity = '0';
  sfx.engine(false, 0, false, 0);
  if (!world || world.stale) loadWorld(levelIdx);
  world.reset();
  P.u = 0.04;
  plane.visible = true; shadow.visible = true;
  renderCards();
  $('menu').classList.remove('hidden');
}

const LOCK = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
function renderCards() {
  const wrap = $('levels');
  wrap.innerHTML = '';
  LEVELS.forEach((l, i) => {
    const locked = i >= save.unlocked;
    const b = save.best[l.id];
    const btn = document.createElement('button');
    btn.className = 'card' + (locked ? ' locked' : '');
    btn.disabled = locked;
    btn.style.cssText = `--top:${l.sky.top};--bot:${l.sky.bottom};--gnd:${l.palette[Math.min(2, l.palette.length - 1)][1]};--acc:${l.accent}`;
    const stars = [0, 1, 2].map((k) => `<span class="${b && k < b.stars ? '' : 'off'}">★</span>`).join('');
    btn.innerHTML = `<div class="thumb"><span class="num">${String(i + 1).padStart(2, '0')}</span></div>
      <div class="info"><h3>${l.name}</h3><p>${l.mood}</p>
      <div class="meta">${locked ? `<span class="locktxt">${LOCK} Bloccato</span>` : `<span class="stars">${stars}</span><span class="best">${b ? 'Record ' + fmt(b.score) : 'Da giocare'}</span>`}</div></div>`;
    btn.title = locked ? 'Finisci il livello precedente per sbloccarlo' : l.desc;
    btn.addEventListener('click', () => startLevel(i));
    wrap.appendChild(btn);
  });
}

function togglePause(force) {
  if (mode === 'play' || mode === 'countdown') {
    if (force === false) return;
    pausedFrom = mode; mode = 'paused';
    $('pause').classList.remove('hidden');
    sfx.engine(false, 0, false, 0);
    if (sfx.ctx) sfx.ctx.suspend();
  } else if (mode === 'paused' && force !== true) {
    $('pause').classList.add('hidden');
    if (sfx.ctx) sfx.ctx.resume();
    input.reset();
    mode = pausedFrom;
  }
}

/* ---------- eventi interfaccia ---------- */
$('btnPause').addEventListener('click', () => togglePause());
$('pResume').addEventListener('click', () => togglePause());
$('pRestart').addEventListener('click', () => { if (sfx.ctx) sfx.ctx.resume(); startLevel(levelIdx); });
$('pMenu').addEventListener('click', () => { if (sfx.ctx) sfx.ctx.resume(); showMenu(); });
$('rRetry').addEventListener('click', () => startLevel(levelIdx));
$('rNext').addEventListener('click', () => startLevel(levelIdx + 1));
$('rMenu').addEventListener('click', () => showMenu());
$('btnHow').addEventListener('click', () => $('how').classList.remove('hidden'));
$('howClose').addEventListener('click', () => $('how').classList.add('hidden'));

const optAudio = $('optAudio'), optInvert = $('optInvert'), optLow = $('optLow');
optAudio.checked = save.opts.audio; optInvert.checked = save.opts.invert; optLow.checked = save.opts.low;
optAudio.addEventListener('change', () => { save.opts.audio = optAudio.checked; sfx.setEnabled(optAudio.checked); persist(); });
optInvert.addEventListener('change', () => { save.opts.invert = optInvert.checked; input.invert = optInvert.checked; persist(); });
optLow.addEventListener('change', () => { save.opts.low = optLow.checked; persist(); resize(); if (world) world.stale = true; if (mode === 'menu') { loadWorld(levelIdx); world.reset(); } });

input.onKey = (code) => {
  if (code === 'Escape' || code === 'KeyP') {
    if (!$('how').classList.contains('hidden')) { $('how').classList.add('hidden'); return; }
    togglePause();
  } else if (code === 'KeyR' && ['play', 'paused', 'crashed', 'finished'].includes(mode)) {
    if (sfx.ctx) sfx.ctx.resume();
    startLevel(levelIdx);
  }
};
document.addEventListener('visibilitychange', () => { if (document.hidden && (mode === 'play' || mode === 'countdown')) togglePause(); });
input.bindTouch($('joyZone'), $('joyBase'), $('joyKnob'), $('btnBoost'));
document.addEventListener('gesturestart', (e) => e.preventDefault());

/* ---------- ciclo principale ---------- */
const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  if (!world) return;
  tick(dt);
  renderer.render(scene, camera);
}
function tick(dt) {
  if (mode !== 'paused') time += dt;
  input.update(dt);

  if (mode === 'menu') {
    P.u += (world.level.speed * 0.8 * dt) / world.L;
    if (P.u > 0.96) P.u = 0.04;
    autopilot(P.u, dt);
    plane.rotation.set(P.pitch, P.yaw, P.roll);
    orbitCam(time);
  } else if (mode === 'countdown') {
    P.u += (world.level.speed * dt) / world.L;
    autopilot(P.u, dt);
    plane.rotation.set(P.pitch, P.yaw, P.roll);
    cdT -= dt;
    const n = cdT > 0.4 ? Math.ceil(cdT - 0.4) : 0;
    if (n !== cdShown) {
      cdShown = n;
      $('countdown').innerHTML = `<span>${n > 0 ? n : 'VIA!'}</span>`;
      sfx.beep(n === 0);
      if (n === 0 && levelIdx === 0 && !save.best[LEVELS[0].id]) message('Segui la scia luminosa e scendi basso', false, 3.5);
    }
    if (cdT <= 0) {
      mode = 'play';
      P.prev.copy(P.pos);
      setTimeout(() => { if (mode !== 'countdown') $('countdown').classList.add('hidden'); }, 500);
    }
    chaseCam(dt, false);
    sfx.engine(true, 0.4, false, 0);
    updateHud(dt);
  } else if (mode === 'play') {
    run.time += dt;
    const nr = updateFlight(dt);
    plane.rotation.set(P.pitch, P.yaw, P.roll);
    checkRings();
    if (mode === 'play') checkObstacles();
    if (mode === 'play') updateRisk(dt);
    if (mode === 'play') checkBounds(dt, nr);
    chaseCam(dt, false);
    const lvl = world.level;
    camera.fov += ((baseFov + (P.boosting ? 12 : 0) + P.risk * 4) - camera.fov) * Math.min(1, dt * 3);
    camera.updateProjectionMatrix();
    sfx.engine(true, clamp(P.speed / lvl.speed - 0.6, 0, 1.2), P.boosting, P.risk);
    updateHud(dt);
  } else if (mode === 'finished') {
    P.pitch += (0.25 - P.pitch) * Math.min(1, dt * 1.5);
    P.roll += (0 - P.roll) * Math.min(1, dt * 2);
    P.prev.copy(P.pos);
    P.pos.addScaledVector(forward(P.yaw, P.pitch, fwdV), P.speed * dt);
    plane.rotation.set(P.pitch, P.yaw, P.roll);
    chaseCam(dt, false);
    sfx.engine(true, 0.5, false, 0);
    updateHud(dt);
  } else if (mode === 'crashed') {
    chaseCam(dt, false);
    updateHud(dt);
  }

  if (mode !== 'paused') {
    plane.position.copy(P.pos);
    plane.userData.prop.rotation.z += dt * 45;
    if (shadow.visible) {
      const g = world.groundAt(P.pos.x, P.pos.z);
      const alt = P.pos.y - g;
      shadow.position.set(P.pos.x, g + 0.3, P.pos.z);
      shadow.rotation.y = P.yaw;
      const s = 1 + alt * 0.012;
      shadow.scale.set(s * Math.max(0.3, Math.cos(P.roll)), 1, s);
      shadow.userData.mat.opacity = clamp(0.5 - alt * 0.009, 0, 0.5);
    }
    updateTrails(dt, mode === 'play' && (P.boosting || P.risk > 0.3) || mode === 'finished');
    particles.update(dt);
    world.update(dt, time, camera.position);
    if (mode === 'play' || mode === 'countdown') world.setProgress(world.nearest(P.pos.x, P.pos.z).i / world.N * world.L);
  }
}

/* ---------- prova automatica (solo con #debug nell'indirizzo) ---------- */
if (location.hash.includes('debug')) {
  window.__R = { tick, input, P, run, world: () => world, mode: () => mode, start: startLevel };
}

/* ---------- avvio ---------- */
loadWorld(levelIdx);
showMenu();
frame();
