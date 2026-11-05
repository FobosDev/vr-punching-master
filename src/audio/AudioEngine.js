// Web Audio backbone: context, mixing buses, analyser for music-reactive visuals and all
// sound effects (synthesised on the fly, so the game ships without a single audio file).

import { clamp } from '../util/math.js';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.energy = { bass: 0, mid: 0, high: 0, level: 0, beat: 0 };
    this._lastSfx = new Map();
    this._freqData = null;
    this._prevBass = 0;
    this.musicVolume = 0.8;
    this.sfxVolume = 0.9;
  }

  /** Must be called from a user gesture (click / XR select) the first time. */
  init() {
    if (this.ready) { this.resume(); return this.ctx; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx({ latencyHint: 'interactive' });
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 1;
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -6;
    this.limiter.knee.value = 8;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.12;
    this.master.connect(this.limiter).connect(ctx.destination);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicVolume;
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.sfxVolume;

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.6;
    this._freqData = new Uint8Array(this.analyser.frequencyBinCount);

    this.musicBus.connect(this.analyser);
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);

    // Shared reverb (generated impulse response).
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = makeImpulse(ctx, 2.4, 2.8);
    this.reverbReturn = ctx.createGain();
    this.reverbReturn.gain.value = 0.9;
    this.reverb.connect(this.reverbReturn).connect(this.master);
    this.reverbSendMusic = ctx.createGain();
    this.reverbSendMusic.gain.value = this.musicVolume;
    this.reverbSendMusic.connect(this.reverb);
    this.reverbSendSfx = ctx.createGain();
    this.reverbSendSfx.gain.value = this.sfxVolume * 0.5;
    this.reverbSendSfx.connect(this.reverb);

    this.noiseBuffer = makeNoise(ctx, 2);
    this.ready = true;
    this.resume();
    return ctx;
  }

  resume() { if (this.ctx && this.ctx.state !== 'running') return this.ctx.resume().catch(() => {}); return Promise.resolve(); }
  suspend() { if (this.ctx && this.ctx.state === 'running') return this.ctx.suspend().catch(() => {}); return Promise.resolve(); }

  get now() { return this.ctx ? this.ctx.currentTime : 0; }
  /** Approximate time between scheduling and the sound reaching the ears. */
  get outputLatency() {
    if (!this.ctx) return 0;
    const l = this.ctx.outputLatency || this.ctx.baseLatency || 0;
    return clamp(l, 0, 0.25);
  }

  setMusicVolume(v) {
    this.musicVolume = clamp(v, 0, 1);
    if (!this.ready) return;
    this.musicBus.gain.setTargetAtTime(this.musicVolume, this.now, 0.03);
    this.reverbSendMusic.gain.setTargetAtTime(this.musicVolume, this.now, 0.03);
  }
  setSfxVolume(v) {
    this.sfxVolume = clamp(v, 0, 1);
    if (!this.ready) return;
    this.sfxBus.gain.setTargetAtTime(this.sfxVolume, this.now, 0.03);
    this.reverbSendSfx.gain.setTargetAtTime(this.sfxVolume * 0.5, this.now, 0.03);
  }

  /** Call once per frame: updates smoothed band energies used by the environment. */
  updateAnalysis(dt) {
    if (!this.ready) return this.energy;
    const data = this._freqData;
    this.analyser.getByteFrequencyData(data);
    const binHz = this.ctx.sampleRate / this.analyser.fftSize;
    const bandAvg = (fromHz, toHz) => {
      const a = Math.max(0, Math.floor(fromHz / binHz));
      const b = Math.min(data.length - 1, Math.ceil(toHz / binHz));
      let s = 0; for (let i = a; i <= b; i++) s += data[i];
      return s / ((b - a + 1) * 255);
    };
    const bass = bandAvg(30, 150);
    const mid = bandAvg(150, 2000);
    const high = bandAvg(2000, 9000);
    const e = this.energy;
    const k = 1 - Math.exp(-dt * 18);
    e.bass += (bass - e.bass) * k;
    e.mid += (mid - e.mid) * k;
    e.high += (high - e.high) * k;
    e.level = e.bass * 0.5 + e.mid * 0.35 + e.high * 0.15;
    // Crude onset flag: a sharp rise in bass energy.
    const rise = bass - this._prevBass;
    this._prevBass = bass;
    e.beat = Math.max(e.beat * Math.exp(-dt * 6), rise > 0.08 ? 1 : 0);
    return e;
  }

  // ---------------------------------------------------------------- music playback

  /** Plays a decoded AudioBuffer through the music bus starting at `when` (ctx time). */
  playBuffer(buffer, when, offset = 0) {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.musicBus);
    src.start(when, offset);
    return src;
  }

  decode(arrayBuffer) {
    const ctx = this.ctx;
    return new Promise((resolve, reject) => {
      const p = ctx.decodeAudioData(arrayBuffer, resolve, reject);
      if (p && p.then) p.then(resolve, reject);
    });
  }

  // ---------------------------------------------------------------- sound effects

  _throttle(name, ms) {
    const t = performance.now();
    const last = this._lastSfx.get(name) || 0;
    if (t - last < ms) return false;
    this._lastSfx.set(name, t);
    return true;
  }

  _env(gainNode, t, attack, peak, decay, sustainLevel = 0.0001) {
    const g = gainNode.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0.0001, t);
    g.linearRampToValueAtTime(peak, t + attack);
    g.exponentialRampToValueAtTime(Math.max(sustainLevel, 0.0001), t + attack + decay);
  }

  _noise(t, dur, filterType, freq, q, gain, dest, env) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    src.loopStart = Math.random() * 1.5;
    const f = ctx.createBiquadFilter();
    f.type = filterType; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    src.connect(f).connect(g).connect(dest);
    if (env) env(f, g); else this._env(g, t, 0.002, gain, dur);
    src.start(t);
    src.stop(t + dur + 0.1);
    return { src, f, g };
  }

  _tone(t, type, f0, f1, dur, gain, dest, slide = 0.08) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + slide);
    const g = ctx.createGain();
    o.connect(g).connect(dest);
    this._env(g, t, 0.002, gain, dur);
    o.start(t);
    o.stop(t + dur + 0.1);
    return { o, g };
  }

  /** Target punched. quality 0..1 (timing), power 0..1 (punch speed). */
  playHit(quality = 1, power = 0.5, hand = 0) {
    if (!this.ready || !this._throttle('hit', 25)) return;
    const t = this.now;
    const dest = this.sfxBus;
    // Impact body.
    this._tone(t, 'sine', 160 + power * 40, 48, 0.22, 0.9, dest, 0.06);
    // Snap / leather crack.
    this._noise(t, 0.12, 'bandpass', 1800 + power * 1200, 0.9, 0.55 + power * 0.3, dest);
    this._noise(t, 0.05, 'highpass', 5000, 0.7, 0.35, dest);
    // Musical shimmer, brighter the better the timing.
    const base = hand === 0 ? 523.25 : 659.25;
    const shimmerGain = 0.12 + quality * 0.22;
    this._tone(t + 0.005, 'triangle', base * 2, base * 2, 0.3 + quality * 0.3, shimmerGain, this.reverbSendSfx, 0.05);
    this._tone(t + 0.005, 'sine', base * 3, base * 3, 0.25, shimmerGain * 0.5, dest, 0.05);
  }

  playPerfectSparkle() {
    if (!this.ready || !this._throttle('sparkle', 60)) return;
    const t = this.now;
    [1318.5, 1568, 2093].forEach((f, i) => this._tone(t + i * 0.03, 'sine', f, f, 0.25, 0.12, this.reverbSendSfx, 0.02));
  }

  playMiss() {
    if (!this.ready || !this._throttle('miss', 80)) return;
    const t = this.now;
    this._tone(t, 'sawtooth', 220, 110, 0.28, 0.16, this.sfxBus, 0.25);
    this._noise(t, 0.2, 'lowpass', 600, 0.5, 0.25, this.sfxBus);
  }

  playWrongHand() {
    if (!this.ready || !this._throttle('wrong', 80)) return;
    const t = this.now;
    this._tone(t, 'square', 330, 300, 0.1, 0.12, this.sfxBus, 0.05);
    this._tone(t + 0.11, 'square', 262, 240, 0.16, 0.12, this.sfxBus, 0.05);
  }

  playBomb() {
    if (!this.ready || !this._throttle('bomb', 100)) return;
    const t = this.now;
    const dest = this.sfxBus;
    this._tone(t, 'sine', 120, 30, 0.8, 1.0, dest, 0.3);
    this._noise(t, 0.7, 'lowpass', 2400, 0.4, 0.9, dest, (f, g) => {
      f.frequency.setValueAtTime(3000, t); f.frequency.exponentialRampToValueAtTime(120, t + 0.7);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.9, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);
    });
    this._noise(t, 0.3, 'bandpass', 900, 0.6, 0.6, this.reverbSendSfx);
  }

  playWallHit() {
    if (!this.ready || !this._throttle('wall', 140)) return;
    const t = this.now;
    this._tone(t, 'sawtooth', 70, 55, 0.14, 0.35, this.sfxBus, 0.1);
    this._noise(t, 0.14, 'bandpass', 300, 2, 0.4, this.sfxBus);
  }

  playUiHover() {
    if (!this.ready || !this._throttle('hover', 40)) return;
    this._tone(this.now, 'sine', 1400, 1500, 0.05, 0.05, this.sfxBus, 0.03);
  }
  playUiClick() {
    if (!this.ready) return;
    const t = this.now;
    this._tone(t, 'triangle', 880, 1320, 0.09, 0.14, this.sfxBus, 0.04);
    this._noise(t, 0.04, 'highpass', 4000, 0.7, 0.12, this.sfxBus);
  }
  playUiBack() {
    if (!this.ready) return;
    this._tone(this.now, 'triangle', 660, 440, 0.12, 0.12, this.sfxBus, 0.08);
  }

  /** Count-in tick. `final` = the "go" beat. Scheduled at an exact context time. */
  playCount(at, final = false) {
    if (!this.ready) return;
    const f = final ? 1320 : 880;
    this._tone(at, 'square', f, f, final ? 0.25 : 0.08, final ? 0.25 : 0.14, this.sfxBus, 0.02);
    if (final) this._tone(at, 'sine', f / 2, f / 2, 0.35, 0.2, this.reverbSendSfx, 0.02);
  }

  playCombo(level = 1) {
    if (!this.ready) return;
    const t = this.now;
    const root = 523.25 * Math.pow(2, Math.min(level, 4) * 0.0833);
    [1, 1.25, 1.5, 2].forEach((r, i) => {
      this._tone(t + i * 0.05, 'triangle', root * r, root * r, 0.3, 0.14, this.reverbSendSfx, 0.02);
    });
  }

  playFanfare(good = true) {
    if (!this.ready) return;
    const t = this.now;
    const chord = good ? [261.6, 329.6, 392, 523.25, 659.25] : [261.6, 311.1, 392, 466.2];
    chord.forEach((f, i) => {
      this._tone(t + i * 0.06, 'sawtooth', f, f, 1.2, 0.08, this.reverbSendSfx, 0.02);
      this._tone(t + i * 0.06, 'triangle', f * 2, f * 2, 0.8, 0.05, this.sfxBus, 0.02);
    });
  }

  playFail() {
    if (!this.ready) return;
    const t = this.now;
    this._tone(t, 'sawtooth', 220, 55, 1.6, 0.25, this.reverbSendSfx, 1.4);
    this._tone(t, 'square', 165, 41, 1.6, 0.15, this.sfxBus, 1.4);
  }

  playHeartbeat() {
    if (!this.ready || !this._throttle('heart', 500)) return;
    const t = this.now;
    this._tone(t, 'sine', 90, 50, 0.2, 0.5, this.sfxBus, 0.15);
    this._tone(t + 0.22, 'sine', 80, 45, 0.18, 0.35, this.sfxBus, 0.12);
  }
}

function makeNoise(ctx, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function makeImpulse(ctx, seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // Early reflections a touch denser, then a smooth exponential tail.
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (i < 2000 ? 0.6 : 1);
    }
  }
  return buf;
}
