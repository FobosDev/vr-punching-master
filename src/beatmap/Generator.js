// Beat-map generation. Input is a song analysis (from compileTrack or analyzeAudioBuffer):
// beat times, candidate "hits" with strength and band, loudness per beat and optional section
// hints. Output is a playable map: notes (L/R/any), bombs and walls laid out on a 3x3 grid.
//
// Design goals: notes land on real musical accents, hands alternate like a natural boxing
// rhythm, density follows the energy of the music, walls appear in breakdowns, and the same
// song + difficulty always produces the same map (seeded RNG).

import { makeRng, hashString, clamp } from '../util/math.js';

export const DIFFICULTIES = {
  //                 note speed  min gap (beats / seconds)   same-hand gap (beats / seconds)    notes per bar
  easy:   { label: 'Easy',   speed: 7,  minGap: 1.0,  minGapSec: 0.5,  sameHandGap: 1.0, sameHandSec: 0.8,  maxPerBar: 2,  threshold: 0.62, subdiv: 2, anyHand: 0.3,  doubles: 0.0, bombs: 0.0, walls: 0.5, duck: false, hooks: 0 },
  normal: { label: 'Normal', speed: 9,  minGap: 0.5,  minGapSec: 0.26, sameHandGap: 1.0, sameHandSec: 0.5,  maxPerBar: 5,  threshold: 0.47, subdiv: 2, anyHand: 0.12, doubles: 0.3, bombs: 0.0, walls: 1.0, duck: false, hooks: 0.04 },
  hard:   { label: 'Hard',   speed: 11, minGap: 0.25, minGapSec: 0.18, sameHandGap: 0.5, sameHandSec: 0.36, maxPerBar: 8,  threshold: 0.36, subdiv: 4, anyHand: 0.05, doubles: 0.5, bombs: 0.5, walls: 1.0, duck: true,  hooks: 0.08 },
  expert: { label: 'Expert', speed: 13, minGap: 0.25, minGapSec: 0.14, sameHandGap: 0.5, sameHandSec: 0.28, maxPerBar: 12, threshold: 0.24, subdiv: 4, anyHand: 0.0,  doubles: 0.7, bombs: 1.0, walls: 1.3, duck: true,  hooks: 0.12 },
};

export const DIFFICULTY_ORDER = ['easy', 'normal', 'hard', 'expert'];

const LEAD_IN = 2.0;      // no targets in the first seconds
const WALL_LEAD_IN = 6.0;

function lowerBound(arr, x) { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < x) lo = m + 1; else hi = m; } return lo; }

function weightedPick(rng, weights) {
  let total = 0; for (const w of weights) total += Math.max(0, w);
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) { r -= Math.max(0, weights[i]); if (r <= 0) return i; }
  return weights.length - 1;
}

/**
 * @param {object} analysis  {beats, hits, energy, sections, duration}
 * @param {string} difficulty
 * @param {string} seedKey   track id (keeps maps stable per track)
 */
export function generateBeatmap(analysis, difficulty = 'normal', seedKey = 'song') {
  const D = DIFFICULTIES[difficulty] || DIFFICULTIES.normal;
  const rng = makeRng(hashString(seedKey + '|' + difficulty));
  const beats = analysis.beats;
  const duration = analysis.duration;
  const energy = analysis.energy || [];
  const avgBeat = beats.length > 1 ? (beats[beats.length - 1] - beats[0]) / (beats.length - 1) : 0.5;
  const energyAt = (i) => (energy.length ? energy[clamp(i, 0, energy.length - 1)] : 0.8);

  // ---------------------------------------------------------------- 1) slots
  const slots = [];
  for (let i = 0; i < beats.length - 1; i++) {
    const b0 = beats[i], b1 = beats[i + 1];
    const len = b1 - b0;
    for (let k = 0; k < D.subdiv; k++) {
      slots.push({ t: b0 + (len * k) / D.subdiv, beat: i, sub: k, len: len / D.subdiv, s: 0, raw: 0, band: 'mid', energy: energyAt(i) });
    }
  }
  const slotTimes = slots.map((s) => s.t);
  for (const h of analysis.hits) {
    let idx = lowerBound(slotTimes, h.t);
    if (idx > 0 && (idx >= slots.length || Math.abs(slotTimes[idx - 1] - h.t) < Math.abs(slotTimes[idx] - h.t))) idx--;
    const slot = slots[idx];
    if (!slot || Math.abs(slot.t - h.t) > slot.len * 0.5) continue;
    if (h.s > slot.raw) { slot.raw = h.s; slot.band = h.band; } else slot.raw = Math.min(1, slot.raw + h.s * 0.25);
  }
  for (const slot of slots) {
    const posW = slot.sub === 0 ? 1.15 : (D.subdiv === 4 && slot.sub === 2) ? 1.0 : 0.82;
    slot.s = slot.raw * (0.55 + 0.65 * slot.energy) * posW;
  }

  // ---------------------------------------------------------------- 2) select
  const selected = [];   // slot indices
  const selectedTimes = [];
  const canPlace = (t, gapSec) => {
    const i = lowerBound(selectedTimes, t);
    if (i > 0 && t - selectedTimes[i - 1] < gapSec - 1e-6) return false;
    if (i < selectedTimes.length && selectedTimes[i] - t < gapSec - 1e-6) return false;
    return true;
  };
  const place = (idx) => {
    const t = slots[idx].t;
    const i = lowerBound(selectedTimes, t);
    selectedTimes.splice(i, 0, t);
    selected.splice(i, 0, idx);
  };
  const gapSec = Math.max(D.minGap * avgBeat, D.minGapSec);
  const usable = (slot) => slot.t >= LEAD_IN && slot.t <= duration - 1.0;
  // Pass A: on-beat accents.
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (slot.sub !== 0 || !usable(slot)) continue;
    if (slot.s >= D.threshold && canPlace(slot.t, gapSec)) place(i);
  }
  // Pass B: off-beats, strongest first so syncopation wins over filler.
  const off = [];
  for (let i = 0; i < slots.length; i++) if (slots[i].sub !== 0 && usable(slots[i]) && slots[i].s >= D.threshold + 0.06) off.push(i);
  off.sort((a, b) => slots[b].s - slots[a].s);
  for (const i of off) if (canPlace(slots[i].t, gapSec)) place(i);
  // Pass C: in loud sections make sure there is at least one note per 2 beats (keeps the flow).
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (slot.sub !== 0 || !usable(slot) || slot.energy < 0.75 || slot.beat % 2 !== 0) continue;
    if (slot.raw > 0.3 && canPlace(slot.t, Math.max(gapSec, avgBeat * 0.99))) place(i);
  }

  // Cap the density per bar (keep the strongest accents) so Easy really is easy.
  {
    const perBar = new Map();
    for (const idx of selected) {
      const bar = Math.floor(slots[idx].beat / 4);
      if (!perBar.has(bar)) perBar.set(bar, []);
      perBar.get(bar).push(idx);
    }
    const drop = new Set();
    for (const [, list] of perBar) {
      const limit = D.maxPerBar + (slots[list[0]].energy >= 0.9 && D.maxPerBar <= 2 ? 1 : 0);
      if (list.length <= limit) continue;
      list.sort((a, b) => slots[b].s - slots[a].s || slots[a].t - slots[b].t);
      for (let i = limit; i < list.length; i++) drop.add(list[i]);
    }
    if (drop.size) {
      for (let i = selected.length - 1; i >= 0; i--) if (drop.has(selected[i])) { selected.splice(i, 1); selectedTimes.splice(i, 1); }
    }
  }

  // ---------------------------------------------------------------- 3) hands & cells
  const notes = [];
  const state = {
    lastHand: rng.chance(0.5) ? 'L' : 'R',
    lastTime: -Infinity,
    hand: { L: { t: -Infinity, col: 0, row: 1 }, R: { t: -Infinity, col: 2, row: 1 } },
  };
  const sameHandGap = Math.max(D.sameHandGap * avgBeat, D.sameHandSec);
  const other = (h) => (h === 'L' ? 'R' : 'L');

  const pickCell = (hand, slot, avoid, anyHand = false) => {
    const hs = state.hand[hand];
    const recent = slot.t - hs.t < avgBeat * 0.75;
    // Column weights
    let colW;
    if (anyHand) colW = [0.3, 0.4, 0.3];
    else if (hand === 'L') colW = [0.5, 0.42, 0.02 + D.hooks];
    else colW = [0.02 + D.hooks, 0.42, 0.5];
    // Row weights with band bias
    const rowW = [0.3, 0.45, 0.25];
    if (slot.band === 'low') { rowW[0] += 0.25; }
    if (slot.band === 'high') { rowW[2] += 0.25; }
    if (slot.band === 'mid') { rowW[1] += 0.1; }
    if (recent) { // keep movement small when notes are fast
      for (let r = 0; r < 3; r++) if (Math.abs(r - hs.row) > 1) rowW[r] *= 0.1;
    }
    for (let tries = 0; tries < 6; tries++) {
      const col = weightedPick(rng, colW);
      const row = weightedPick(rng, rowW);
      if (avoid.some((c) => c.col === col && c.row === row)) continue;
      if (recent && tries < 4 && col === hs.col && row === hs.row && !rng.chance(0.25)) continue; // avoid hammering the same cell
      return { col, row };
    }
    for (let col = 0; col < 3; col++) for (let row = 0; row < 3; row++) if (!avoid.some((c) => c.col === col && c.row === row)) return { col, row };
    return { col: 1, row: 1 };
  };

  const emit = (t, type, cell, slot) => {
    notes.push({ t, type, col: cell.col, row: cell.row, band: slot.band, strength: slot.s });
    if (type === 'L' || type === 'R') { state.hand[type].t = t; state.hand[type].col = cell.col; state.hand[type].row = cell.row; state.lastHand = type; }
    state.lastTime = t;
  };

  for (let si = 0; si < selected.length; si++) {
    const slot = slots[selected[si]];
    const t = slot.t;
    const prevGap = t - state.lastTime;
    const nextGap = si + 1 < selected.length ? slots[selected[si + 1]].t - t : Infinity;

    // Doubles on heavy downbeats.
    const heavy = slot.sub === 0 && slot.band === 'low' && slot.s >= 0.75 && slot.energy >= 0.7;
    if (D.doubles > 0 && heavy && prevGap >= Math.max(avgBeat * 0.99, sameHandGap) && nextGap >= Math.max(avgBeat * 0.49, sameHandGap) && (slot.beat % 4 === 0 || rng.chance(0.3)) && rng.chance(D.doubles)) {
      const row = weightedPick(rng, [0.4, 0.45, 0.15]);
      const wide = rng.chance(0.5);
      emit(t, 'L', { col: wide ? 0 : 1, row }, slot);
      emit(t, 'R', { col: wide ? 2 : 1, row: wide ? row : clamp(row + (rng.chance(0.5) ? 1 : -1), 0, 2) }, slot);
      if (!wide) { // make sure the two cells differ
        const a = notes[notes.length - 2], b = notes[notes.length - 1];
        if (a.col === b.col && a.row === b.row) b.col = 2;
      }
      continue;
    }

    // Choose hand.
    let hand;
    const fast = prevGap < avgBeat * 0.75;
    if (fast) hand = other(state.lastHand);
    else hand = rng.chance(0.72) ? other(state.lastHand) : state.lastHand;
    if (t - state.hand[hand].t < sameHandGap - 1e-6) hand = other(hand);
    if (t - state.hand[hand].t < sameHandGap - 1e-6) continue; // both hands busy: drop the note
    let type = hand;
    if (D.anyHand > 0 && !fast && rng.chance(D.anyHand)) type = 'A';

    // Avoid the cell the other hand just used (and any note at the very same time).
    const avoid = [];
    const oh = state.hand[other(hand)];
    if (t - oh.t < avgBeat * 0.6) avoid.push({ col: oh.col, row: oh.row });
    for (let k = notes.length - 1; k >= 0 && t - notes[k].t < 1e-3; k--) avoid.push({ col: notes[k].col, row: notes[k].row });
    const cell = pickCell(hand, slot, avoid, type === 'A');
    emit(t, type, cell, slot);
    if (type === 'A') { state.lastHand = hand; state.hand[hand].t = t; state.hand[hand].col = cell.col; state.hand[hand].row = cell.row; }
  }

  // ---------------------------------------------------------------- 4) walls
  const walls = [];
  if (D.walls > 0 && beats.length > 8) {
    const windows = [];
    if (analysis.sections && analysis.sections.some((s) => s.walls)) {
      for (const s of analysis.sections) if (s.walls) windows.push({ start: s.start, end: s.end, kind: 'calm' });
    } else {
      // Detect calm stretches from loudness: >= 4 beats below 55 % of the loud reference.
      let runStart = -1;
      for (let i = 0; i <= energy.length; i++) {
        const calm = i < energy.length && energy[i] < 0.55;
        if (calm && runStart < 0) runStart = i;
        if (!calm && runStart >= 0) {
          if (i - runStart >= 4) windows.push({ start: beats[runStart], end: beats[i], kind: 'calm' });
          runStart = -1;
        }
      }
    }
    // Spice for the harder modes: a quick wall every 16 beats in the loud parts.
    if (D.walls >= 1) {
      const every = D.walls > 1.1 ? 12 : 16;
      for (let i = 8; i < beats.length - 4; i += every) {
        if (energyAt(i) >= 0.7 && rng.chance(0.75)) windows.push({ start: beats[i] - 0.001, end: beats[Math.min(beats.length - 1, i + 2)], kind: 'hot' });
      }
    }
    windows.sort((a, b) => a.start - b.start);
    let lastWallEnd = -Infinity;
    let wallCount = 0;
    const wallSpacing = D.walls > 1.1 ? 4 : 8;
    for (const w of windows) {
      const i0 = lowerBound(beats, w.start - 1e-3);
      for (let i = i0; i < beats.length - 1 && beats[i] < w.end - avgBeat; i += (w.kind === 'hot' ? 999 : wallSpacing)) {
        const start = beats[i];
        if (start < WALL_LEAD_IN || start > duration - 3) continue;
        if (start - lastWallEnd < avgBeat * 3) continue;
        const lenBeats = w.kind === 'hot' ? 1 : 2;
        const end = start + lenBeats * avgBeat;
        let kind = wallCount % 2 === 0 ? 'left' : 'right';
        if (D.duck && w.kind !== 'hot' && wallCount % 3 === 2) kind = 'duck';
        if (rng.chance(0.2) && kind !== 'duck') kind = kind === 'left' ? 'right' : 'left';
        walls.push({ t: start, end, kind });
        lastWallEnd = end;
        wallCount++;
      }
    }
    walls.sort((a, b) => a.t - b.t);
    // Remove notes the player could not reach while dodging.
    for (const w of walls) {
      const from = w.t - avgBeat * 0.6, to = w.end + avgBeat * 0.3;
      for (let k = notes.length - 1; k >= 0; k--) {
        const nt = notes[k];
        if (nt.t < from || nt.t > to) continue;
        const nearStart = Math.abs(nt.t - w.t) < avgBeat * 0.35;
        const blocked = w.kind === 'left' ? nt.col === 0 : w.kind === 'right' ? nt.col === 2 : nt.row > 0;
        if (nearStart || blocked) notes.splice(k, 1);
      }
    }
  }

  // ---------------------------------------------------------------- 5) bombs
  const bombs = [];
  if (D.bombs > 0) {
    const perBar = D.bombs * 0.25; // probability per note-bearing bar
    const barSeen = new Set();
    for (let k = 0; k < notes.length; k++) {
      const nt = notes[k];
      if (nt.type === 'A') continue;
      const bar = Math.floor(lowerBound(beats, nt.t + 1e-4) / 4);
      if (barSeen.has(bar) || nt.t < WALL_LEAD_IN) continue;
      if (!rng.chance(perBar)) { barSeen.add(bar); continue; }
      barSeen.add(bar);
      const inWall = walls.some((w) => nt.t > w.t - avgBeat && nt.t < w.end + avgBeat);
      if (inWall) continue;
      const near = notes.filter((o) => Math.abs(o.t - nt.t) < avgBeat * 0.6);
      const occupied = (c, r) => near.some((o) => o.col === c && o.row === r);
      // Companion bomb: a cell next to the note, so the player has to aim rather than flail.
      const candidates = [];
      for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) {
        if (occupied(c, r)) continue;
        const dc = Math.abs(c - nt.col), dr = Math.abs(r - nt.row);
        if (dc + dr === 0 || dc + dr > 2) continue;
        if (c === 1 && r === 1) continue; // never the middle: that is where idle gloves rest
        candidates.push({ col: c, row: r, w: dc + dr === 1 ? 1 : 0.4 });
      }
      if (!candidates.length) continue;
      const pick = candidates[weightedPick(rng, candidates.map((c) => c.w))];
      bombs.push({ t: nt.t, type: 'B', col: pick.col, row: pick.row });
    }
  }

  const all = notes.concat(bombs).sort((a, b) => a.t - b.t || (a.type === 'B' ? 1 : -1));
  all.forEach((n, i) => { n.id = i; });
  const playable = all.filter((n) => n.type !== 'B').length;
  const span = Math.max(1, duration - LEAD_IN);
  return {
    difficulty,
    speed: D.speed,
    notes: all,
    walls,
    beats,
    bpm: analysis.bpm,
    duration,
    stats: { notes: playable, bombs: bombs.length, walls: walls.length, nps: playable / span },
  };
}
