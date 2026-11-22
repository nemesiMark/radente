// Suoni sintetizzati con Web Audio: reattore, postbruciatore, vento, cerchi, sfioramenti, missili, esplosioni.
// Nessun file audio.
export class Sfx {
  constructor() { this.ctx = null; this.enabled = true; }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    // compressore finale: le esplosioni non saturano e i suoni piccoli restano udibili
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16; this.comp.knee.value = 12; this.comp.ratio.value = 4;
    this.comp.attack.value = 0.004; this.comp.release.value = 0.25;
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.6 : 0;
    this.master.connect(this.comp); this.comp.connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    const loopNoise = () => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.loopStart = Math.random(); s.start(0, Math.random() * 1.5); return s; };

    // reattore: rombo (rumore filtrato), sibilo della turbina, brontolio basso
    this.roarF = ctx.createBiquadFilter(); this.roarF.type = 'lowpass'; this.roarF.frequency.value = 500; this.roarF.Q.value = 0.8;
    this.roarG = ctx.createGain(); this.roarG.gain.value = 0;
    loopNoise().connect(this.roarF); this.roarF.connect(this.roarG); this.roarG.connect(this.master);

    this.burnF = ctx.createBiquadFilter(); this.burnF.type = 'bandpass'; this.burnF.frequency.value = 160; this.burnF.Q.value = 0.9;
    this.burnG = ctx.createGain(); this.burnG.gain.value = 0;
    loopNoise().connect(this.burnF); this.burnF.connect(this.burnG); this.burnG.connect(this.master);

    this.whine = ctx.createOscillator(); this.whine.type = 'triangle'; this.whine.frequency.value = 1100;
    this.whineG = ctx.createGain(); this.whineG.gain.value = 0;
    this.whine.connect(this.whineG); this.whineG.connect(this.master); this.whine.start();

    this.rumble = ctx.createOscillator(); this.rumble.type = 'sawtooth'; this.rumble.frequency.value = 46;
    const rf = ctx.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 170;
    this.rumbleG = ctx.createGain(); this.rumbleG.gain.value = 0;
    this.rumble.connect(rf); rf.connect(this.rumbleG); this.rumbleG.connect(this.master); this.rumble.start();

    // vento
    this.windFilter = ctx.createBiquadFilter(); this.windFilter.type = 'bandpass'; this.windFilter.frequency.value = 800; this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    loopNoise().connect(this.windFilter); this.windFilter.connect(this.windGain); this.windGain.connect(this.master);
  }

  setEnabled(v) {
    this.enabled = v;
    if (this.master) this.master.gain.setTargetAtTime(v ? 0.6 : 0, this.ctx.currentTime, 0.05);
  }

  // boost: 0..1 (morbido) oppure true/false
  engine(active, speedN, boost, risk) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, b = +boost || 0;
    const on = active ? 1 : 0;
    this.roarG.gain.setTargetAtTime(on * (0.07 + speedN * 0.03 + b * 0.1), t, 0.2);
    this.roarF.frequency.setTargetAtTime(380 + speedN * 420 + b * 1100, t, 0.18);
    this.burnG.gain.setTargetAtTime(on * b * 0.42, t, 0.12);
    this.burnF.frequency.setTargetAtTime(120 + b * 90 + speedN * 40, t, 0.2);
    this.whine.frequency.setTargetAtTime(980 + speedN * 520 + b * 380, t, 0.25);
    this.whineG.gain.setTargetAtTime(on * (0.010 + speedN * 0.008), t, 0.25);
    this.rumble.frequency.setTargetAtTime(42 + speedN * 14 + b * 10, t, 0.2);
    this.rumbleG.gain.setTargetAtTime(on * (0.05 + b * 0.09), t, 0.2);
    this.windGain.gain.setTargetAtTime(on * (0.03 + risk * 0.2 + b * 0.05), t, 0.15);
    this.windFilter.frequency.setTargetAtTime(600 + risk * 1400 + speedN * 300, t, 0.2);
  }

  tone(freq, dur, type = 'sine', vol = 0.22, delay = 0, slide = 0) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  noise(dur, vol, f0, f1, type = 'lowpass', delay = 0, q = 1) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t, Math.random() * 1.2); s.stop(t + dur + 0.05);
  }

  ring(gold, center) {
    const notes = gold ? [880, 1109, 1319] : [660, 880];
    notes.forEach((n, i) => this.tone(n, 0.28, 'triangle', 0.2, i * 0.06));
    if (center) this.tone(1760, 0.4, 'sine', 0.12, 0.14);
  }
  miss() { this.tone(240, 0.3, 'square', 0.1, 0, 0.55); }
  near() { this.noise(0.45, 0.45, 3400, 420, 'bandpass'); }
  crash() { this.boom(1); this.noise(1.6, 0.6, 1800, 60, 'lowpass'); this.tone(90, 0.9, 'sawtooth', 0.22, 0, 0.3); }
  beep(hi) { this.tone(hi ? 1046 : 523, hi ? 0.4 : 0.16, 'square', 0.1); }
  finish() { [523, 659, 784, 1046].forEach((n, i) => this.tone(n, 0.35, 'triangle', 0.2, i * 0.11)); }

  // accensione del postbruciatore: colpo sordo + soffio che si apre
  boostOn() {
    this.tone(95, 0.45, 'sine', 0.42, 0, 0.4);
    this.noise(0.7, 0.55, 3200, 180, 'lowpass', 0, 0.7);
    this.noise(0.25, 0.25, 900, 2400, 'bandpass', 0.02, 1.2);
  }
  // partenza del missile: scatto e sibilo che si allontana
  missile() {
    this.tone(1500, 0.05, 'square', 0.08);
    this.noise(0.6, 0.38, 700, 2800, 'bandpass', 0.01, 1.4);
    this.noise(0.9, 0.18, 2400, 500, 'bandpass', 0.25, 2);
  }
  // esplosione: prox 0..1 (1 = vicinissima)
  boom(prox = 0.5) {
    const p = Math.max(0.15, Math.min(1, prox));
    this.tone(72, 0.7, 'sine', 0.2 + p * 0.4, 0, 0.42);
    this.noise(1.3, 0.2 + p * 0.5, 1400 * (0.5 + p), 55, 'lowpass', 0, 0.8);
    this.noise(2.2, 0.08 + p * 0.14, 320, 40, 'lowpass', 0.12, 0.7);
  }
  lock() { this.tone(1760, 0.06, 'square', 0.07); this.tone(1760, 0.06, 'square', 0.07, 0.09); }
  kill() { [784, 1175, 1568].forEach((n, i) => this.tone(n, 0.22, 'triangle', 0.12, 0.18 + i * 0.05)); }
  reload() { this.tone(520, 0.08, 'triangle', 0.05, 0, 1.4); }
}
