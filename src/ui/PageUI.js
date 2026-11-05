// The 2D landing page: song list, difficulty, settings and the buttons that start a session.

import { DIFFICULTY_ORDER, DIFFICULTIES } from '../beatmap/Generator.js';
import { getBest } from '../util/storage.js';
import { formatScore } from '../util/math.js';

const $ = (id) => document.getElementById(id);

export class PageUI {
  constructor({ library, settings, game, onEnter, onSettingsChanged }) {
    this.library = library;
    this.settings = settings;
    this.game = game;
    this.onEnter = onEnter;
    this.onSettingsChanged = onSettingsChanged;
    this.page = $('page');
    this.desktopHud = $('desktopHud');
    this.toastEl = $('toast');
    this.toastTimer = 0;

    $('addMp3').addEventListener('click', () => $('fileInput').click());
    $('fileInput').addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      e.target.value = '';
      if (!files.length) return;
      if (library.customCount >= library.maxCustom) { this.toast(`You can keep up to ${library.maxCustom} of your own songs loaded at once.`); return; }
      const created = await library.addFiles(files);
      if (created.length) { game.selectTrack(created[0].id); this.renderTracks(); }
    });

    for (const b of $('difficulty').querySelectorAll('button')) {
      b.addEventListener('click', () => game.setDifficulty(b.dataset.diff));
    }
    $('enterVR').addEventListener('click', () => onEnter('vr'));
    $('enterAR').addEventListener('click', () => onEnter('ar'));
    $('enterDesktop').addEventListener('click', () => onEnter('desktop'));
    $('exitDesktop').addEventListener('click', () => onEnter('exit'));

    const bind = (id, key, parse, format) => {
      const el = $(id);
      const apply = () => { if (el.type === 'checkbox') el.checked = !!settings[key]; else el.value = format ? format(settings[key]) : settings[key]; };
      apply();
      el.addEventListener('input', () => {
        settings[key] = el.type === 'checkbox' ? el.checked : parse(el.value);
        this.onSettingsChanged();
        this.syncSettings();
      });
      this._binders = this._binders || [];
      this._binders.push(apply);
    };
    bind('musicVol', 'musicVolume', (v) => v / 100, (v) => Math.round(v * 100));
    bind('sfxVol', 'sfxVolume', (v) => v / 100, (v) => Math.round(v * 100));
    bind('offset', 'audioOffsetMs', (v) => parseInt(v, 10), (v) => v);
    bind('noFail', 'noFail'); bind('haptics', 'haptics'); bind('reducedMotion', 'reducedMotion'); bind('swapHands', 'swapHands'); bind('autoplay', 'autoplay');

    library.onChange = () => { this.renderTracks(); game.refreshLibrary(); };
    this.renderTracks();
    this.syncSettings();
  }

  syncSettings() {
    for (const apply of this._binders || []) apply();
    $('offsetVal').textContent = `${this.settings.audioOffsetMs > 0 ? '+' : ''}${this.settings.audioOffsetMs} ms`;
    for (const b of $('difficulty').querySelectorAll('button')) b.classList.toggle('active', b.dataset.diff === this.game.difficulty);
    $('diffHint').textContent = {
      easy: 'Gold targets take either glove. No bombs and a gentle pace: perfect for a first session.',
      normal: 'Steady punching with lean walls and double hits on the big beats.',
      hard: 'Faster targets, bombs to avoid and duck walls. You will sweat.',
      expert: 'Relentless streams, bombs, walls and no gold targets. For the dedicated.',
    }[this.game.difficulty] || '';
    this.renderBest();
  }

  renderBest() {
    const track = this.library.get(this.game.selectedTrackId);
    const best = track ? getBest(track.id, this.game.difficulty) : null;
    $('best').innerHTML = best
      ? `Personal best on <b>${escapeHtml(track.title)}</b> (${DIFFICULTIES[this.game.difficulty].label}): <b>${formatScore(best.score)}</b> · rank <b>${best.rank}</b> · ${Math.round(best.accuracy * 100)}% accuracy`
      : (track ? `No score yet on <b>${escapeHtml(track.title)}</b> (${DIFFICULTIES[this.game.difficulty].label}).` : '');
  }

  renderTracks() {
    const list = $('trackList');
    list.innerHTML = '';
    for (const t of this.library.tracks) {
      const li = document.createElement('li');
      li.className = 'track' + (t.id === this.game.selectedTrackId ? ' active' : '');
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(t.id === this.game.selectedTrackId));
      li.style.setProperty('--c1', t.colors[0]);
      li.style.setProperty('--c2', t.colors[1]);
      const initials = t.title.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
      const right = t.kind === 'custom'
        ? `<div class="right">${t.status === 'ready' ? `<b>${t.bpm} BPM</b>your song` : t.status === 'error' ? '<b>!</b>error' : `<b>${Math.round((t.progress || 0) * 100)}%</b>analysing`}<button class="remove" title="Remove" aria-label="Remove ${escapeHtml(t.title)}">✕</button></div>`
        : `<div class="right"><b>${t.bpm} BPM</b>built-in</div>`;
      li.innerHTML = `<div class="art">${initials}</div><div><div class="title">${escapeHtml(t.title)}</div><div class="meta">${escapeHtml(t.subtitle)}</div></div>${right}`;
      li.addEventListener('click', (e) => {
        if (e.target.closest('.remove')) { this.library.remove(t.id); return; }
        if (t.status === 'ready') this.game.selectTrack(t.id);
      });
      list.appendChild(li);
    }
    this.renderBest();
  }

  setXRSupport({ vr, ar, secure, hasXR }) {
    const status = $('xrStatus');
    $('enterVR').disabled = !vr;
    $('enterAR').disabled = !ar;
    if (!secure) { status.textContent = 'WebXR needs a secure page (https:// or localhost). Open this game over HTTPS to use the headset.'; status.className = 'xr-status warn'; return; }
    if (!hasXR) { status.textContent = 'No WebXR here. Open this page in the Meta Quest Browser to play in VR, or try the desktop preview below.'; status.className = 'xr-status warn'; return; }
    if (vr || ar) { status.innerHTML = `Headset ready: VR ${vr ? '✓' : '✗'} · Passthrough ${ar ? '✓' : '✗'}. Put it on and press a button below.`; status.className = 'xr-status ok'; }
    else { status.textContent = 'WebXR is available but no immersive session type is supported on this device.'; status.className = 'xr-status warn'; }
  }

  setProgress(frac, label) {
    const wrap = $('progressWrap');
    if (frac == null) { wrap.hidden = true; return; }
    wrap.hidden = false;
    $('progressBar').style.width = `${Math.round(frac * 100)}%`;
    $('progressLabel').textContent = label || '';
  }

  show() { this.page.hidden = false; this.desktopHud.hidden = true; }
  hide(desktop = false) { this.page.hidden = true; this.desktopHud.hidden = !desktop; }

  toast(message, error = false) {
    this.toastEl.textContent = message;
    this.toastEl.className = 'toast' + (error ? ' error' : '');
    this.toastEl.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { this.toastEl.hidden = true; }, 4500);
  }
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
