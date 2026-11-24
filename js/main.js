// Radente: ciclo di gioco, volo, punteggio, missili, telecamera, effetti, HUD e schermate.
import * as THREE from 'three';
import { LEVELS } from './levels.js';
import { buildWorld, sdObstacle } from './world.js';
import { makePlane, makeShadow } from './plane.js';
import { Input } from './input.js';
import { Sfx } from './audio.js';
import { installFog, setFog, FOGU, SHARED } from './shade.js';
import { Post } from './post.js';
import { FX, Ribbon } from './fx.js';
import { Weapons } from './weapons.js';

export const VERSIONE = '2.2';

// la nebbia "atmosferica" sostituisce quella di three.js: va installata prima che si compili qualsiasi materiale
installFog();

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = (n) => Math.round(n).toLocaleString('it-IT');
const rnd = (a, b) => a + Math.random() * (b - a);
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
const save = { unlocked: 1, best: {}, player: '', scores: [], opts: { audio: true, invert: false, low: isTouch } };
try {
  const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
  if (s) { save.unlocked = s.unlocked || 1; save.best = s.best || {}; save.player = s.player || ''; save.scores = Array.isArray(s.scores) ? s.scores : []; Object.assign(save.opts, s.opts || {}); }
} catch (e) { /* storage non disponibile */ }
const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* ignora */ } };
const LOW = !!save.opts.low;   // grafica leggera: niente ombre vere, meno particelle, bagliori a metà risoluzione

/* ---------- rendering ---------- */
const renderer = new THREE.WebGLRenderer({ canvas: $('gl'), antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.toneMapping = THREE.ACESFilmicToneMapping; // più contrasto e colori più pieni di AgX
renderer.shadowMap.enabled = !LOW;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.3, 6000);
scene.add(camera);   // serve per le linee di velocità, che sono figlie della camera
const MAX_PR = LOW ? 1 : 1.5;
// tetto ai pixel disegnati: sugli schermi Retina grandi 1.5× voleva dire quasi 3 milioni di pixel e il gioco andava a scatti
const MAX_PIX = LOW ? 1.0e6 : 2.1e6;
let prScale = 1;     // scende da solo se il gioco rallenta
const currentPR = () => Math.max(0.5, Math.min(devicePixelRatio || 1, MAX_PR, Math.sqrt(MAX_PIX / (innerWidth * innerHeight))) * prScale);
renderer.setPixelRatio(currentPR());
renderer.setSize(innerWidth, innerHeight);

const input = new Input();
input.invert = save.opts.invert;
const sfx = new Sfx();
sfx.enabled = save.opts.audio;

const post = new Post(renderer, scene, camera, { low: LOW });
const fx = new FX(scene, camera, { low: LOW });
const plane = makePlane();
scene.add(plane);
const shadow = makeShadow();
shadow.visible = LOW;
scene.add(shadow);
const ribbons = [new Ribbon(32, 0.12, '#ffffff'), new Ribbon(32, 0.12, '#ffffff')];
let ribT = 0;
ribbons.forEach((r) => scene.add(r.mesh));
const weapons = new Weapons(scene, plane, fx, sfx);
const pmrem = new THREE.PMREMGenerator(renderer);

let baseFov = 70;
function resize() {
  const w = innerWidth, h = innerHeight, pr = currentPR();
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h);
  post.setPixelRatio(pr);
  post.setSize(w, h);
  camera.aspect = w / h;
  baseFov = w / h < 0.8 ? 84 : w / h < 1.25 ? 76 : 68;
  camera.updateProjectionMatrix();
  fx.setScale(h * pr / (2 * Math.tan(THREE.MathUtils.degToRad(baseFov / 2))));
}
resize();
addEventListener('resize', resize);

/* ---------- stato ---------- */
let world = null;
let envRT = null;
let levelIdx = Math.min(save.unlocked, LEVELS.length) - 1;
let mode = 'loading';         // loading | menu | countdown | play | paused | finished | crashed
let pausedFrom = 'play';
let cdT = 0, cdShown = -1;
let frameId = 0;
let time = 0;
let crashT = 0;
const P = {
  pos: new THREE.Vector3(), prev: new THREE.Vector3(), yaw: 0, pitch: 0, roll: 0, speed: 50, energy: 1, boosting: false,
  alt: 10, u: 0, risk: 0, boostK: 0, kick: 0,
};
const run = {};
const activeNear = new Set();
function resetRun() {
  Object.assign(run, { score: 0, shown: 0, combo: 0, maxCombo: 0, ringsHit: 0, centers: 0, nearMiss: 0, chain: 0, chainT: 0, radTime: 0, next: 0, oob: 0, time: 0, msgT: 0, kills: 0, shots: 0 });
  activeNear.clear();
}
resetRun();
const mult = () => Math.min(MAX_MULT, 1 + run.combo * 0.25);

const fwdV = new THREE.Vector3(), tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), upV = new THREE.Vector3(), tipW = new THREE.Vector3();
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), crashPos = new THREE.Vector3(), crashDrift = new THREE.Vector3();
const nozzleW = new THREE.Vector3(), nozzlePrev = new THREE.Vector3(), sunUv = new THREE.Vector3();
const forward = (yaw, pitch, out) => out.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
const dustColor = new THREE.Color(), sunCol = new THREE.Color(), accentCol = new THREE.Color();
const C = {
  shock: new THREE.Color(1.3, 1.25, 1.15), white: new THREE.Color(1, 1, 1), water: new THREE.Color('#e9f6ff'),
  exA: new THREE.Color(3.6, 1.9, 0.7), exB: new THREE.Color(1.6, 0.3, 0.08), plane: new THREE.Color('#d9dde3'),
  emberA: new THREE.Color(5, 1.6, 0.3), emberB: new THREE.Color(1.2, 0.2, 0.05),
};

/* ---------- mondo ---------- */
function loadWorld(idx) {
  const lvl = LEVELS[idx];
  if (world && world.level === lvl) return;
  if (world) { scene.remove(world.root); world.dispose(); }
  world = buildWorld(lvl, { low: LOW, shadows: !LOW });
  scene.add(world.root);
  scene.fog = world.fog;
  scene.background = world.bg;
  const look = lvl.look || {};
  const f = look.fog || [0, 100, 0.6, 1];
  sunCol.set(lvl.sky.sun);
  setFog(world.sunDir, sunCol, f[0], f[1], f[2]);
  FOGU.uFogParams.value[3] = f[3];
  post.setLook(look);
  // riflessi del cielo del livello (aereo, acqua, vetri, metalli)
  if (envRT) envRT.dispose();
  envRT = pmrem.fromScene(world.envScene, 0, 0.1, 1000);
  world.setEnv(envRT.texture);
  plane.userData.setEnv(envRT.texture);
  document.documentElement.style.setProperty('--accent', lvl.accent);
  accentCol.set(lvl.accent);
  dustColor.set(lvl.dust || '#ffffff');
  weapons.groundColor.set(lvl.dust || '#c8b89a');
  fx.clear();
  ribbons.forEach((r) => r.reset());
}

// compila in anticipo tutti gli shader (anche quelli degli effetti ancora invisibili): niente scatti al primo missile
async function warmup() {
  const shown = [];
  const show = (o) => { if (o && !o.visible) { o.visible = true; shown.push(o); } };
  show(fx.fire.items[0].m); show(fx.waves.items[0].m); show(fx.lines.mesh); show(plane.userData.vapor); show(weapons.pool[0].mesh);
  try { await renderer.compileAsync(scene, camera); } catch (e) { try { renderer.compile(scene, camera); } catch (e2) { /* ignora */ } }
  shown.forEach((o) => { o.visible = false; });
}

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

/* ---------- telecamera e scossoni ---------- */
let trauma = 0, shakeT = 0, fovKick = 0;
const addTrauma = (a) => { trauma = Math.min(1, trauma + a); };
// scossone morbido: somma di sinusoidi a frequenze diverse, forza = trauma², mai un tremolio casuale
function applyShake(dt, floor = 0) {
  trauma = Math.max(0, trauma - dt * 1.15);
  const k = Math.max(trauma, floor), s = k * k;
  if (s < 1e-4) return;
  shakeT += dt;
  const t = shakeT * 26;
  camera.rotateX((Math.sin(t * 1.13) + 0.5 * Math.sin(t * 2.31 + 1.7)) * 0.016 * s);
  camera.rotateY((Math.sin(t * 0.97 + 0.4) + 0.5 * Math.sin(t * 2.07 + 3.1)) * 0.016 * s);
  camera.rotateZ(Math.sin(t * 0.71 + 2.2) * 0.028 * s);
}
function chaseCam(dt, snap) {
  forward(P.yaw, P.pitch, fwdV);
  // col turbo la camera resta un po' indietro: l'aereo "scappa" in avanti
  const back = 8.5 + P.boostK * 1.9 + P.kick * 1.3;
  tmpV.copy(P.pos).addScaledVector(fwdV, -back); tmpV.y += 2.7 - P.boostK * 0.35;
  const k = snap ? 1 : 1 - Math.exp(-dt * (10 - P.boostK * 2.5));
  camPos.lerp(tmpV, k);
  const g = world.groundAt(camPos.x, camPos.z) + 1.2;
  if (camPos.y < g) camPos.y = g;
  camera.position.copy(camPos);
  camLook.copy(P.pos).addScaledVector(fwdV, 22);
  upV.set(0, 1, 0).applyQuaternion(plane.quaternion);
  camera.up.set(0, 1, 0).lerp(upV, 0.28).normalize();
  camera.lookAt(camLook);
  applyShake(dt, mode === 'play' ? P.boostK * 0.2 + P.risk * 0.2 : 0);
}
function orbitCam(t) {
  const a = t * 0.1, r = 15 + Math.sin(t * 0.21) * 3;
  camera.position.set(P.pos.x + Math.sin(a) * r, P.pos.y + 3 + Math.sin(t * 0.3) * 2.4, P.pos.z + Math.cos(a) * r);
  const g = world.groundAt(camera.position.x, camera.position.z) + 2;
  if (camera.position.y < g) camera.position.y = g;
  camera.up.set(0, 1, 0);
  camera.lookAt(P.pos.x, P.pos.y + 0.5, P.pos.z);
}
// dopo lo schianto la camera smette di inseguire, arretra piano e guarda l'esplosione
function crashCam(dt) {
  camPos.addScaledVector(crashDrift, dt);
  crashDrift.multiplyScalar(Math.exp(-dt * 0.8));
  const g = world.groundAt(camPos.x, camPos.z) + 1.5;
  if (camPos.y < g) camPos.y = g;
  camera.position.copy(camPos);
  camera.up.set(0, 1, 0);
  camLook.lerp(crashPos, 1 - Math.exp(-dt * 5));
  camera.lookAt(camLook);
  applyShake(dt);
}
// al traguardo la camera rallenta e lascia andare l'aereo che cabra
function finishCam(dt) {
  forward(P.yaw, P.pitch, fwdV);
  tmpV.copy(P.pos).addScaledVector(fwdV, -9); tmpV.y += 3;
  camPos.lerp(tmpV, 1 - Math.exp(-dt * 0.9));
  camera.position.copy(camPos);
  camera.up.set(0, 1, 0);
  camLook.lerp(P.pos, 1 - Math.exp(-dt * 6));
  camera.lookAt(camLook);
  applyShake(dt);
}

/* ---------- HUD ---------- */
const H = {
  hud: $('hud'), score: $('hScore'), mult: $('hMult'), rings: $('hRings'), kills: $('hKills'), level: $('hLevel'), progress: $('hProgress'),
  speed: $('hSpeed'), alt: $('hAlt'), risk: $('hRisk'), riskLbl: $('hRiskLbl'), boost: $('hBoost'), boostBox: $('hBoostBox'),
  msg: $('hMsg'), marker: $('marker'), mDist: $('mDist'), arrow: $('arrow'), popups: $('popups'),
  speedfx: $('speedfx'), lock: $('lock'), lockTxt: $('lockTxt'), cross: $('cross'),
  mis: [$('hMis0'), $('hMis1')], fireBtn: $('btnFire'),
};
const setText = (el, t) => { if (el._t !== t) { el._t = t; el.textContent = t; } };
const setStyle = (el, k, v) => { const key = '_s' + k; if (el[key] !== v) { el[key] = v; el.style.setProperty(k, v); } };
let lastMult = 1;
function popup(text, cls = '') {
  const d = document.createElement('div');
  d.className = 'pop ' + cls; d.textContent = text;
  H.popups.appendChild(d);
  while (H.popups.children.length > 4) H.popups.firstChild.remove();
  setTimeout(() => d.remove(), 1400);
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
  setText(H.score, fmt(run.shown));
  const m = mult();
  setText(H.mult, '×' + m.toLocaleString('it-IT', { maximumFractionDigits: 2 }));
  if (m > lastMult) { H.mult.classList.remove('bump'); void H.mult.offsetWidth; H.mult.classList.add('bump'); }
  lastMult = m;
  setText(H.rings, `${run.ringsHit}/${world.rings.length}`);
  setText(H.kills, `${run.kills}/${world.targets.total}`);
  setStyle(H.progress, 'width', (clamp(world.nearest(P.pos.x, P.pos.z).i / world.N, 0, 1) * 100).toFixed(1) + '%');
  setText(H.speed, String(Math.round(P.speed * 4.2)));
  setText(H.alt, String(Math.max(0, Math.round(P.alt))));
  H.alt.parentElement.classList.toggle('danger', P.alt < world.level.radenteH);
  setStyle(H.risk, 'width', (P.risk * 100).toFixed(0) + '%');
  setStyle(H.boost, 'width', (P.energy * 100).toFixed(0) + '%');
  H.hud.classList.toggle('boosting', P.boosting);
  setStyle(H.speedfx, 'opacity', (mode === 'play' ? P.boostK * 0.85 : 0).toFixed(2));
  for (let i = 0; i < 2; i++) {
    const f = weapons.ready[i];
    setStyle(H.mis[i], '--f', f.toFixed(2));
    H.mis[i].classList.toggle('ready', f >= 1);
  }
  if (H.fireBtn) H.fireBtn.classList.toggle('empty', !weapons.canFire());
  if (run.msgT > 0) { run.msgT -= dt; if (run.msgT <= 0) message(''); }
  updateMarker();
  updateAim();
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
    H.marker.style.transform = `translate3d(${((x * 0.5 + 0.5) * W).toFixed(1)}px, ${((-y * 0.5 + 0.5) * Hh).toFixed(1)}px, 0)`;
    setText(H.mDist, Math.round(P.pos.distanceTo(r.pos)) + ' m');
    return;
  }
  if (behind) { x = -x; y = -y; }
  let dx = x * W / 2, dy = -y * Hh / 2;
  if (Math.abs(dx) < 1e-3 && Math.abs(dy) < 1e-3) dy = 1;
  const s = Math.min((W / 2 - 46) / Math.abs(dx || 1e-6), (Hh / 2 - 90) / Math.abs(dy || 1e-6));
  H.marker.style.display = 'none'; H.arrow.style.display = 'block';
  H.arrow.style.transform = `translate3d(${(W / 2 + dx * s).toFixed(1)}px, ${(Hh / 2 + dy * s).toFixed(1)}px, 0) rotate(${Math.atan2(dy, dx).toFixed(3)}rad)`;
}
// mirino davanti al muso e cornice di aggancio sul bersaglio
function updateAim() {
  const W = innerWidth, Hh = innerHeight;
  if (mode !== 'play') { H.cross.classList.remove('on'); H.lock.classList.remove('on', 'locked'); return; }
  forward(P.yaw, P.pitch, tmpV);
  tmpV2.copy(P.pos).addScaledVector(tmpV, 150).project(camera);
  H.cross.classList.add('on');
  H.cross.style.transform = `translate3d(${((tmpV2.x * 0.5 + 0.5) * W).toFixed(1)}px, ${((-tmpV2.y * 0.5 + 0.5) * Hh).toFixed(1)}px, 0)`;
  const L = weapons.lock;
  if (!L.target) { H.lock.classList.remove('on', 'locked'); return; }
  tmpV2.copy(L.target.pos).project(camera);
  if (tmpV2.z > 1 || Math.abs(tmpV2.x) > 1.02 || Math.abs(tmpV2.y) > 1.02) { H.lock.classList.remove('on', 'locked'); return; }
  H.lock.classList.add('on');
  H.lock.classList.toggle('locked', L.locked);
  H.lock.style.translate = `${((tmpV2.x * 0.5 + 0.5) * W).toFixed(1)}px ${((-tmpV2.y * 0.5 + 0.5) * Hh).toFixed(1)}px`;
  setText(H.lockTxt, L.locked ? 'AGGANCIATO' : Math.round(L.target.pos.distanceTo(P.pos)) + ' m');
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

  const was = P.boosting;
  P.boosting = input.boost && P.energy > 0.02;
  if (P.boosting && !was && P.energy > 0.1) onBoostStart();
  if (P.boosting) P.energy = Math.max(0, P.energy - dt * 0.24);
  else P.energy = Math.min(1, P.energy + dt * 0.07);
  P.boostK += ((P.boosting ? 1 : 0) - P.boostK) * Math.min(1, dt * (P.boosting ? 6 : 2.2));
  const target = lvl.speed * (P.boosting ? BOOST : 1) * (1 - P.pitch * 0.18);
  P.speed += (target - P.speed) * Math.min(1, dt * 2);

  P.prev.copy(P.pos);
  forward(P.yaw, P.pitch, fwdV);
  P.pos.addScaledVector(fwdV, P.speed * dt);
  return nr;
}

// accensione del turbo: cono di vapore, onda d'urto, colpo di FOV, aberrazione, lampo caldo, scossone, "whoomp"
function onBoostStart() {
  P.kick = 1;
  plane.userData.triggerVapor();
  fx.shock(P.pos, 2, 18, 0.5, C.shock, 0.9);
  post.kick(0.007);
  post.flash('#ffb46a', 0.06);
  fovKick = 8;
  addTrauma(0.32);
  sfx.boostOn();
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
  // scintille sul piano del cerchio e anello di luce che si allarga
  fx.ringBurst(r.pos, r.tan, r.R, r.color, r.gold ? 80 : 56, r.gold ? 16 : 12);
  fx.shock(r.pos, r.R * 2.1, r.R * 4.6, 0.5, r.color, center ? 0.85 : 0.55);
  if (center) { post.flash(r.color, 0.05); addTrauma(0.1); }
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
    if (o.dead) continue;
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
    if (o.dead) continue;          // mina abbattuta mentre la sfioravi: niente punti di sfioramento
    o.hit = true;
    const close = 1 - clamp((o.minD - 0.9) / (o.near - 0.9), 0, 1);
    const base = o.kind === 'arch' ? 200 : 120;
    const pts = Math.round(base * (1 + 3 * close) * mult() * (P.boosting ? 1.5 : 1));
    run.score += pts; run.nearMiss++;
    const label = o.kind === 'arch' ? "SOTTO L'ARCO" : close > 0.7 ? 'PER UN PELO' : 'SFIORATO';
    popup(`${label} +${fmt(pts)}`, 'risk');
    sfx.near();
    addTrauma(0.16 + close * 0.22);
    post.kick(0.0015 + close * 0.002);
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

  // polvere, spruzzi o braci sotto l'aereo
  if (f > 0.15) {
    const n = Math.random() < f * dt * 70 ? 1 + Math.floor(f * 2) : 0;
    if (n) fx.dust(x, ground, z, dustColor, f, fwdV.x, fwdV.z, n);
    if (ground === world.waterY && f > 0.35 && Math.random() < f * dt * 40) {
      if (lvl.water.lava) fx.add.spawn(x + rnd(-1.5, 1.5), ground + 0.3, z + rnd(-1.5, 1.5), rnd(-3, 3) - fwdV.x * 6, rnd(4, 10) * f, rnd(-3, 3) - fwdV.z * 6, C.emberA, C.emberB, rnd(0.5, 0.9), rnd(0.3, 0.6), 0.1, 9, 1, 1);
      else fx.smoke.spawn(x - fwdV.x * 3, ground + 0.2, z - fwdV.z * 3, rnd(-2, 2) - fwdV.x * 4, rnd(5, 11) * f, rnd(-2, 2) - fwdV.z * 4, C.water, C.water, rnd(0.8, 1.2), 1.2, 4.5, 9, 0.9, 0.6, 0.3);
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

/* ---------- missili e bersagli ---------- */
function updateCombat(dt) {
  forward(P.yaw, P.pitch, tmpV);
  weapons.updateLock(dt, world, P.pos, tmpV);
  if (input.consumeFire()) {
    if (weapons.fire(tmpV, P.speed)) { run.shots++; addTrauma(0.06); }
    else sfx.tone(180, 0.08, 'square', 0.05);
  }
}
weapons.onHit = (tg) => {
  world.targets.kill(tg);
  const mine = tg.type === 'mine';
  fx.explosion(tg.pos, mine ? 1.3 : 1.6, { debrisColor: tg.debris, nDebris: mine ? 12 : 18 });
  const d = tg.pos.distanceTo(P.pos);
  const prox = clamp(1 - d / 260, 0, 1);
  addTrauma(0.22 + prox * 0.5);
  post.flash('#ffc890', 0.05 + prox * 0.16);
  post.kick(0.003 + prox * 0.005);
  sfx.boom(prox);
  if (!mine) tg.burn = 18;
  if (mode !== 'play') return;
  const pts = Math.round(tg.value * mult());
  run.score += pts; run.kills++;
  popup(`${mine ? 'MINA ABBATTUTA' : 'BASE DISTRUTTA'} +${fmt(pts)}`, 'kill');
  sfx.kill();
};
weapons.onBlast = (pos) => {
  const d = pos.distanceTo(P.pos);
  if (d < 140) { addTrauma(0.14 * (1 - d / 140)); sfx.boom(0.25 * (1 - d / 140)); }
};

/* ---------- fine volo ---------- */
const CRASH_TXT = {
  terrain: 'Hai toccato terra', water: 'Ammaraggio non previsto', lava: 'Finito nella lava', tree: 'Preso un albero',
  rock: 'Contro la roccia', ice: 'Contro un iceberg', building: 'Contro un palazzo', arch: "Contro l'arco", oob: 'Fuori rotta troppo a lungo',
  mine: 'Preso in pieno una mina', target: 'Contro una base radar',
};
function crash(kind) {
  if (mode !== 'play') return;
  mode = 'crashed';
  crashT = 0;
  crashPos.copy(P.pos);
  camLook.copy(P.pos);
  forward(P.yaw, P.pitch, fwdV);
  crashDrift.set(-fwdV.x * 6, 3.5, -fwdV.z * 6);
  plane.visible = false; shadow.visible = false;
  ribbons.forEach((r) => { r.mat.uniforms.uOp.value = 0; });
  if (kind !== 'oob') {
    tmpV.copy(fwdV).multiplyScalar(P.speed);
    fx.explosion(P.pos, 1.7, { vel: tmpV, debrisColor: C.plane, nDebris: 16 });
    if (kind === 'water') {
      for (let i = 0; i < 40; i++) fx.smoke.spawn(P.pos.x + rnd(-3, 3), world.waterY + 0.3, P.pos.z + rnd(-3, 3), rnd(-6, 6), rnd(10, 26), rnd(-6, 6), C.water, C.water, rnd(1.2, 2.2), rnd(2, 3), rnd(6, 10), 14, 0.8, 0.8, 0.4);
      fx.shock(P.pos, 3, 30, 0.7, C.water, 0.8);
    }
    post.flash('#ffd2a0', 0.5);
    post.kick(0.012);
    addTrauma(1);
    sfx.crash();
  } else sfx.miss();
  sfx.engine(false, 0, false, 0);
  $('touch').classList.add('hidden');
  message('');
  recordScore(false, kind, 0);
  setTimeout(() => showResult({ ok: false, kind }), 1700);
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
  recordScore(true, '', stars);
  sfx.finish();
  // fuochi d'artificio sul traguardo
  const r = world.rings[world.rings.length - 1];
  fx.burst(r.pos, accentCol, 90, 30);
  fx.burst(r.pos, C.white, 60, 22);
  fx.shock(r.pos, r.R * 2, r.R * 7, 0.9, accentCol, 1.2);
  post.flash(lvl.accent, 0.12);
  $('touch').classList.add('hidden');
  message('');
  setTimeout(() => showResult({ ok: true, stars, record, t2, t3, score }), 1700);
}

function showResult(r) {
  if (mode !== 'crashed' && mode !== 'finished') return;
  const lvl = LEVELS[levelIdx];
  $('result').classList.remove('hidden');
  $('result').classList.toggle('ok', !!r.ok);
  $('rKicker').textContent = `${save.player} · Livello ${levelIdx + 1} · ${lvl.name}`;
  $('rTitle').textContent = r.ok ? 'Traguardo!' : (CRASH_TXT[r.kind] || 'Schianto');
  const st = $('rStars');
  st.innerHTML = r.ok ? [0, 1, 2].map((i) => `<span class="${i < r.stars ? '' : 'off'}" style="animation-delay:${0.15 + i * 0.18}s">★</span>`).join('') : '';
  st.classList.toggle('hidden', !r.ok);
  $('rScore').textContent = fmt(run.score);
  $('rRecord').classList.toggle('hidden', !r.record);
  const total = world.rings.length;
  const stats = [
    ['Cerchi presi', `${run.ringsHit} / ${total}`],
    ['Centri perfetti', run.centers],
    ['Combo migliore', run.maxCombo],
    ['Bersagli abbattuti', `${run.kills} / ${world.targets.total}`],
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
function hideModals() { ['result', 'pause', 'how', 'nameBox', 'scores'].forEach((id) => $(id).classList.add('hidden')); }

/* ---------- nome del pilota ---------- */
let pendingLevel = 0;
function askName(idx) {
  pendingLevel = idx;
  $('nKicker').textContent = `Livello ${idx + 1} · ${LEVELS[idx].name}`;
  const inp = $('nameInput');
  inp.value = save.player || '';
  $('nameErr').textContent = '';
  $('nameBox').classList.remove('hidden');
  setTimeout(() => { inp.focus(); inp.select(); }, 30);
}
$('nameForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('nameInput').value.replace(/\s+/g, ' ').trim().slice(0, 20);
  if (!name) { $('nameErr').textContent = 'Scrivi il tuo nome per partire.'; $('nameInput').focus(); return; }
  save.player = name;
  persist();
  $('nameInput').blur();
  startLevel(pendingLevel);
});
$('nameCancel').addEventListener('click', () => $('nameBox').classList.add('hidden'));
$('nameInput').addEventListener('input', () => { $('nameErr').textContent = ''; });

/* ---------- storico dei punteggi ---------- */
function recordScore(ok, kind, stars) {
  const lvl = LEVELS[levelIdx];
  save.scores.push({
    d: new Date().toISOString(), n: save.player || 'Senza nome', l: levelIdx + 1, ln: lvl.name,
    p: Math.round(run.score), s: stars, ok, k: ok ? '' : (CRASH_TXT[kind] || 'Schianto'),
    c: run.ringsHit, ct: world.rings.length, b: run.kills,
  });
  if (save.scores.length > 3000) save.scores.splice(0, save.scores.length - 3000);
  persist();
}
const fmtDate = (iso) => { const d = new Date(iso); const z = (n) => String(n).padStart(2, '0'); return `${z(d.getDate())}/${z(d.getMonth() + 1)}/${d.getFullYear()} ${z(d.getHours())}:${z(d.getMinutes())}`; };
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let scoreSort = 'recent';
function renderScores() {
  const list = save.scores.slice();
  if (scoreSort === 'best') list.sort((a, b) => (b.ok - a.ok) || (b.p - a.p));
  else list.reverse();
  document.querySelectorAll('#scoreTabs button').forEach((b) => b.classList.toggle('on', b.dataset.sort === scoreSort));
  $('scoreEmpty').classList.toggle('hidden', list.length > 0);
  $('scoreTable').classList.toggle('hidden', list.length === 0);
  $('scDownload').disabled = list.length === 0;
  $('scoreTable').innerHTML = '<thead><tr><th>Data</th><th>Pilota</th><th>Livello</th><th>Esito</th><th class="r">Punti</th></tr></thead><tbody>' +
    list.slice(0, 300).map((e) => `<tr class="${e.ok ? '' : 'ko'}"><td>${fmtDate(e.d)}</td><td>${esc(e.n)}</td><td>${e.l} · ${esc(e.ln)}</td><td>${e.ok ? '<span class="stars">' + '★'.repeat(e.s) + '</span>' : esc(e.k)}</td><td class="r">${fmt(e.p)}</td></tr>`).join('') + '</tbody>';
}
function scoresTxt() {
  const pad = (t, n) => String(t).padEnd(n);
  const lines = [
    'RADENTE - PUNTEGGI', `Esportato il ${fmtDate(new Date().toISOString())} · ${save.scores.length} partite`, '',
    [pad('Data', 17), pad('Pilota', 21), pad('Livello', 23), pad('Esito', 28), pad('Cerchi', 8), 'Punti'].join(' '),
    '-'.repeat(110),
  ];
  for (const e of save.scores) {
    const esito = e.ok ? `Traguardo ${'*'.repeat(e.s)}` : e.k;
    lines.push([pad(fmtDate(e.d), 17), pad(e.n, 21), pad(`${e.l} ${e.ln}`, 23), pad(esito, 28), pad(`${e.c}/${e.ct}`, 8), fmt(e.p)].join(' '));
  }
  lines.push('', 'MIGLIORI PUNTEGGI PER LIVELLO (solo voli arrivati al traguardo)');
  LEVELS.forEach((l, i) => {
    const best = save.scores.filter((e) => e.ok && e.l === i + 1).sort((a, b) => b.p - a.p).slice(0, 5);
    lines.push(`${i + 1} ${l.name}: ` + (best.length ? best.map((e) => `${e.n} ${fmt(e.p)}`).join(' · ') : 'nessuno'));
  });
  return lines.join('\r\n') + '\r\n';
}
$('btnScores').addEventListener('click', () => { renderScores(); $('scores').classList.remove('hidden'); });
$('scClose').addEventListener('click', () => $('scores').classList.add('hidden'));
document.querySelectorAll('#scoreTabs button').forEach((b) => b.addEventListener('click', () => { scoreSort = b.dataset.sort; renderScores(); }));
$('scDownload').addEventListener('click', () => {
  const blob = new Blob(['﻿' + scoresTxt()], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'punteggi-radente.txt';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});

function resetFlightVisuals() {
  fx.clear();
  weapons.clear();
  ribbons.forEach((r) => r.reset());
  trauma = 0; fovKick = 0;
  P.boostK = 0; P.kick = 0; P.boosting = false;
}

function startLevel(idx) {
  sfx.init();
  hideModals();
  $('menu').classList.add('hidden');
  const needBuild = !world || world.level !== LEVELS[idx];
  mode = 'loading';
  const go = async () => {
    loadWorld(idx);
    levelIdx = idx;
    world.reset();
    resetRun();
    resetFlightVisuals();
    input.reset();
    P.u = 0; P.roll = 0; P.speed = world.level.speed; P.energy = 1; P.alt = 10; P.risk = 0;
    autopilot(0, 0);
    plane.visible = true; shadow.visible = LOW;
    H.level.textContent = `${save.player} · ${idx + 1} · ${world.level.name}`;
    H.popups.innerHTML = '';
    message('');
    plane.position.copy(P.pos);
    plane.rotation.set(P.pitch, P.yaw, P.roll);
    plane.updateMatrixWorld();
    camera.fov = baseFov; camera.updateProjectionMatrix();
    chaseCam(0, true);
    if (needBuild) await warmup();
    H.hud.classList.remove('hidden');
    if (isTouch) { $('touch').classList.remove('hidden'); if (input.restJoy) input.restJoy(); }
    $('loading').classList.add('hidden');
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
  hideModals();
  H.hud.classList.add('hidden');
  $('touch').classList.add('hidden');
  $('countdown').classList.add('hidden');
  sfx.engine(false, 0, false, 0);
  loadWorld(levelIdx);
  world.reset();
  resetFlightVisuals();
  P.u = 0.04;
  plane.visible = true; shadow.visible = LOW;
  camera.fov = baseFov; camera.updateProjectionMatrix();
  renderCards();
  $('menu').classList.remove('hidden');
  mode = 'menu';
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
    btn.innerHTML = `<div class="thumb"><span class="num">${String(i + 1).padStart(2, '0')}</span><span class="glint"></span></div>
      <div class="info"><h3>${l.name}</h3><p>${l.mood}</p>
      <div class="meta">${locked ? `<span class="locktxt">${LOCK} Bloccato</span>` : `<span class="stars">${stars}</span><span class="best">${b ? 'Record ' + fmt(b.score) : 'Da giocare'}</span>`}</div></div>`;
    btn.title = locked ? 'Finisci il livello precedente per sbloccarlo' : l.desc;
    btn.addEventListener('click', () => askName(i));
    // passando sopra una carta, lo sfondo del menu mostra quel livello
    btn.addEventListener('pointerenter', () => { if (!locked && mode === 'menu' && i !== levelIdx) previewLevel(i); });
    btn.addEventListener('focus', () => { if (!locked && mode === 'menu' && i !== levelIdx) previewLevel(i); });
    wrap.appendChild(btn);
  });
}
let previewTimer = 0;
function previewLevel(i) {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(async () => {
    if (mode !== 'menu') return;
    $('loadingTxt').textContent = `Preparo ${LEVELS[i].name}…`;
    $('loading').classList.add('soft');
    $('loading').classList.remove('hidden');
    await new Promise((r) => setTimeout(r, 30));
    levelIdx = i;
    mode = 'loading';
    loadWorld(i);
    world.reset();
    resetFlightVisuals();
    P.u = 0.04;
    autopilot(P.u, 0);
    updateVisuals(0, 0);
    orbitCam(time);
    await warmup();
    $('loading').classList.add('hidden');
    $('loading').classList.remove('soft');
    mode = 'menu';
  }, 380);
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
// la grafica leggera cambia ombre, post-produzione e numero di particelle: si ricarica la pagina
optLow.addEventListener('change', () => {
  save.opts.low = optLow.checked; persist();
  $('loadingTxt').textContent = 'Applico la grafica…';
  $('loading').classList.remove('hidden');
  setTimeout(() => location.reload(), 60);
});

input.onKey = (code) => {
  if (code === 'Escape' || code === 'KeyP') {
    for (const id of ['how', 'nameBox', 'scores']) if (!$(id).classList.contains('hidden')) { if (code === 'Escape') $(id).classList.add('hidden'); return; }
    togglePause();
  } else if (code === 'KeyR' && $('nameBox').classList.contains('hidden') && ['play', 'paused', 'crashed', 'finished'].includes(mode)) {
    if (sfx.ctx) sfx.ctx.resume();
    startLevel(levelIdx);
  }
};
document.addEventListener('visibilitychange', () => { if (document.hidden && (mode === 'play' || mode === 'countdown')) togglePause(); });
input.bindTouch($('joyZone'), $('joyBase'), $('joyKnob'), $('btnBoost'), $('btnFire'));
input.bindMouse($('gl'));
document.addEventListener('gesturestart', (e) => e.preventDefault());

/* ---------- ciclo principale ---------- */
const DBG = { manual: false };   // con #debug il pilota automatico di prova può guidare tick() da solo
const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const raw = clock.getDelta();
  const dt = Math.min(0.05, raw);
  if (!world) return;
  if (!DBG.manual) tick(dt);
  render(dt);
  adapt(raw);
}
function render(dt) {
  if (post.enabled) post.render(dt); else renderer.render(scene, camera);
}
// risoluzione automatica. Non basta la media: a 60 Hz un gioco che alterna fotogrammi da 16 e da 33 ms ha una media
// "buona" (~21 ms) ma si vede a scatti. Si contano quindi i fotogrammi lunghi rispetto al periodo dello schermo
// (il più corto visto, così vale anche a 120 Hz): se in 2 secondi sono più dell'8%, o la media resta sotto
// i ~43 fotogrammi al secondo, la risoluzione scende;
// risale solo dopo 8 secondi puliti e mai fino al gradino che aveva già dato scatti.
const perf = { acc: 0, good: 0, period: 1, ceil: 1, frames: [] };
function adapt(raw) {
  if (DBG.manual || raw > 0.25 || !['play', 'menu', 'countdown'].includes(mode)) { perf.frames.length = 0; return; }
  perf.acc += raw; perf.frames.push(raw);
  if (perf.acc < 2) return;
  const sorted = perf.frames.slice().sort((a, b) => a - b);
  perf.period = Math.min(perf.period, Math.max(1 / 250, sorted[Math.floor(sorted.length * 0.1)]));
  const long = perf.frames.filter((t) => t > perf.period * 1.5).length / perf.frames.length;
  const avg = perf.acc / perf.frames.length;   // anche sotto i ~43 fotogrammi al secondo costanti si scende
  perf.acc = 0; perf.frames.length = 0;
  if ((long > 0.08 || avg > 0.023) && prScale > 0.5) {
    perf.ceil = Math.min(perf.ceil, prScale - 0.05);
    prScale = Math.max(0.5, prScale - (long > 0.25 ? 0.2 : 0.1)); perf.good = 0; resize();
  } else if (long < 0.01 && prScale + 0.05 < perf.ceil) {
    if (++perf.good >= 4) { prScale = Math.min(perf.ceil, prScale + 0.05); perf.good = 0; resize(); }
  } else perf.good = 0;
}

function tick(dt) {
  if (mode === 'paused' || mode === 'loading') return;
  time += dt;
  SHARED.uTime.value = time;
  input.update(dt);
  input.fireEnabled = mode === 'play';
  let vdt = dt;   // tempo degli effetti: dopo lo schianto va al rallentatore per un attimo

  if (mode === 'menu') {
    P.u += (world.level.speed * 0.8 * dt) / world.L;
    if (P.u > 0.96) P.u = 0.04;
    autopilot(P.u, dt);
  } else if (mode === 'countdown') {
    P.u += (world.level.speed * dt) / world.L;
    autopilot(P.u, dt);
    cdT -= dt;
    const n = cdT > 0.4 ? Math.ceil(cdT - 0.4) : 0;
    if (n !== cdShown) {
      cdShown = n;
      $('countdown').innerHTML = `<span>${n > 0 ? n : 'VIA!'}</span>`;
      sfx.beep(n === 0);
      if (n === 0 && levelIdx === 0 && !save.best[LEVELS[0].id]) message(`Segui la scia luminosa e scendi basso · ${isTouch ? 'FUOCO' : 'F'} per i missili`, false, 4);
    }
    if (cdT <= 0) {
      mode = 'play';
      P.prev.copy(P.pos);
      setTimeout(() => { if (mode !== 'countdown') $('countdown').classList.add('hidden'); }, 500);
    }
    sfx.engine(true, 0.4, 0, 0);
    world.setProgress(world.nearest(P.pos.x, P.pos.z).i / world.N * world.L);
  } else if (mode === 'play') {
    run.time += dt;
    const nr = updateFlight(dt);
    plane.position.copy(P.pos);
    plane.rotation.set(P.pitch, P.yaw, P.roll);
    plane.updateMatrixWorld();
    checkRings();
    if (mode === 'play') checkObstacles();
    if (mode === 'play') updateRisk(dt);
    if (mode === 'play') checkBounds(dt, nr);
    if (mode === 'play') updateCombat(dt);
    sfx.engine(true, clamp(P.speed / world.level.speed - 0.6, 0, 1.2), P.boostK, P.risk);
    if (mode === 'play') world.setProgress(world.nearest(P.pos.x, P.pos.z).i / world.N * world.L);
  } else if (mode === 'finished') {
    P.pitch += (0.25 - P.pitch) * Math.min(1, dt * 1.5);
    P.roll += (0 - P.roll) * Math.min(1, dt * 2);
    P.boostK += (0 - P.boostK) * Math.min(1, dt * 2);
    P.prev.copy(P.pos);
    P.pos.addScaledVector(forward(P.yaw, P.pitch, fwdV), P.speed * dt);
    sfx.engine(true, 0.5, 0, 0);
  } else if (mode === 'crashed') {
    crashT += dt;
    vdt = dt * (crashT < 0.18 ? 0.22 : Math.min(1, 0.22 + (crashT - 0.18) * 1.4));
  }
  if (mode !== 'play') input.consumeFire();
  P.kick = Math.max(0, P.kick - dt * 2.4);
  fovKick *= Math.exp(-dt * 2.6);

  updateVisuals(dt, vdt);

  // telecamera (dopo aver messo in posa l'aereo)
  if (mode === 'menu') orbitCam(time);
  else if (mode === 'crashed') crashCam(dt);
  else if (mode === 'finished') finishCam(dt);
  else chaseCam(dt, false);
  if (mode === 'play' || mode === 'countdown' || mode === 'finished') {
    const fovT = baseFov + P.boostK * 12 + fovKick + (mode === 'play' ? P.risk * 4 : 0);
    camera.fov += (fovT - camera.fov) * Math.min(1, dt * 5);
    camera.updateProjectionMatrix();
  }
  camera.updateMatrixWorld();   // così i segni dell'HUD seguono gli oggetti nello stesso fotogramma
  if (mode !== 'menu') updateHud(dt);

  // sole sullo schermo (riflesso dell'obiettivo) e parametri della post-produzione
  camera.getWorldDirection(tmpV);
  let sunS = 0;
  if (tmpV.dot(world.sunDir) > 0.2) {
    tmpV2.copy(world.sunDir).multiplyScalar(1000).add(camera.position).project(camera);
    const e = Math.max(Math.abs(tmpV2.x), Math.abs(tmpV2.y));
    sunS = clamp((1.15 - e) / 0.4, 0, 1);
    sunUv.set(tmpV2.x * 0.5 + 0.5, tmpV2.y * 0.5 + 0.5, sunS);
  }
  sunUv.z = sunS;
  const flying = mode === 'play' || mode === 'countdown';
  post.update(dt, time, {
    blur: flying ? P.boostK * 0.7 + P.kick * 0.5 : 0,
    risk: mode === 'play' ? clamp((P.risk - 0.3) / 0.7, 0, 1) : 0,
    sunUv,
  });
}

function updateVisuals(dt, vdt) {
  plane.position.copy(P.pos);
  plane.rotation.set(P.pitch, P.yaw, P.roll);
  plane.updateMatrixWorld();
  const throttle = mode === 'menu' ? 0.55 : clamp(P.speed / world.level.speed - 0.4, 0, 1);
  plane.userData.update(dt, time, { throttle, boost: P.boostK, kick: P.kick });

  // ombra finta (solo con la grafica leggera)
  if (shadow.visible) {
    const g = world.groundAt(P.pos.x, P.pos.z);
    const alt = P.pos.y - g;
    shadow.position.set(P.pos.x, g + 0.3, P.pos.z);
    shadow.rotation.y = P.yaw;
    const s = (1 + alt * 0.012) * 0.62;
    shadow.scale.set(s * Math.max(0.3, Math.cos(P.roll)), 1, s);
    shadow.userData.mat.opacity = clamp(0.5 - alt * 0.009, 0, 0.5);
  }

  // scie bianche dalle estremità delle ali: in virata stretta, col turbo e a filo del terreno
  const pull = clamp(Math.abs(input.y) * 0.7 + Math.abs(P.roll) * 0.6, 0, 1);
  const active = plane.visible && mode !== 'crashed';
  const want = active ? Math.max(P.boostK * 0.12, pull * (mode === 'play' ? 0.5 : 0.35), P.risk > 0.35 ? 0.32 : 0) : 0;
  ribT += dt;
  const shift = ribT >= 1 / 60;
  if (shift) ribT = Math.min(ribT - 1 / 60, 1 / 60);
  for (let k = 0; k < 2; k++) {
    const rb = ribbons[k];
    if (active) { tipW.copy(plane.userData.tips[k]).applyMatrix4(plane.matrixWorld); rb.push(tipW, shift); }
    const u = rb.mat.uniforms.uOp;
    u.value += (want - u.value) * Math.min(1, dt * 4);
  }

  // fiamma lunga del postbruciatore: particelle calde lungo il tratto percorso dall'ugello
  nozzlePrev.copy(nozzleW);
  nozzleW.copy(plane.userData.nozzle).applyMatrix4(plane.matrixWorld);
  if (active && P.boostK > 0.15 && nozzlePrev.distanceToSquared(nozzleW) < 400) {
    forward(P.yaw, P.pitch, tmpV);
    const n = LOW ? 2 : 3;
    for (let i = 0; i < n; i++) {
      tmpV2.copy(nozzlePrev).lerp(nozzleW, (i + 1) / n);
      fx.add.spawn(tmpV2.x, tmpV2.y, tmpV2.z, -tmpV.x * 28 + rnd(-1, 1), -tmpV.y * 28 + rnd(-1, 1), -tmpV.z * 28 + rnd(-1, 1),
        C.exA, C.exB, 0.08, 0.8 * P.boostK, 0.2, 0, 2, 0.4 * P.boostK, 0);
    }
  }

  fx.lines.update(dt, mode === 'play' || mode === 'countdown' ? P.boostK * 0.9 + P.kick * 0.35 : 0, P.speed);
  fx.update(vdt);
  world.update(vdt, time, camera.position);
  world.targets.update(vdt, time);
  // basi distrutte: fumano e bruciano per un po'
  for (const b of world.targets.bases) {
    if (!(b.burn > 0)) continue;
    b.burn -= vdt;
    if (Math.random() < 0.55 && Math.abs(b.x - camera.position.x) < 700 && Math.abs(b.z - camera.position.z) < 700) fx.smolder(b.x, b.g + 1.2 * b.scale, b.z, Math.min(1, b.burn / 6));
  }
  // ombre: la "scatola" del sole segue l'aereo, spostata in avanti dove si guarda
  forward(P.yaw, P.pitch, tmpV);
  world.focusSun(tmpV2.copy(P.pos).addScaledVector(tmpV, mode === 'menu' ? 0 : 70));
  weapons.update(vdt, world);
}

/* ---------- prova automatica (solo con #debug nell'indirizzo) ---------- */
if (location.hash.includes('debug')) {
  window.__R = { tick, input, P, run, save, world: () => world, mode: () => mode, start: startLevel, askName, scoresTxt, weapons, dbg: DBG, render: () => render(1 / 60), camera, renderer, post };
}

/* ---------- avvio ---------- */
(async () => {
  $('loadingTxt').textContent = 'Preparo il volo…';
  $('loading').classList.remove('hidden');
  await new Promise((r) => setTimeout(r, 30));
  loadWorld(levelIdx);
  world.reset();
  P.u = 0.04;
  autopilot(P.u, 0);
  orbitCam(0);
  await warmup();
  $('loading').classList.add('hidden');
  showMenu();
  frame();
})();
