// Offline music analysis for user supplied songs: onset detection in three frequency bands,
// tempo estimation by autocorrelation and dynamic-programming beat tracking (after Ellis 2007).
// The result has the same shape as compileTrack() so the beat-map generator treats built-in and
// custom songs identically.

const HOP = 512;

class Biquad {
  constructor(type, fc, sr, q = 0.7071) {
    const w0 = 2 * Math.PI * fc / sr;
    const cos = Math.cos(w0), sin = Math.sin(w0);
    const alpha = sin / (2 * q);
    let b0, b1, b2, a0, a1, a2;
    if (type === 'lowpass') {
      b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2;
    } else { // highpass
      b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2;
    }
    a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
    this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0;
  }
  process(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

const yieldToUI = () => new Promise((r) => setTimeout(r, 0));

function percentile(arr, p) {
  const a = Array.from(arr).sort((x, y) => x - y);
  if (!a.length) return 0;
  return a[Math.min(a.length - 1, Math.floor(p * (a.length - 1)))];
}

/**
 * @param {AudioBuffer} buffer
 * @param {(fraction:number, label:string)=>void} onProgress
 */
export async function analyzeAudioBuffer(buffer, onProgress = () => {}) {
  const sr = buffer.sampleRate;
  const n = buffer.length;
  const channels = buffer.numberOfChannels;
  const frames = Math.ceil(n / HOP);
  const fps = sr / HOP;

  // 1) Band energies per frame -----------------------------------------------
  const lowE = new Float32Array(frames), midE = new Float32Array(frames), highE = new Float32Array(frames), fullE = new Float32Array(frames);
  const lp1 = new Biquad('lowpass', 160, sr), lp2 = new Biquad('lowpass', 160, sr);
  const hp1 = new Biquad('highpass', 4000, sr), hp2 = new Biquad('highpass', 4000, sr);
  const mhp = new Biquad('highpass', 200, sr), mlp = new Biquad('lowpass', 2500, sr);
  const chans = [];
  for (let c = 0; c < channels; c++) chans.push(buffer.getChannelData(c));
  const inv = 1 / channels;
  const CHUNK = HOP * 400;
  for (let start = 0; start < n; start += CHUNK) {
    const end = Math.min(n, start + CHUNK);
    for (let i = start; i < end; i++) {
      let x = 0;
      for (let c = 0; c < channels; c++) x += chans[c][i];
      x *= inv;
      const f = (i / HOP) | 0;
      const lo = lp2.process(lp1.process(x));
      const hi = hp2.process(hp1.process(x));
      const mi = mlp.process(mhp.process(x));
      lowE[f] += lo * lo; midE[f] += mi * mi; highE[f] += hi * hi; fullE[f] += x * x;
    }
    onProgress(0.05 + 0.55 * (end / n), 'Listening to the song');
    if ((start / CHUNK) % 3 === 2) await yieldToUI();
  }

  // 2) Onset strength (spectral-flux style, per band, log compressed) --------
  const logc = (e) => Math.log10(1 + 2000 * e / HOP);
  const bandFlux = [new Float32Array(frames), new Float32Array(frames), new Float32Array(frames)];
  const onset = new Float32Array(frames);
  const bands = [lowE, midE, highE];
  const weights = [1.6, 1.0, 0.9];
  for (let f = 1; f < frames; f++) {
    let sum = 0;
    for (let b = 0; b < 3; b++) {
      const d = logc(bands[b][f]) - logc(bands[b][f - 1]);
      const v = d > 0 ? d : 0;
      bandFlux[b][f] = v;
      sum += v * weights[b];
    }
    onset[f] = sum;
  }
  // Light smoothing + local normalisation so quiet intros and loud drops are treated alike.
  const smooth = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    const a = onset[Math.max(0, f - 1)], b = onset[f], c = onset[Math.min(frames - 1, f + 1)];
    smooth[f] = 0.25 * a + 0.5 * b + 0.25 * c;
  }
  const win = Math.round(fps * 1.5);
  const norm = new Float32Array(frames);
  let acc = 0; const q = [];
  for (let f = 0; f < frames; f++) {
    q.push(smooth[f]); acc += smooth[f];
    if (q.length > win * 2) acc -= q.shift();
    const mean = acc / q.length;
    norm[f] = smooth[f] / (mean + 1e-4);
  }
  onProgress(0.65, 'Finding the beat');
  await yieldToUI();

  // 3) Tempo via autocorrelation of the onset envelope ------------------------
  const minLag = Math.floor(fps * 60 / 200);
  const maxLag = Math.ceil(fps * 60 / 60);
  const acf = new Float32Array(maxLag * 3 + 2);
  const mean = smooth.reduce((s, v) => s + v, 0) / frames;
  const centered = new Float32Array(frames);
  for (let f = 0; f < frames; f++) centered[f] = smooth[f] - mean;
  for (let lag = 1; lag < acf.length; lag++) {
    let s = 0;
    for (let f = lag; f < frames; f++) s += centered[f] * centered[f - lag];
    acf[lag] = s / (frames - lag);
  }
  let bestLag = minLag, bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = 60 * fps / lag;
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 125) / 0.55, 2));
    const harmonic = acf[lag] + 0.5 * (acf[lag * 2] || 0) + 0.3 * (acf[lag * 3] || 0);
    const score = harmonic * (0.35 + prior);
    if (score > bestScore) { bestScore = score; bestLag = lag; }
  }
  // Parabolic refinement of the lag.
  let lagF = bestLag;
  if (bestLag > 1 && bestLag < acf.length - 1) {
    const y0 = acf[bestLag - 1], y1 = acf[bestLag], y2 = acf[bestLag + 1];
    const denom = y0 - 2 * y1 + y2;
    if (Math.abs(denom) > 1e-9) lagF = bestLag + 0.5 * (y0 - y2) / denom;
  }
  let bpm = 60 * fps / lagF;
  while (bpm < 80) { bpm *= 2; lagF /= 2; }
  while (bpm > 190) { bpm /= 2; lagF *= 2; }
  const period = lagF;
  onProgress(0.75, 'Tracking beats');
  await yieldToUI();

  // 4) Dynamic-programming beat tracking --------------------------------------
  const std = Math.sqrt(norm.reduce((s, v) => s + v * v, 0) / frames) || 1;
  const env = new Float32Array(frames);
  for (let f = 0; f < frames; f++) env[f] = norm[f] / std;
  const tightness = 100;
  const cum = new Float32Array(frames);
  const back = new Int32Array(frames).fill(-1);
  const pMin = Math.max(1, Math.round(period / 2));
  const pMax = Math.round(period * 2);
  const txwt = new Float32Array(pMax + 1);
  for (let p = pMin; p <= pMax; p++) txwt[p] = -tightness * Math.pow(Math.log(p / period), 2);
  for (let f = 0; f < frames; f++) {
    let best = -Infinity, bestP = -1;
    const lo = Math.max(0, f - pMax);
    for (let p = f - pMin; p >= lo; p--) {
      const v = cum[p] + txwt[f - p];
      if (v > best) { best = v; bestP = p; }
    }
    cum[f] = env[f] + (bestP >= 0 ? best : 0);
    back[f] = bestP;
    if ((f & 4095) === 0 && f) await yieldToUI();
  }
  // Last beat: the strongest local maximum of the cumulative score near the end of the song.
  const localMax = [];
  for (let f = 1; f < frames - 1; f++) if (cum[f] > cum[f - 1] && cum[f] >= cum[f + 1]) localMax.push(f);
  const thresh = 0.5 * percentile(localMax.map((f) => cum[f]), 0.5);
  let last = -1;
  for (let i = localMax.length - 1; i >= 0; i--) { if (cum[localMax[i]] >= thresh) { last = localMax[i]; break; } }
  if (last < 0) last = frames - 1;
  const beatFrames = [];
  for (let f = last; f >= 0; f = back[f]) { beatFrames.push(f); if (back[f] < 0) break; }
  beatFrames.reverse();
  // Trim weak beats at both ends (the DP chain always starts somewhere, even in silence).
  if (beatFrames.length > 8) {
    const strengths = beatFrames.map((f) => env[f]).sort((a, b) => a - b);
    const floor = 0.25 * strengths[Math.floor(strengths.length / 2)];
    while (beatFrames.length > 4 && env[beatFrames[0]] < floor) beatFrames.shift();
    while (beatFrames.length > 4 && env[beatFrames[beatFrames.length - 1]] < floor) beatFrames.pop();
  }
  // Extend the grid to the beginning/end so the whole song is covered.
  const beatsSec = beatFrames.map((f) => f / fps);
  const avgInterval = beatsSec.length > 1 ? (beatsSec[beatsSec.length - 1] - beatsSec[0]) / (beatsSec.length - 1) : 60 / bpm;
  while (beatsSec.length && beatsSec[0] - avgInterval > 0) beatsSec.unshift(beatsSec[0] - avgInterval);
  const duration = n / sr;
  while (beatsSec.length && beatsSec[beatsSec.length - 1] + avgInterval < duration) beatsSec.push(beatsSec[beatsSec.length - 1] + avgInterval);
  bpm = 60 / avgInterval;
  onProgress(0.9, 'Placing targets');
  await yieldToUI();

  // 5) Hits: onset peaks with a strength and dominant band ----------------------
  const hits = [];
  const minGapFrames = Math.round(fps * 0.09);
  const strengthRef = percentile(norm, 0.97) || 1;
  let lastPeak = -minGapFrames;
  for (let f = 2; f < frames - 2; f++) {
    const v = norm[f];
    if (v < 0.9) continue;
    if (v < norm[f - 1] || v < norm[f + 1] || v < norm[f - 2] || v < norm[f + 2]) continue;
    if (f - lastPeak < minGapFrames) continue;
    lastPeak = f;
    const lo = bandFlux[0][f] * weights[0], mi = bandFlux[1][f] * weights[1], hi = bandFlux[2][f] * weights[2];
    const band = lo >= mi && lo >= hi ? 'low' : mi >= hi ? 'mid' : 'high';
    hits.push({ t: f / fps, s: Math.min(1, v / strengthRef), band });
  }

  // 6) Energy per beat (loudness) normalised to 0..1 ----------------------------
  const energy = new Array(Math.max(0, beatsSec.length - 1)).fill(0);
  for (let i = 0; i < energy.length; i++) {
    const a = Math.max(0, Math.floor(beatsSec[i] * fps)), b = Math.min(frames - 1, Math.floor(beatsSec[i + 1] * fps));
    let s = 0, c = 0;
    for (let f = a; f <= b; f++) { s += fullE[f]; c++; }
    energy[i] = c ? Math.sqrt(s / c / HOP) : 0;
  }
  const eRef = percentile(energy, 0.95) || 1;
  for (let i = 0; i < energy.length; i++) energy[i] = Math.min(1, energy[i] / eRef);

  onProgress(1, 'Ready');
  return { hits, beats: beatsSec, energy, sections: [], duration, bpm, beatLength: 60 / bpm, confidence: bestScore };
}
