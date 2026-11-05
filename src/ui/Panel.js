// A tiny world-space UI kit: panels drawn on canvases with raycast-able buttons. Used by the
// in-VR menus (track selection, pause, results) and clickable with controller rays, hand
// pinches, or the mouse in desktop mode.

import * as THREE from 'three';
import { makeCanvas, roundRect, makeTexture, fitText, UI_FONT, DISPLAY_FONT } from '../util/CanvasText.js';

const PPM = 560; // canvas pixels per metre

const STYLES = {
  default: { bg: 'rgba(255,255,255,0.07)', bgHover: 'rgba(25,230,255,0.22)', border: 'rgba(255,255,255,0.18)', borderHover: '#19e6ff', text: '#eef0ff' },
  primary: { bg: 'rgba(255,45,149,0.55)', bgHover: 'rgba(255,45,149,0.9)', border: 'rgba(255,120,190,0.8)', borderHover: '#ffffff', text: '#ffffff' },
  accent: { bg: 'rgba(25,230,255,0.35)', bgHover: 'rgba(25,230,255,0.7)', border: 'rgba(25,230,255,0.8)', borderHover: '#ffffff', text: '#ffffff' },
  ghost: { bg: 'rgba(0,0,0,0.0)', bgHover: 'rgba(255,255,255,0.12)', border: 'rgba(255,255,255,0.12)', borderHover: '#ffffff', text: '#cfd2ff' },
  danger: { bg: 'rgba(255,59,59,0.3)', bgHover: 'rgba(255,59,59,0.7)', border: 'rgba(255,59,59,0.7)', borderHover: '#ffffff', text: '#ffffff' },
};

export class UIButton {
  constructor(panel, opts) {
    this.panel = panel;
    this.id = opts.id;
    this.w = opts.w; this.h = opts.h;
    this.label = opts.label;
    this.sub = opts.sub || '';
    this.style = opts.style || 'default';
    this.fontSize = opts.fontSize || 0.045;
    this.onClick = opts.onClick;
    this.active = !!opts.active;
    this.disabled = !!opts.disabled;
    this.hover = false;
    this.pressed = false;
    this.align = opts.align || 'center';
    this.canvas = makeCanvas(Math.round(this.w * PPM), Math.round(this.h * PPM));
    this.texture = makeTexture(this.canvas);
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(this.w, this.h), this.material);
    this.mesh.position.set(opts.x, opts.y, 0.004);
    this.mesh.renderOrder = 51;
    this.mesh.userData.button = this;
    this.scaleTarget = 1;
    this.redraw();
  }

  setLabel(label, sub) { if (label !== this.label || (sub !== undefined && sub !== this.sub)) { this.label = label; if (sub !== undefined) this.sub = sub; this.redraw(); } }
  setActive(v) { if (this.active !== !!v) { this.active = !!v; this.redraw(); } }
  setDisabled(v) { if (this.disabled !== !!v) { this.disabled = !!v; this.redraw(); } }
  setHover(v) { if (this.hover !== !!v) { this.hover = !!v; this.redraw(); } }
  setPressed(v) { if (this.pressed !== !!v) { this.pressed = !!v; this.redraw(); } }

  redraw() {
    const ctx = this.canvas.getContext('2d');
    const W = this.canvas.width, H = this.canvas.height;
    const st = STYLES[this.style] || STYLES.default;
    ctx.clearRect(0, 0, W, H);
    const pad = 4;
    roundRect(ctx, pad, pad, W - pad * 2, H - pad * 2, Math.min(22, H * 0.28));
    const hot = this.hover || this.pressed;
    ctx.fillStyle = this.active ? 'rgba(124,77,255,0.6)' : hot ? st.bgHover : st.bg;
    if (this.disabled) ctx.fillStyle = 'rgba(255,255,255,0.03)';
    ctx.fill();
    ctx.lineWidth = hot || this.active ? 5 : 3;
    ctx.strokeStyle = this.disabled ? 'rgba(255,255,255,0.08)' : this.active ? '#b388ff' : hot ? st.borderHover : st.border;
    if (hot && !this.disabled) { ctx.shadowColor = st.borderHover; ctx.shadowBlur = 18; }
    ctx.stroke();
    ctx.shadowBlur = 0;
    const px = this.fontSize * PPM;
    ctx.fillStyle = this.disabled ? 'rgba(255,255,255,0.3)' : st.text;
    ctx.textBaseline = 'middle';
    ctx.textAlign = this.align;
    const tx = this.align === 'left' ? px * 0.6 : this.align === 'right' ? W - px * 0.6 : W / 2;
    if (this.sub) {
      ctx.font = `700 ${px}px ${UI_FONT}`;
      ctx.fillText(fitText(ctx, this.label, W - px), tx, H * 0.38);
      ctx.font = `500 ${px * 0.68}px ${UI_FONT}`;
      ctx.fillStyle = this.disabled ? 'rgba(255,255,255,0.25)' : 'rgba(230,230,255,0.75)';
      ctx.fillText(fitText(ctx, this.sub, W - px), tx, H * 0.72);
    } else {
      ctx.font = `700 ${px}px ${UI_FONT}`;
      ctx.fillText(fitText(ctx, this.label, W - px * 0.8), tx, H / 2 + px * 0.04);
    }
    this.texture.needsUpdate = true;
  }

  update(dt) {
    const target = this.hover && !this.disabled ? 1.05 : 1;
    const s = this.mesh.scale.x + (target - this.mesh.scale.x) * Math.min(1, dt * 18);
    this.mesh.scale.set(s, s, 1);
  }

  click() {
    if (this.disabled) return false;
    if (this.onClick) this.onClick(this);
    return true;
  }
}

export class UIPanel {
  constructor({ width = 1.4, height = 0.9, title = '', subtitle = '' } = {}) {
    this.width = width; this.height = height;
    this.title = title; this.subtitle = subtitle;
    this.group = new THREE.Group();
    this.group.visible = false;
    this.buttons = [];
    this.labels = new Map();
    this.canvas = makeCanvas(Math.round(width * PPM), Math.round(height * PPM));
    this.texture = makeTexture(this.canvas);
    this.bgMaterial = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false });
    this.bg = new THREE.Mesh(new THREE.PlaneGeometry(width, height), this.bgMaterial);
    this.bg.renderOrder = 50;
    this.bg.userData.panel = this;
    this.group.add(this.bg);
    this.dirty = true;
    this.redraw();
  }

  get visible() { return this.group.visible; }
  setVisible(v) { this.group.visible = !!v; if (!v) for (const b of this.buttons) { b.setHover(false); b.setPressed(false); } }

  addButton(opts) {
    const b = new UIButton(this, opts);
    this.buttons.push(b);
    this.group.add(b.mesh);
    return b;
  }

  removeButton(b) {
    const i = this.buttons.indexOf(b);
    if (i >= 0) this.buttons.splice(i, 1);
    this.group.remove(b.mesh);
    b.texture.dispose(); b.material.dispose(); b.mesh.geometry.dispose();
  }

  /** Static text drawn on the background. Positions in metres from the panel centre. */
  addLabel(id, { x = 0, y = 0, text = '', size = 0.04, color = '#eef0ff', align = 'center', font = UI_FONT, weight = 600, maxWidth = 0 }) {
    this.labels.set(id, { x, y, text, size, color, align, font, weight, maxWidth });
    this.dirty = true;
  }
  setLabel(id, text, extra) {
    const l = this.labels.get(id);
    if (!l) return;
    if (l.text !== text || extra) { l.text = text; if (extra) Object.assign(l, extra); this.dirty = true; }
  }

  redraw() {
    const ctx = this.canvas.getContext('2d');
    const W = this.canvas.width, H = this.canvas.height;
    ctx.clearRect(0, 0, W, H);
    roundRect(ctx, 3, 3, W - 6, H - 6, 34);
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, 'rgba(22,12,44,0.92)');
    grad.addColorStop(1, 'rgba(10,6,24,0.92)');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(140,100,255,0.55)';
    ctx.shadowColor = 'rgba(124,77,255,0.8)';
    ctx.shadowBlur = 24;
    ctx.stroke();
    ctx.shadowBlur = 0;
    // Accent line under the title.
    if (this.title) {
      ctx.font = `800 ${0.07 * PPM}px ${DISPLAY_FONT}`;
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = '#19e6ff'; ctx.shadowBlur = 16;
      ctx.fillText(this.title, 0.06 * PPM, 0.11 * PPM);
      ctx.shadowBlur = 0;
      if (this.subtitle) {
        ctx.font = `500 ${0.034 * PPM}px ${UI_FONT}`;
        ctx.fillStyle = 'rgba(200,195,240,0.8)';
        ctx.fillText(this.subtitle, 0.06 * PPM, 0.16 * PPM);
      }
      const lg = ctx.createLinearGradient(0.06 * PPM, 0, W * 0.6, 0);
      lg.addColorStop(0, '#ff2d95'); lg.addColorStop(1, 'rgba(25,230,255,0)');
      ctx.fillStyle = lg;
      ctx.fillRect(0.06 * PPM, 0.185 * PPM, W * 0.55, 3);
    }
    for (const l of this.labels.values()) {
      ctx.font = `${l.weight} ${l.size * PPM}px ${l.font}`;
      ctx.fillStyle = l.color;
      ctx.textAlign = l.align;
      ctx.textBaseline = 'middle';
      const px = W / 2 + l.x * PPM;
      const py = H / 2 - l.y * PPM;
      const lines = String(l.text).split('\n');
      lines.forEach((line, i) => {
        const txt = l.maxWidth ? fitText(ctx, line, l.maxWidth * PPM) : line;
        ctx.fillText(txt, px, py + i * l.size * PPM * 1.25);
      });
    }
    this.texture.needsUpdate = true;
    this.dirty = false;
  }

  update(dt) {
    if (this.dirty) this.redraw();
    for (const b of this.buttons) b.update(dt);
  }

  /** Meshes to raycast: buttons first, then the background (so rays stop at panels). */
  get pickables() { return this.group.visible ? [...this.buttons.map((b) => b.mesh), this.bg] : []; }
}

/** Handles pointer rays (controllers, hands, mouse) over a set of panels. */
export class UIManager {
  constructor(scene, audio) {
    this.scene = scene;
    this.audio = audio;
    this.panels = [];
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 6;
    this.pointers = new Map(); // key -> {hover, pressed, line, dot}
    this.enabled = true;
  }

  add(panel) { this.panels.push(panel); this.scene.add(panel.group); return panel; }

  _pointer(key) {
    let p = this.pointers.get(key);
    if (!p) {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.6 }));
      line.visible = false;
      line.renderOrder = 60;
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }));
      dot.visible = false;
      dot.renderOrder = 61;
      this.scene.add(line, dot);
      p = { hover: null, pressed: null, line, dot, visible: false };
      this.pointers.set(key, p);
    }
    return p;
  }

  hidePointer(key) {
    const p = this.pointers.get(key);
    if (p) { p.line.visible = false; p.dot.visible = false; if (p.hover) { p.hover.setHover(false); p.hover = null; } }
  }

  /**
   * Update one pointer. `origin`/`direction` in world space. `showRay` draws the controller ray.
   * Returns the hovered button (or null).
   */
  pointAt(key, origin, direction, showRay = true) {
    const p = this._pointer(key);
    if (!this.enabled) { this.hidePointer(key); return null; }
    this.raycaster.set(origin, direction);
    const pickables = [];
    for (const panel of this.panels) pickables.push(...panel.pickables);
    let hit = null;
    if (pickables.length) {
      const hits = this.raycaster.intersectObjects(pickables, false);
      hit = hits.length ? hits[0] : null;
    }
    const button = hit && hit.object.userData.button ? hit.object.userData.button : null;
    if (p.hover !== button) {
      if (p.hover) p.hover.setHover(false);
      p.hover = button;
      if (button && !button.disabled) { button.setHover(true); this.audio.playUiHover(); }
    }
    if (showRay) {
      const len = hit ? hit.distance : 2.5;
      p.line.visible = true;
      p.line.position.copy(origin);
      p.line.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), direction);
      p.line.scale.set(1, 1, len);
      p.line.material.opacity = button ? 0.9 : 0.35;
      p.dot.visible = !!hit;
      if (hit) p.dot.position.copy(hit.point);
      p.dot.material.color.set(button ? 0x19e6ff : 0xffffff);
    } else {
      p.line.visible = false;
      p.dot.visible = !!hit;
      if (hit) p.dot.position.copy(hit.point);
    }
    return button;
  }

  pressStart(key) {
    const p = this._pointer(key);
    p.pressed = p.hover;
    if (p.pressed) p.pressed.setPressed(true);
  }

  pressEnd(key) {
    const p = this._pointer(key);
    const b = p.pressed;
    p.pressed = null;
    if (!b) return false;
    b.setPressed(false);
    if (p.hover === b && b.click()) { this.audio.playUiClick(); return true; }
    return false;
  }

  update(dt) { for (const panel of this.panels) panel.update(dt); }
}
