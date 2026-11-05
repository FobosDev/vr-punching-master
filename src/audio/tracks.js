// Built-in soundtrack. Each track is a small "song sheet": tempo, key, chord progression, an
// arrangement of sections and the note patterns each section uses. The sequencer turns this
// into timed events for the synth, and the beat-map generator reads the very same events.

export const SCALES = {
  minor:    [0, 2, 3, 5, 7, 8, 10],
  dorian:   [0, 2, 3, 5, 7, 9, 10],
  major:    [0, 2, 4, 5, 7, 9, 11],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
};

// 16 steps per bar. x = hit, X = accent, . = rest
export const DRUM_PATTERNS = {
  kickOnly:  { k: 'x...x...x...x...' },
  intro:     { k: 'x...x...x...x...', h: '..x...x...x...x.' },
  hatsOnly:  { h: 'x.x.x.x.x.x.x.x.', o: '......x.......x.' },
  build:     { k: 'x...x...x...x...', c: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' },
  full:      { k: 'X...x...X...x...', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.', o: '..x...x...x...x.' },
  fullClap:  { k: 'X...x...X...x...', s: '....x.......x...', c: '....x.......x...', h: 'x.x.x.x.x.x.x.x.', o: '..x...x...x...x.' },
  fullHard:  { k: 'X...x...X...x.x.', s: '....x.......x...', c: '....x.......x...', h: 'xxxxxxxxxxxxxxxx', o: '..x...x...x...x.' },
  half:      { k: 'x.......x.......', s: '....x.......x...', h: '..x...x...x...x.' },
  halftime:  { k: 'x.........x.....', s: '........x.......', h: 'x.x.x.x.x.x.x.x.' },
  halftimeB: { k: 'x.....x...x.....', s: '........x.......', h: 'x.x.xxx.x.x.x.xx', o: '..............x.' },
  dnb:       { k: 'x.........x.....', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.', o: '......x.......x.' },
  dnbB:      { k: 'x.......x.x.....', s: '....x.......x..x', h: 'x.x.x.x.x.x.x.x.' },
  breaks:    { k: 'x..x..x...x.x...', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' },
};

// Bass: digits / o = note (semitones above chord root, o = octave), - = sustain, . = rest
export const BASS_PATTERNS = {
  off:      '................',
  pulse8:   '0-0-0-0-0-0-0-0-',
  octave:   '0-o-0-o-0-o-0-o-',
  drive16:  '0000000000000000',
  gallop:   '0-00-0-00-0-00-0',
  half:     '0-------0-------',
  whole:    '0---------------',
  offbeat:  '..0-..0-..0-..0-',
  trap808:  '0---------..0-..',
  trap808B: '0-----..0-----7-',
  dnb:      '0--.0--.0-..0-0-',
  dnbB:     '0--.0-.0--0-..0-',
};

/**
 * Melodies: 4-bar phrases (one bar per chord of the progression). Each note is
 * [bar, step, scaleDegree, lengthInSteps]; degree 0 = key root, 7 = octave above.
 */
const NEON_LEAD_A = [
  [0, 0, 4, 2], [0, 2, 7, 2], [0, 4, 8, 2], [0, 6, 9, 4], [0, 10, 8, 2], [0, 12, 7, 4],
  [1, 0, 9, 2], [1, 2, 7, 2], [1, 4, 5, 4], [1, 8, 6, 2], [1, 10, 7, 2], [1, 12, 9, 4],
  [2, 0, 6, 2], [2, 2, 4, 2], [2, 4, 2, 4], [2, 8, 3, 2], [2, 10, 4, 2], [2, 12, 6, 4],
  [3, 0, 8, 2], [3, 2, 7, 2], [3, 4, 6, 4], [3, 8, 3, 2], [3, 10, 4, 2], [3, 12, 6, 2], [3, 14, 7, 2],
];
const NEON_LEAD_A2 = [
  [0, 0, 7, 2], [0, 2, 9, 2], [0, 4, 8, 2], [0, 6, 7, 2], [0, 8, 4, 4], [0, 12, 5, 2], [0, 14, 6, 2],
  [1, 0, 7, 4], [1, 4, 9, 4], [1, 8, 11, 2], [1, 10, 9, 2], [1, 12, 7, 4],
  [2, 0, 6, 2], [2, 2, 7, 2], [2, 4, 9, 4], [2, 8, 7, 2], [2, 10, 6, 2], [2, 12, 4, 4],
  [3, 0, 3, 2], [3, 2, 4, 2], [3, 4, 6, 4], [3, 8, 8, 2], [3, 10, 7, 2], [3, 12, 6, 4],
];
const NEON_LEAD_B = [
  [0, 0, 7, 6], [0, 8, 4, 6],
  [1, 0, 9, 8], [1, 8, 8, 4], [1, 12, 7, 4],
  [2, 0, 6, 6], [2, 8, 4, 6],
  [3, 0, 3, 8], [3, 8, 4, 8],
];

const OVER_LEAD_A = [
  [0, 0, 7, 1], [0, 2, 7, 1], [0, 3, 9, 1], [0, 6, 7, 2], [0, 8, 4, 2], [0, 10, 7, 2], [0, 12, 6, 2], [0, 14, 5, 2],
  [1, 0, 3, 1], [1, 2, 3, 1], [1, 3, 5, 1], [1, 6, 3, 2], [1, 8, 7, 2], [1, 10, 5, 2], [1, 12, 3, 4],
  [2, 0, 5, 1], [2, 2, 5, 1], [2, 3, 7, 1], [2, 6, 5, 2], [2, 8, 9, 2], [2, 10, 7, 2], [2, 12, 5, 2], [2, 14, 6, 2],
  [3, 0, 6, 1], [3, 2, 6, 1], [3, 3, 8, 1], [3, 6, 6, 2], [3, 8, 4, 2], [3, 10, 6, 2], [3, 12, 8, 2], [3, 14, 9, 2],
];
const OVER_LEAD_A2 = [
  ...OVER_LEAD_A.filter((n) => n[0] < 3),
  [3, 0, 11, 2], [3, 2, 9, 2], [3, 4, 8, 2], [3, 6, 7, 2], [3, 8, 6, 4], [3, 12, 8, 2], [3, 14, 9, 2],
];
const OVER_LEAD_B = [
  [0, 0, 7, 8], [0, 8, 4, 8],
  [1, 0, 5, 8], [1, 8, 3, 8],
  [2, 0, 5, 12], [2, 12, 6, 4],
  [3, 0, 8, 8], [3, 8, 7, 8],
];

const MIDNIGHT_PLUCK_A = [
  [0, 0, 7, 3], [0, 3, 9, 3], [0, 6, 7, 2], [0, 10, 4, 4],
  [1, 0, 5, 3], [1, 3, 7, 3], [1, 6, 5, 2], [1, 10, 2, 4],
  [2, 0, 2, 3], [2, 3, 4, 3], [2, 6, 6, 2], [2, 10, 4, 6],
  [3, 0, 6, 3], [3, 3, 8, 3], [3, 6, 6, 2], [3, 8, 4, 2], [3, 10, 3, 2], [3, 12, 1, 4],
];
const MIDNIGHT_LEAD_B = [
  [0, 0, 7, 4], [0, 4, 9, 2], [0, 6, 11, 6], [0, 12, 9, 4],
  [1, 0, 7, 4], [1, 4, 5, 2], [1, 6, 7, 6], [1, 12, 4, 4],
  [2, 0, 4, 4], [2, 4, 6, 2], [2, 6, 9, 6], [2, 12, 8, 4],
  [3, 0, 6, 4], [3, 4, 4, 2], [3, 6, 3, 6], [3, 12, 1, 4],
];

const NOVA_LEAD_A = [
  [0, 0, 7, 2], [0, 4, 9, 2], [0, 6, 7, 2], [0, 8, 4, 2], [0, 12, 5, 2], [0, 14, 4, 2],
  [1, 0, 2, 4], [1, 6, 4, 2], [1, 8, 5, 4], [1, 12, 7, 4],
  [2, 0, 3, 2], [2, 4, 5, 2], [2, 6, 7, 2], [2, 8, 9, 2], [2, 12, 7, 2], [2, 14, 5, 2],
  [3, 0, 6, 4], [3, 6, 8, 2], [3, 8, 7, 4], [3, 12, 4, 4],
];
const NOVA_LEAD_B = [
  [0, 0, 7, 8], [0, 8, 5, 8],
  [1, 0, 4, 16],
  [2, 0, 3, 8], [2, 8, 5, 8],
  [3, 0, 6, 8], [3, 8, 4, 8],
];

export const TRACKS = [
  {
    id: 'neon-pulse',
    title: 'Neon Pulse',
    style: 'Synthwave',
    bpm: 124,
    root: 57, // A3
    scale: 'minor',
    progression: [0, 5, 2, 6], // Am F C G
    colors: ['#ff2d95', '#7c4dff'],
    swing: 0,
    leads: { A: NEON_LEAD_A, A2: NEON_LEAD_A2, B: NEON_LEAD_B },
    sections: [
      { name: 'intro', bars: 8, energy: 0.3, drums: 'intro', bass: 'off', pad: true, arp: 'up8' },
      { name: 'build', bars: 8, energy: 0.55, drums: 'build', bass: 'pulse8', pad: true, arp: 'up16', riser: true },
      { name: 'drop', bars: 16, energy: 1.0, drums: 'full', bass: 'octave', arp: 'up16', lead: ['A', 'A', 'A', 'A2'], impact: true },
      { name: 'break', bars: 8, energy: 0.35, drums: 'half', bass: 'pulse8', pad: true, lead: ['B', 'B'], walls: true },
      { name: 'build', bars: 8, energy: 0.6, drums: 'build', bass: 'pulse8', arp: 'up16', riser: true, walls: true },
      { name: 'drop', bars: 24, energy: 1.0, drums: 'fullClap', bass: 'octave', arp: 'up16', lead: ['A', 'A2', 'A', 'A2', 'A', 'A2'], impact: true },
      { name: 'outro', bars: 8, energy: 0.35, drums: 'intro', bass: 'off', pad: true, arp: 'up8' },
    ],
  },
  {
    id: 'overdrive',
    title: 'Overdrive',
    style: 'Big-room EDM',
    bpm: 150,
    root: 52, // E3
    scale: 'minor',
    progression: [0, 3, 5, 6], // Em Am C D
    colors: ['#ffd166', '#ff3b3b'],
    swing: 0,
    leads: { A: OVER_LEAD_A, A2: OVER_LEAD_A2, B: OVER_LEAD_B },
    leadOpts: { bright: true, detune: 12 },
    sections: [
      { name: 'intro', bars: 8, energy: 0.4, drums: 'intro', bass: 'off', stabs: 'offbeat', pad: true },
      { name: 'build', bars: 8, energy: 0.6, drums: 'build', bass: 'pulse8', stabs: 'offbeat', riser: true },
      { name: 'drop', bars: 16, energy: 1.0, drums: 'fullHard', bass: 'drive16', lead: ['A', 'A', 'A', 'A2'], impact: true },
      { name: 'break', bars: 8, energy: 0.3, drums: 'half', bass: 'half', pad: true, lead: ['B', 'B'], walls: true },
      { name: 'bridge', bars: 8, energy: 0.5, drums: 'breaks', bass: 'gallop', stabs: 'offbeat', walls: true },
      { name: 'build', bars: 8, energy: 0.65, drums: 'build', bass: 'pulse8', stabs: 'offbeat', riser: true },
      { name: 'drop', bars: 24, energy: 1.0, drums: 'fullHard', bass: 'drive16', lead: ['A', 'A2', 'A', 'A2', 'A', 'A2'], impact: true },
      { name: 'outro', bars: 4, energy: 0.3, drums: 'kickOnly', bass: 'off', pad: true },
    ],
  },
  {
    id: 'midnight-drive',
    title: 'Midnight Drive',
    style: 'Chill / halftime',
    bpm: 92,
    root: 50, // D3
    scale: 'minor',
    progression: [0, 5, 2, 6], // Dm Bb F C
    colors: ['#19e6ff', '#2b6cff'],
    swing: 0.12,
    bassPreset: '808',
    leads: { A: MIDNIGHT_PLUCK_A, B: MIDNIGHT_LEAD_B },
    leadOpts: { detune: 6, delay: 0.55 },
    sections: [
      { name: 'intro', bars: 4, energy: 0.3, drums: 'hatsOnly', bass: 'off', pad: true },
      { name: 'verse', bars: 8, energy: 0.5, drums: 'halftime', bass: 'trap808', pluck: ['A', 'A'] },
      { name: 'chorus', bars: 8, energy: 0.8, drums: 'halftimeB', bass: 'trap808B', lead: ['B', 'B'], pluck: ['A', 'A'] },
      { name: 'verse', bars: 8, energy: 0.5, drums: 'halftime', bass: 'trap808', pluck: ['A', 'A'], pad: true },
      { name: 'chorus', bars: 8, energy: 0.85, drums: 'halftimeB', bass: 'trap808B', lead: ['B', 'B'], pluck: ['A', 'A'] },
      { name: 'bridge', bars: 4, energy: 0.3, drums: 'hatsOnly', bass: 'whole', pad: true, walls: true },
      { name: 'chorus', bars: 8, energy: 0.9, drums: 'halftimeB', bass: 'trap808B', lead: ['B', 'B'], pluck: ['A', 'A'], impact: true },
      { name: 'outro', bars: 4, energy: 0.3, drums: 'hatsOnly', bass: 'off', pad: true },
    ],
  },
  {
    id: 'supernova',
    title: 'Supernova',
    style: 'Drum & bass',
    bpm: 172,
    root: 55, // G3
    scale: 'minor',
    progression: [0, 5, 3, 6], // Gm Eb Cm F
    colors: ['#b388ff', '#19e6ff'],
    swing: 0,
    bassPreset: 'reese',
    leads: { A: NOVA_LEAD_A, B: NOVA_LEAD_B },
    leadOpts: { bright: true, detune: 10, delay: 0.3 },
    sections: [
      { name: 'intro', bars: 8, energy: 0.35, drums: 'hatsOnly', bass: 'off', pad: true, arp: 'up8' },
      { name: 'build', bars: 8, energy: 0.6, drums: 'breaks', bass: 'half', pad: true, arp: 'up8', riser: true },
      { name: 'drop', bars: 32, energy: 1.0, drums: 'dnb', bass: 'dnb', arp: 'up8', lead: ['A', 'A', 'A', 'A', 'A', 'A', 'A', 'A'], impact: true },
      { name: 'break', bars: 16, energy: 0.35, drums: 'half', bass: 'whole', pad: true, lead: ['B', 'B', 'B', 'B'], walls: true },
      { name: 'drop', bars: 32, energy: 1.0, drums: 'dnbB', bass: 'dnbB', arp: 'up8', lead: ['A', 'A', 'A', 'A', 'A', 'A', 'A', 'A'], impact: true },
      { name: 'outro', bars: 8, energy: 0.3, drums: 'hatsOnly', bass: 'off', pad: true },
    ],
  },
];

export function getTrack(id) { return TRACKS.find((t) => t.id === id) || TRACKS[0]; }
