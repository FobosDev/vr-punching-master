// Game orchestration: state machine (menu → countdown → playing → results), scoring, hit
// resolution, in-VR menus, the demo bot and the glue between audio clock and visuals.

import * as THREE from 'three';
import { Environment } from './world/Environment.js';
import { Obstacles } from './world/Obstacles.js';
import { Gloves } from './world/Gloves.js';
import { Effects } from './world/Effects.js';
import { COLORS } from './world/Materials.js';
import { HUD } from './ui/HUD.js';
import { UIPanel, UIManager } from './ui/Panel.js';
import { Input } from './Input.js';
import { MusicPlayer } from './audio/Sequencer.js';
import { generateBeatmap, DIFFICULTIES, DIFFICULTY_ORDER } from './beatmap/Generator.js';
import { getBest, submitScore } from './util/storage.js';
import { formatScore, clamp, lerp } from './util/math.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _inv = new THREE.Matrix4();

const COMBO_MILESTONES = [10, 25, 50, 100, 150, 200, 300, 400, 500];

export class Game {
  constructor({ renderer, scene, camera, audio, settings, library, onEvent }) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.audio = audio;
    this.settings = settings;
    this.library = library;
    this.onEvent = onEvent || (() => {});

    this.state = 'idle';
    this.xrMode = 'none'; // 'none' | 'desktop' | 'vr' | 'ar'
    this.selectedTrackId = settings.trackId;
    this.difficulty = DIFFICULTY_ORDER.includes(settings.difficulty) ? settings.difficulty : 'normal';
    this.headY = 1.6;
    this.floorMode = 'floor';
    this.pendingRecenter = 0;
    this.listOffset = 0;
    this.clock = 0;

    this.laneRoot = new THREE.Group();
    scene.add(this.laneRoot);
    this.environment = new Environment(scene, this.laneRoot);
    this.obstacles = new Obstacles(this.laneRoot);
    this.gloves = new Gloves(scene);
    this.effects = new Effects(this.laneRoot, camera);
    this.hud = new HUD(this.laneRoot);
    this.ui = new UIManager(this.laneRoot, audio);
    this.input = new Input(renderer, scene);
    this.music = new MusicPlayer(audio);
    this.customSource = null;

    this.obstacles.onMiss = (note, pos) => this._onMiss(note, pos);
    this.input.onSelect = (slot, phase) => this._onSelect(slot, phase);
    this.input.onButton = (slot, name, pressed) => this._onButton(slot, name, pressed);

    this.run = null;
    this.map = null;
    this.track = null;
    this.songStart = 0;
    this.countTicks = [];
    this.beatIdx = 0;
    this.resumeAt = 0;
    this.mouse = { active: false, ndc: new THREE.Vector2(), down: false };

    this._buildMenus();
    this.applySettings();
  }

  // ------------------------------------------------------------------ settings
  applySettings() {
    const s = this.settings;
    this.audio.setMusicVolume(s.musicVolume);
    this.audio.setSfxVolume(s.sfxVolume);
    this.gloves.setSwapped(s.swapHands);
    this.environment.setReducedMotion(s.reducedMotion);
    this._refreshSettingsPanel();
  }

  setDifficulty(d) {
    if (!DIFFICULTIES[d]) return;
    this.difficulty = d;
    this.settings.difficulty = d;
    this.onEvent('settingsChanged');
    this._refreshMainPanel();
  }

  selectTrack(id) {
    if (!this.library.get(id)) return;
    this.selectedTrackId = id;
    this.settings.trackId = id;
    this.onEvent('settingsChanged');
    this.onEvent('trackSelected', id);
    this._refreshMainPanel();
  }

  // ------------------------------------------------------------------ modes
  /** Called by the app when an XR session starts/ends or desktop preview toggles. */
  setXRMode(mode) {
    this.xrMode = mode;
    this.stopSong();
    if (mode === 'none') {
      this.state = 'idle';
      this._hideAllPanels();
      this.hud.setVisible(false);
      this.environment.setMode('vr');
      this.laneRoot.position.set(0, 0, 0);
      this.laneRoot.rotation.set(0, 0, 0);
      this.laneRoot.updateMatrixWorld(true);
      for (const key of ['left', 'right', 'mouse']) this.ui.hidePointer(key);
      this.gloves.L.tracked = false; this.gloves.R.tracked = false;
    } else {
      this.environment.setMode(mode === 'ar' ? 'ar' : 'vr');
      this.pendingRecenter = mode === 'desktop' ? 1 : 6;
      this.showMenu();
    }
    this.onEvent('stateChange', this.state);
  }

  recenter() {
    const cam = this.camera;
    cam.getWorldDirection(_dir);
    const yaw = Math.atan2(-_dir.x, -_dir.z);
    cam.getWorldPosition(_v);
    const floorY = this.floorMode === 'local' ? _v.y - 1.6 : 0; // 'local' spaces have no floor: assume a standing player
    this.laneRoot.position.set(_v.x, floorY, _v.z);
    this.laneRoot.rotation.set(0, yaw, 0);
    this.laneRoot.updateMatrixWorld(true);
    this._updateHeadHeight(true);
  }

  _updateHeadHeight(force = false) {
    this.camera.getWorldPosition(_v);
    let y = _v.y - this.laneRoot.position.y;
    if (!(y > 0.6 && y < 2.4)) y = 1.6;
    if (force) this.headY = y; else this.headY = lerp(this.headY, y, 0.02);
    this.obstacles.setLayout(this.headY);
    this.environment.setStrikeZone((this.obstacles.rowsY[0] + this.obstacles.rowsY[2]) / 2, 0.72, 0.46, this.obstacles.hitZ);
    this.hud.setHeight(this.headY);
    const py = clamp(this.headY - 0.15, 0.9, 1.9);
    for (const p of [this.mainPanel, this.settingsPanel, this.pausePanel, this.resultsPanel, this.loadingPanel]) p.group.position.y = py;
  }

  // ------------------------------------------------------------------ menus
  _buildMenus() {
    const ui = this.ui;
    const Z = -1.9;
    const place = (panel) => { panel.group.position.set(0, 1.45, Z); ui.add(panel); };

    // Main menu -----------------------------------------------------------
    const main = new UIPanel({ width: 1.5, height: 1.0, title: 'PUNCHING MASTER', subtitle: 'Pick a song, pick a difficulty, put your gloves up.' });
    this.mainPanel = main;
    this.trackButtons = [];
    for (let i = 0; i < 5; i++) {
      const b = main.addButton({ id: `track${i}`, x: -0.37, y: 0.19 - i * 0.108, w: 0.7, h: 0.098, label: '', sub: '', align: 'left', fontSize: 0.04, onClick: () => { const t = this._visibleTracks()[i]; if (t) this.selectTrack(t.id); } });
      this.trackButtons.push(b);
    }
    this.listUp = main.addButton({ id: 'up', x: 0.03, y: 0.19, w: 0.075, h: 0.098, label: '▲', fontSize: 0.035, onClick: () => { this.listOffset = Math.max(0, this.listOffset - 1); this._refreshMainPanel(); } });
    this.listDown = main.addButton({ id: 'down', x: 0.03, y: -0.242, w: 0.075, h: 0.098, label: '▼', fontSize: 0.035, onClick: () => { this.listOffset = Math.min(Math.max(0, this.library.tracks.length - 5), this.listOffset + 1); this._refreshMainPanel(); } });
    main.addLabel('pageInfo', { x: 0.03, y: -0.03, text: '', size: 0.028, color: 'rgba(200,195,240,0.7)' });
    main.addLabel('diffTitle', { x: 0.42, y: 0.265, text: 'DIFFICULTY', size: 0.03, color: 'rgba(200,195,240,0.75)', weight: 700 });
    this.diffButtons = {};
    DIFFICULTY_ORDER.forEach((d, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      this.diffButtons[d] = main.addButton({ id: `diff-${d}`, x: 0.29 + col * 0.265, y: 0.19 - row * 0.1, w: 0.25, h: 0.09, label: DIFFICULTIES[d].label, fontSize: 0.04, onClick: () => this.setDifficulty(d) });
    });
    main.addLabel('best', { x: 0.42, y: 0.0, text: '', size: 0.03, color: '#ffd166', weight: 600, maxWidth: 0.5 });
    main.addLabel('diffHint', { x: 0.42, y: -0.045, text: '', size: 0.026, color: 'rgba(200,195,240,0.75)', maxWidth: 0.52 });
    this.startButton = main.addButton({ id: 'start', x: 0.42, y: -0.145, w: 0.52, h: 0.13, label: 'START', style: 'primary', fontSize: 0.06, onClick: () => this.startSong() });
    main.addButton({ id: 'settings', x: 0.29, y: -0.265, w: 0.25, h: 0.08, label: 'Settings', fontSize: 0.034, onClick: () => this.showSettings() });
    this.modeButton = main.addButton({ id: 'mode', x: 0.555, y: -0.265, w: 0.25, h: 0.08, label: 'Passthrough', style: 'accent', fontSize: 0.034, onClick: () => this.onEvent('switchMode', this.xrMode === 'ar' ? 'vr' : 'ar') });
    main.addButton({ id: 'recenter', x: -0.6, y: -0.405, w: 0.26, h: 0.072, label: 'Recenter', style: 'ghost', fontSize: 0.03, onClick: () => this.recenter() });
    this.exitButton = main.addButton({ id: 'exit', x: -0.31, y: -0.405, w: 0.26, h: 0.072, label: 'Exit VR', style: 'ghost', fontSize: 0.03, onClick: () => this.onEvent('exitXR') });
    main.addLabel('hint', { x: 0.33, y: -0.405, text: 'Point & pull the trigger  ·  B / Y pauses  ·  pinch with bare hands', size: 0.024, color: 'rgba(200,195,240,0.6)' });
    place(main);

    // Settings --------------------------------------------------------------
    const st = new UIPanel({ width: 1.5, height: 1.0, title: 'SETTINGS', subtitle: 'Saved on this device.' });
    this.settingsPanel = st;
    const rows = [
      { key: 'audioOffsetMs', label: 'Audio offset', y: 0.2, step: 10, min: -300, max: 300, fmt: (v) => `${v > 0 ? '+' : ''}${v} ms` },
      { key: 'musicVolume', label: 'Music volume', y: 0.1, step: 0.1, min: 0, max: 1, fmt: (v) => `${Math.round(v * 100)}%` },
      { key: 'sfxVolume', label: 'Effects volume', y: 0.0, step: 0.1, min: 0, max: 1, fmt: (v) => `${Math.round(v * 100)}%` },
    ];
    this.settingRows = rows;
    for (const r of rows) {
      st.addLabel(`lbl-${r.key}`, { x: -0.66, y: r.y, text: r.label, size: 0.036, align: 'left' });
      st.addButton({ id: `dec-${r.key}`, x: -0.1, y: r.y, w: 0.09, h: 0.08, label: '−', fontSize: 0.045, onClick: () => this._adjustSetting(r, -1) });
      st.addLabel(`val-${r.key}`, { x: 0.1, y: r.y, text: '', size: 0.036, color: '#19e6ff', weight: 700 });
      st.addButton({ id: `inc-${r.key}`, x: 0.3, y: r.y, w: 0.09, h: 0.08, label: '+', fontSize: 0.045, onClick: () => this._adjustSetting(r, +1) });
    }
    st.addLabel('offsetHint', { x: 0.62, y: 0.2, text: 'Targets early? lower it.\nTargets late? raise it.', size: 0.024, color: 'rgba(200,195,240,0.7)', align: 'center' });
    const toggles = [
      ['noFail', 'No-fail mode'], ['haptics', 'Vibration'], ['reducedMotion', 'Reduced motion'], ['swapHands', 'Swap glove colours'], ['autoplay', 'Auto-play bot'],
    ];
    this.toggleButtons = {};
    toggles.forEach(([key, label], i) => {
      const col = i % 2, row = Math.floor(i / 2);
      this.toggleButtons[key] = st.addButton({ id: `tg-${key}`, x: -0.37 + col * 0.54, y: -0.13 - row * 0.1, w: 0.5, h: 0.085, label, fontSize: 0.034, onClick: () => { this.settings[key] = !this.settings[key]; this.applySettings(); this.onEvent('settingsChanged'); } });
    });
    st.addButton({ id: 'back', x: 0.42, y: -0.33, w: 0.4, h: 0.1, label: 'Back', style: 'primary', fontSize: 0.045, onClick: () => this.showMenu() });
    place(st);

    // Pause -------------------------------------------------------------------
    const pause = new UIPanel({ width: 0.9, height: 0.62, title: 'PAUSED' });
    this.pausePanel = pause;
    pause.addButton({ id: 'resume', x: 0, y: 0.06, w: 0.6, h: 0.11, label: 'Resume', style: 'primary', fontSize: 0.045, onClick: () => this.resume() });
    pause.addButton({ id: 'restart', x: 0, y: -0.075, w: 0.6, h: 0.11, label: 'Restart song', fontSize: 0.045, onClick: () => this.startSong() });
    pause.addButton({ id: 'quit', x: 0, y: -0.21, w: 0.6, h: 0.11, label: 'Quit to menu', style: 'danger', fontSize: 0.045, onClick: () => this.showMenu() });
    place(pause);

    // Results -----------------------------------------------------------------
    const res = new UIPanel({ width: 1.5, height: 1.0, title: 'RESULTS' });
    this.resultsPanel = res;
    res.addLabel('rank', { x: 0.5, y: 0.02, text: 'S', size: 0.36, color: '#ffd166', font: '"Orbitron", "Rajdhani", sans-serif', weight: 800 });
    res.addLabel('rankCap', { x: 0.5, y: -0.21, text: 'RANK', size: 0.03, color: 'rgba(200,195,240,0.7)', weight: 700 });
    res.addLabel('song', { x: -0.66, y: 0.21, text: '', size: 0.034, color: 'rgba(200,195,240,0.85)', align: 'left', maxWidth: 0.85 });
    res.addLabel('score', { x: -0.66, y: 0.12, text: '0', size: 0.11, color: '#ffffff', align: 'left', font: '"Orbitron", "Rajdhani", sans-serif', weight: 800 });
    res.addLabel('line1', { x: -0.66, y: 0.0, text: '', size: 0.036, align: 'left' });
    res.addLabel('line2', { x: -0.66, y: -0.065, text: '', size: 0.03, color: 'rgba(230,230,255,0.85)', align: 'left' });
    res.addLabel('line3', { x: -0.66, y: -0.12, text: '', size: 0.03, color: 'rgba(230,230,255,0.85)', align: 'left' });
    res.addLabel('record', { x: -0.66, y: -0.2, text: '', size: 0.034, color: '#ffd166', align: 'left', weight: 700 });
    res.addButton({ id: 'retry', x: -0.45, y: -0.38, w: 0.42, h: 0.11, label: 'Retry', style: 'primary', fontSize: 0.045, onClick: () => this.startSong() });
    res.addButton({ id: 'menu', x: 0.0, y: -0.38, w: 0.42, h: 0.11, label: 'Song list', fontSize: 0.045, onClick: () => this.showMenu() });
    this.resultsExit = res.addButton({ id: 'exit2', x: 0.45, y: -0.38, w: 0.42, h: 0.11, label: 'Exit VR', style: 'ghost', fontSize: 0.045, onClick: () => this.onEvent('exitXR') });
    place(res);

    // Loading -----------------------------------------------------------------
    const load = new UIPanel({ width: 1.0, height: 0.4, title: 'LOADING' });
    this.loadingPanel = load;
    load.addLabel('status', { x: 0, y: -0.02, text: 'Preparing…', size: 0.036 });
    this.loadingBar = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x19e6ff, transparent: true, opacity: 0.9, depthWrite: false }));
    this.loadingBar.position.set(-0.42, -0.1, 0.004);
    this.loadingBar.scale.set(0.01, 0.025, 1);
    this.loadingBar.renderOrder = 52;
    load.group.add(this.loadingBar);
    place(load);

    this._hideAllPanels();
    this._refreshMainPanel();
  }

  _hideAllPanels() { for (const p of [this.mainPanel, this.settingsPanel, this.pausePanel, this.resultsPanel, this.loadingPanel]) p.setVisible(false); }

  _visibleTracks() { return this.library.tracks.slice(this.listOffset, this.listOffset + 5); }

  _refreshMainPanel() {
    const tracks = this.library.tracks;
    const sel = tracks.findIndex((t) => t.id === this.selectedTrackId);
    if (sel >= 0 && (sel < this.listOffset || sel >= this.listOffset + 5)) this.listOffset = clamp(sel - 2, 0, Math.max(0, tracks.length - 5));
    const visible = this._visibleTracks();
    this.trackButtons.forEach((b, i) => {
      const t = visible[i];
      if (!t) { b.setLabel('', ''); b.setDisabled(true); b.setActive(false); b.mesh.visible = false; return; }
      b.mesh.visible = true;
      b.setLabel(t.title, t.subtitle);
      b.setDisabled(t.status !== 'ready');
      b.setActive(t.id === this.selectedTrackId);
    });
    this.listUp.setDisabled(this.listOffset === 0);
    this.listDown.setDisabled(this.listOffset + 5 >= tracks.length);
    this.mainPanel.setLabel('pageInfo', tracks.length > 5 ? `${this.listOffset + 1}–${Math.min(tracks.length, this.listOffset + 5)}\nof ${tracks.length}` : '');
    for (const d of DIFFICULTY_ORDER) this.diffButtons[d].setActive(d === this.difficulty);
    const track = this.library.get(this.selectedTrackId);
    const best = track ? getBest(track.id, this.difficulty) : null;
    this.mainPanel.setLabel('best', best ? `Best: ${formatScore(best.score)}  ·  rank ${best.rank}  ·  ${Math.round(best.accuracy * 100)}%` : 'No score yet on this difficulty');
    this.mainPanel.setLabel('diffHint', difficultyHint(this.difficulty));
    this.startButton.setDisabled(!track || track.status !== 'ready');
    this.startButton.setLabel(track && track.status === 'analysing' ? 'ANALYSING…' : 'START');
    this.modeButton.setLabel(this.xrMode === 'ar' ? 'Switch to VR' : 'Passthrough');
    this.modeButton.setDisabled(this.xrMode === 'desktop' || !this.onEvent('canSwitchMode', this.xrMode === 'ar' ? 'vr' : 'ar'));
    this.exitButton.setLabel(this.xrMode === 'desktop' ? 'Leave preview' : 'Exit VR');
    this.resultsExit.setLabel(this.xrMode === 'desktop' ? 'Leave preview' : 'Exit VR');
  }

  _refreshSettingsPanel() {
    if (!this.settingsPanel) return;
    for (const r of this.settingRows) this.settingsPanel.setLabel(`val-${r.key}`, r.fmt(this.settings[r.key]));
    for (const [key, b] of Object.entries(this.toggleButtons)) b.setActive(!!this.settings[key]);
  }

  _adjustSetting(row, dir) {
    const v = clamp(+(this.settings[row.key] + dir * row.step).toFixed(3), row.min, row.max);
    this.settings[row.key] = v;
    this.applySettings();
    this.onEvent('settingsChanged');
  }

  /** Called when the library changes (new song analysed, removed). */
  refreshLibrary() {
    if (!this.library.get(this.selectedTrackId)) this.selectedTrackId = this.library.tracks[0].id;
    this._refreshMainPanel();
  }

  showMenu() {
    this.stopSong();
    this.state = 'menu';
    this._hideAllPanels();
    this.hud.setVisible(false);
    this.obstacles.clear();
    this.gloves.clearTrails();
    this.effects.vignette.setLowHealth(0);
    this._refreshMainPanel();
    this.mainPanel.setVisible(true);
    this.ui.enabled = true;
    this.onEvent('stateChange', this.state);
  }

  showSettings() {
    this._hideAllPanels();
    this._refreshSettingsPanel();
    this.settingsPanel.setVisible(true);
  }

  // ------------------------------------------------------------------ song lifecycle
  async startSong() {
    const track = this.library.get(this.selectedTrackId);
    if (!track || track.status !== 'ready') return;
    this.stopSong();
    this.audio.init();
    await this.audio.resume();
    this.state = 'loading';
    this._hideAllPanels();
    this.hud.setVisible(false);
    this.loadingPanel.setVisible(true);
    this._setLoading(0.05, `Loading ${track.title}…`);
    this.onEvent('stateChange', this.state);
    const token = (this.loadToken = (this.loadToken || 0) + 1);

    let analysis, buffer = null;
    try {
      if (track.kind === 'builtin') {
        analysis = this.music.load(track.def);
      } else {
        analysis = track.analysis;
        this._setLoading(0.3, 'Decoding audio…');
        buffer = await this.library.getBuffer(track);
      }
    } catch (err) {
      console.error(err);
      this.onEvent('toast', 'Could not load this song.');
      this.showMenu();
      return;
    }
    if (token !== this.loadToken || this.state !== 'loading') return;
    this._setLoading(0.8, 'Building the beat map…');
    const map = generateBeatmap(analysis, this.difficulty, track.id);
    this.map = map;
    this.track = track;
    this._updateHeadHeight(true);
    this.obstacles.loadMap(map);
    this.beatIdx = 0;
    this.run = {
      score: 0, combo: 0, maxCombo: 0, multiplier: 1, health: 1, hits: 0, perfect: 0, great: 0, good: 0, weak: 0, wrong: 0, misses: 0, bombs: 0, walls: 0,
      qualitySum: 0, notesTotal: map.stats.notes, judged: 0, milestone: 0, ended: false, failed: false,
    };
    this.hud.set({ score: 0, combo: 0, multiplier: 1, health: 1, progress: 0, accuracy: 1, title: track.title, difficulty: DIFFICULTIES[this.difficulty].label });
    this.hud.setVisible(true);
    this.loadingPanel.setVisible(false);

    // Count-in: ticks at beat intervals (never faster than every half second), then the song.
    const ctx = this.audio.ctx;
    const tick = Math.max(analysis.beatLength || 0.5, 0.5);
    const startAt = ctx.currentTime + 0.35 + tick * 3;
    this.songStart = startAt;
    this.countTicks = [];
    for (let i = 3; i >= 0; i--) {
      const at = startAt - tick * i;
      this.audio.playCount(at, i === 0);
      this.countTicks.push({ at: at - this.audio.outputLatency, label: i === 0 ? 'GO!' : String(i), shown: false });
    }
    if (track.kind === 'builtin') {
      this.music.start(startAt);
    } else {
      this.customSource = this.audio.playBuffer(buffer, startAt);
    }
    this.state = 'countdown';
    this.ui.enabled = false;
    this.gloves.clearTrails();
    this.onEvent('stateChange', this.state);
  }

  _setLoading(frac, text) {
    this.loadingPanel.setLabel('status', text);
    this.loadingBar.scale.x = Math.max(0.01, frac * 0.84);
    this.loadingBar.position.x = -0.42 + this.loadingBar.scale.x / 2;
    this.onEvent('loadingProgress', { frac, text });
  }

  stopSong() {
    this.music.stop();
    if (this.customSource) { try { this.customSource.stop(); } catch { /* already stopped */ } this.customSource = null; }
    this.audio.resume();
    if (this.state === 'countdown' || this.state === 'playing' || this.state === 'paused') this.state = 'menu';
  }

  get songTime() {
    if (!this.audio.ctx) return -10;
    return this.audio.ctx.currentTime - this.songStart - this.audio.outputLatency + (this.settings.audioOffsetMs || 0) / 1000;
  }

  pause() {
    if (this.state !== 'playing' && this.state !== 'countdown') return;
    this.state = 'paused';
    this.audio.suspend();
    this._hideAllPanels();
    this.pausePanel.setVisible(true);
    this.ui.enabled = true;
    this.onEvent('stateChange', this.state);
  }

  resume() {
    if (this.state !== 'paused') return;
    this._hideAllPanels();
    this.ui.enabled = false;
    this.state = 'resuming';
    this.resumeAt = performance.now() + 1200;
    this.effects.popup('GET READY', this._strikeCenter(_v), '#ffffff', { scale: 0.22, duration: 1.1, rise: 0.05 });
    this.onEvent('stateChange', this.state);
  }

  togglePause() {
    if (this.state === 'playing' || this.state === 'countdown') this.pause();
    else if (this.state === 'paused') this.resume();
  }

  /** Where big announcements (count-in, combos) appear: above the strike zone, two metres out. */
  _strikeCenter(out) { return out.set(0, (this.obstacles.rowsY[0] + this.obstacles.rowsY[2]) / 2 + 0.35, this.obstacles.hitZ - 1.6); }
  /** Popups at a hit sit half a metre behind the target so they are readable, not in your face. */
  _popupPos(pos, dy, out) { return out.set(pos.x, pos.y + dy, pos.z - 0.55); }

  _finish(failed) {
    const run = this.run;
    if (!run || run.ended) return;
    run.ended = true;
    run.failed = failed;
    this.music.stop(failed ? 0.6 : 0.4);
    if (this.customSource) { try { this.customSource.stop(this.audio.now + (failed ? 0.6 : 0.3)); } catch { /* ignore */ } this.customSource = null; }
    const total = Math.max(1, run.notesTotal);
    const accuracy = run.qualitySum / total;
    const rank = failed ? 'F' : accuracy >= 0.95 ? 'S' : accuracy >= 0.85 ? 'A' : accuracy >= 0.7 ? 'B' : accuracy >= 0.5 ? 'C' : 'D';
    const result = { score: run.score, rank, accuracy, maxCombo: run.maxCombo };
    const record = !failed && submitScore(this.track.id, this.difficulty, result);
    this.state = failed ? 'failed' : 'results';
    if (failed) this.audio.playFail(); else this.audio.playFanfare(rank === 'S' || rank === 'A' || rank === 'B');
    this.hud.setVisible(false);
    const res = this.resultsPanel;
    res.title = failed ? 'SONG FAILED' : 'RESULTS';
    res.setLabel('rank', rank, { color: failed ? '#ff3b3b' : rank === 'S' ? '#ffd166' : rank === 'A' ? '#19e6ff' : '#eef0ff' });
    res.setLabel('song', `${this.track.title}  ·  ${DIFFICULTIES[this.difficulty].label}`);
    res.setLabel('score', formatScore(run.score));
    res.setLabel('line1', `Max combo ${run.maxCombo}   ·   Accuracy ${Math.round(accuracy * 100)}%`);
    res.setLabel('line2', `Perfect ${run.perfect}  ·  Great ${run.great}  ·  Good ${run.good}  ·  Weak ${run.weak}`);
    res.setLabel('line3', `Missed ${run.misses}  ·  Wrong glove ${run.wrong}  ·  Bombs ${run.bombs}  ·  Walls ${run.walls}`);
    res.setLabel('record', record ? '★ New personal best!' : failed ? 'Try No-fail mode in Settings to play through.' : '');
    res.dirty = true;
    setTimeout(() => { if (this.state === 'results' || this.state === 'failed') { res.setVisible(true); this.ui.enabled = true; } }, failed ? 1400 : 900);
    this.effects.vignette.setLowHealth(0);
    this.onEvent('stateChange', this.state);
    this.onEvent('result', { ...result, record, failed, track: this.track.id, difficulty: this.difficulty });
  }

  // ------------------------------------------------------------------ input
  _onSelect(slot, phase) {
    const key = slot.handedness === 'left' ? 'left' : 'right';
    if (this.ui.enabled) {
      if (phase === 'start') this.ui.pressStart(key); else this.ui.pressEnd(key);
    }
  }

  _onButton(slot, name, pressed) {
    if (!pressed) return;
    if (name === 'by') this.togglePause();
    if (name === 'stick' && (this.state === 'menu')) this.recenter();
  }

  /** Desktop mouse: normalised device coords. */
  pointerMove(x, y) { this.mouse.active = true; this.mouse.ndc.set(x, y); }
  pointerDown() { this.mouse.down = true; if (this.ui.enabled) this.ui.pressStart('mouse'); }
  pointerUp() { this.mouse.down = false; if (this.ui.enabled) this.ui.pressEnd('mouse'); }

  // ------------------------------------------------------------------ frame
  update(dt, now) {
    dt = Math.min(dt, 0.1);
    this.clock += dt;
    this.input.update(dt);
    // Hand tracking has no buttons: pinching with both hands for a second pauses / resumes.
    if (this.input.bothHandsPinching && !this.pinchPauseLatch) { this.pinchPauseLatch = true; this.togglePause(); }
    if (!this.input.bothHandsPinching) this.pinchPauseLatch = false;
    const presenting = this.renderer.xr.isPresenting;
    if (this.pendingRecenter > 0 && (presenting || this.xrMode === 'desktop')) {
      this.pendingRecenter--;
      if (this.pendingRecenter === 0) this.recenter();
    }

    // Gloves ----------------------------------------------------------------
    this.gloves.beginFrame();
    const bot = this.xrMode === 'desktop' || (this.settings.autoplay && this.xrMode !== 'none');
    if (presenting) {
      for (const slot of this.input.slots) {
        if (!slot.connected) continue;
        const hand = slot.handedness === 'left' ? 'L' : slot.handedness === 'right' ? 'R' : null;
        if (!hand) continue;
        if (slot.isHand) this.gloves.driveFromHand(hand, slot.hand);
        else this.gloves.driveFromObject(hand, slot.grip);
      }
    }
    if (bot && (this.state === 'playing' || this.state === 'countdown' || this.state === 'resuming' || this.state === 'paused' || this.xrMode === 'desktop')) this._driveBot(dt);
    this.camera.getWorldPosition(_v3);
    this.gloves.update(dt, now, _v3);

    // UI pointers ------------------------------------------------------------
    if (presenting) {
      for (const slot of this.input.slots) {
        const key = slot.handedness === 'left' ? 'left' : 'right';
        if (slot.connected && this.ui.enabled && this.input.getRay(slot, _origin, _dir)) this.ui.pointAt(key, _origin, _dir, true);
        else this.ui.hidePointer(key);
      }
      this.ui.hidePointer('mouse');
    } else if (this.xrMode === 'desktop' && this.mouse.active && this.ui.enabled) {
      _origin.setFromMatrixPosition(this.camera.matrixWorld);
      _dir.set(this.mouse.ndc.x, this.mouse.ndc.y, 0.5).unproject(this.camera).sub(_origin).normalize();
      this.ui.pointAt('mouse', _origin, _dir, false);
    } else {
      this.ui.hidePointer('mouse');
    }

    // Game logic -------------------------------------------------------------
    let songTime = -10;
    if (this.state === 'countdown' || this.state === 'playing') {
      songTime = this.songTime;
      if (this.state === 'countdown') {
        const ctxNow = this.audio.ctx.currentTime;
        for (const t of this.countTicks) {
          if (!t.shown && ctxNow >= t.at) {
            t.shown = true;
            this.effects.popup(t.label, this._strikeCenter(_v), t.label === 'GO!' ? '#19e6ff' : '#ffffff', { scale: t.label === 'GO!' ? 0.34 : 0.28, duration: 0.8, rise: 0.08 });
            this.environment.onBeat(1);
          }
        }
        if (songTime >= 0) { this.state = 'playing'; this.onEvent('stateChange', this.state); }
      }
      this.obstacles.update(songTime, dt);
      if (this.state === 'playing') this._playFrame(songTime, dt);
    } else if (this.state === 'resuming') {
      if (performance.now() >= this.resumeAt) { this.audio.resume(); this.state = 'playing'; this.onEvent('stateChange', this.state); }
      songTime = this.songTime;
    } else if (this.state === 'paused') {
      songTime = this.songTime;
    }
    if (this.state !== 'idle' && this.state !== 'menu' && this.state !== 'loading') this._updateHeadHeight(false);

    // Visuals ----------------------------------------------------------------
    const energy = this.audio.updateAnalysis(dt);
    this.environment.update(dt, { songTime, speed: this.map ? this.map.speed : 9, energy, headWorld: _v3 });
    const size = this.renderer.getSize(this._size || (this._size = new THREE.Vector2()));
    this.effects.update(dt, size.y || 1000);
    this.hud.update(dt);
    this.ui.update(dt);
  }

  _playFrame(songTime, dt) {
    const run = this.run;
    const map = this.map;
    // Beat pulses for the environment.
    while (this.beatIdx < map.beats.length && map.beats[this.beatIdx] <= songTime) {
      this.environment.onBeat(this.beatIdx % 4 === 0 ? 1 : 0.6);
      this.beatIdx++;
    }
    // Punches.
    _inv.copy(this.laneRoot.matrixWorld).invert();
    for (const glove of this.gloves.list) {
      if (!glove.tracked) continue;
      const cur = _v.copy(glove.position).applyMatrix4(_inv);
      const prev = _v2.copy(glove.history[(glove.histHead + glove.history.length - 1) % glove.history.length].p).applyMatrix4(_inv);
      const res = this.obstacles.testPunch({ prev, cur, speed: glove.speed, noteType: this.gloves.noteTypeFor(glove) });
      if (res) this._resolvePunch(glove, res);
    }
    // Head vs walls.
    this.camera.getWorldPosition(_v).applyMatrix4(_inv);
    const wall = this.obstacles.testHead(_v);
    if (wall) {
      run.health -= 0.3 * dt;
      if (!wall.hit) {
        wall.hit = true;
        run.walls++;
        this._breakCombo();
        this.effects.popup('DODGE!', _v2.set(_v.x, _v.y + 0.2, this.obstacles.hitZ - 1.4), '#ff3b3b', { scale: 0.2 });
      }
      this.effects.wall();
      this.audio.playWallHit();
      if (this.settings.haptics) this.input.haptic('both', 0.6, 60);
    }
    // Health / fail.
    run.health = clamp(run.health, 0, 1);
    this.effects.vignette.setLowHealth(run.health < 0.3 ? (0.3 - run.health) / 0.3 : 0);
    if (run.health < 0.25 && !this.settings.noFail) this.audio.playHeartbeat();
    if (run.health <= 0 && !this.settings.noFail) { this._finish(true); return; }
    // HUD.
    const judged = Math.max(1, run.judged);
    this.hud.set({ score: run.score, combo: run.combo, multiplier: run.multiplier, health: run.health, progress: clamp(songTime / map.duration, 0, 1), accuracy: run.qualitySum / judged });
    // End of song.
    if (songTime >= map.duration + 0.8) this._finish(false);
  }

  _multiplierFor(combo) { return combo >= 50 ? 8 : combo >= 25 ? 4 : combo >= 10 ? 2 : 1; }

  _breakCombo() {
    const run = this.run;
    if (run.combo >= 10) this.audio.playMiss();
    run.combo = 0;
    run.multiplier = 1;
  }

  _resolvePunch(glove, res) {
    const run = this.run;
    const note = res.note;
    const pos = res.position;
    const color = note.type === 'L' ? COLORS.left : note.type === 'R' ? COLORS.right : note.type === 'A' ? COLORS.any : COLORS.bomb;
    const handed = glove.hand === 'L' ? 'left' : 'right';
    _inv.copy(this.laneRoot.matrixWorld).invert();
    const dir = _v2.copy(glove.velocity).transformDirection(_inv).normalize();
    if (res.kind === 'bomb') {
      run.bombs++;
      run.health -= 0.18;
      this._breakCombo();
      this.effects.bomb(pos);
      this.effects.popup('BOMB!', this._popupPos(pos, 0.12, _v3), '#ff3b3b', { scale: 0.16 });
      this.audio.playBomb();
      if (this.settings.haptics) this.input.haptic(handed, 1, 180);
      return;
    }
    if (res.kind === 'wrong') {
      run.wrong++; run.judged++;
      run.health -= 0.06;
      this._breakCombo();
      this.effects.miss(pos, color);
      this.effects.popup('WRONG GLOVE', this._popupPos(pos, 0.12, _v3), '#ff8a65', { scale: 0.13 });
      this.audio.playWrongHand();
      if (this.settings.haptics) this.input.haptic(handed, 0.4, 80);
      return;
    }
    // A real punch.
    const quality = res.quality;
    const power = clamp((glove.speed - 1.2) / 3.0, 0, 1);
    run.judged++;
    run.hits++;
    let label, labelColor, q;
    if (res.kind === 'weak') { run.weak++; label = 'WEAK'; labelColor = '#c7c2e8'; q = 0.3; }
    else if (quality >= 0.8) { run.perfect++; label = 'PERFECT'; labelColor = '#ffd166'; q = 1; }
    else if (quality >= 0.5) { run.great++; label = 'GREAT'; labelColor = '#19e6ff'; q = 0.8; }
    else { run.good++; label = 'GOOD'; labelColor = '#ffffff'; q = 0.6; }
    run.qualitySum += q;
    if (res.kind !== 'weak') { run.combo++; run.maxCombo = Math.max(run.maxCombo, run.combo); }
    run.multiplier = this._multiplierFor(run.combo);
    const points = Math.round(100 * (0.5 + 0.5 * quality) * (0.85 + 0.35 * power) * (res.kind === 'weak' ? 0.35 : 1)) * run.multiplier;
    run.score += points;
    run.health = Math.min(1, run.health + (res.kind === 'weak' ? 0.01 : 0.02));
    this.effects.hit(pos, note.type, color, res.kind === 'weak' ? 0.2 : quality, dir);
    this.effects.popup(label, this._popupPos(pos, 0.16, _v3), labelColor, { scale: 0.1 + quality * 0.04 });
    this.effects.popup(`+${points}`, this._popupPos(pos, -0.1, _v3), '#ffffff', { scale: 0.075, duration: 0.7, rise: -0.12 });
    this.audio.playHit(quality, power, glove.hand === 'L' ? 0 : 1);
    if (quality >= 0.8 && res.kind !== 'weak') this.audio.playPerfectSparkle();
    if (this.settings.haptics) this.input.haptic(handed, 0.5 + power * 0.5, 40 + quality * 40);
    this.environment.onBeat(0.5 + quality * 0.5);
    // Combo milestones.
    const next = COMBO_MILESTONES[run.milestone];
    if (next && run.combo >= next) {
      run.milestone++;
      this.audio.playCombo(run.milestone);
      this.effects.popup(`COMBO ${next}`, this._strikeCenter(_v3).add(_v2.set(0, 0.25, 0)), '#ffd166', { scale: 0.26, duration: 1.2, rise: 0.2 });
      this.environment.flash(next >= 50 ? '#ffd166' : '#19e6ff', 1);
      this.hud.flashCombo();
    } else if (run.combo > 0 && run.combo % 10 === 0) {
      this.hud.flashCombo();
    }
  }

  _onMiss(note, pos) {
    if (this.state !== 'playing') return;
    const run = this.run;
    run.misses++; run.judged++;
    run.health -= this.difficulty === 'easy' ? 0.05 : 0.07;
    this._breakCombo();
    const color = note.type === 'L' ? COLORS.left : note.type === 'R' ? COLORS.right : COLORS.any;
    this.effects.miss(pos, color);
    this.effects.popup('MISS', this._popupPos(pos, 0.1, _v3), '#8f8ab5', { scale: 0.1, duration: 0.7 });
    this.audio.playMiss();
  }

  // ------------------------------------------------------------------ demo bot
  _driveBot(dt) {
    const songTime = this.state === 'playing' || this.state === 'countdown' ? this.songTime : -10;
    const rows = this.obstacles.rowsY;
    const restY = rows[2] - 0.12; // a boxing guard: fists up near the chin
    for (const glove of this.gloves.list) {
      if (glove.tracked && glove.source !== 'bot') continue; // a real controller wins
      const type = this.gloves.noteTypeFor(glove);
      const sideX = glove.hand === 'L' ? -0.18 : 0.18;
      const target = _v.set(sideX, restY, -0.3);
      const slot = this.state === 'playing' ? this.obstacles.nextNoteFor(type, songTime, 0.6) : null;
      if (slot) {
        const tth = slot.note.t - songTime;
        const hitZ = this.obstacles.hitZ;
        // Approach the cell, then punch through the strike plane right on time.
        const f = clamp((0.6 - tth) / 0.6, 0, 1);
        const z = tth > 0.3 ? -0.3 + (hitZ + 0.5 + 0.3) * f : hitZ + 0.5 - (0.3 - tth) * (0.75 / 0.35);
        target.set(lerp(sideX, slot.x, Math.min(1, f * 1.6)), lerp(restY, slot.y, Math.min(1, f * 1.6)), z);
      }
      if (!glove.botPos) { glove.botPos = target.clone(); }
      const k = 1 - Math.exp(-dt * (slot ? 22 : 8));
      glove.botPos.lerp(target, k);
      _v2.copy(glove.botPos).applyMatrix4(this.laneRoot.matrixWorld);
      _q.copy(this.laneRoot.quaternion);
      this.gloves.drive(glove.hand, _v2, _q, 'bot');
    }
  }
}

function difficultyHint(d) {
  switch (d) {
    case 'easy': return 'Gold targets take either glove. No bombs, gentle pace.';
    case 'normal': return 'Steady punching, lean walls, double hits on the drops.';
    case 'hard': return 'Faster targets, bombs and duck walls. Break a sweat.';
    case 'expert': return 'Relentless. Streams, bombs, walls and no gold targets.';
    default: return '';
  }
}
