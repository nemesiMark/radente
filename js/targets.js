// Bersagli da abbattere con i missili:
// - mine galleggianti sulla rotta, a metà strada tra due cerchi: se le tocchi ti schianti, quindi o le abbatti o le schivi;
// - basi radar a terra (sui tetti in città, su piattaforme galleggianti nei fiordi) vicino alla rotta: punti extra.
// Usa solo il generatore casuale "grafico" (R2): la disposizione di cerchi e ostacoli resta quella di sempre.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glowTexture } from './shade.js';

const dummy = new THREE.Object3D();
const tmpC = new THREE.Color();

function paint(geo, color) {
  const c = new THREE.Color(color), n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}
const at = (geo, x, y, z) => geo.translate(x, y, z);

// mina: sfera di metallo scuro con punte, fascia luminosa a parte
function mineGeometry() {
  const parts = [paint(new THREE.SphereGeometry(1.2, 22, 16), '#3b3f47')];
  const n = 14, up = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion(), d = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const y = 1 - (i + 0.5) / n * 2, r = Math.sqrt(1 - y * y), th = i * 2.39996;
    d.set(Math.cos(th) * r, y, Math.sin(th) * r);
    const g = new THREE.ConeGeometry(0.2, 0.85, 8).translate(0, 1.42, 0);
    q.setFromUnitVectors(up, d); g.applyQuaternion(q);
    parts.push(paint(g, '#5a5f69'));
    const cap = new THREE.CylinderGeometry(0.24, 0.24, 0.12, 8).translate(0, 1.04, 0);
    cap.applyQuaternion(q);
    parts.push(paint(cap, '#262930'));
  }
  const g = mergeGeometries(parts); parts.forEach((p) => p.dispose());
  return g;
}
function mineGlowGeometry() {
  const parts = [new THREE.TorusGeometry(1.24, 0.09, 8, 48).rotateX(Math.PI / 2)];
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2;
    parts.push(new THREE.SphereGeometry(0.2, 10, 8).translate(Math.cos(a) * 1.2, 0, Math.sin(a) * 1.2));
  }
  parts.push(new THREE.SphereGeometry(0.22, 10, 8).translate(0, 1.2, 0), new THREE.SphereGeometry(0.22, 10, 8).translate(0, -1.2, 0));
  const g = mergeGeometries(parts); parts.forEach((p) => p.dispose());
  return g;
}

// base radar: piazzola esagonale, capannone, due serbatoi, traliccio (l'antenna gira a parte)
function baseGeometry(floating) {
  const P = [];
  P.push(paint(at(new THREE.CylinderGeometry(5.2, 5.6, floating ? 1.4 : 0.8, 6), 0, floating ? 0.2 : 0.4, 0), floating ? '#4c5560' : '#8e9095'));
  if (floating) for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3 + Math.PI / 6; P.push(paint(at(new THREE.CylinderGeometry(0.75, 0.75, 1.0, 10), Math.cos(a) * 4.9, -0.2, Math.sin(a) * 4.9), '#f2c230')); }
  P.push(paint(at(new THREE.BoxGeometry(2.8, 2.3, 3.6), -2.1, 1.95, 0), '#cfd3d8'));
  P.push(paint(at(new THREE.BoxGeometry(2.9, 0.18, 3.7), -2.1, 3.18, 0), '#5d636c'));
  P.push(paint(at(new THREE.BoxGeometry(0.9, 1.2, 0.06), -2.1, 1.45, 1.82), '#22262c'));
  for (const [x, z] of [[1.4, 2.4], [3.4, 0.8]]) {
    P.push(paint(at(new THREE.CylinderGeometry(0.95, 0.95, 2.6, 18), x, 2.1, z), '#e3ddd0'));
    P.push(paint(at(new THREE.SphereGeometry(0.95, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), x, 3.4, z), '#e3ddd0'));
    P.push(paint(at(new THREE.CylinderGeometry(0.97, 0.97, 0.34, 18), x, 2.5, z), '#c8321e'));
  }
  P.push(paint(at(new THREE.CylinderGeometry(0.3, 0.42, 5.0, 8), 1.3, 3.3, -1.6), '#3a3f47'));
  P.push(paint(at(new THREE.BoxGeometry(1.4, 0.3, 1.4), 1.3, 5.8, -1.6), '#3a3f47'));
  const g = mergeGeometries(P); P.forEach((p) => p.dispose());
  return g;
}
function dishGeometry() {
  const pts = [];
  for (let i = 0; i <= 10; i++) { const r = i / 10 * 1.9; pts.push(new THREE.Vector2(r, r * r * 0.22)); }
  const bowl = new THREE.LatheGeometry(pts, 24);
  const feed = new THREE.CylinderGeometry(0.05, 0.05, 1.2, 6).translate(0, 0.6, 0);
  const horn = new THREE.SphereGeometry(0.16, 8, 6).translate(0, 1.2, 0);
  const g = mergeGeometries([paint(bowl, '#eef0f2'), paint(feed, '#3a3f47'), paint(horn, '#c8321e')]);
  [bowl, feed, horn].forEach((p) => p.dispose());
  g.rotateX(Math.PI / 2 - 0.5);
  return g;
}

export function buildTargets(ctx) {
  const { level, R2, curve, L, N, sx, sy, sz, tx, tz, rings, obstacles, nearest, near, heightAt, groundAt, waterY,
    root, track, envMats, archGaps, startS, spacing, buildings, shadows } = ctx;
  const T = level.targets || {};
  const type = level.type;
  const ringR = level.ring.radius;
  const list = [], mines = [], bases = [];

  /* --- mine sulla rotta --- */
  const gaps = [];
  for (let g = 1; g < rings.length - 2; g++) if (!archGaps.has(g)) gaps.push(g);
  const nm = Math.min(T.mines || 0, gaps.length);
  const p = new THREE.Vector3(), tan = new THREE.Vector3(), sideV = new THREE.Vector3();
  for (let k = 0; k < nm; k++) {
    const gap = gaps[Math.floor((k + 0.5) * gaps.length / nm)];
    const s = startS + (gap + 0.5) * spacing + (R2() - 0.5) * spacing * 0.2;
    const u = Math.min(0.995, s / L);
    curve.getPointAt(u, p); curve.getTangentAt(u, tan);
    sideV.set(-tan.z, 0, tan.x).normalize();
    p.addScaledVector(sideV, (R2() * 2 - 1) * ringR * 0.3);
    p.y += (R2() * 2 - 1) * ringR * 0.2;
    p.y = Math.max(p.y, groundAt(p.x, p.z) + 5);
    const ob = { shape: 'sphere', kind: 'mine', x: p.x, y: p.y, z: p.z, r: 2.0, br: 2.6, near: 5 };
    obstacles.push(ob);
    const tg = { type: 'mine', idx: mines.length, s, pos: p.clone(), base: p.clone(), hitR: 3.6, alive: true, ob, value: 300, phase: R2() * 6.28, debris: new THREE.Color('#3b3f47') };
    mines.push(tg); list.push(tg);
  }

  /* --- basi radar a terra --- */
  const nb = T.bases || 0;
  const freeOf = (x, z, rad) => {
    for (const o of obstacles) {
      const lim = (o.br || 4) + rad;
      if (Math.abs(o.x - x) < lim && Math.abs(o.z - z) < lim) return false;
    }
    return true;
  };
  const flat = (x, z, h0) => {
    for (const [dx, dz] of [[5, 0], [-5, 0], [0, 5], [0, -5]]) if (Math.abs(heightAt(x + dx, z + dz) - h0) > 2.6) return false;
    return true;
  };
  for (let b = 0; b < nb; b++) {
    // ogni base cade in un tratto diverso della rotta
    const segA = startS + (b + 0.15) * (L - startS - 200) / nb, segB = startS + (b + 0.85) * (L - startS - 200) / nb;
    let placed = null;
    for (let tries = 0; tries < 60 && !placed; tries++) {
      const s = segA + R2() * (segB - segA);
      const i = Math.min(N, Math.max(0, Math.round(s / L * N)));
      if (type === 'city') {
        // sul tetto di un palazzo vicino alla rotta
        const cand = buildings.filter((e) => Math.abs(e.z - sz[i]) < 60 && e.d > ringR + 10 && e.d < 85 && e.sy < 62 && !e.taken);
        if (!cand.length) continue;
        const e = cand[Math.floor(R2() * cand.length)];
        e.taken = true;
        placed = { x: e.x, z: e.z, g: e.sy, floating: false, scale: Math.min(1, Math.min(e.sx, e.sz) / 11) };
        break;
      }
      const side = R2() < 0.5 ? -1 : 1;
      const maxLat = type === 'canyon' ? (level.corridor || 20) - 6 : type === 'fjord' ? 70 : 60;
      const minLat = Math.min(maxLat - 2, ringR + 7);
      const lat = (minLat + R2() * (maxLat - minLat)) * side;
      const x = sx[i] - tz[i] * lat, z = sz[i] + tx[i] * lat;
      nearest(x, z);
      if (near.d < ringR + 6) continue;
      const h = heightAt(x, z);
      const floating = Number.isFinite(waterY) && h < waterY - 1.5 && !(level.water && level.water.lava);
      if (level.water && level.water.lava && h < waterY + 1.5) continue;
      const g = floating ? waterY : h;
      if (!floating && !flat(x, z, h)) continue;
      if (g + 7 > sy[i] - 2) continue;
      if (!freeOf(x, z, 7)) continue;
      placed = { x, z, g, floating, scale: 1 };
    }
    if (!placed) continue;
    const { x, z, g, floating, scale } = placed;
    const ob = { shape: 'cyl', kind: 'target', x, z, y0: g - 1.5, y1: g + 6.3 * scale, r: 5.3 * scale, br: 6.5 * scale, near: 5.5 };
    obstacles.push(ob);
    const tg = { type: 'base', idx: bases.length, x, z, g, scale, floating, pos: new THREE.Vector3(x, g + 3 * scale, z), hitR: 6.5 * scale, alive: true, ob, value: 500, phase: R2() * 6.28, debris: new THREE.Color('#cfd3d8'), y1: ob.y1 };
    bases.push(tg); list.push(tg);
  }

  /* --- grafica --- */
  let mineMesh = null, mineGlow = null, minePts = null, mineGlowMat = null, minePtsMat = null;
  if (mines.length) {
    const bm = track(new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.75, roughness: 0.32 }));
    envMats.push(bm);
    mineMesh = new THREE.InstancedMesh(track(mineGeometry()), bm, mines.length);
    mineMesh.castShadow = shadows; mineMesh.frustumCulled = false;
    mineGlowMat = track(new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.3, 0.2) }));
    mineGlow = new THREE.InstancedMesh(track(mineGlowGeometry()), mineGlowMat, mines.length);
    mineGlow.frustumCulled = false;
    root.add(mineMesh, mineGlow);
    const pg = track(new THREE.BufferGeometry());
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(mines.length * 3), 3));
    pg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(mines.length * 3).fill(1), 3));
    minePtsMat = track(new THREE.PointsMaterial({ size: 9, map: track(glowTexture(64, 0.2)), vertexColors: true, color: new THREE.Color(2.2, 0.25, 0.15), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    minePts = new THREE.Points(pg, minePtsMat); minePts.frustumCulled = false; minePts.renderOrder = 8;
    root.add(minePts);
  }
  let baseMesh = null, dishMesh = null, beacons = null, beaconMat = null;
  if (bases.length) {
    const m = track(new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.35, roughness: 0.55 }));
    envMats.push(m);
    // le basi galleggianti hanno la loro piattaforma: due mesh istanziate separate
    const fl = bases.filter((b) => b.floating), gr = bases.filter((b) => !b.floating);
    const groups = [];
    if (gr.length) groups.push([gr, track(baseGeometry(false))]);
    if (fl.length) groups.push([fl, track(baseGeometry(true))]);
    baseMesh = [];
    for (const [arr, geo] of groups) {
      const im = new THREE.InstancedMesh(geo, m, arr.length);
      im.castShadow = shadows; im.receiveShadow = true; im.frustumCulled = false;
      arr.forEach((b, k) => { b.mesh = im; b.slot = k; });
      baseMesh.push(im); root.add(im);
    }
    dishMesh = new THREE.InstancedMesh(track(dishGeometry()), m, bases.length);
    dishMesh.castShadow = shadows; dishMesh.frustumCulled = false;
    root.add(dishMesh);
    const pg = track(new THREE.BufferGeometry());
    const bp = new Float32Array(bases.length * 3);
    // luce rossa sull'angolo del tetto del capannone (coordinate locali ruotate come la base)
    bases.forEach((b, k) => {
      const lx = -3.3, lz = 1.6, c = Math.cos(b.phase), s = Math.sin(b.phase);
      bp[k * 3] = b.x + (lx * c + lz * s) * b.scale; bp[k * 3 + 1] = b.g + 3.5 * b.scale; bp[k * 3 + 2] = b.z + (-lx * s + lz * c) * b.scale;
    });
    pg.setAttribute('position', new THREE.BufferAttribute(bp, 3));
    pg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(bases.length * 3).fill(1), 3));
    beaconMat = track(new THREE.PointsMaterial({ size: 5, map: track(glowTexture(64, 0.25)), vertexColors: true, color: new THREE.Color(4, 0.35, 0.25), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    beacons = new THREE.Points(pg, beaconMat); beacons.frustumCulled = false; beacons.renderOrder = 8;
    root.add(beacons);
  }

  function placeBase(b) {
    dummy.position.set(b.x, b.g, b.z); dummy.rotation.set(0, b.phase, 0);
    const sy2 = b.alive ? 1 : 0.42;
    dummy.scale.set(b.scale, b.scale * sy2, b.scale);
    dummy.updateMatrix();
    b.mesh.setMatrixAt(b.slot, dummy.matrix);
    b.mesh.setColorAt(b.slot, tmpC.setScalar(b.alive ? 1 : 0.14));
    b.mesh.instanceMatrix.needsUpdate = true;
    b.mesh.instanceColor.needsUpdate = true;
  }

  function update(dt, t) {
    if (mineMesh) {
      const pa = minePts.geometry.attributes.position.array, ca = minePts.geometry.attributes.color.array;
      for (const m of mines) {
        const k = m.idx;
        if (m.alive) {
          m.pos.y = m.base.y + Math.sin(t * 1.3 + m.phase) * 0.55;
          m.ob.y = m.pos.y;
          dummy.position.copy(m.pos); dummy.rotation.set(0.3 * Math.sin(t * 0.7 + m.phase), t * 0.6 + m.phase, 0.25); dummy.scale.setScalar(1);
        } else dummy.scale.setScalar(0);
        dummy.updateMatrix();
        mineMesh.setMatrixAt(k, dummy.matrix); mineGlow.setMatrixAt(k, dummy.matrix);
        pa[k * 3] = m.pos.x; pa[k * 3 + 1] = m.pos.y; pa[k * 3 + 2] = m.pos.z;
        const c = m.alive ? 1 : 0; ca[k * 3] = ca[k * 3 + 1] = ca[k * 3 + 2] = c;
      }
      mineMesh.instanceMatrix.needsUpdate = mineGlow.instanceMatrix.needsUpdate = true;
      minePts.geometry.attributes.position.needsUpdate = minePts.geometry.attributes.color.needsUpdate = true;
      const pulse = 0.5 + 0.5 * Math.sin(t * 6);
      mineGlowMat.color.setRGB(1.2 + 4 * pulse, 0.12 + 0.3 * pulse, 0.08 + 0.15 * pulse);
      minePtsMat.size = 7 + 5 * pulse;
    }
    if (dishMesh) {
      for (const b of bases) {
        if (b.alive) {
          const c = Math.cos(b.phase), s = Math.sin(b.phase);
          dummy.position.set(b.x + (1.3 * c - 1.6 * s) * b.scale, b.g + 6.0 * b.scale, b.z + (-1.3 * s - 1.6 * c) * b.scale);
          dummy.rotation.set(0, t * 1.1 + b.phase, 0); dummy.scale.setScalar(b.scale);
        } else dummy.scale.setScalar(0);
        dummy.updateMatrix(); dishMesh.setMatrixAt(b.idx, dummy.matrix);
      }
      dishMesh.instanceMatrix.needsUpdate = true;
      const blink = (t % 1.1) < 0.5 ? 1 : 0.08;
      beaconMat.color.setRGB(4 * blink, 0.35 * blink, 0.25 * blink);
    }
  }

  // il bersaglio colpito: la mina sparisce (e non è più un ostacolo), la base resta come rottame basso
  function kill(tg) {
    if (!tg.alive) return;
    tg.alive = false;
    if (tg.type === 'mine') tg.ob.dead = true;
    else {
      tg.ob.y1 = tg.g + 2.4 * tg.scale;
      placeBase(tg);
      const ca = beacons.geometry.attributes.color.array;
      ca[tg.idx * 3] = ca[tg.idx * 3 + 1] = ca[tg.idx * 3 + 2] = 0;
      beacons.geometry.attributes.color.needsUpdate = true;
    }
  }

  function reset() {
    for (const m of mines) { m.alive = true; m.ob.dead = false; m.pos.copy(m.base); m.ob.y = m.base.y; }
    for (const b of bases) { b.alive = true; b.ob.y1 = b.y1; b.burn = 0; placeBase(b); }
    if (beacons) { beacons.geometry.attributes.color.array.fill(1); beacons.geometry.attributes.color.needsUpdate = true; }
    update(0, 0);
  }

  reset();
  return { list, mines, bases, update, kill, reset, total: list.length };
}
