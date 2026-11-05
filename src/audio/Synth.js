// Instrument voices for the built-in soundtrack. Every sound is generated with oscillators and
// filtered noise at schedule time, which keeps the game free of audio assets and lets the beat
// map be derived from the exact same event list that drives the synth.

const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Synth {
  constructor(engine) {
    this.engine = engine;
    const ctx = engine.ctx;
    this.ctx = ctx;

    // Buses -------------------------------------------------------------
    this.out = ctx.createGain();           // everything -> music bus
    this.out.gain.value = 0.72;
    this.out.connect(engine.musicBus);

    this.duck = ctx.createGain();          // side-chain "pump" for bass + synths
    this.duck.connect(this.out);

    this.drumBus = ctx.createGain(); this.drumBus.gain.value = 1.0; this.drumBus.connect(this.out);
    this.bassBus = ctx.createGain(); this.bassBus.gain.value = 0.9; this.bassBus.connect(this.duck);
    this.synthBus = ctx.createGain(); this.synthBus.gain.value = 0.8; this.synthBus.connect(this.duck);

    // Soft clipper for the bass to add harmonics.
    this.bassDrive = ctx.createWaveShaper();
    this.bassDrive.curve = makeDriveCurve(2.2);
    this.bassDrive.connect(this.bassBus);

    // Ping-pong delay for leads/arps.
    this.delaySend = ctx.createGain(); this.delaySend.gain.value = 1;
    this.delayL = ctx.createDelay(2); this.delayR = ctx.createDelay(2);
    this.delayFb = ctx.createGain(); this.delayFb.gain.value = 0.38;
    this.delayFilter = ctx.createBiquadFilter(); this.delayFilter.type = 'lowpass'; this.delayFilter.frequency.value = 3200;
    const merger = ctx.createChannelMerger(2);
    this.delaySend.connect(this.delayL);
    this.delayL.connect(this.delayFilter).connect(this.delayR);
    this.delayR.connect(this.delayFb).connect(this.delayL);
    this.delayL.connect(merger, 0, 0);
    this.delayR.connect(merger, 0, 1);
    this.delayReturn = ctx.createGain(); this.delayReturn.gain.value = 0.35;
    merger.connect(this.delayReturn).connect(this.duck);

    this.reverbSend = engine.reverbSendMusic;
    this.noise = engine.noiseBuffer;
    this.setTempo(120);
  }

  setTempo(bpm) {
    const beat = 60 / bpm;
    this.delayL.delayTime.value = beat * 0.75;
    this.delayR.delayTime.value = beat * 0.5;
  }

  dispose() {
    try { this.out.disconnect(); } catch { /* ignore */ }
  }

  // ------------------------------------------------------------------ helpers
  _adsr(param, t, a, d, s, r, dur, peak) {
    const sus = Math.max(peak * s, 0.0001);
    const holdEnd = Math.max(t + a + d, t + dur);
    param.setValueAtTime(0.0001, t);
    param.linearRampToValueAtTime(peak, t + a);
    param.exponentialRampToValueAtTime(sus, t + a + d);
    param.setValueAtTime(sus, holdEnd);
    param.exponentialRampToValueAtTime(0.0001, holdEnd + r);
    return holdEnd + r;
  }

  _noiseSource(t, dur) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.loopStart = (t * 7.31) % 1.5;
    src.start(t);
    src.stop(t + dur + 0.05);
    return src;
  }

  _osc(type, freq, t, stopAt, detuneCents = 0) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    if (detuneCents) o.detune.value = detuneCents;
    o.start(t);
    o.stop(stopAt);
    return o;
  }

  sidechain(t, depth = 0.3, release = 0.11) {
    const g = this.duck.gain;
    g.setValueAtTime(1 - depth, t);
    g.setTargetAtTime(1, t + 0.02, release);
  }

  // ------------------------------------------------------------------ drums
  kick(t, vel = 1, opts = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    const f0 = opts.punchy ? 190 : 150;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(opts.sub ? 38 : 48, t + 0.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.95 * vel, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (opts.long ? 0.6 : 0.38));
    o.connect(g).connect(this.drumBus);
    o.start(t); o.stop(t + 0.7);
    // Click transient.
    const n = this._noiseSource(t, 0.03);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.35 * vel, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.025);
    n.connect(hp).connect(ng).connect(this.drumBus);
    this.sidechain(t, 0.35 * vel);
  }

  snare(t, vel = 1) {
    const ctx = this.ctx;
    const n = this._noiseSource(t, 0.25);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1700; bp.Q.value = 0.6;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.8 * vel, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    n.connect(bp).connect(hp).connect(g).connect(this.drumBus);
    const o = this._osc('triangle', 196, t, t + 0.15);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.5 * vel, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(og).connect(this.drumBus);
    // A little room.
    const rg = ctx.createGain(); rg.gain.value = 0.25 * vel;
    g.connect(rg).connect(this.reverbSend);
  }

  clap(t, vel = 1) {
    const ctx = this.ctx;
    for (let i = 0; i < 3; i++) {
      const tt = t + i * 0.011;
      const n = this._noiseSource(tt, 0.05);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1200; bp.Q.value = 1.2;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.5 * vel, tt);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.03);
      n.connect(bp).connect(g).connect(this.drumBus);
    }
    const tail = this._noiseSource(t + 0.03, 0.25);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5 * vel, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    tail.connect(bp).connect(g).connect(this.drumBus);
    const rg = ctx.createGain(); rg.gain.value = 0.4 * vel;
    g.connect(rg).connect(this.reverbSend);
  }

  hat(t, vel = 1, open = false) {
    const ctx = this.ctx;
    const dur = open ? 0.32 : 0.05;
    const n = this._noiseSource(t, dur);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = open ? 6500 : 8000;
    const pk = ctx.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 10000; pk.gain.value = 4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime((open ? 0.22 : 0.26) * vel, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(hp).connect(pk).connect(g).connect(this.drumBus);
  }

  crash(t, vel = 1) {
    const ctx = this.ctx;
    const n = this._noiseSource(t, 1.6);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 4000;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 7000; bp.Q.value = 0.3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.45 * vel, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
    n.connect(hp).connect(bp).connect(g).connect(this.drumBus);
    const rg = ctx.createGain(); rg.gain.value = 0.5;
    g.connect(rg).connect(this.reverbSend);
  }

  tom(t, vel = 1, pitch = 110) {
    const ctx = this.ctx;
    const o = this._osc('sine', pitch * 1.5, t, t + 0.4);
    o.frequency.exponentialRampToValueAtTime(pitch, t + 0.15);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.7 * vel, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g).connect(this.drumBus);
  }

  // ------------------------------------------------------------------ tonal
  bass(t, midi, dur, vel = 1, preset = 'synth') {
    const ctx = this.ctx;
    const f = midiToHz(midi);
    const end = t + dur + 0.15;
    const o1 = this._osc(preset === 'reese' ? 'sawtooth' : 'sawtooth', f, t, end);
    const o2 = this._osc(preset === '808' ? 'sine' : 'square', preset === '808' ? f : f / 2, t, end, preset === 'reese' ? 12 : 0);
    const o3 = preset === 'reese' ? this._osc('sawtooth', f, t, end, -12) : null;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.Q.value = preset === '808' ? 1 : 7;
    const peakCut = preset === 'pluck' ? 2600 : preset === '808' ? 400 : 1500;
    lp.frequency.setValueAtTime(preset === '808' ? 300 : 220, t);
    lp.frequency.linearRampToValueAtTime(peakCut, t + 0.02);
    lp.frequency.exponentialRampToValueAtTime(preset === '808' ? 120 : 260, t + Math.max(0.12, dur * 0.8));
    const g = ctx.createGain();
    const peak = (preset === '808' ? 1.1 : 0.55) * vel;
    this._adsr(g.gain, t, 0.004, Math.max(0.05, dur * 0.3), preset === '808' ? 0.8 : 0.75, 0.08, dur, peak);
    const mix1 = ctx.createGain(); mix1.gain.value = 0.7;
    const mix2 = ctx.createGain(); mix2.gain.value = preset === '808' ? 1 : 0.45;
    o1.connect(mix1).connect(lp);
    o2.connect(mix2).connect(lp);
    if (o3) { const m3 = ctx.createGain(); m3.gain.value = 0.5; o3.connect(m3).connect(lp); }
    lp.connect(g);
    if (preset === '808') {
      const pitchDrop = ctx.createGain(); // 808 glide: pitch envelope on the sine
      o2.frequency.setValueAtTime(f * 2.2, t);
      o2.frequency.exponentialRampToValueAtTime(f, t + 0.06);
      g.connect(this.bassDrive);
      void pitchDrop;
    } else {
      g.connect(this.bassDrive);
    }
  }

  lead(t, midi, dur, vel = 1, opts = {}) {
    const ctx = this.ctx;
    const f = midiToHz(midi);
    const end = t + dur + 0.3;
    const detune = opts.detune ?? 9;
    const o1 = this._osc('sawtooth', f, t, end, detune);
    const o2 = this._osc('sawtooth', f, t, end, -detune);
    const o3 = this._osc('square', f / 2, t, end);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2.5;
    lp.frequency.setValueAtTime(600, t);
    lp.frequency.linearRampToValueAtTime(opts.bright ? 5200 : 3200, t + 0.03);
    lp.frequency.exponentialRampToValueAtTime(1400, t + Math.max(0.2, dur));
    const g = ctx.createGain();
    this._adsr(g.gain, t, 0.012, 0.15, 0.7, 0.14, dur, 0.26 * vel);
    const m1 = ctx.createGain(); m1.gain.value = 0.5;
    const m2 = ctx.createGain(); m2.gain.value = 0.5;
    const m3 = ctx.createGain(); m3.gain.value = 0.25;
    o1.connect(m1).connect(lp); o2.connect(m2).connect(lp); o3.connect(m3).connect(lp);
    lp.connect(g);
    g.connect(this.synthBus);
    const ds = ctx.createGain(); ds.gain.value = opts.delay ?? 0.45; g.connect(ds).connect(this.delaySend);
    const rs = ctx.createGain(); rs.gain.value = 0.3; g.connect(rs).connect(this.reverbSend);
    // Vibrato for longer notes.
    if (dur > 0.3) {
      const lfo = this._osc('sine', 5.5, t + 0.15, end);
      const lg = ctx.createGain(); lg.gain.setValueAtTime(0, t + 0.15); lg.gain.linearRampToValueAtTime(6, t + 0.5);
      lfo.connect(lg); lg.connect(o1.detune); lg.connect(o2.detune);
    }
  }

  pluck(t, midi, dur, vel = 1, opts = {}) {
    const ctx = this.ctx;
    const f = midiToHz(midi);
    const end = t + Math.max(dur, 0.3) + 0.1;
    const o1 = this._osc(opts.wave || 'sawtooth', f, t, end, 4);
    const o2 = this._osc('triangle', f, t, end, -4);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 3;
    lp.frequency.setValueAtTime(opts.bright ? 6000 : 3400, t);
    lp.frequency.exponentialRampToValueAtTime(380, t + 0.28);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.22 * vel, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.25, dur));
    const m1 = ctx.createGain(); m1.gain.value = 0.55;
    const m2 = ctx.createGain(); m2.gain.value = 0.6;
    o1.connect(m1).connect(lp); o2.connect(m2).connect(lp);
    lp.connect(g).connect(this.synthBus);
    const ds = ctx.createGain(); ds.gain.value = opts.delay ?? 0.4; g.connect(ds).connect(this.delaySend);
  }

  pad(t, midis, dur, vel = 1) {
    const ctx = this.ctx;
    const end = t + dur + 1.0;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.8;
    lp.frequency.setValueAtTime(500, t);
    lp.frequency.linearRampToValueAtTime(1300, t + dur * 0.6);
    lp.frequency.linearRampToValueAtTime(600, t + dur + 0.8);
    const g = ctx.createGain();
    this._adsr(g.gain, t, 0.35, 0.3, 0.9, 0.9, dur, 0.11 * vel);
    for (const m of midis) {
      const f = midiToHz(m);
      const a = this._osc('sawtooth', f, t, end, 10);
      const b = this._osc('sawtooth', f, t, end, -10);
      const c = this._osc('sine', f / 2, t, end);
      const ga = ctx.createGain(); ga.gain.value = 0.35;
      const gb = ctx.createGain(); gb.gain.value = 0.35;
      const gc = ctx.createGain(); gc.gain.value = 0.3;
      a.connect(ga).connect(lp); b.connect(gb).connect(lp); c.connect(gc).connect(lp);
    }
    lp.connect(g).connect(this.synthBus);
    const rs = ctx.createGain(); rs.gain.value = 0.7; g.connect(rs).connect(this.reverbSend);
  }

  stab(t, midis, dur, vel = 1) {
    const ctx = this.ctx;
    const end = t + dur + 0.2;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 4;
    lp.frequency.setValueAtTime(4500, t);
    lp.frequency.exponentialRampToValueAtTime(500, t + Math.max(0.15, dur));
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.2 * vel, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.18, dur));
    for (const m of midis) {
      const f = midiToHz(m);
      const a = this._osc('sawtooth', f, t, end, 7);
      const b = this._osc('square', f, t, end, -7);
      const ga = ctx.createGain(); ga.gain.value = 0.5;
      const gb = ctx.createGain(); gb.gain.value = 0.3;
      a.connect(ga).connect(lp); b.connect(gb).connect(lp);
    }
    lp.connect(g).connect(this.synthBus);
    const ds = ctx.createGain(); ds.gain.value = 0.3; g.connect(ds).connect(this.delaySend);
    const rs = ctx.createGain(); rs.gain.value = 0.35; g.connect(rs).connect(this.reverbSend);
  }

  riser(t, dur) {
    const ctx = this.ctx;
    const n = this._noiseSource(t, dur);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.5;
    bp.frequency.setValueAtTime(250, t);
    bp.frequency.exponentialRampToValueAtTime(7000, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + dur);
    g.gain.setValueAtTime(0.35, t + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
    n.connect(bp).connect(g).connect(this.synthBus);
    const rs = ctx.createGain(); rs.gain.value = 0.5; g.connect(rs).connect(this.reverbSend);
    // Rising tone underneath.
    const o = this._osc('sawtooth', 110, t, t + dur + 0.1);
    o.frequency.exponentialRampToValueAtTime(440, t + dur);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.08, t + dur);
    og.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
    const olp = ctx.createBiquadFilter(); olp.type = 'lowpass'; olp.frequency.value = 1500;
    o.connect(olp).connect(og).connect(this.synthBus);
  }

  impact(t) {
    const ctx = this.ctx;
    const o = this._osc('sine', 80, t, t + 1.2);
    o.frequency.exponentialRampToValueAtTime(28, t + 0.9);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(1.0, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    o.connect(g).connect(this.drumBus);
    this.crash(t, 1);
    this.sidechain(t, 0.6, 0.3);
  }
}

function makeDriveCurve(amount) {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  return curve;
}
