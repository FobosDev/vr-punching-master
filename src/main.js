// Entry point: renderer, XR session management, desktop preview controls and the page UI.

import * as THREE from 'three';
import { AudioEngine } from './audio/AudioEngine.js';
import { Library } from './Library.js';
import { Game } from './Game.js';
import { PageUI } from './ui/PageUI.js';
import { loadSettings, saveSettings } from './util/storage.js';

class App {
  constructor() {
    const canvas = document.getElementById('gl');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType('local-floor');

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 1200);
    this.camera.position.set(0, 1.6, 0);
    this.scene.add(this.camera);

    this.session = null;
    this.sessionMode = null;
    this.switchTo = null;
    this.busy = false;
    this.support = { vr: false, ar: false };
    this.desktop = { yaw: 0, pitch: 0, dragging: false, lastX: 0, lastY: 0 };
    this.lastTime = 0;
    this.renderEnabled = true; // tests switch this off to run the logic without the (slow) software GPU

    this.settings = loadSettings();
    this.audio = new AudioEngine();
    this.audio.musicVolume = this.settings.musicVolume;
    this.audio.sfxVolume = this.settings.sfxVolume;
    this.library = new Library(this.audio);
    this.game = new Game({ renderer: this.renderer, scene: this.scene, camera: this.camera, audio: this.audio, settings: this.settings, library: this.library, onEvent: (name, data) => this.onGameEvent(name, data) });
    this.page = new PageUI({ library: this.library, settings: this.settings, game: this.game, onEnter: (mode) => this.enter(mode), onSettingsChanged: () => { this.game.applySettings(); saveSettings(this.settings); } });

    this.detectXR();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => this.game.redrawUI()).catch(() => {});
    this.bindDesktopControls();
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.game.pause(); });
    this.renderer.setAnimationLoop((time, frame) => this.frame(time, frame));
  }

  async detectXR() {
    const secure = window.isSecureContext;
    const hasXR = !!navigator.xr;
    if (hasXR) {
      try { this.support.vr = await navigator.xr.isSessionSupported('immersive-vr'); } catch { this.support.vr = false; }
      try { this.support.ar = await navigator.xr.isSessionSupported('immersive-ar'); } catch { this.support.ar = false; }
    }
    this.page.setXRSupport({ ...this.support, secure, hasXR });
    this.game.refreshLibrary();
  }

  // ------------------------------------------------------------------ sessions
  async enter(mode) {
    if (mode === 'exit') { this.leaveDesktop(); return; }
    if (mode === 'desktop') { this.enterDesktop(); return; }
    await this.enterXR(mode);
  }

  async enterXR(mode) {
    if (this.busy) return;
    this.busy = true;
    try {
      this.audio.init();
      const xrMode = mode === 'ar' ? 'immersive-ar' : 'immersive-vr';
      const optional = ['hand-tracking', 'bounded-floor', 'layers'];
      let session;
      let floorMode = 'floor';
      try {
        session = await navigator.xr.requestSession(xrMode, { requiredFeatures: ['local-floor'], optionalFeatures: optional });
      } catch (err) {
        // Some runtimes lack local-floor: fall back to 'local' and assume a standing user.
        if (err && err.name === 'NotSupportedError') {
          session = await navigator.xr.requestSession(xrMode, { optionalFeatures: optional });
          floorMode = 'local';
        } else throw err;
      }
      this.session = session;
      this.sessionMode = mode;
      this.game.floorMode = floorMode;
      session.addEventListener('end', () => this.onSessionEnd());
      session.addEventListener('visibilitychange', () => { if (session.visibilityState !== 'visible') this.game.pause(); });
      this.renderer.xr.setReferenceSpaceType(floorMode === 'floor' ? 'local-floor' : 'local');
      await this.renderer.xr.setSession(session);
      this.tryFrameRate(session);
      this.page.hide(false);
      this.game.setXRMode(mode);
    } catch (err) {
      console.error('XR session failed', err);
      this.page.toast(`Could not start ${mode === 'ar' ? 'passthrough' : 'VR'}: ${err && err.message ? err.message : err}`, true);
      this.page.show();
    } finally {
      this.busy = false;
    }
  }

  tryFrameRate(session) {
    try {
      const rates = session.supportedFrameRates ? Array.from(session.supportedFrameRates) : [];
      if (rates.length && session.updateTargetFrameRate) {
        const want = rates.includes(90) ? 90 : Math.max(...rates);
        session.updateTargetFrameRate(want).catch(() => {});
      }
    } catch { /* optional */ }
  }

  onSessionEnd() {
    this.session = null;
    this.game.setXRMode('none');
    this.page.show();
    this.resize();
    const next = this.switchTo;
    this.switchTo = null;
    if (next) {
      // Still inside the user-activation window of the controller click that asked for the switch.
      this.enterXR(next).catch(() => {});
    }
  }

  enterDesktop() {
    this.audio.init();
    this.page.hide(true);
    this.desktop.yaw = 0; this.desktop.pitch = -0.22;
    this.game.setXRMode('desktop');
  }

  leaveDesktop() {
    if (this.game.xrMode !== 'desktop') return;
    this.game.setXRMode('none');
    this.page.show();
  }

  onGameEvent(name, data) {
    switch (name) {
      case 'settingsChanged': saveSettings(this.settings); this.page.syncSettings(); return true;
      case 'trackSelected': this.page.renderTracks(); return true;
      case 'toast': this.page.toast(data); return true;
      case 'loadingProgress': if (this.game.xrMode === 'none') this.page.setProgress(data.frac < 1 ? data.frac : null, data.text); return true;
      case 'exitXR':
        if (this.session) this.session.end(); else this.leaveDesktop();
        return true;
      case 'canSwitchMode': return !!this.support[data];
      case 'switchMode':
        if (this.session && this.support[data]) { this.switchTo = data; this.session.end(); }
        return true;
      case 'result': this.page.renderBest(); return true;
      case 'stateChange': return true;
      default: return true;
    }
  }

  // ------------------------------------------------------------------ desktop controls
  bindDesktopControls() {
    const canvas = this.renderer.domElement;
    const toNdc = (e) => [(e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1];
    canvas.addEventListener('pointermove', (e) => {
      if (this.game.xrMode !== 'desktop') return;
      const [x, y] = toNdc(e);
      this.game.pointerMove(x, y);
      if (this.desktop.dragging) {
        this.desktop.yaw -= (e.clientX - this.desktop.lastX) * 0.004;
        this.desktop.pitch = THREE.MathUtils.clamp(this.desktop.pitch - (e.clientY - this.desktop.lastY) * 0.004, -1.2, 1.2);
        this.desktop.lastX = e.clientX; this.desktop.lastY = e.clientY;
      }
    });
    canvas.addEventListener('pointerdown', (e) => {
      if (this.game.xrMode !== 'desktop') return;
      this.audio.init();
      const [x, y] = toNdc(e);
      this.game.pointerMove(x, y);
      this.desktop.dragging = true; this.desktop.lastX = e.clientX; this.desktop.lastY = e.clientY; this.desktop.moved = 0;
      this.game.pointerDown();
    });
    window.addEventListener('pointerup', () => { if (this.game.xrMode !== 'desktop') return; this.desktop.dragging = false; this.game.pointerUp(); });
    window.addEventListener('keydown', (e) => {
      if (this.game.xrMode !== 'desktop') return;
      if (e.key === 'Escape') this.leaveDesktop();
      if (e.key === ' ' || e.key === 'p' || e.key === 'P') { e.preventDefault(); this.game.togglePause(); }
      if (e.key === 'r' || e.key === 'R') { this.desktop.yaw = 0; this.desktop.pitch = -0.22; this.game.recenter(); }
    });
  }

  resize() {
    if (this.renderer.xr.isPresenting) return;
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // ------------------------------------------------------------------ loop
  frame(time) {
    const t = time / 1000;
    const dt = this.lastTime ? Math.min(0.1, t - this.lastTime) : 1 / 72;
    this.lastTime = t;
    if (!this.renderer.xr.isPresenting) {
      // Desktop / idle camera: standing at the origin, mouse look in preview mode.
      const d = this.desktop;
      const idle = this.game.xrMode === 'none';
      const yaw = idle ? Math.sin(t * 0.07) * 0.08 : d.yaw;
      const pitch = idle ? -0.06 : d.pitch;
      this.camera.position.set(0, 1.6, 0);
      this.camera.rotation.set(pitch, yaw, 0, 'YXZ');
    }
    this.game.update(dt, t);
    if (this.renderEnabled || this.renderer.xr.isPresenting) this.renderer.render(this.scene, this.camera);
  }
}

const app = new App();
window.__pm = { app, game: app.game, library: app.library, audio: app.audio };
