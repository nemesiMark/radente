// Suoni sintetizzati con Web Audio: motore, vento, cerchi, sfioramenti, schianto. Nessun file audio.
export class Sfx {
  constructor() { this.ctx = null; this.enabled = true; }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.55 : 0;
    this.master.connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    // motore
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    this.engFilter = ctx.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 700; this.engFilter.Q.value = 2;
    this.o1 = ctx.createOscillator(); this.o1.type = 'sawtooth'; this.o1.frequency.value = 70;
    this.o2 = ctx.createOscillator(); this.o2.type = 'square'; this.o2.frequency.value = 35.5;
    const g2 = ctx.createGain(); g2.gain.value = 0.4;
    this.o1.connect(this.engFilter); this.o2.connect(g2); g2.connect(this.engFilter);
    this.engFilter.connect(this.engGain); this.engGain.connect(this.master);
    this.o1.start(); this.o2.start();

    // vento
    const ns = ctx.createBufferSource(); ns.buffer = buf; ns.loop = true;
    this.windFilter = ctx.createBiquadFilter(); this.windFilter.type = 'bandpass'; this.windFilter.frequency.value = 800; this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    ns.connect(this.windFilter); this.windFilter.connect(this.windGain); this.windGain.connect(this.master);
    ns.start();
  }

  setEnabled(v) {
    this.enabled = v;
    if (this.master) this.master.gain.setTargetAtTime(v ? 0.55 : 0, this.ctx.currentTime, 0.05);
  }

  engine(active, speedN, boost, risk) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.engGain.gain.setTargetAtTime(active ? 0.14 : 0, t, 0.25);
    const fr = 58 + speedN * 38 + (boost ? 22 : 0);
    this.o1.frequency.setTargetAtTime(fr, t, 0.15);
    this.o2.frequency.setTargetAtTime(fr * 0.5 + 0.7, t, 0.15);
    this.engFilter.frequency.setTargetAtTime(480 + speedN * 500 + (boost ? 600 : 0), t, 0.2);
    this.windGain.gain.setTargetAtTime(active ? 0.035 + risk * 0.2 + (boost ? 0.05 : 0) : 0, t, 0.15);
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

  noise(dur, vol, f0, f1, type = 'lowpass', delay = 0) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = 1;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t); s.stop(t + dur + 0.05);
  }

  ring(gold, center) {
    const notes = gold ? [880, 1109, 1319] : [660, 880];
    notes.forEach((n, i) => this.tone(n, 0.28, 'triangle', 0.2, i * 0.06));
    if (center) this.tone(1760, 0.4, 'sine', 0.12, 0.14);
  }
  miss() { this.tone(240, 0.3, 'square', 0.1, 0, 0.55); }
  near() { this.noise(0.4, 0.4, 3200, 500, 'bandpass'); }
  crash() { this.noise(1.6, 0.9, 1800, 60, 'lowpass'); this.tone(90, 0.9, 'sawtooth', 0.28, 0, 0.3); }
  beep(hi) { this.tone(hi ? 1046 : 523, hi ? 0.4 : 0.16, 'square', 0.1); }
  finish() { [523, 659, 784, 1046].forEach((n, i) => this.tone(n, 0.35, 'triangle', 0.2, i * 0.11)); }
}
