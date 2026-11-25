// All sounds are synthesised here (original: no samples). Sape plucks, kompang drums, gong, river and rain.
import { BEAT_MS } from './config.js';

const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19]; // major pentatonic, sape-like

export class Audio {
  constructor() { this.ctx = null; this.music = 0.7; this.sfx = 0.9; this.master = 0.8; this.muted = false; this.loopOn = false; this.cache = {}; this.rainGain = null; }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.out = this.ctx.createGain(); this.out.connect(this.ctx.destination);
      this.mBus = this.ctx.createGain(); this.mBus.connect(this.out);
      this.sBus = this.ctx.createGain(); this.sBus.connect(this.out);
      this.noiseBuf = this.makeNoise();
      this.apply();
    } catch (e) { this.ctx = null; }
  }

  set(vol) { Object.assign(this, vol); this.apply(); }
  apply() {
    if (!this.ctx) return;
    const m = this.muted ? 0 : this.master;
    this.out.gain.value = m;
    this.mBus.gain.value = this.music * 0.55;
    this.sBus.gain.value = this.sfx;
  }
  toggleMute() { this.muted = !this.muted; this.apply(); return this.muted; }

  makeNoise() {
    const b = this.ctx.createBuffer(1, this.ctx.sampleRate * 1.5, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  // Karplus–Strong plucked string, cached per pitch
  pluckBuf(freq) {
    const key = Math.round(freq);
    if (this.cache[key]) return this.cache[key];
    const sr = this.ctx.sampleRate, len = Math.floor(sr * 1.2), N = Math.max(2, Math.floor(sr / freq));
    const b = this.ctx.createBuffer(1, len, sr), d = b.getChannelData(0);
    const ring = new Float32Array(N);
    for (let i = 0; i < N; i++) ring[i] = Math.random() * 2 - 1;
    let idx = 0;
    for (let i = 0; i < len; i++) {
      const nxt = (idx + 1) % N;
      const v = 0.497 * (ring[idx] + ring[nxt]);
      d[i] = ring[idx]; ring[idx] = v; idx = nxt;
    }
    this.cache[key] = b;
    return b;
  }

  play(buf, gain, bus, rate = 1, when = 0) {
    const s = this.ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate;
    const g = this.ctx.createGain(); g.gain.value = gain;
    s.connect(g); g.connect(bus || this.sBus);
    s.start(when || this.ctx.currentTime);
    return { s, g };
  }

  noise(dur, freq, type = 'bandpass', gain = 0.4, q = 1, when = 0, sweepTo = null) {
    const t = when || this.ctx.currentTime;
    const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.sBus);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }

  tone(freq, dur, type = 'sine', gain = 0.3, when = 0, bus = null, slideTo = null) {
    const t = when || this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(bus || this.sBus); o.start(t); o.stop(t + dur + 0.05);
  }

  note(step, base = 293.66) { return base * Math.pow(2, SCALE[step % SCALE.length] / 12 + Math.floor(step / SCALE.length)); }

  // ---------- game cues ----------
  hop(onBeat, combo = 0, big = false) {
    if (!this.ctx) return;
    const step = onBeat ? Math.min(8, combo) : Math.floor(Math.random() * 3);
    const f = this.note(step, big ? 196 : 293.66);
    this.play(this.pluckBuf(f), 0.35);
    if (onBeat) this.play(this.pluckBuf(f * 1.5), 0.18);
  }
  tip() { if (!this.ctx) return; this.tone(1320, 0.12, 'triangle', 0.18); this.tone(1760, 0.14, 'triangle', 0.12, this.ctx.currentTime + 0.05); }
  kuih() { if (!this.ctx) return; [0, 2, 4].forEach((s, i) => this.play(this.pluckBuf(this.note(s + 3)), 0.3, null, 1, this.ctx.currentTime + i * 0.07)); }
  gong() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [[110, 0.5], [220.5, 0.22], [331, 0.12], [446, 0.08]].forEach(([f, g]) => this.tone(f, 2.4, 'sine', g, t));
    this.tone(108, 2.6, 'sine', 0.18, t + 0.01, null, 104);
  }
  power() { if (!this.ctx) return; [4, 6, 8].forEach((s, i) => this.play(this.pluckBuf(this.note(s)), 0.25, null, 1, this.ctx.currentTime + i * 0.06)); }
  stamp() { if (!this.ctx) return; this.noise(0.18, 3500, 'highpass', 0.25, 0.7); this.noise(0.14, 5000, 'highpass', 0.18, 0.7, this.ctx.currentTime + 0.1); this.tone(988, 0.2, 'triangle', 0.15, this.ctx.currentTime + 0.15); }
  bump() { if (!this.ctx) return; this.tone(140, 0.25, 'square', 0.25, 0, null, 60); this.noise(0.15, 600, 'lowpass', 0.4); }
  bonk() { if (!this.ctx) return; this.tone(220, 0.08, 'triangle', 0.15, 0, null, 160); }
  splash() { if (!this.ctx) return; this.noise(0.7, 2400, 'lowpass', 0.6, 0.8, 0, 300); this.tone(300, 0.3, 'sine', 0.2, 0, null, 90); }
  fall() { if (!this.ctx) return; this.tone(600, 0.6, 'triangle', 0.25, 0, null, 120); }
  bike() { if (!this.ctx) return; const t = this.ctx.currentTime; this.tone(160, 0.45, 'sawtooth', 0.06, t, null, 320); this.tone(80, 0.45, 'sawtooth', 0.05, t, null, 160); }
  boat() { if (!this.ctx) return; const t = this.ctx.currentTime; for (let i = 0; i < 4; i++) this.tone(70, 0.07, 'square', 0.07, t + i * 0.09); }
  thunder() { if (!this.ctx) return; this.noise(1.8, 180, 'lowpass', 0.5, 0.5, 0, 60); }
  check() { if (!this.ctx) return; [0, 4].forEach((s, i) => this.play(this.pluckBuf(this.note(s + 5)), 0.22, null, 1, this.ctx.currentTime + i * 0.1)); }
  click() { if (!this.ctx) return; this.tone(660, 0.05, 'triangle', 0.12); }

  rain(level) { // 0..1
    if (!this.ctx) return;
    if (!this.rainGain) {
      const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
      const f = this.ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1200;
      this.rainGain = this.ctx.createGain(); this.rainGain.gain.value = 0;
      s.connect(f); f.connect(this.rainGain); this.rainGain.connect(this.sBus); s.start();
    }
    this.rainGain.gain.setTargetAtTime(level * 0.12, this.ctx.currentTime, 0.3);
  }

  // ---------- kompang music loop (scheduled ahead) ----------
  startMusic(startMs) {
    if (!this.ctx) return;
    this.loopOn = true;
    const beat = BEAT_MS / 1000;
    // align audio time to the game clock (performance.now)
    this.t0 = this.ctx.currentTime - ((performance.now() - startMs) / 1000) % beat + beat;
    this.nextBeat = 0;
    const tick = () => {
      if (!this.loopOn || !this.ctx) return;
      const ahead = this.ctx.currentTime + 0.25;
      while (this.t0 + this.nextBeat * beat / 2 < ahead) { this.drum(this.t0 + this.nextBeat * beat / 2, this.nextBeat); this.nextBeat++; }
      this.timer = setTimeout(tick, 60);
    };
    tick();
  }
  stopMusic() { this.loopOn = false; clearTimeout(this.timer); }

  drum(t, i) {
    // pattern in 8th notes over 2 bars: kompang "tung" (low) and "pak" (slap), with a sape line every 4 beats
    const pat = 'T.p.TpT.T.p.Tpp.';
    const ch = pat[i % pat.length];
    const bus = this.mBus;
    if (ch === 'T') {
      const o = this.ctx.createOscillator(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.18);
      const g = this.ctx.createGain(); g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      o.connect(g); g.connect(bus); o.start(t); o.stop(t + 0.3);
    } else if (ch === 'p') {
      const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf;
      const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 1.4;
      const g = this.ctx.createGain(); g.gain.setValueAtTime(0.35, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      s.connect(f); f.connect(g); g.connect(bus); s.start(t, Math.random()); s.stop(t + 0.12);
    }
    if (i % 8 === 0) {
      const mel = [0, 2, 4, 2, 5, 4, 2, 0];
      const n = mel[(i / 8) % mel.length];
      const src = this.ctx.createBufferSource(); src.buffer = this.pluckBuf(this.note(n, 196));
      const g = this.ctx.createGain(); g.gain.value = 0.25; src.connect(g); g.connect(bus); src.start(t);
    }
  }
}
