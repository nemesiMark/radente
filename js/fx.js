// Effetti visivi: particelle (fuoco, scintille, fumo, polvere, spruzzi), palle di fuoco, onde d'urto, detriti,
// linee di velocità del turbo, scie delle ali, cono di vapore e luce delle esplosioni.
// Tutto è preparato all'inizio ("pool"): durante il gioco non si crea niente di nuovo.
import * as THREE from 'three';
import { NOISE, fogUniforms, glowTexture, puffTexture } from './shade.js';

const tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(), tmpS = new THREE.Vector3(), tmpM = new THREE.Matrix4();
const tmpU = new THREE.Vector3(), tmpW = new THREE.Vector3();
const rnd = (a, b) => a + Math.random() * (b - a);

/* ---------- particelle su Points ---------- */
class ParticlePool {
  constructor(n, additive, map) {
    this.n = n; this.cur = 0; this.live = 0; this.dirty = true;
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3);
    this.alpha = new Float32Array(n); this.size = new Float32Array(n); this.rot = new Float32Array(n);
    this.vel = new Float32Array(n * 3); this.life = new Float32Array(n); this.max = new Float32Array(n);
    this.c0 = new Float32Array(n * 3); this.c1 = new Float32Array(n * 3);
    this.grav = new Float32Array(n); this.drag = new Float32Array(n);
    this.s0 = new Float32Array(n); this.s1 = new Float32Array(n); this.a0 = new Float32Array(n); this.spin = new Float32Array(n);
    for (let i = 0; i < n; i++) this.pos[i * 3 + 1] = -99999;
    const g = this.geo = new THREE.BufferGeometry();
    const dyn = (arr, k) => new THREE.BufferAttribute(arr, k).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', dyn(this.pos, 3));
    g.setAttribute('pcolor', dyn(this.col, 3));
    g.setAttribute('alpha', dyn(this.alpha, 1));
    g.setAttribute('size', dyn(this.size, 1));
    g.setAttribute('rot', dyn(this.rot, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: Object.assign(fogUniforms(), { map: { value: map }, scale: { value: 400 } }),
      defines: additive ? { ADDITIVE: '' } : {},
      vertexShader: /* glsl */ `
        attribute vec3 pcolor; attribute float alpha; attribute float size; attribute float rot;
        uniform float scale;
        varying vec3 vC; varying float vA; varying float vR;
        #include <fog_pars_vertex>
        void main(){
          vC = pcolor; vR = rot;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          float dc = -mvPosition.z;
          // vicino alla telecamera la particella sfuma: niente "palle" enormi davanti agli occhi
          vA = alpha * smoothstep(1.2, 7.0, dc);
          gl_PointSize = alpha > 0.0 ? min(size * scale / max(0.6, dc), scale * 0.6) : 0.0;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        varying vec3 vC; varying float vA; varying float vR;
        #include <fog_pars_fragment>
        void main(){
          vec2 c = gl_PointCoord - 0.5;
          float cs = cos(vR), sn = sin(vR);
          vec2 uv = vec2(cs * c.x - sn * c.y, sn * c.x + cs * c.y) + 0.5;
          vec4 t = texture2D(map, uv);
          float a = t.a * vA;
          if (a < 0.004) discard;
          #ifdef ADDITIVE
            float ff = 0.0;
            #ifdef USE_FOG
              ff = radFogFactor();
            #endif
            gl_FragColor = vec4(vC * (1.0 - ff * 0.85), a);
          #else
            gl_FragColor = vec4(vC * t.rgb, a);
            #include <fog_fragment>
          #endif
        }`,
      transparent: true, depthWrite: false, fog: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 8 : 6;
  }
  // c0 → c1 durante la vita; dimensione s0 → s1; grav positiva = cade, negativa = sale
  spawn(x, y, z, vx, vy, vz, c0, c1, life, s0, s1, grav = 0, drag = 0, a0 = 1, spin = 0) {
    const i = this.cur; this.cur = (this.cur + 1) % this.n;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.c0[i3] = c0.r; this.c0[i3 + 1] = c0.g; this.c0[i3 + 2] = c0.b;
    this.c1[i3] = c1.r; this.c1[i3 + 1] = c1.g; this.c1[i3 + 2] = c1.b;
    this.life[i] = this.max[i] = life; this.s0[i] = s0; this.s1[i] = s1;
    this.grav[i] = grav; this.drag[i] = drag; this.a0[i] = a0;
    this.rot[i] = Math.random() * 6.283; this.spin[i] = spin * (Math.random() < 0.5 ? -1 : 1);
    this.live++;
  }
  update(dt) {
    if (this.live === 0 && !this.dirty) return;
    let live = 0;
    const { pos, vel, life, max, alpha, size, col, c0, c1 } = this;
    for (let i = 0; i < this.n; i++) {
      if (life[i] <= 0) { if (alpha[i] !== 0) { alpha[i] = 0; pos[i * 3 + 1] = -99999; } continue; }
      life[i] -= dt;
      if (life[i] <= 0) { alpha[i] = 0; pos[i * 3 + 1] = -99999; continue; }
      live++;
      const i3 = i * 3;
      const d = Math.max(0, 1 - this.drag[i] * dt);
      vel[i3] *= d; vel[i3 + 1] = vel[i3 + 1] * d - this.grav[i] * dt; vel[i3 + 2] *= d;
      pos[i3] += vel[i3] * dt; pos[i3 + 1] += vel[i3 + 1] * dt; pos[i3 + 2] += vel[i3 + 2] * dt;
      const f = 1 - life[i] / max[i];
      alpha[i] = this.a0[i] * Math.min(1, f * 14) * (1 - f * f);
      size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * f;
      col[i3] = c0[i3] + (c1[i3] - c0[i3]) * f;
      col[i3 + 1] = c0[i3 + 1] + (c1[i3 + 1] - c0[i3 + 1]) * f;
      col[i3 + 2] = c0[i3 + 2] + (c1[i3 + 2] - c0[i3 + 2]) * f;
      this.rot[i] += this.spin[i] * dt;
    }
    this.dirty = live > 0 || this.live > 0;
    this.live = live;
    const a = this.geo.attributes;
    a.position.needsUpdate = a.pcolor.needsUpdate = a.alpha.needsUpdate = a.size.needsUpdate = a.rot.needsUpdate = true;
  }
  clear() {
    this.life.fill(0); this.alpha.fill(0);
    for (let i = 0; i < this.n; i++) this.pos[i * 3 + 1] = -99999;
    this.live = 0; this.dirty = true;
  }
}

/* ---------- palle di fuoco (billboard con rumore) ---------- */
const BILLBOARD_VS = /* glsl */ `
  varying vec2 vUv;
  varying float vNear;
  #include <fog_pars_vertex>
  void main(){
    vUv = uv;
    vec4 mvPosition = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float s = length(modelMatrix[0].xyz);
    // quando la telecamera ci passa dentro l'effetto sfuma invece di coprire lo schermo
    vNear = smoothstep(s * 0.25 + 1.0, s * 0.6 + 4.0, -mvPosition.z);
    mvPosition.xy += position.xy * s;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;

class Fireballs {
  constructor(n) {
    this.items = [];
    const geo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < n; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: Object.assign(fogUniforms(), { uT: { value: 0 }, uSeed: { value: Math.random() * 50 }, uHot: { value: 1 } }),
        vertexShader: BILLBOARD_VS,
        fragmentShader: /* glsl */ `
          ${NOISE}
          uniform float uT, uSeed, uHot;
          varying vec2 vUv; varying float vNear;
          #include <fog_pars_fragment>
          void main(){
            vec2 p = vUv * 2.0 - 1.0;
            float r = length(p);
            float t = uT;
            float n = fbm5(p * 1.7 + vec2(uSeed, uSeed * 0.7) + vec2(0.0, -t * 1.3));
            float n2 = vnoise(p * 5.0 + uSeed * 1.3 - t * 2.0);
            float edge = 0.6 + 0.32 * t;
            float d = r / edge + (0.5 - n) * 0.8 + (0.5 - n2) * 0.16;
            float body = 1.0 - smoothstep(0.6, 1.0, d);
            float core = (1.0 - smoothstep(0.0, 0.8, d)) * clamp(1.0 - t * 1.7, 0.0, 1.0) * uHot;
            vec3 fire = mix(vec3(1.0, 0.28, 0.05), vec3(1.0, 0.8, 0.45), core) * (1.4 + 7.0 * core);
            float burn = smoothstep(0.18, 0.72, t + (n - 0.5) * 0.5);
            vec3 smoke = vec3(0.075, 0.07, 0.068) * (0.7 + 0.9 * n);
            vec3 col = mix(fire, smoke, burn);
            float a = body * (1.0 - smoothstep(0.62, 1.0, t)) * vNear;
            float occ = a * mix(0.22, 0.85, burn);
            vec3 outc = col * a;
            #ifdef USE_FOG
              float ff = radFogFactor();
              outc = mix(outc, radFogColor() * occ, ff);
            #endif
            gl_FragColor = vec4(outc, occ);
          }`,
        transparent: true, depthWrite: false, fog: true,
        blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      });
      const m = new THREE.Mesh(geo, mat);
      m.visible = false; m.frustumCulled = false; m.renderOrder = 9;
      this.items.push({ m, mat, t: 0, life: 1, delay: 0, vy: 0, s: 1, on: false });
    }
    this.next = 0;
  }
  spawn(x, y, z, size, life = 1.3, delay = 0, hot = 1) {
    const it = this.items[this.next]; this.next = (this.next + 1) % this.items.length;
    it.on = true; it.t = 0; it.life = life; it.delay = delay; it.s = size; it.vy = size * 0.18;
    it.m.position.set(x, y, z); it.m.visible = false;
    it.mat.uniforms.uSeed.value = Math.random() * 50; it.mat.uniforms.uHot.value = hot;
  }
  update(dt) {
    for (const it of this.items) {
      if (!it.on) continue;
      if (it.delay > 0) { it.delay -= dt; continue; }
      it.t += dt / it.life;
      if (it.t >= 1) { it.on = false; it.m.visible = false; continue; }
      it.m.visible = true;
      it.m.position.y += it.vy * dt;
      it.m.scale.setScalar(it.s * (0.45 + it.t * 0.85));
      it.mat.uniforms.uT.value = it.t;
    }
  }
  clear() { for (const it of this.items) { it.on = false; it.m.visible = false; } }
}

/* ---------- onde d'urto (anelli che si allargano) ---------- */
class Shockwaves {
  constructor(n) {
    this.items = [];
    const geo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < n; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: Object.assign(fogUniforms(), { uT: { value: 0 }, uColor: { value: new THREE.Color(1, 1, 1) }, uInt: { value: 1 } }),
        vertexShader: BILLBOARD_VS,
        fragmentShader: /* glsl */ `
          uniform float uT, uInt; uniform vec3 uColor;
          varying vec2 vUv; varying float vNear;
          #include <fog_pars_fragment>
          void main(){
            vec2 p = vUv * 2.0 - 1.0;
            float r = length(p);
            float w = mix(0.12, 0.025, uT);
            float ring = 1.0 - smoothstep(0.0, w, abs(r - 0.88));
            float inner = (1.0 - smoothstep(0.0, 0.9, r)) * 0.18;
            float k = (1.0 - uT);
            float a = (ring + inner) * k * k * uInt * vNear;
            float ff = 0.0;
            #ifdef USE_FOG
              ff = radFogFactor();
            #endif
            gl_FragColor = vec4(uColor * a * (1.0 - ff), 1.0);
          }`,
        transparent: true, depthWrite: false, fog: true, blending: THREE.AdditiveBlending,
      });
      const m = new THREE.Mesh(geo, mat);
      m.visible = false; m.frustumCulled = false; m.renderOrder = 10;
      this.items.push({ m, mat, t: 0, life: 0.5, s0: 1, s1: 10, on: false });
    }
    this.next = 0;
  }
  spawn(pos, s0, s1, life, color, intensity = 1) {
    const it = this.items[this.next]; this.next = (this.next + 1) % this.items.length;
    it.on = true; it.t = 0; it.life = life; it.s0 = s0; it.s1 = s1;
    it.m.position.copy(pos); it.m.visible = true;
    it.mat.uniforms.uColor.value.copy(color); it.mat.uniforms.uInt.value = intensity;
  }
  update(dt) {
    for (const it of this.items) {
      if (!it.on) continue;
      it.t += dt / it.life;
      if (it.t >= 1) { it.on = false; it.m.visible = false; continue; }
      const e = 1 - Math.pow(1 - it.t, 3);
      it.m.scale.setScalar(it.s0 + (it.s1 - it.s0) * e);
      it.mat.uniforms.uT.value = it.t;
    }
  }
  clear() { for (const it of this.items) { it.on = false; it.m.visible = false; } }
}

/* ---------- detriti ---------- */
class Debris {
  constructor(n) {
    this.n = n;
    const geo = new THREE.DodecahedronGeometry(1, 0);
    geo.scale(1, 0.55, 0.8);
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.65, metalness: 0.35, flatShading: true });
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3);
    this.rot = new Float32Array(n * 3); this.spin = new Float32Array(n * 3);
    this.life = new Float32Array(n); this.size = new Float32Array(n); this.burn = new Float32Array(n);
    this.cur = 0; this.live = 0;
    const c = new THREE.Color('#333');
    for (let i = 0; i < n; i++) { this.mesh.setMatrixAt(i, tmpM.makeScale(0, 0, 0)); this.mesh.setColorAt(i, c); }
    this.mesh.instanceColor.needsUpdate = true;
  }
  spawn(x, y, z, vx, vy, vz, size, color, burn, life) {
    const i = this.cur; this.cur = (this.cur + 1) % this.n;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.rot[i3] = Math.random() * 6; this.rot[i3 + 1] = Math.random() * 6; this.rot[i3 + 2] = Math.random() * 6;
    this.spin[i3] = rnd(-9, 9); this.spin[i3 + 1] = rnd(-9, 9); this.spin[i3 + 2] = rnd(-9, 9);
    this.life[i] = life; this.size[i] = size; this.burn[i] = burn;
    this.mesh.setColorAt(i, color);
    this.mesh.instanceColor.needsUpdate = true;
    this.live++;
  }
  update(dt, groundAt, onBurn) {
    if (this.live === 0) return;
    let live = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const i3 = i * 3;
      if (this.life[i] <= 0) { this.mesh.setMatrixAt(i, tmpM.makeScale(0, 0, 0)); continue; }
      live++;
      this.vel[i3 + 1] -= 22 * dt;
      const k = Math.max(0, 1 - 0.4 * dt);
      this.vel[i3] *= k; this.vel[i3 + 2] *= k;
      this.pos[i3] += this.vel[i3] * dt; this.pos[i3 + 1] += this.vel[i3 + 1] * dt; this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      const g = groundAt(this.pos[i3], this.pos[i3 + 2]) + this.size[i] * 0.4;
      if (this.pos[i3 + 1] < g) {
        this.pos[i3 + 1] = g;
        if (this.vel[i3 + 1] < -3) { this.vel[i3 + 1] *= -0.3; this.vel[i3] *= 0.5; this.vel[i3 + 2] *= 0.5; }
        else { this.vel[i3] = this.vel[i3 + 1] = this.vel[i3 + 2] = 0; this.spin[i3] = this.spin[i3 + 1] = this.spin[i3 + 2] = 0; }
      } else {
        this.rot[i3] += this.spin[i3] * dt; this.rot[i3 + 1] += this.spin[i3 + 1] * dt; this.rot[i3 + 2] += this.spin[i3 + 2] * dt;
      }
      if (this.burn[i] > 0 && onBurn) { this.burn[i] -= dt; if (Math.random() < dt * 40) onBurn(this.pos[i3], this.pos[i3 + 1], this.pos[i3 + 2], this.burn[i]); }
      const s = this.size[i] * Math.min(1, this.life[i] / 0.6);
      tmpQ.setFromEuler(tmpE.set(this.rot[i3], this.rot[i3 + 1], this.rot[i3 + 2]));
      tmpM.compose(tmpV.set(this.pos[i3], this.pos[i3 + 1], this.pos[i3 + 2]), tmpQ, tmpS.set(s, s, s));
      this.mesh.setMatrixAt(i, tmpM);
    }
    this.live = live;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  clear() {
    for (let i = 0; i < this.n; i++) { this.life[i] = 0; this.mesh.setMatrixAt(i, tmpM.makeScale(0, 0, 0)); }
    this.mesh.instanceMatrix.needsUpdate = true; this.live = 0;
  }
}

/* ---------- linee di velocità (figlie della camera) ---------- */
class SpeedLines {
  constructor(n) {
    this.n = n;
    this.pos = new Float32Array(n * 4 * 3);
    const al = new Float32Array(n * 4), side = new Float32Array(n * 4);
    const idx = [];
    for (let i = 0; i < n; i++) {
      al[i * 4] = al[i * 4 + 1] = 1; al[i * 4 + 2] = al[i * 4 + 3] = 0;
      side[i * 4] = side[i * 4 + 2] = -1; side[i * 4 + 1] = side[i * 4 + 3] = 1;
      const b = i * 4; idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
    }
    this.st = [];
    for (let i = 0; i < n; i++) this.st.push(this.respawn({}, true));
    const g = this.geo = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aA', new THREE.BufferAttribute(al, 1));
    g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    g.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uAmt: { value: 0 }, uColor: { value: new THREE.Color(1.4, 1.6, 1.9) } },
      vertexShader: /* glsl */ `attribute float aA; attribute float aSide; varying float vA; varying float vS;
        void main(){ vA = aA; vS = aSide; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `uniform float uAmt; uniform vec3 uColor; varying float vA; varying float vS;
        void main(){ float a = vA * vA * (1.0 - abs(vS)) * uAmt; gl_FragColor = vec4(uColor * a, 1.0); }`,
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 20; this.mesh.visible = false;
  }
  respawn(s, initial) {
    const a = Math.random() * Math.PI * 2, r = rnd(2.2, 7.5);
    s.x = Math.cos(a) * r; s.y = Math.sin(a) * r * 0.75;
    s.z = initial ? rnd(-60, 0) : rnd(-70, -45);
    s.len = rnd(3, 9); s.sp = rnd(0.8, 1.3); s.w = rnd(0.012, 0.03);
    return s;
  }
  update(dt, amount, speed) {
    this.mat.uniforms.uAmt.value = amount;
    this.mesh.visible = amount > 0.01;
    if (!this.mesh.visible) return;
    const p = this.pos;
    for (let i = 0; i < this.n; i++) {
      const s = this.st[i];
      s.z += speed * s.sp * dt * 1.6;
      if (s.z > 3) this.respawn(s, false);
      // spessore tangente al cerchio intorno all'asse di vista: la linea guarda sempre la camera
      const l = Math.hypot(s.x, s.y) || 1, tx = -s.y / l * s.w * (-s.z * 0.08 + 1), ty = s.x / l * s.w * (-s.z * 0.08 + 1);
      const b = i * 12;
      p[b] = s.x - tx; p[b + 1] = s.y - ty; p[b + 2] = s.z;
      p[b + 3] = s.x + tx; p[b + 4] = s.y + ty; p[b + 5] = s.z;
      p[b + 6] = s.x - tx; p[b + 7] = s.y - ty; p[b + 8] = s.z - s.len;
      p[b + 9] = s.x + tx; p[b + 10] = s.y + ty; p[b + 11] = s.z - s.len;
    }
    this.geo.attributes.position.needsUpdate = true;
  }
}

/* ---------- scia a nastro (estremità alari) ---------- */
export class Ribbon {
  constructor(n, width, color) {
    this.n = n; this.init = false;
    this.pts = new Float32Array(n * 3);
    this.pos = new Float32Array(n * 2 * 3); this.dir = new Float32Array(n * 2 * 3);
    const side = new Float32Array(n * 2), age = new Float32Array(n * 2), idx = [];
    for (let i = 0; i < n; i++) {
      side[i * 2] = -1; side[i * 2 + 1] = 1; age[i * 2] = age[i * 2 + 1] = i / (n - 1);
      if (i < n - 1) { const b = i * 2; idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
    }
    const g = this.geo = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aDir', new THREE.BufferAttribute(this.dir, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    g.setAttribute('aAge', new THREE.BufferAttribute(age, 1));
    g.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      uniforms: Object.assign(fogUniforms(), { uW: { value: width }, uOp: { value: 0 }, uColor: { value: new THREE.Color(color) } }),
      vertexShader: /* glsl */ `
        attribute vec3 aDir; attribute float aSide; attribute float aAge;
        uniform float uW;
        varying float vAge; varying float vSide; varying float vNear;
        #include <fog_pars_vertex>
        void main(){
          vec3 toCam = normalize(cameraPosition - position);
          vNear = smoothstep(6.0, 11.0, distance(cameraPosition, position));
          vec3 d = length(aDir) > 1e-4 ? normalize(aDir) : vec3(0.0, 0.0, 1.0);
          vec3 sv = normalize(cross(d, toCam) + vec3(1e-5));
          vec3 p = position + sv * aSide * uW * (0.35 + aAge * 1.3);
          vAge = aAge; vSide = aSide;
          vec4 mvPosition = viewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform float uOp; uniform vec3 uColor;
        varying float vAge; varying float vSide; varying float vNear;
        #include <fog_pars_fragment>
        void main(){
          float a = pow(1.0 - vAge, 1.6) * (1.0 - vSide * vSide) * uOp * vNear;
          float ff = 0.0;
          #ifdef USE_FOG
            ff = radFogFactor();
          #endif
          gl_FragColor = vec4(uColor * a * (1.0 - ff), 1.0);
        }`,
      transparent: true, depthWrite: false, fog: true, blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 7;
  }
  // shift = true aggiunge un punto (a passo fisso, 60 al secondo); false sposta solo la testa sull'ala
  push(p, shift = true) {
    const P = this.pts;
    if (!this.init) { for (let i = 0; i < this.n; i++) { P[i * 3] = p.x; P[i * 3 + 1] = p.y; P[i * 3 + 2] = p.z; } this.init = true; }
    else { if (shift) P.copyWithin(3, 0, (this.n - 1) * 3); P[0] = p.x; P[1] = p.y; P[2] = p.z; }
    for (let i = 0; i < this.n; i++) {
      const j = Math.min(this.n - 1, i + 1), k = Math.max(0, i - 1);
      const dx = P[k * 3] - P[j * 3], dy = P[k * 3 + 1] - P[j * 3 + 1], dz = P[k * 3 + 2] - P[j * 3 + 2];
      for (let s = 0; s < 2; s++) {
        const v = (i * 2 + s) * 3;
        this.pos[v] = P[i * 3]; this.pos[v + 1] = P[i * 3 + 1]; this.pos[v + 2] = P[i * 3 + 2];
        this.dir[v] = dx; this.dir[v + 1] = dy; this.dir[v + 2] = dz;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aDir.needsUpdate = true;
  }
  reset() { this.init = false; this.mat.uniforms.uOp.value = 0; }
}

/* ---------- cono di vapore dell'onda d'urto (turbo) ---------- */
export function makeVaporCone() {
  const geo = new THREE.CylinderGeometry(0.5, 4.2, 5.2, 40, 1, true).rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uT: { value: 1 }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV; varying vec2 vUv;
      void main(){
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      ${NOISE}
      uniform float uT, uTime;
      varying vec3 vN; varying vec3 vV; varying vec2 vUv;
      void main(){
        float rim = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float streak = vnoise(vec2(vUv.x * 40.0, vUv.y * 3.0 - uTime * 6.0));
        float along = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
        float a = (0.25 + rim * 0.9) * (0.45 + streak * 0.75) * along * pow(1.0 - uT, 1.5);
        gl_FragColor = vec4(vec3(1.25, 1.35, 1.5) * a, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(geo, mat);
  m.visible = false; m.renderOrder = 11; m.frustumCulled = false;
  return m;
}

/* ---------- regia degli effetti ---------- */
const COL = {
  fireA: new THREE.Color(5, 2.6, 0.9), fireB: new THREE.Color(1.4, 0.18, 0.04),
  sparkA: new THREE.Color(7, 4.2, 1.6), sparkB: new THREE.Color(2.2, 0.5, 0.1),
  smokeA: new THREE.Color('#2b2826'), smokeB: new THREE.Color('#6b6866'),
  white: new THREE.Color(1, 1, 1), shock: new THREE.Color(1.3, 1.2, 1.0),
  trailA: new THREE.Color('#d9d9d9'), trailB: new THREE.Color('#8a8a8a'),
  flameA: new THREE.Color(6, 4.5, 2.4), flameB: new THREE.Color(2.5, 0.7, 0.2),
};

export class FX {
  constructor(scene, camera, { low = false } = {}) {
    this.low = low;
    this.glow = glowTexture(64, 0.3);
    this.puff = puffTexture(128, 11);
    this.add = new ParticlePool(low ? 700 : 1300, true, this.glow);
    this.smoke = new ParticlePool(low ? 450 : 900, false, this.puff);
    this.fire = new Fireballs(low ? 6 : 10);
    this.waves = new Shockwaves(8);
    this.debris = new Debris(low ? 32 : 60);
    this.lines = new SpeedLines(low ? 40 : 72);
    camera.add(this.lines.mesh);
    this.light = new THREE.PointLight('#ff9a4a', 0, 180, 2);
    this.light.position.set(0, -9999, 0);
    scene.add(this.add.points, this.smoke.points, this.debris.mesh, this.light);
    for (const it of this.fire.items) scene.add(it.m);
    for (const it of this.waves.items) scene.add(it.m);
    this.groundAt = () => -1e9;
    this._cA = new THREE.Color(); this._cB = new THREE.Color();
    this._burn =(x, y, z, k) => {
      this.add.spawn(x, y, z, rnd(-1, 1), rnd(1, 3), rnd(-1, 1), COL.fireA, COL.fireB, 0.35, 0.9 + k * 0.4, 0.2, -2, 1);
      if (Math.random() < 0.4) this.smoke.spawn(x, y, z, rnd(-0.5, 0.5), rnd(1, 2.5), rnd(-0.5, 0.5), COL.smokeA, COL.smokeB, 1.2, 0.8, 3.5, -1, 0.6, 0.5, 0.6);
    };
  }

  setScale(px) { this.add.mat.uniforms.scale.value = px; this.smoke.mat.uniforms.scale.value = px; }

  update(dt) {
    this.add.update(dt);
    this.smoke.update(dt);
    this.fire.update(dt);
    this.waves.update(dt);
    this.debris.update(dt, this.groundAt, this._burn);
    this.light.intensity *= Math.exp(-dt * 7);
    if (this.light.intensity < 1) this.light.intensity = 0;
  }

  clear() {
    this.add.clear(); this.smoke.clear(); this.fire.clear(); this.waves.clear(); this.debris.clear();
    this.light.intensity = 0;
  }

  flashLight(pos, power, color = '#ff9a4a') {
    this.light.color.set(color);
    this.light.position.copy(pos);
    this.light.intensity = Math.max(this.light.intensity, power);
  }

  // esplosione completa: palle di fuoco, scintille, fumo, detriti, onda d'urto, lampo di luce
  explosion(pos, s = 1, { vel = null, debrisColor = null, nDebris = 8 } = {}) {
    const vx = vel ? vel.x * 0.25 : 0, vy = vel ? vel.y * 0.25 : 0, vz = vel ? vel.z * 0.25 : 0;
    const { x, y, z } = pos;
    this.fire.spawn(x, y, z, 11 * s, 1.25, 0, 1);
    this.fire.spawn(x + rnd(-2, 2) * s, y + rnd(0, 2) * s, z + rnd(-2, 2) * s, 8 * s, 1.1, 0.08, 0.8);
    if (s > 0.8) this.fire.spawn(x + rnd(-3, 3) * s, y + rnd(1, 3) * s, z + rnd(-3, 3) * s, 9 * s, 1.5, 0.18, 0.6);
    const nS = Math.round((this.low ? 30 : 60) * Math.min(1.5, s));
    for (let i = 0; i < nS; i++) {
      const th = Math.random() * 6.283, ph = Math.acos(rnd(-0.6, 1)), sp = rnd(12, 38) * s;
      this.add.spawn(x, y, z, Math.sin(ph) * Math.cos(th) * sp + vx, Math.cos(ph) * sp + vy, Math.sin(ph) * Math.sin(th) * sp + vz,
        COL.sparkA, COL.sparkB, rnd(0.4, 1.0), rnd(0.35, 0.7), 0.1, 14, 1.4);
    }
    for (let i = 0; i < 14 * Math.min(1.4, s); i++) {
      this.add.spawn(x + rnd(-1, 1) * s, y + rnd(-1, 1) * s, z + rnd(-1, 1) * s, rnd(-6, 6) * s + vx, rnd(-2, 8) * s + vy, rnd(-6, 6) * s + vz,
        COL.fireA, COL.fireB, rnd(0.3, 0.6), rnd(3, 5) * s, rnd(1, 2) * s, -3, 2.2, 0.9);
    }
    const nSm = Math.round((this.low ? 10 : 18) * Math.min(1.5, s));
    for (let i = 0; i < nSm; i++) {
      this.smoke.spawn(x + rnd(-2, 2) * s, y + rnd(-1, 2) * s, z + rnd(-2, 2) * s, rnd(-3, 3) * s, rnd(2, 6) * s, rnd(-3, 3) * s,
        COL.smokeA, COL.smokeB, rnd(2.2, 4), rnd(3, 5) * s, rnd(9, 15) * s, -1.2, 0.8, 0.75, 0.4);
    }
    const nd = Math.round(nDebris * (this.low ? 0.6 : 1));
    for (let i = 0; i < nd; i++) {
      const th = Math.random() * 6.283, sp = rnd(8, 22) * s;
      const c = debrisColor && Math.random() < 0.6 ? debrisColor : COL.smokeA;
      this.debris.spawn(x, y, z, Math.cos(th) * sp + vx, rnd(6, 18) * s + vy, Math.sin(th) * sp + vz, rnd(0.25, 0.7) * s, c, Math.random() < 0.6 ? rnd(0.6, 1.6) : 0, rnd(2.5, 4));
    }
    tmpV.set(x, y, z);
    this.waves.spawn(tmpV, 2 * s, 34 * s, 0.55, COL.shock, 1.1);
    this.flashLight(tmpV, 9000 * s);
  }

  // piccolo scoppio (missile a vuoto o contro il terreno)
  blast(pos, color = null) {
    const { x, y, z } = pos;
    this.fire.spawn(x, y, z, 5.5, 0.9, 0, 0.8);
    for (let i = 0; i < (this.low ? 14 : 26); i++) {
      const th = Math.random() * 6.283, ph = Math.acos(rnd(-0.4, 1)), sp = rnd(8, 22);
      this.add.spawn(x, y, z, Math.sin(ph) * Math.cos(th) * sp, Math.cos(ph) * sp, Math.sin(ph) * Math.sin(th) * sp, COL.sparkA, COL.sparkB, rnd(0.3, 0.7), rnd(0.3, 0.55), 0.1, 14, 1.4);
    }
    for (let i = 0; i < 6; i++) this.smoke.spawn(x, y, z, rnd(-2, 2), rnd(1, 4), rnd(-2, 2), COL.smokeA, COL.smokeB, rnd(1.5, 2.5), 2, 7, -1, 0.8, 0.6, 0.4);
    if (color) this.dust(x, y, z, color, 1, 0, 0, 10);
    this.flashLight(pos, 3000);
  }

  // scintille colorate (cerchio preso)
  burst(pos, color, n, speed, normal = null) {
    const cA = this._cA.setRGB(color.r * 4, color.g * 4, color.b * 4), cB = this._cB.setRGB(color.r * 0.6, color.g * 0.6, color.b * 0.6);
    for (let i = 0; i < n; i++) {
      let vx = rnd(-1, 1), vy = rnd(-1, 1), vz = rnd(-1, 1);
      if (normal) { const d = vx * normal.x + vy * normal.y + vz * normal.z; vx -= normal.x * d; vy -= normal.y * d; vz -= normal.z * d; }
      const l = Math.hypot(vx, vy, vz) || 1, sp = speed * rnd(0.6, 1.1);
      this.add.spawn(pos.x + vx / l * 2, pos.y + vy / l * 2, pos.z + vz / l * 2, vx / l * sp, vy / l * sp, vz / l * sp, cA, cB, rnd(0.4, 0.8), rnd(0.4, 0.8), 0.1, 3, 2);
    }
  }

  shock(pos, s0, s1, life, color, intensity) { this.waves.spawn(pos, s0, s1, life, color || COL.shock, intensity); }

  // cerchio preso: scintille che partono dal bordo e si allargano sul suo piano
  // (partendo dal centro finirebbero addosso alla telecamera, che ci passa in mezzo subito dopo)
  ringBurst(pos, tan, R, color, n, speed) {
    const cA = this._cA.setRGB(color.r * 4, color.g * 4, color.b * 4), cB = this._cB.setRGB(color.r * 0.6, color.g * 0.6, color.b * 0.6);
    const t = tmpW.copy(tan).normalize();
    const u = tmpU.set(0, 1, 0).cross(t);
    if (u.lengthSq() < 1e-4) u.set(1, 0, 0);
    u.normalize();
    const v = tmpS.copy(t).cross(u);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.2832, ca = Math.cos(a), sa = Math.sin(a);
      const dx = u.x * ca + v.x * sa, dy = u.y * ca + v.y * sa, dz = u.z * ca + v.z * sa;
      const rr = R * rnd(0.92, 1.08), sp = speed * rnd(0.5, 1.1);
      this.add.spawn(pos.x + dx * rr, pos.y + dy * rr, pos.z + dz * rr, dx * sp + rnd(-1, 1), dy * sp + rnd(-1, 1), dz * sp + rnd(-1, 1),
        cA, cB, rnd(0.35, 0.7), rnd(0.35, 0.75), 0.1, 3, 2);
    }
  }

  // fumo e fiamma dietro il missile
  missileTrail(x, y, z, vx, vy, vz) {
    this.add.spawn(x, y, z, vx * 0.1, vy * 0.1, vz * 0.1, COL.flameA, COL.flameB, 0.09, 1.3, 0.4, 0, 0, 1);
    this.smoke.spawn(x + rnd(-0.15, 0.15), y + rnd(-0.15, 0.15), z + rnd(-0.15, 0.15), rnd(-0.6, 0.6), rnd(0, 0.8), rnd(-0.6, 0.6),
      COL.trailA, COL.trailB, rnd(0.8, 1.3), 0.5, 2.4, -0.4, 1.2, 0.42, 0.5);
  }

  muzzle(pos) {
    for (let i = 0; i < 6; i++) this.smoke.spawn(pos.x, pos.y, pos.z, rnd(-2, 2), rnd(-1, 1), rnd(-2, 2), COL.trailA, COL.trailB, 0.8, 1, 3, 0, 2, 0.5, 0.4);
    this.add.spawn(pos.x, pos.y, pos.z, 0, 0, 0, COL.flameA, COL.flameB, 0.12, 3, 1, 0, 0, 1);
  }

  // polvere o spruzzi sotto l'aereo
  dust(x, y, z, color, f, fx, fz, n = 1) {
    for (let i = 0; i < n; i++) {
      this.smoke.spawn(x + rnd(-1.5, 1.5), y + 0.2, z + rnd(-1.5, 1.5), rnd(-3, 3) - fx * 8, 1.5 + Math.random() * 4.5 * f, rnd(-3, 3) - fz * 8,
        color, color, rnd(0.7, 1.3), rnd(0.8, 1.4), rnd(3, 5), 3, 1.5, 0.55, 0.5);
    }
  }

  // braci e fumo che salgono da un bersaglio distrutto
  smolder(x, y, z, k) {
    if (Math.random() < 0.6) this.smoke.spawn(x + rnd(-1, 1), y, z + rnd(-1, 1), rnd(-0.6, 0.6) + 1.2, rnd(3, 5), rnd(-0.6, 0.6), COL.smokeA, COL.smokeB, rnd(3, 5), 2, 10, -0.6, 0.3, 0.55 * k, 0.3);
    if (Math.random() < 0.5 * k) this.add.spawn(x + rnd(-1.5, 1.5), y + rnd(0, 1), z + rnd(-1.5, 1.5), rnd(-0.5, 0.5), rnd(1.5, 3.5), rnd(-0.5, 0.5), COL.fireA, COL.fireB, rnd(0.4, 0.8), rnd(1, 2), 0.3, -2, 1, 0.9);
  }
}
