// Post-produzione: bloom (bagliori), sfocatura radiale e aberrazione cromatica del turbo, lens flare del sole,
// colori del livello, vignetta e grana. Ordine: scena → bloom → OutputPass (tone mapping + sRGB) → passo finale.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// valori non validi (NaN o infiniti) nel buffer HDR: gli infiniti diventano luce piena, i NaN nero.
// Senza questa pulizia il bloom li allarga a rettangoli neri grandi come mezzo schermo.
// (scritto con il solo operatore ?: perché l'OutputPass è in GLSL ES 1.00)
const SAFE = /* glsl */ `
  float radSafe1(float v){ return v < 1.0e4 ? clamp(v, 0.0, 64.0) : (v > 0.0 ? 64.0 : 0.0); }
  vec3 radSafe(vec3 c){ return vec3(radSafe1(c.x), radSafe1(c.y), radSafe1(c.z)); }
`;
// inserisce radSafe() subito dopo la lettura della texture in un passo di three.js
function patchSafe(mat, find, fix) {
  const fs = mat.fragmentShader;
  if (!fs.includes(find) || !fs.includes('void main() {')) { console.warn('Radente: pulizia HDR non applicata'); return; }
  mat.fragmentShader = fs.replace('void main() {', SAFE + 'void main() {').replace(find, find + ' ' + fix);
  mat.needsUpdate = true;
}

function finalShader(taps) {
  return {
    defines: { TAPS: taps },
    uniforms: {
      tDiffuse: { value: null }, uTime: { value: 0 }, uAspect: { value: 1 },
      uBlur: { value: 0 }, uCA: { value: 0.0012 }, uVignette: { value: 0.35 }, uGrain: { value: 0.03 },
      uRisk: { value: 0 }, uRiskColor: { value: new THREE.Color('#ff6a1a') },
      uFlash: { value: new THREE.Color(0, 0, 0) },
      uSun: { value: new THREE.Vector3(0.5, 0.5, 0) },
      uFlareColor: { value: new THREE.Color('#ffd9a0') },
      uSat: { value: 1.05 }, uContrast: { value: 1.04 },
      uTint: { value: new THREE.Color(1, 1, 1) }, uLift: { value: new THREE.Color(0, 0, 0) },
    },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform float uTime, uAspect, uBlur, uCA, uVignette, uGrain, uRisk, uSat, uContrast;
      uniform vec3 uRiskColor, uFlash, uSun, uFlareColor, uTint, uLift;
      varying vec2 vUv;
      float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      float lum(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
      float ghost(vec2 uv, vec2 p, float rad){ vec2 d = (uv - p) * vec2(uAspect, 1.0); return 1.0 - smoothstep(rad * 0.55, rad, length(d)); }
      void main(){
        vec2 dc = vUv - 0.5;
        float r = length(dc * vec2(uAspect, 1.0));
        vec2 caOff = dc * uCA * (0.4 + r * 1.8);
        vec3 col = vec3(texture2D(tDiffuse, vUv + caOff).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - caOff).b);
        if (uBlur > 0.002) {
          float amt = uBlur * smoothstep(0.06, 0.75, r);
          vec3 acc = col; float ws = 1.0;
          for (int i = 1; i < TAPS; i++) {
            float t = float(i) / float(TAPS - 1);
            float w = 1.0 - t * 0.55;
            acc += texture2D(tDiffuse, 0.5 + dc * (1.0 - amt * t * 0.13)).rgb * w;
            ws += w;
          }
          col = acc / ws;
        }
        if (uSun.z > 0.001) {
          vec2 sp = uSun.xy;
          vec2 px = vec2(0.005 / uAspect, 0.005);
          float vis = step(0.9, lum(texture2D(tDiffuse, sp).rgb));
          vis += step(0.9, lum(texture2D(tDiffuse, sp + vec2(px.x, 0.0)).rgb));
          vis += step(0.9, lum(texture2D(tDiffuse, sp - vec2(px.x, 0.0)).rgb));
          vis += step(0.9, lum(texture2D(tDiffuse, sp + vec2(0.0, px.y)).rgb));
          vis += step(0.9, lum(texture2D(tDiffuse, sp - vec2(0.0, px.y)).rgb));
          vis *= 0.2 * uSun.z;
          if (vis > 0.0) {
            vec2 axis = 0.5 - sp;
            vec3 fl = vec3(0.0);
            fl += vec3(1.0, 0.55, 0.25) * ghost(vUv, sp + axis * 0.55, 0.035) * 0.16;
            fl += vec3(0.35, 0.9, 0.8) * ghost(vUv, sp + axis * 1.2, 0.08) * 0.07;
            fl += vec3(0.7, 0.45, 1.0) * ghost(vUv, sp + axis * 1.5, 0.025) * 0.18;
            fl += vec3(1.0, 0.8, 0.5) * ghost(vUv, sp + axis * 1.95, 0.13) * 0.05;
            vec2 ds = (vUv - sp) * vec2(uAspect, 1.0);
            float d = length(ds);
            fl += uFlareColor * (exp(-d * 9.0) * 0.28 + (1.0 - smoothstep(0.0, 0.012, abs(d - 0.2))) * 0.05);
            fl += uFlareColor * exp(-abs(ds.y) * 260.0) * exp(-abs(ds.x) * 2.2) * 0.32;
            col += fl * vis;
          }
        }
        col = col * uTint + uLift;
        float l = lum(col);
        col = mix(vec3(l), col, uSat);
        col = (col - 0.5) * uContrast + 0.5;
        col += uRiskColor * uRisk * smoothstep(0.32, 0.95, r) * 0.6;
        col += uFlash;
        col *= 1.0 - uVignette * smoothstep(0.36, 1.05, r);
        col += (h12(vUv * vec2(1931.0, 1373.0) + fract(uTime * 7.31) * 113.0) - 0.5) * uGrain;
        gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
      }`,
  };
}

export class Post {
  constructor(renderer, scene, camera, { low = false } = {}) {
    this.renderer = renderer;
    this.low = low;
    this.enabled = renderer.capabilities.isWebGL2;
    this.ca = 0; this.flashV = 0; this.flashC = new THREE.Color();
    this.blur = 0; this.risk = 0; this.sunS = 0;
    this.baseCA = 0.0012;
    if (!this.enabled) return;
    const size = renderer.getSize(new THREE.Vector2());
    const pr = renderer.getPixelRatio();
    const rt = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, { type: THREE.HalfFloatType, samples: low ? 0 : 4 });
    rt.texture.name = 'radente.scene';
    const composer = this.composer = new EffectComposer(renderer, rt);
    this.renderPass = new RenderPass(scene, camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.7, 0.55, 0.92);
    this.bloom.highPassUniforms.smoothWidth.value = 0.3;
    if (low) {
      const ss = this.bloom.setSize.bind(this.bloom);
      this.bloom.setSize = (w, h) => ss(Math.max(2, Math.round(w * 0.5)), Math.max(2, Math.round(h * 0.5)));
    }
    this.output = new OutputPass();
    patchSafe(this.bloom.materialHighPassFilter, 'vec4 texel = texture2D( tDiffuse, vUv );', 'texel.rgb = radSafe( texel.rgb );');
    patchSafe(this.output.material, 'gl_FragColor = texture2D( tDiffuse, vUv );', 'gl_FragColor.rgb = radSafe( gl_FragColor.rgb );');
    this.final = new ShaderPass(finalShader(low ? 5 : 8));
    this.U = this.final.uniforms;
    composer.addPass(this.renderPass);
    composer.addPass(this.bloom);
    composer.addPass(this.output);
    composer.addPass(this.final);
    composer.setSize(size.x, size.y);
    this.U.uAspect.value = size.x / Math.max(1, size.y);
  }

  setSize(w, h) {
    if (!this.enabled) return;
    this.composer.setSize(w, h);
    this.U.uAspect.value = w / Math.max(1, h);
  }

  setPixelRatio(pr) {
    if (!this.enabled) return;
    this.composer.setPixelRatio(pr);
  }

  setLook(look = {}) {
    this.renderer.toneMappingExposure = look.exposure ?? 1;
    if (!this.enabled) return;
    const [bs, br, bt] = look.bloom || [0.7, 0.55, 0.92];
    this.bloom.strength = bs; this.bloom.radius = br; this.bloom.threshold = bt;
    const U = this.U;
    U.uSat.value = look.sat ?? 1.05;
    U.uContrast.value = look.contrast ?? 1.04;
    U.uTint.value.set(look.tint || '#ffffff');
    U.uLift.value.set(look.lift || '#000000');
    U.uVignette.value = look.vignette ?? 0.35;
    U.uGrain.value = look.grain ?? 0.03;
    U.uFlareColor.value.set(look.flareColor || '#ffd9a0');
    this.flareMax = look.flare ?? 0.8;
  }

  // impulsi: aberrazione cromatica e lampo a tutto schermo che poi si spengono da soli
  kick(ca) { this.ca = Math.max(this.ca, ca); }
  flash(color, amount) { this.flashC.set(color); this.flashV = Math.max(this.flashV, amount); }

  update(dt, time, { blur = 0, risk = 0, sunUv = null } = {}) {
    if (!this.enabled) return;
    const U = this.U;
    const k = Math.min(1, dt * 6);
    this.blur += (blur - this.blur) * k;
    this.risk += (risk - this.risk) * Math.min(1, dt * 8);
    this.ca = Math.max(0, this.ca - dt * 0.03);
    this.flashV = Math.max(0, this.flashV - dt * 2.6);
    U.uTime.value = time;
    U.uBlur.value = this.blur;
    U.uRisk.value = this.risk;
    U.uCA.value = this.baseCA + this.ca + this.blur * 0.004;
    U.uFlash.value.copy(this.flashC).multiplyScalar(this.flashV);
    let target = 0;
    if (sunUv && sunUv.z > 0) { U.uSun.value.x = sunUv.x; U.uSun.value.y = sunUv.y; target = (this.flareMax || 0) * sunUv.z; }
    this.sunS += (target - this.sunS) * Math.min(1, dt * 5);
    U.uSun.value.z = this.sunS;
  }

  render(dt) {
    if (this.enabled) this.composer.render(dt);
  }
}
