// Comandi: tastiera (frecce / WASD, Spazio o Shift = turbo) e tocco (levetta virtuale + pulsante TURBO).
const clamp = (v) => Math.max(-1, Math.min(1, v));

export class Input {
  constructor() {
    this.keys = new Set();
    this.ax = 0; this.ay = 0;
    this.x = 0; this.y = 0; this.boost = false;
    this.invert = false;
    this.joy = { active: false, id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.boostTouch = false;
    this.onKey = null;

    addEventListener('keydown', (e) => {
      const tg = e.target && e.target.tagName;
      if (tg === 'INPUT' || tg === 'TEXTAREA') { if (e.code === 'Escape' && this.onKey) this.onKey(e.code); return; }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (!e.repeat && this.onKey) this.onKey(e.code);
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.boostTouch = false; this.joy.active = false; });
  }

  bindTouch(zone, base, knob, boostBtn) {
    const RAD = 62;
    const show = (on) => { base.style.opacity = on ? '1' : '0.35'; };
    const place = (x, y) => { base.style.left = x + 'px'; base.style.top = y + 'px'; };
    const rest = () => { const r = zone.getBoundingClientRect(); place(r.left + Math.min(110, r.width * 0.35), r.bottom - 120); knob.style.transform = 'translate(-50%,-50%)'; show(false); };
    this.restJoy = rest;
    rest();
    addEventListener('resize', rest);

    zone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (this.joy.active) return;
      const t = e.changedTouches[0];
      this.joy = { active: true, id: t.identifier, ox: t.clientX, oy: t.clientY, x: 0, y: 0 };
      place(t.clientX, t.clientY); show(true);
    }, { passive: false });
    zone.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier !== this.joy.id) continue;
        let dx = t.clientX - this.joy.ox, dy = t.clientY - this.joy.oy;
        const l = Math.hypot(dx, dy);
        if (l > RAD) { dx *= RAD / l; dy *= RAD / l; }
        knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        const curve = (v) => Math.sign(v) * Math.pow(Math.abs(v), 1.25);
        this.joy.x = curve(dx / RAD); this.joy.y = curve(-dy / RAD);
      }
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) if (t.identifier === this.joy.id) { this.joy.active = false; this.joy.x = this.joy.y = 0; rest(); }
    };
    zone.addEventListener('touchend', end);
    zone.addEventListener('touchcancel', end);

    const bOn = (e) => { e.preventDefault(); this.boostTouch = true; boostBtn.classList.add('on'); };
    const bOff = (e) => { e.preventDefault(); this.boostTouch = false; boostBtn.classList.remove('on'); };
    boostBtn.addEventListener('touchstart', bOn, { passive: false });
    boostBtn.addEventListener('touchend', bOff, { passive: false });
    boostBtn.addEventListener('touchcancel', bOff, { passive: false });
  }

  update(dt) {
    const k = this.keys;
    const kx = (k.has('ArrowRight') || k.has('KeyD') ? 1 : 0) - (k.has('ArrowLeft') || k.has('KeyA') ? 1 : 0);
    const ky = (k.has('ArrowUp') || k.has('KeyW') ? 1 : 0) - (k.has('ArrowDown') || k.has('KeyS') ? 1 : 0);
    const r = 1 - Math.exp(-dt * 7);
    this.ax += (kx - this.ax) * r;
    this.ay += (ky - this.ay) * r;
    let x = this.ax, y = this.ay;
    if (this.joy.active) { x = this.joy.x; y = this.joy.y; }
    this.x = clamp(x);
    this.y = clamp(this.invert ? -y : y);
    this.boost = k.has('Space') || k.has('ShiftLeft') || k.has('ShiftRight') || this.boostTouch;
  }

  reset() { this.ax = this.ay = 0; this.x = this.y = 0; }
}
