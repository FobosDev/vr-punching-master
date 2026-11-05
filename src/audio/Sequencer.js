// Turns a track sheet (see tracks.js) into a flat list of timed synth events, and plays it back
// with a look-ahead scheduler on the AudioContext clock. compileTrack() is pure, so the beat-map
// generator and the unit tests can run it without any Web Audio.

import { SCALES, DRUM_PATTERNS, BASS_PATTERNS } from './tracks.js';
import { Synth } from './Synth.js';

const mod = (n, m) => ((n % m) + m) % m;

export function degreeToMidi(root, scale, degree) {
  const oct = Math.floor(degree / 7);
  return root + oct * 12 + scale[mod(degree, 7)];
}

export function chordMidis(root, scale, degree) {
  return [degree, degree + 2, degree + 4].map((d) => degreeToMidi(root, scale, d));
}

/**
 * @returns {{events, hits, beats, energy, sections, duration, bpm, beatLength}}
 *  events  – synth events {t, kind, ...}
 *  hits    – candidate moments for the beat map {t, s, band}
 *  beats   – beat times in seconds
 *  energy  – 0..1 per beat
 */
export function compileTrack(track) {
  const scale = SCALES[track.scale] || SCALES.minor;
  const bpm = track.bpm;
  const beat = 60 / bpm;
  const step = beat / 4;
  const bar = beat * 4;
  const swing = track.swing || 0;
  const events = [];
  const hits = [];
  const sections = [];
  const energy = [];

  let barIndex = 0;
  let time = 0;
  const push = (ev) => events.push(ev);
  const hit = (t, s, band) => hits.push({ t, s, band });

  for (let si = 0; si < track.sections.length; si++) {
    const sec = track.sections[si];
    const next = track.sections[si + 1];
    const start = time;
    const dur = sec.bars * bar;
    sections.push({ name: sec.name, start, end: start + dur, energy: sec.energy, walls: !!sec.walls });
    for (let b = 0; b < sec.bars * 4; b++) energy.push(sec.energy);

    if (sec.impact) push({ t: start, kind: 'impact' });
    if (sec.riser) push({ t: start, kind: 'riser', dur });

    const drums = DRUM_PATTERNS[sec.drums] || {};
    const bassPattern = BASS_PATTERNS[sec.bass] || BASS_PATTERNS.off;
    const fill = next && next.energy > sec.energy + 0.2;

    for (let bi = 0; bi < sec.bars; bi++) {
      const barStart = start + bi * bar;
      const chordDeg = track.progression[barIndex % track.progression.length];
      const chord = chordMidis(track.root, scale, chordDeg);
      const chordRoot = chord[0];
      const isLastBar = bi === sec.bars - 1;
      const stepTime = (s) => barStart + s * step + ((s % 2 === 1) ? swing * step : 0);

      // Drums --------------------------------------------------------------
      for (const [voice, pattern] of Object.entries(drums)) {
        for (let s = 0; s < 16; s++) {
          const c = pattern[s];
          if (c !== 'x' && c !== 'X') continue;
          if (fill && isLastBar && s >= 8 && (voice === 'k' || voice === 's' || voice === 'c')) continue; // make room for the fill
          const vel = c === 'X' ? 1 : 0.85;
          const t = stepTime(s);
          switch (voice) {
            case 'k': push({ t, kind: 'kick', vel, hard: sec.energy >= 0.9 }); hit(t, c === 'X' ? 1 : 0.85, 'low'); break;
            case 's': push({ t, kind: 'snare', vel }); hit(t, 0.9, 'mid'); break;
            case 'c': push({ t, kind: 'clap', vel }); hit(t, 0.8, 'mid'); break;
            case 'h': push({ t, kind: 'hat', vel: s % 4 === 0 ? 0.9 : 0.6 }); hit(t, s % 4 === 0 ? 0.35 : 0.25, 'high'); break;
            case 'o': push({ t, kind: 'ohat', vel: 0.8 }); hit(t, 0.45, 'high'); break;
            default: break;
          }
        }
      }
      if (fill && isLastBar) {
        const steps = [8, 10, 12, 13, 14, 15];
        steps.forEach((s, i) => {
          const t = stepTime(s);
          push({ t, kind: 'snare', vel: 0.55 + 0.45 * (i / (steps.length - 1)) });
          hit(t, 0.6 + 0.4 * (i / (steps.length - 1)), 'mid');
        });
        push({ t: stepTime(12), kind: 'tom', vel: 0.9, pitch: 130 });
        push({ t: stepTime(14), kind: 'tom', vel: 1, pitch: 95 });
      }

      // Bass ---------------------------------------------------------------
      for (let s = 0; s < 16; s++) {
        const c = bassPattern[s];
        if (c === '.' || c === '-' || c === undefined) continue;
        let len = 1;
        while (s + len < 16 && bassPattern[s + len] === '-') len++;
        const semis = c === 'o' ? 12 : parseInt(c, 10);
        const t = stepTime(s);
        push({ t, kind: 'bass', midi: chordRoot - 12 + semis, dur: len * step * 0.92, vel: s % 4 === 0 ? 1 : 0.85, preset: track.bassPreset || 'synth' });
        hit(t, s % 4 === 0 ? 0.5 : 0.4, 'low');
      }

      // Arpeggio -----------------------------------------------------------
      if (sec.arp) {
        const every = sec.arp === 'up16' ? 1 : 2;
        const tones = [chord[0], chord[1], chord[2], chord[0] + 12].map((m) => m + 12);
        let idx = (bi * (16 / every)) % tones.length;
        for (let s = 0; s < 16; s += every) {
          const t = stepTime(s);
          push({ t, kind: 'arp', midi: tones[idx % tones.length], dur: step * every * 0.8, vel: s % 4 === 0 ? 0.9 : 0.7 });
          hit(t, s % 4 === 0 ? 0.4 : 0.3, 'mid');
          idx++;
        }
      }

      // Pad / stabs ----------------------------------------------------------
      if (sec.pad) {
        push({ t: barStart, kind: 'pad', midis: [chord[0], chord[1], chord[2], chord[0] + 12], dur: bar * 0.98, vel: 1 });
      }
      if (sec.stabs) {
        for (const s of [2, 6, 10, 14]) {
          const t = stepTime(s);
          push({ t, kind: 'stab', midis: chord.map((m) => m + 12), dur: step * 1.5, vel: 0.9 });
          hit(t, 0.55, 'mid');
        }
      }

      // Melodies -----------------------------------------------------------
      const phraseIdx = Math.floor(bi / 4);
      const barInPhrase = bi % 4;
      const melodic = [['lead', sec.lead], ['pluck', sec.pluck]];
      for (const [kind, list] of melodic) {
        if (!list) continue;
        const name = list[phraseIdx % list.length];
        const phrase = track.leads[name];
        if (!phrase) continue;
        for (const [pb, ps, deg, len] of phrase) {
          if (pb !== barInPhrase) continue;
          const t = stepTime(ps);
          const midi = degreeToMidi(track.root, scale, deg) + 12;
          push({ t, kind, midi, dur: len * step * 0.9, vel: ps % 4 === 0 ? 1 : 0.85, opts: track.leadOpts || {} });
          hit(t, kind === 'lead' ? (ps % 4 === 0 ? 0.7 : 0.6) : 0.5, 'mid');
        }
      }

      barIndex++;
    }
    time += dur;
  }

  // Crash on big section starts.
  for (const s of sections) if (s.energy >= 0.9) push({ t: s.start, kind: 'crash', vel: 1 });

  events.sort((a, b) => a.t - b.t);
  hits.sort((a, b) => a.t - b.t);
  const totalBeats = barIndex * 4;
  const beats = [];
  for (let i = 0; i <= totalBeats; i++) beats.push(i * beat);
  return { events, hits, beats, energy, sections, duration: time + 1.5, bpm, beatLength: beat };
}

/** Schedules compiled events on the synth with a look-ahead timer. */
export class MusicPlayer {
  constructor(engine) {
    this.engine = engine;
    this.synth = null;
    this.compiled = null;
    this.startTime = 0;
    this.index = 0;
    this.timer = 0;
    this.lookahead = 0.35;
    this.playing = false;
  }

  load(track) {
    this.compiled = compileTrack(track);
    this.track = track;
    return this.compiled;
  }

  start(ctxStartTime) {
    if (!this.compiled) throw new Error('MusicPlayer: load() first');
    this.stop();
    this.synth = new Synth(this.engine);
    this.synth.setTempo(this.compiled.bpm);
    this.startTime = ctxStartTime;
    this.index = 0;
    this.playing = true;
    this._tick();
    this.timer = setInterval(() => this._tick(), 40);
  }

  _tick() {
    if (!this.playing) return;
    const ctx = this.engine.ctx;
    const horizon = ctx.currentTime + this.lookahead;
    const events = this.compiled.events;
    while (this.index < events.length && events[this.index].t + this.startTime < horizon) {
      const ev = events[this.index++];
      const t = ev.t + this.startTime;
      if (t < ctx.currentTime - 0.05) continue; // we fell behind (tab hidden): skip stale notes
      this._trigger(ev, t);
    }
  }

  _trigger(ev, t) {
    const s = this.synth;
    switch (ev.kind) {
      case 'kick': s.kick(t, ev.vel, { punchy: ev.hard }); break;
      case 'snare': s.snare(t, ev.vel); break;
      case 'clap': s.clap(t, ev.vel); break;
      case 'hat': s.hat(t, ev.vel, false); break;
      case 'ohat': s.hat(t, ev.vel, true); break;
      case 'crash': s.crash(t, ev.vel); break;
      case 'tom': s.tom(t, ev.vel, ev.pitch); break;
      case 'bass': s.bass(t, ev.midi, ev.dur, ev.vel, ev.preset); break;
      case 'lead': s.lead(t, ev.midi, ev.dur, ev.vel, ev.opts); break;
      case 'pluck': s.pluck(t, ev.midi, ev.dur, ev.vel, ev.opts); break;
      case 'arp': s.pluck(t, ev.midi, ev.dur, ev.vel, { wave: 'triangle', delay: 0.3 }); break;
      case 'pad': s.pad(t, ev.midis, ev.dur, ev.vel); break;
      case 'stab': s.stab(t, ev.midis, ev.dur, ev.vel); break;
      case 'riser': s.riser(t, ev.dur); break;
      case 'impact': s.impact(t); break;
      default: break;
    }
  }

  stop(fadeSeconds = 0.08) {
    this.playing = false;
    if (this.timer) { clearInterval(this.timer); this.timer = 0; }
    if (this.synth) {
      const synth = this.synth;
      this.synth = null;
      const ctx = this.engine.ctx;
      const g = synth.out.gain;
      g.setValueAtTime(g.value, ctx.currentTime);
      g.linearRampToValueAtTime(0.0001, ctx.currentTime + fadeSeconds);
      setTimeout(() => synth.dispose(), (fadeSeconds + 3) * 1000);
    }
  }
}
