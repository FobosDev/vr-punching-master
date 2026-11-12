# Punching Master VR

A rhythm boxing game for **Meta Quest 3** that runs straight from the browser. Neon targets fly
at you in time with the music: punch the pink ones with your left glove, the cyan ones with
your right, dodge the red walls, don't touch the bombs. Play inside a synthwave arena in VR or
in your own room with **passthrough (mixed reality)**.

No app store, no install: open the page in the Quest Browser and press *Enter VR*.

## Features

- **WebXR, no build step** – plain ES modules + Three.js (vendored), works from any static host.
- **VR and passthrough** – a full synthwave arena, or the same lane floating in your living room.
  Switch between the two from inside the headset.
- **Built-in soundtrack** – four tracks (synthwave, big-room EDM, chill halftime, drum & bass)
  generated live by a Web Audio synth engine, so beat maps are sample-accurate.
- **Bring your own MP3** – songs are decoded and analysed *on the device* (onset detection,
  tempo estimation, dynamic-programming beat tracking) and turned into a playable map. Nothing
  is uploaded anywhere.
- **Four difficulties** – from "gold targets take either glove" to relentless expert streams
  with bombs, lean walls and duck walls. Maps follow the energy of the music.
- **Real punches count** – swept collision tests with punch-speed detection, timing judgement
  (Perfect / Great / Good / Weak), combo multipliers, health, local high scores.
- **Juice** – GPU particle bursts, shards, shockwaves, glove trails, haptics, music-reactive
  environment (sun, towers, rings and floor pulse with the track), all tuned for 90 Hz on Quest.
- **Controllers or bare hands** – hand tracking works too (pinch to select, pinch both hands
  for a second to pause).
- **Desktop preview** – an auto-play demo that runs without a headset (also used by the tests).

## Play it

### On a Quest (or any WebXR headset)

WebXR requires a secure origin (`https://` or `localhost`). Pick one:

1. **GitHub Pages (easiest).** This repository ships its own deploy workflow
   (`.github/workflows/pages.yml`), so there is nothing to build:
   - In *Settings → Pages → Build and deployment*, set **Source** to **GitHub Actions**.
     Don't click *Configure* on the suggested Jekyll or Static HTML workflows.
   - Every push to the default branch tests and publishes the game. To publish by hand, open
     *Actions → Deploy to GitHub Pages → Run workflow*.
   - The game appears at `https://<user>.github.io/<repository>/` (shown on the workflow run
     and in *Settings → Pages*). Open that address in the Quest Browser.
2. **Local dev server + ADB.** Run the server on your computer and forward the port to the
   headset so it is reachable as `localhost` (which browsers treat as secure):

   ```bash
   npm start
   ```

   ```bash
   adb reverse tcp:8080 tcp:8080
   ```

   Then open `http://localhost:8080` in the Quest Browser.
3. Any static host with HTTPS, or a tunnel such as `cloudflared` / `ngrok` pointed at port 8080.

### On a desktop browser

```bash
npm start
```

Open `http://localhost:8080` and click **Desktop preview** to watch the auto-play demo. Use
the mouse to click the 3D menus, drag to look around, `P` pauses, `Esc` leaves.

## How to play

| Thing | What to do |
| --- | --- |
| Pink target | punch with the **left** glove |
| Cyan target | punch with the **right** glove |
| Gold target | either glove |
| Red spiked bomb | don't touch it |
| Red wall | lean (left/right) or duck (crouch) out of its way |

Hit targets when they cross the glowing **strike line** in front of you. Speed matters: a real
punch scores, a gentle touch is "weak", a resting glove does nothing. Combos of 10 / 25 / 50
multiply your score ×2 / ×4 / ×8. Losing all energy fails the song unless *No-fail* is on.

Controls: point at a menu and pull the trigger; **B / Y** pauses; click the thumbstick in the
menu to recenter. With hand tracking: pinch to select, pinch with both hands for a second to
pause. The lane is centred on where you stand and face when a song starts.

### Adding your own music

On the start page press **+ Add your MP3** (MP3, M4A, OGG, WAV, FLAC – whatever the browser can
decode). The song is analysed on the device in a few seconds and shows up in the list with
its detected tempo. On the Quest, files you downloaded or copied to the headset appear in the
file picker. Up to eight songs can be loaded at once (they live in memory for the session).

If targets feel early or late on your setup, adjust **Audio offset** in the settings (negative
= targets later, positive = targets earlier).

## Project layout

```
index.html, style.css        start page (2D)
src/main.js                  renderer, XR sessions, desktop controls
src/Game.js                  state machine, scoring, menus, demo bot
src/Input.js                 controllers / hands / haptics
src/Library.js               built-in + user songs
src/audio/AudioEngine.js     Web Audio buses, analyser, synthesised SFX
src/audio/Synth.js           instruments for the built-in soundtrack
src/audio/tracks.js          the four built-in compositions (patterns, melodies, arrangement)
src/audio/Sequencer.js       compiles a track into timed events and plays it
src/audio/BeatAnalyzer.js    MP3 analysis: onsets, tempo, beat tracking
src/beatmap/Generator.js     turns an analysis into notes, bombs and walls per difficulty
src/world/*                  environment, obstacles, gloves, effects, shaders
src/ui/*                     world-space UI kit, HUD, 2D page bindings
vendor/three/                Three.js r187 (MIT)
scripts/serve.mjs            static dev server
test/                        node unit test, Playwright end-to-end smoke test
```

## Development

```bash
npm test
```

runs the pure-logic checks (track compiler + beat-map generator). The end-to-end test drives
the desktop preview in headless Chromium, lets the bot play, analyses a synthetic 128 BPM song
and checks the results flow:

```bash
npm i -D playwright && npx playwright install chromium
```

```bash
node scripts/serve.mjs 8123 & npm run test:e2e
```

Screenshots land in `test/output/`.

## Notes on the design

- Hit detection compares a swept segment of each glove (previous → current position) against
  the swept position of every target in the strike window, so fast punches at 90 Hz never
  tunnel through a target.
- The game clock is the AudioContext clock (minus output latency, plus the user offset); target
  positions are derived from song time every frame, so visuals can never drift from the music.
  Pausing suspends the context, which freezes the clock and everything scheduled on it.
- Built-in tracks and user songs share one analysis format (`beats`, `hits`, `energy`,
  `sections`), so the same generator produces maps for both.
- Rendering is deliberately post-processing free: glow is faked with additive fresnel shells,
  sprites and emissive colours under ACES tone mapping, and all obstacles are instanced
  (one draw call per layer). This keeps the Quest 3 at its native refresh rate.

## License

MIT. Three.js is © three.js authors, MIT licensed (see `vendor/three/LICENSE`).
