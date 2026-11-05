// End-to-end smoke test in headless Chromium (software WebGL):
//   node scripts/serve.mjs 8123 &  then  node test/e2e.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || 'playwright');
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE || 'http://localhost:8123';
const OUT = 'test/output';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 960, height: 600 }, deviceScaleFactor: 1 });
const render = (on) => page.evaluate((v) => { window.__pm.app.renderEnabled = v; }, on);
const shot = async (name) => { await render(true); await page.waitForTimeout(1500); await page.screenshot({ path: path.join(OUT, name) }); await render(false); };
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

let failed = 0;
const check = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) failed++; };

await page.goto(BASE + '/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => window.__pm && window.__pm.game, null, { timeout: 20000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(OUT, '01-landing.png') });
await render(false);
check(await page.locator('#trackList .track').count() === 4, 'four built-in tracks listed');

// Desktop preview → menu in 3D.
await page.click('#enterDesktop');
await page.waitForTimeout(1200);
check(await page.evaluate(() => window.__pm.game.state) === 'menu', 'desktop preview shows the 3D menu');
await shot('02-menu.png');

// Click the START button in 3D with the mouse: project the button to screen space.
const startPos = await page.evaluate(() => {
  const g = window.__pm.game; const b = g.startButton.mesh;
  const THREE_V = b.getWorldPosition(new (b.position.constructor)());
  const v = THREE_V.project(g.camera);
  return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight };
});
await page.mouse.move(startPos.x, startPos.y);
await page.waitForTimeout(200);
await page.mouse.down(); await page.waitForTimeout(80); await page.mouse.up();
await page.waitForTimeout(1500);
let state = await page.evaluate(() => window.__pm.game.state);
check(state === 'countdown' || state === 'playing' || state === 'loading', `start button works (state=${state})`);

// Let the bot play for a while (logic only, then one rendered frame for the screenshot).
await page.waitForTimeout(9000);
const run = await page.evaluate(() => { const g = window.__pm.game; return { state: g.state, songTime: g.songTime, ...g.run, active: g.obstacles.activeCount() }; });
await shot('03-playing.png');
console.log('    run:', JSON.stringify({ state: run.state, songTime: +run.songTime.toFixed(2), score: run.score, hits: run.hits, misses: run.misses, wrong: run.wrong, bombs: run.bombs, combo: run.combo, active: run.active, perfect: run.perfect, great: run.great, good: run.good, weak: run.weak }));
check(run.state === 'playing', 'song is playing');
check(run.hits >= 5, 'bot landed punches');
check(run.score > 0, 'score increases');
check(run.misses <= 2, `bot rarely misses (${run.misses} misses)`);

// Pause / resume.
await page.keyboard.press('p');
await page.waitForTimeout(300);
check(await page.evaluate(() => window.__pm.game.state) === 'paused', 'pause works');
await shot('04-paused.png');
await page.evaluate(() => window.__pm.game.resume());
await page.waitForTimeout(1600);
check(await page.evaluate(() => window.__pm.game.state) === 'playing', 'resume works');

// Analyse the synthetic 128 BPM song through the real library path.
const bytes = fs.readFileSync('test/fixtures/beat128.mp3');
const analysis = await page.evaluate(async (b64) => {
  const bin = atob(b64); const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const file = new File([arr], 'Test Beat 128.mp3', { type: 'audio/mpeg' });
  const created = await window.__pm.library.addFiles([file]);
  const e = created[0];
  return { status: e.status, bpm: e.analysis ? e.analysis.bpm : 0, beats: e.analysis ? e.analysis.beats.slice(0, 6) : [], hits: e.analysis ? e.analysis.hits.length : 0, subtitle: e.subtitle };
}, bytes.toString('base64'));
console.log('    analysis:', JSON.stringify(analysis));
check(analysis.status === 'ready', 'custom song analysed');
check(Math.abs(analysis.bpm - 128) < 1.5, `tempo detected ≈128 (got ${analysis.bpm.toFixed(2)})`);
const phaseErr = analysis.beats.map((b) => { const k = Math.round((b - 0.35) / (60 / 128)); return Math.abs(b - (0.35 + k * 60 / 128)); });
check(phaseErr.length && Math.max(...phaseErr) < 0.05, `beat phase aligned (max err ${(Math.max(...phaseErr) * 1000).toFixed(0)} ms)`);

// Play the custom song for a few seconds.
await page.evaluate(async () => { const g = window.__pm.game; const t = window.__pm.library.tracks.find((x) => x.kind === 'custom'); g.selectTrack(t.id); await g.startSong(); });
await page.waitForTimeout(8000);
const run2 = await page.evaluate(() => { const g = window.__pm.game; return { state: g.state, hits: g.run.hits, misses: g.run.misses, score: g.run.score, track: g.track.title }; });
console.log('    custom run:', JSON.stringify(run2));
check(run2.state === 'playing' && run2.hits > 0, 'custom song plays and scores');
await shot('05-custom.png');

// Finish quickly: jump near the end and check the results flow.
await page.evaluate(() => { const g = window.__pm.game; g.songStart -= (g.map.duration - g.songTime - 1.5); });
await page.waitForTimeout(3500);
state = await page.evaluate(() => window.__pm.game.state);
check(state === 'results' || state === 'failed', `results screen reached (${state})`);
await shot('06-results.png');

const realErrors = errors.filter((e) => !/favicon|Autoplay|AudioContext was not allowed|fonts.googleapis|fonts.gstatic|ERR_/.test(e));
check(realErrors.length === 0, `no console errors (${realErrors.length})`);
for (const e of realErrors.slice(0, 15)) console.log('    ', e);
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nAll e2e checks passed');
process.exit(failed ? 1 : 0);
