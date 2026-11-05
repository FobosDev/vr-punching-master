// The song library: built-in tracks plus user supplied audio files (decoded and analysed on
// the device, never uploaded anywhere).

import { TRACKS } from './audio/tracks.js';
import { compileTrack } from './audio/Sequencer.js';
import { analyzeAudioBuffer } from './audio/BeatAnalyzer.js';
import { formatTime } from './util/math.js';

let customCounter = 0;

export class Library {
  constructor(audio) {
    this.audio = audio;
    this.tracks = TRACKS.map((t) => {
      const compiled = compileTrack(t);
      return { id: t.id, title: t.title, subtitle: `${t.style} · ${t.bpm} BPM · ${formatTime(compiled.duration)}`, kind: 'builtin', def: t, colors: t.colors, bpm: t.bpm, duration: compiled.duration, status: 'ready' };
    });
    this.bufferCache = { id: null, buffer: null };
    this.onChange = null;
    this.maxCustom = 8;
  }

  get(id) { return this.tracks.find((t) => t.id === id) || null; }
  get customCount() { return this.tracks.filter((t) => t.kind === 'custom').length; }

  _emit() { if (this.onChange) this.onChange(); }

  /** Adds files, analysing them in the background. Returns the created entries. */
  async addFiles(files, onProgress) {
    const created = [];
    for (const file of files) {
      if (this.customCount >= this.maxCustom) break;
      const id = `custom-${++customCounter}`;
      const title = prettifyName(file.name);
      const entry = { id, title, subtitle: `${formatBytes(file.size)} · analysing…`, kind: 'custom', file, colors: pickColors(customCounter), status: 'analysing', progress: 0, analysis: null, bpm: 0, duration: 0 };
      this.tracks.push(entry);
      created.push(entry);
    }
    this._emit();
    for (const entry of created) {
      try {
        await this.analyze(entry, onProgress);
      } catch (err) {
        console.error('Could not analyse', entry.title, err);
        entry.status = 'error';
        entry.subtitle = 'Could not decode this file';
        this._emit();
      }
    }
    return created;
  }

  async analyze(entry, onProgress) {
    this.audio.init();
    const arrayBuffer = await entry.file.arrayBuffer();
    entry.progress = 0.02; entry.subtitle = 'decoding…'; this._emit();
    const buffer = await this.audio.decode(arrayBuffer);
    this.bufferCache = { id: entry.id, buffer };
    const analysis = await analyzeAudioBuffer(buffer, (f, label) => {
      entry.progress = f;
      entry.subtitle = `${label}… ${Math.round(f * 100)}%`;
      if (onProgress) onProgress(entry, f, label);
      this._emit();
    });
    entry.analysis = analysis;
    entry.bpm = Math.round(analysis.bpm);
    entry.duration = analysis.duration;
    entry.status = 'ready';
    entry.subtitle = `Your song · ${entry.bpm} BPM · ${formatTime(analysis.duration)}`;
    this._emit();
    return analysis;
  }

  /** Decoded audio for a custom track (cached for the most recent one). */
  async getBuffer(entry) {
    if (this.bufferCache.id === entry.id && this.bufferCache.buffer) return this.bufferCache.buffer;
    const arrayBuffer = await entry.file.arrayBuffer();
    const buffer = await this.audio.decode(arrayBuffer);
    this.bufferCache = { id: entry.id, buffer };
    return buffer;
  }

  remove(id) {
    const i = this.tracks.findIndex((t) => t.id === id && t.kind === 'custom');
    if (i < 0) return;
    this.tracks.splice(i, 1);
    if (this.bufferCache.id === id) this.bufferCache = { id: null, buffer: null };
    this._emit();
  }

  /** Analysis-shaped data for the generator, for either kind of track. */
  getAnalysis(entry) {
    if (entry.kind === 'builtin') return compileTrack(entry.def);
    return entry.analysis;
  }
}

function prettifyName(name) {
  return name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled';
}
function formatBytes(b) { return b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`; }
function pickColors(i) {
  const palettes = [['#ffd166', '#ff2d95'], ['#19e6ff', '#7c4dff'], ['#b388ff', '#ff6b6b'], ['#5efc8d', '#19e6ff'], ['#ff9f43', '#ff2d95']];
  return palettes[i % palettes.length];
}
