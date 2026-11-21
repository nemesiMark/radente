// Modello low-poly dell'aereo (muso verso -Z) e della sua ombra.
import * as THREE from 'three';

export function makePlane() {
  const g = new THREE.Group();
  const M = (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
  const red = M('#d8352a'), cream = M('#f2e8d2'), dark = M('#23262d');
  const glass = new THREE.MeshPhongMaterial({ color: '#7fd6ff', shininess: 120, specular: '#ffffff', flatShading: true });

  const add = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m; };

  add(new THREE.CylinderGeometry(0.22, 0.56, 5.6, 8).rotateX(Math.PI / 2), red);              // fusoliera
  add(new THREE.CylinderGeometry(0.6, 0.56, 0.9, 10).rotateX(Math.PI / 2), dark, 0, 0, -3.05); // cofano motore
  add(new THREE.ConeGeometry(0.24, 0.6, 8).rotateX(-Math.PI / 2), cream, 0, 0, -3.8);          // ogiva
  add(new THREE.BoxGeometry(9, 0.16, 1.5), cream, 0, -0.2, -0.7);                              // ala
  add(new THREE.BoxGeometry(0.9, 0.2, 1.54), red, -4.1, -0.2, -0.7);                           // estremità
  add(new THREE.BoxGeometry(0.9, 0.2, 1.54), red, 4.1, -0.2, -0.7);
  add(new THREE.BoxGeometry(3.2, 0.12, 0.9), cream, 0, 0.05, 2.55);                            // piano di coda
  add(new THREE.BoxGeometry(0.12, 1.4, 1.0), red, 0, 0.7, 2.6);                                // deriva
  add(new THREE.BoxGeometry(1.2, 0.18, 0.5), cream, 0, -0.5, -1.4);                            // carrello stilizzato
  const canopy = add(new THREE.SphereGeometry(0.5, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), glass, 0, 0.3, -0.5);
  canopy.scale.set(0.95, 0.9, 1.9);

  const prop = new THREE.Group();
  prop.position.z = -3.6;
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.16, 3.2, 0.06), dark);
  prop.add(blade);
  const blur = new THREE.Mesh(new THREE.CircleGeometry(1.6, 24), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }));
  prop.add(blur);
  g.add(prop);

  g.rotation.order = 'YXZ';
  g.scale.setScalar(0.6);
  g.userData = {
    prop,
    tips: [new THREE.Vector3(-4.5, -0.2, -0.4), new THREE.Vector3(4.5, -0.2, -0.4)],
  };
  return g;
}

export function makeShadow() {
  const mat = new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const g = new THREE.Group();
  const wing = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 0.9).rotateX(-Math.PI / 2), mat);
  wing.position.z = -0.4;
  const body = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 3.8).rotateX(-Math.PI / 2), mat);
  const tail = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.55).rotateX(-Math.PI / 2), mat);
  tail.position.z = 1.55;
  g.add(wing, body, tail);
  g.renderOrder = 2;
  g.userData.mat = mat;
  return g;
}
