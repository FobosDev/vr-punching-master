// Node sanity tests for the pure modules (no browser needed): run with `node test/beatmap.test.mjs`.
import { TRACKS } from '../src/audio/tracks.js';
import { compileTrack } from '../src/audio/Sequencer.js';
import { generateBeatmap, DIFFICULTY_ORDER, DIFFICULTIES } from '../src/beatmap/Generator.js';

let failures = 0;
const check = (cond, msg) => { if (!cond) { failures++; console.error('  FAIL:', msg); } };

for (const track of TRACKS) {
  const c = compileTrack(track);
  console.log(`\n${track.title}  ${track.bpm} bpm  ${c.duration.toFixed(1)}s  events=${c.events.length} hits=${c.hits.length} beats=${c.beats.length}`);
  check(c.events.every((e, i) => i === 0 || e.t >= c.events[i - 1].t), 'events sorted');
  check(c.events.every((e) => Number.isFinite(e.t) && e.t >= 0 && e.t < c.duration), 'event times in range');
  check(c.events.filter((e) => e.midi !== undefined).every((e) => e.midi > 20 && e.midi < 110), 'midi in range');
  check(c.energy.length === c.beats.length - 1, `energy per beat (${c.energy.length} vs ${c.beats.length - 1})`);
  for (const diff of DIFFICULTY_ORDER) {
    const map = generateBeatmap(c, diff, track.id);
    const map2 = generateBeatmap(c, diff, track.id);
    check(JSON.stringify(map.notes) === JSON.stringify(map2.notes), 'deterministic');
    const notes = map.notes.filter((n) => n.type !== 'B');
    // No two notes at the same time in the same cell.
    const seen = new Set();
    for (const n of map.notes) { const k = `${n.t.toFixed(3)}|${n.col}|${n.row}`; check(!seen.has(k), `overlap ${k}`); seen.add(k); }
    // Same-hand spacing respected.
    const D = DIFFICULTIES[diff];
    const last = { L: -1e9, R: -1e9 };
    for (const n of notes) {
      if (n.type === 'L' || n.type === 'R') {
        check(n.t - last[n.type] >= Math.max(D.sameHandGap * c.beatLength, D.sameHandSec) - 1e-3, `same hand gap ${diff} ${n.type} ${n.t.toFixed(2)}`);
        last[n.type] = n.t;
      }
    }
    check(notes.every((n) => n.t >= 2 && n.t <= c.duration), 'lead in respected');
    check(map.walls.every((w) => w.end > w.t && w.t >= 6), 'walls valid');
    const types = notes.reduce((m, n) => (m[n.type] = (m[n.type] || 0) + 1, m), {});
    console.log(`  ${diff.padEnd(6)} notes=${String(map.stats.notes).padStart(4)} nps=${map.stats.nps.toFixed(2)} bombs=${map.stats.bombs} walls=${map.stats.walls}  L/R/A=${types.L || 0}/${types.R || 0}/${types.A || 0}`);
    check(map.stats.nps > 0.5, `enough notes on ${diff}`);
  }
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
