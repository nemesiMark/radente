// Modello del jet (muso verso -Z): fusoliera tornita, ali a freccia, doppia deriva, abitacolo riflettente,
// postbruciatore con anelli d'urto, luci di navigazione, due missili sotto le ali. Più l'ombra finta di riserva.
import * as THREE from 'three';
import { NOISE } from './shade.js';
import { makeVaporCone } from './fx.js';

const V2 = (x, y) => new THREE.Vector2(x, y);

function wingGeo(pts, depth, y) {
  const s = new THREE.Shape(pts.map(([x, z]) => V2(x, z)));
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: depth * 0.28, bevelSize: 0.03, bevelSegments: 1, curveSegments: 1 });
  g.rotateX(Math.PI / 2);
  g.translate(0, y + depth / 2, 0);
  return g;
}

function finGeo(pts, depth) {
  const s = new THREE.Shape(pts.map(([z, h]) => V2(z, h)));
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.025, bevelSegments: 1, curveSegments: 1 });
  g.rotateY(-Math.PI / 2);
  g.translate(depth / 2, 0, 0);
  return g;
}

function flameMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uBoost: { value: 0 }, uInt: { value: 1 },
      uColA: { value: new THREE.Color(1, 1.3, 2) }, uColB: { value: new THREE.Color(0.3, 0.5, 1.6) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      ${NOISE}
      uniform float uTime, uBoost, uInt; uniform vec3 uColA, uColB;
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){
        float y = vUv.y;
        float rim = abs(dot(normalize(vN), normalize(vV)));
        float body = pow(1.0 - y, 1.25);
        float flick = 0.8 + 0.3 * vnoise(vec2(vUv.x * 9.0, y * 7.0 - uTime * 34.0));
        float dia = pow(0.5 + 0.5 * cos(y * 6.2831 * 4.5 - uTime * 3.0), 6.0) * uBoost * (1.0 - y);
        vec3 col = mix(uColB, uColA, rim * rim);
        float a = body * pow(rim, 1.3) * flick + dia * rim * 1.2;
        gl_FragColor = vec4(col * a * uInt, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

export function makeMissile(mats) {
  const m = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 1.45, 12).rotateX(Math.PI / 2), mats.paint);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.34, 12).rotateX(-Math.PI / 2), mats.accent);
  nose.position.z = -0.89;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.088, 0.12, 12).rotateX(Math.PI / 2), mats.graphite);
  band.position.z = -0.45;
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.1, 10).rotateX(Math.PI / 2), mats.metal);
  nozzle.position.z = 0.76;
  m.add(body, nose, band, nozzle);
  const finG = new THREE.BoxGeometry(0.012, 0.2, 0.22);
  for (let k = 0; k < 4; k++) {
    const f = new THREE.Mesh(finG, mats.graphite);
    const a = k * Math.PI / 2 + Math.PI / 4;
    f.position.set(Math.cos(a) * 0.13, Math.sin(a) * 0.13, 0.58);
    f.rotation.z = a - Math.PI / 2;
    m.add(f);
  }
  return m;
}

export function makePlane() {
  const g = new THREE.Group();
  const mats = {
    paint: new THREE.MeshPhysicalMaterial({ color: '#e6eaef', metalness: 0.3, roughness: 0.3, clearcoat: 0.9, clearcoatRoughness: 0.12 }),
    graphite: new THREE.MeshPhysicalMaterial({ color: '#2a2f37', metalness: 0.45, roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.2 }),
    accent: new THREE.MeshPhysicalMaterial({ color: '#ff4a1c', metalness: 0.2, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 }),
    metal: new THREE.MeshStandardMaterial({ color: '#868b93', metalness: 0.95, roughness: 0.28 }),
    dark: new THREE.MeshStandardMaterial({ color: '#0d0f13', metalness: 0.3, roughness: 0.55 }),
    glass: new THREE.MeshPhysicalMaterial({ color: '#0e2236', metalness: 0.15, roughness: 0.03, clearcoat: 1, clearcoatRoughness: 0.02, transparent: true, opacity: 0.86 }),
  };
  const add = (geo, mat, x = 0, y = 0, z = 0, parent = g) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };

  // fusoliera (profilo [raggio, distanza verso il muso]) e radome scuro
  const body = [[0.48, -3.5], [0.58, -3.05], [0.67, -2.1], [0.72, -0.9], [0.7, 0.4], [0.64, 1.45], [0.55, 2.3], [0.45, 3.0]];
  const nose = [[0.45, 3.0], [0.36, 3.55], [0.23, 4.15], [0.09, 4.62], [0.0, 4.78]];
  const lathe = (pts) => new THREE.LatheGeometry(pts.map(([r, a]) => V2(r, a)), 28).rotateX(-Math.PI / 2).scale(1, 0.8, 1);
  add(lathe(body), mats.paint);
  add(lathe(nose), mats.graphite);
  // dorso scuro e striscia d'accento sul muso
  add(new THREE.BoxGeometry(0.34, 0.14, 3.6), mats.graphite, 0, 0.5, 1.2);
  add(new THREE.CylinderGeometry(0.455, 0.455, 0.16, 28, 1, true).rotateX(Math.PI / 2).scale(1, 0.8, 1), mats.accent, 0, 0, -3.02);

  // abitacolo
  const canopy = add(new THREE.SphereGeometry(0.5, 28, 16), mats.glass, 0, 0.42, -1.75);
  canopy.scale.set(0.62, 0.56, 2.1);
  canopy.castShadow = false;
  const helmet = add(new THREE.SphereGeometry(0.15, 12, 10), mats.paint, 0, 0.52, -1.55);
  helmet.castShadow = false;
  add(new THREE.BoxGeometry(0.66, 0.05, 0.08), mats.graphite, 0, 0.47, -0.72);

  // prese d'aria
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(0.34, 0.46, 1.9), mats.graphite, s * 0.66, -0.14, -0.15);
    add(new THREE.BoxGeometry(0.28, 0.38, 0.06), mats.dark, s * 0.66, -0.14, -1.11);
  }

  // ali, piani di coda, derive
  const wR = [[0.6, -0.9], [3.55, 1.25], [3.55, 1.95], [0.6, 2.35]];
  add(wingGeo(wR, 0.09, -0.17), mats.paint);
  add(wingGeo(wR.map(([x, z]) => [-x, z]), 0.09, -0.17), mats.paint);
  const tR = [[0.42, 2.45], [1.9, 3.15], [1.9, 3.45], [0.42, 3.6]];
  add(wingGeo(tR, 0.06, -0.08), mats.paint);
  add(wingGeo(tR.map(([x, z]) => [-x, z]), 0.06, -0.08), mats.paint);
  const finPts = [[2.05, 0], [2.95, 1.28], [3.36, 1.3], [3.55, 0]];
  for (const s of [-1, 1]) {
    const fin = add(finGeo(finPts, 0.07), mats.paint, s * 0.4, 0.32, 0);
    fin.rotation.z = -s * 0.27;
    const tip = add(new THREE.BoxGeometry(0.08, 0.1, 0.42), mats.accent, 0, 1.26, 3.15, fin);
    tip.castShadow = false;
  }
  // strisce d'accento sulle ali e rotaie alle estremità
  for (const s of [-1, 1]) {
    const st = add(new THREE.BoxGeometry(2.1, 0.012, 0.16), mats.accent, s * 2.3, -0.065, 0.62);
    st.rotation.y = s * -0.63; st.castShadow = false;
    add(new THREE.CylinderGeometry(0.05, 0.05, 1.3, 8).rotateX(Math.PI / 2), mats.graphite, s * 3.6, -0.12, 1.55);
  }

  // ugello e bagliore interno
  const nozzle = add(new THREE.CylinderGeometry(0.42, 0.5, 0.75, 24, 1, true).rotateX(Math.PI / 2), mats.metal, 0, 0, 3.78);
  nozzle.material.side = THREE.DoubleSide;
  add(new THREE.TorusGeometry(0.44, 0.045, 6, 24), mats.metal, 0, 0, 4.15);
  const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 0.9, 2.2) });
  add(new THREE.CircleGeometry(0.4, 24), glowMat, 0, 0, 3.55).castShadow = false;

  // fiamma del postbruciatore (due coni additivi)
  const coneGeo = new THREE.ConeGeometry(1, 1, 28, 12, true).translate(0, 0.5, 0).rotateX(Math.PI / 2);
  const outerMat = flameMaterial(), innerMat = flameMaterial();
  const outer = new THREE.Mesh(coneGeo, outerMat), inner = new THREE.Mesh(coneGeo, innerMat);
  outer.position.z = inner.position.z = 4.05;
  outer.renderOrder = 12; inner.renderOrder = 13;
  outer.frustumCulled = inner.frustumCulled = false;
  g.add(outer, inner);
  const light = new THREE.PointLight('#ff9a5a', 0, 30, 2);
  light.position.set(0, -0.3, 5.2);
  g.add(light);

  // luci di navigazione
  const lamp = (color, x, y, z) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), new THREE.MeshBasicMaterial({ color }));
    m.position.set(x, y, z); g.add(m); return m;
  };
  const navL = lamp(new THREE.Color(9, 0.25, 0.2), -3.62, -0.1, 1.0);
  const navR = lamp(new THREE.Color(0.2, 7, 0.9), 3.62, -0.1, 1.0);
  const strobe = lamp(new THREE.Color(0, 0, 0), 0, 0.62, 2.75);
  const strobeOn = new THREE.Color(12, 12, 12), strobeOff = new THREE.Color(0, 0, 0);

  // missili sotto le ali (si nascondono quando partono e ricompaiono ricaricati)
  const missiles = [], missileLocal = [];
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(0.06, 0.16, 0.7), mats.graphite, s * 1.95, -0.27, 0.8);
    const m = makeMissile(mats);
    m.position.set(s * 1.95, -0.42, 0.65);
    m.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    g.add(m);
    missiles.push(m);
    missileLocal.push(m.position.clone());
  }

  const vapor = makeVaporCone();
  vapor.position.z = 0.6;
  g.add(vapor);

  g.rotation.order = 'YXZ';
  g.scale.setScalar(0.62);

  const colIdleA = new THREE.Color(0.9, 1.2, 2.4), colIdleB = new THREE.Color(0.25, 0.45, 1.8);
  const colHotA = new THREE.Color(7, 5.6, 3.6), colHotB = new THREE.Color(4.2, 1.1, 0.35), colEdge = new THREE.Color(1.6, 0.25, 0.6);
  let vaporT = 1;

  g.userData = {
    mats, missiles, missileLocal, light, vapor,
    tips: [new THREE.Vector3(-3.62, -0.1, 1.6), new THREE.Vector3(3.62, -0.1, 1.6)],
    nozzle: new THREE.Vector3(0, 0, 4.3),
    setEnv(tex) {
      for (const k in mats) {
        const m = mats[k];
        if (m.envMap !== tex) { const was = !!m.envMap; m.envMap = tex; if (!was) m.needsUpdate = true; }
      }
      mats.glass.envMapIntensity = 1.8;
    },
    setMissile(i, f) {
      const m = missiles[i];
      m.visible = f > 0.02;
      const e = f >= 1 ? 1 : 1 - Math.pow(1 - f, 3);
      m.scale.setScalar(0.4 + 0.6 * e);
      m.position.z = missileLocal[i].z + (1 - e) * 0.9;
    },
    triggerVapor() { vaporT = 0; },
    // throttle 0..1, boost 0..1 (morbido), kick 0..1 (scatto all'accensione del turbo)
    update(dt, t, { throttle = 0.5, boost = 0, kick = 0 } = {}) {
      const flick = 1 + 0.07 * Math.sin(t * 61) + 0.05 * Math.sin(t * 37.7);
      const len = (1.0 + throttle * 0.6 + boost * 4.6 + kick * 2.2) * flick;
      outer.scale.set(0.4 + boost * 0.06, 0.4 + boost * 0.06, len);
      inner.scale.set(0.22, 0.22, len * 0.62);
      const inten = 0.55 + throttle * 0.35 + boost * 0.9 + kick * 0.8;
      const iu = innerMat.uniforms, ou = outerMat.uniforms;
      iu.uTime.value = ou.uTime.value = t;
      iu.uBoost.value = ou.uBoost.value = boost;
      iu.uInt.value = ou.uInt.value = inten;
      iu.uColA.value.copy(colIdleA).lerp(colHotA, boost);
      iu.uColB.value.copy(colIdleA).lerp(colHotA, boost * 0.85);
      ou.uColA.value.copy(colIdleB).lerp(colHotB, boost);
      ou.uColB.value.copy(colIdleB).multiplyScalar(0.7).lerp(colEdge, boost * 0.6);
      glowMat.color.setRGB(0.6 + boost * 5, 0.9 + boost * 2.6, 2.2 + boost * 0.4);
      light.intensity = (6 + throttle * 6 + boost * 140 + kick * 120) * flick;
      light.color.setRGB(1, 0.62 + (1 - boost) * 0.2, 0.36 + (1 - boost) * 0.5);
      // strobo: due lampi brevi ogni 1,3 s
      const ph = t % 1.3;
      strobe.material.color.copy(ph < 0.05 || (ph > 0.14 && ph < 0.19) ? strobeOn : strobeOff);
      navL.scale.setScalar(1 + 0.15 * Math.sin(t * 3));
      navR.scale.setScalar(1 + 0.15 * Math.sin(t * 3 + 1));
      if (vaporT < 1) {
        vaporT = Math.min(1, vaporT + dt / 0.55);
        vapor.visible = vaporT < 1;
        vapor.material.uniforms.uT.value = vaporT;
        vapor.material.uniforms.uTime.value = t;
        const s = 0.75 + vaporT * 0.7;
        vapor.scale.set(s, s, 0.8 + vaporT * 0.6);
      }
    },
  };
  return g;
}

// ombra finta (usata solo se le ombre vere sono spente)
export function makeShadow() {
  const mat = new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const g = new THREE.Group();
  const s = new THREE.Shape([V2(0, 2.9), V2(2.2, -1.3), V2(2.2, -1.7), V2(0, -2.2), V2(-2.2, -1.7), V2(-2.2, -1.3)]);
  const m = new THREE.Mesh(new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2), mat);
  g.add(m);
  g.renderOrder = 2;
  g.userData.mat = mat;
  return g;
}
