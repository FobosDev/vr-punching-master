// Generates a synthetic 128 BPM test song (kick on beats, hats on off-beats, bass) as WAV and
// encodes it to MP3 with ffmpeg. Used by the e2e test to validate the beat analyser.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const sr = 44100, bpm = 128, seconds = 30;
const n = sr * seconds;
const beat = 60 / bpm;
const out = new Float32Array(n);
const firstBeat = 0.35; // deliberate offset: the analyser must find the phase
for (let b = 0; firstBeat + b * beat < seconds; b++) {
  const t0 = firstBeat + b * beat;
  const start = Math.floor(t0 * sr);
  // kick
  for (let i = 0; i < sr * 0.25; i++) {
    const t = i / sr;
    const f = 150 * Math.exp(-t * 30) + 45;
    out[start + i] += Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 12) * 0.9;
  }
  // snare on 2 and 4
  if (b % 2 === 1) for (let i = 0; i < sr * 0.15; i++) { const t = i / sr; out[start + i] += (Math.random() * 2 - 1) * Math.exp(-t * 25) * 0.4; }
  // hat on the off-beat
  const hs = Math.floor((t0 + beat / 2) * sr);
  for (let i = 0; i < sr * 0.04 && hs + i < n; i++) { const t = i / sr; out[hs + i] += (Math.random() * 2 - 1) * Math.exp(-t * 90) * 0.25; }
  // bass note
  const note = [55, 55, 65.4, 49][Math.floor(b / 4) % 4];
  for (let i = 0; i < sr * beat * 0.9 && start + i < n; i++) { const t = i / sr; out[start + i] += Math.sin(2 * Math.PI * note * t) * 0.25 * Math.min(1, t * 50) * Math.exp(-t * 2); }
}
// pad
for (let i = 0; i < n; i++) out[i] += Math.sin(2 * Math.PI * 220 * i / sr) * 0.05 + Math.sin(2 * Math.PI * 330 * i / sr) * 0.04;
const pcm = Buffer.alloc(n * 2);
for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(out[i] * 20000))), i * 2);
const header = Buffer.alloc(44);
header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8); header.write('fmt ', 12);
header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(sr, 24); header.writeUInt32LE(sr * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
fs.mkdirSync('test/fixtures', { recursive: true });
fs.writeFileSync('test/fixtures/beat128.wav', Buffer.concat([header, pcm]));
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', 'test/fixtures/beat128.wav', '-b:a', '128k', 'test/fixtures/beat128.mp3']);
console.log('wrote test/fixtures/beat128.wav and .mp3');
