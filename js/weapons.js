// Missili: due colpi sotto le ali che si ricaricano da soli, aggancio automatico del bersaglio più vicino al centro
// della mira, volo a ricerca con scia di fumo, esplosione su bersagli, terreno, ostacoli o a fine corsa.
import * as THREE from 'three';
import { makeMissile } from './plane.js';
import { sdObstacle } from './world.js';

export const RELOAD = 1.7;            // secondi per ricaricare un missile
const LOCK_RANGE = 400, LOCK_MIN = 22;
const LOCK_COS = Math.cos(THREE.MathUtils.degToRad(18));
const LOCK_TIME = 0.3;                // secondi di mira per l'aggancio pieno
const LIFE = 3.4;
const NOSE = new THREE.Vector3(0, 0, -1);
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), seg = new THREE.Vector3();

// distanza del punto p dal segmento a-b (il missile percorre diversi metri per fotogramma)
function segDist(a, b, p) {
  seg.subVectors(b, a);
  const l2 = seg.lengthSq();
  const t = l2 > 0 ? Math.max(0, Math.min(1, tmp2.subVectors(p, a).dot(seg) / l2)) : 0;
  return tmp2.copy(a).addScaledVector(seg, t).distanceTo(p);
}

export class Weapons {
  constructor(scene, plane, fx, sfx) {
    this.plane = plane; this.fx = fx; this.sfx = sfx;
    this.ready = [1, 1];             // 1 = pronto, 0..1 = in ricarica
    this.next = 0;
    this.pool = [];
    for (let i = 0; i < 6; i++) {
      const mesh = makeMissile(plane.userData.mats);
      mesh.scale.setScalar(plane.scale.x);
      mesh.visible = false;
      scene.add(mesh);
      this.pool.push({ mesh, on: false, pos: new THREE.Vector3(), prev: new THREE.Vector3(), dir: new THREE.Vector3(), speed: 0, maxSpeed: 0, t: 0, target: null, homing: 2 });
    }
    this.lock = { target: null, t: 0, locked: false };
    this.onHit = null;     // (bersaglio, missile)
    this.onBlast = null;   // (posizione, tipo)
    this.groundColor = new THREE.Color('#c8b89a');
  }

  // bersaglio migliore davanti all'aereo: dentro un cono di 18°, entro 400 m, non nascosto dal terreno
  updateLock(dt, world, pos, fwd) {
    const L = this.lock;
    let best = null, bestScore = Infinity;
    for (const tg of world.targets.list) {
      if (!tg.alive) continue;
      tmp.subVectors(tg.pos, pos);
      const d = tmp.length();
      if (d < LOCK_MIN || d > LOCK_RANGE) continue;
      const c = tmp.dot(fwd) / d;
      if (c < LOCK_COS) continue;
      tmp.multiplyScalar(0.5).add(pos);
      if (world.heightAt(tmp.x, tmp.z) > tmp.y + 1) continue;
      const score = (1 - c) * 40 + d / LOCK_RANGE;
      if (score < bestScore) { bestScore = score; best = tg; }
    }
    if (best !== L.target) { L.target = best; L.t = 0; L.locked = false; }
    else if (best) {
      L.t += dt;
      if (!L.locked && L.t >= LOCK_TIME) { L.locked = true; this.sfx.lock(); }
    }
    return L;
  }

  canFire() { return this.ready[0] >= 1 || this.ready[1] >= 1; }

  fire(fwd, speed) {
    const r = this.ready;
    const i = r[this.next] >= 1 ? this.next : r[1 - this.next] >= 1 ? 1 - this.next : -1;
    if (i < 0) return false;
    const m = this.pool.find((x) => !x.on);
    if (!m) return false;
    r[i] = 0; this.next = 1 - i;
    this.plane.updateMatrixWorld();
    m.pos.copy(this.plane.userData.missileLocal[i]).applyMatrix4(this.plane.matrixWorld);
    m.prev.copy(m.pos);
    m.dir.copy(fwd);
    m.speed = speed; m.maxSpeed = speed + 150;
    m.t = 0; m.on = true;
    m.target = this.lock.target;
    m.homing = this.lock.locked ? 3.6 : 2.2;
    m.mesh.position.copy(m.pos);
    m.mesh.quaternion.setFromUnitVectors(NOSE, m.dir);
    m.mesh.visible = true;
    this.plane.userData.setMissile(i, 0);
    this.fx.muzzle(m.pos);
    this.sfx.missile();
    return true;
  }

  update(dt, world) {
    for (let i = 0; i < 2; i++) {
      if (this.ready[i] < 1) {
        this.ready[i] = Math.min(1, this.ready[i] + dt / RELOAD);
        if (this.ready[i] >= 1) this.sfx.reload();
      }
      this.plane.userData.setMissile(i, this.ready[i]);
    }
    for (const m of this.pool) {
      if (!m.on) continue;
      m.t += dt;
      const motor = m.t > 0.12;
      if (motor) m.speed = Math.min(m.maxSpeed, m.speed + 260 * dt);
      if (m.target && m.target.alive && m.t > 0.14) {
        // ricerca: gira verso il bersaglio con una velocità angolare massima (sempre più decisa)
        tmp.subVectors(m.target.pos, m.pos).normalize();
        const ang = m.dir.angleTo(tmp);
        const maxA = m.homing * dt * (1 + m.t * 0.9);
        if (ang > 1e-4) m.dir.lerp(tmp, Math.min(1, maxA / ang)).normalize();
      } else if (!motor) {
        m.dir.y -= 0.5 * dt; m.dir.normalize();   // si stacca dall'ala e cade un poco prima di accendersi
      }
      m.prev.copy(m.pos);
      m.pos.addScaledVector(m.dir, m.speed * dt);
      m.mesh.position.copy(m.pos);
      m.mesh.quaternion.setFromUnitVectors(NOSE, m.dir);
      if (motor) {
        // scia continua anche a 200 m/s: più sbuffi lungo il tratto percorso nel fotogramma
        const n = Math.min(6, 1 + Math.floor(m.speed * dt / 1.5));
        for (let k = 0; k < n; k++) {
          tmp.copy(m.prev).lerp(m.pos, (k + 1) / n).addScaledVector(m.dir, -0.6);
          this.fx.missileTrail(tmp.x, tmp.y, tmp.z, -m.dir.x * 18, -m.dir.y * 18, -m.dir.z * 18);
        }
      }
      let hit = null;
      for (const tg of world.targets.list) {
        if (!tg.alive) continue;
        if (Math.abs(tg.pos.x - m.pos.x) > 80 || Math.abs(tg.pos.z - m.pos.z) > 80) continue;
        if (segDist(m.prev, m.pos, tg.pos) < tg.hitR) { hit = tg; break; }
      }
      if (hit) { this.stop(m); if (this.onHit) this.onHit(hit, m); continue; }
      const g = world.groundAt(m.pos.x, m.pos.z);
      if (m.pos.y < g) { m.pos.y = g + 0.4; this.boom(m, 'ground'); continue; }
      let ob = null;
      for (const o of world.obstacles) {
        if (o.dead) continue;
        const lim = o.br + 4;
        if (Math.abs(o.x - m.pos.x) > lim || Math.abs(o.z - m.pos.z) > lim) continue;
        if (sdObstacle(o, m.pos.x, m.pos.y, m.pos.z) < 0.4) { ob = o; break; }
      }
      if (ob) { this.boom(m, ob.kind); continue; }
      if (m.t > LIFE) this.boom(m, 'air');
    }
  }

  stop(m) { m.on = false; m.mesh.visible = false; }

  boom(m, kind) {
    this.stop(m);
    this.fx.blast(m.pos, kind === 'ground' ? this.groundColor : null);
    if (this.onBlast) this.onBlast(m.pos, kind);
  }

  clear() {
    for (const m of this.pool) this.stop(m);
    this.ready[0] = this.ready[1] = 1;
    this.next = 0;
    this.lock.target = null; this.lock.t = 0; this.lock.locked = false;
    this.plane.userData.setMissile(0, 1); this.plane.userData.setMissile(1, 1);
  }
}
