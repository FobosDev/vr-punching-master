// In-world heads-up display: score, combo, multiplier, health and song progress on a floating
// panel above the lane, far enough away to be comfortable to read in VR.

import * as THREE from 'three';
import { makeCanvas, roundRect, makeTexture, UI_FONT, DISPLAY_FONT, fitText } from '../util/CanvasText.js';
import { formatScore } from '../util/math.js';

export class HUD {
  constructor(laneRoot) {
    this.canvas = makeCanvas(1024, 448);
    this.texture = makeTexture(this.canvas);
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4 * 448 / 1024), this.material);
    this.mesh.position.set(0, 2.4, -5.5);
    this.mesh.rotation.x = -0.12;
    this.mesh.renderOrder = 40;
    this.mesh.visible = false;
    laneRoot.add(this.mesh);
    this.state = { score: 0, combo: 0, multiplier: 1, health: 1, progress: 0, accuracy: 1, title: '', difficulty: '' };
    this.shown = { ...this.state, score: -1 };
    this.comboFlash = 0;
    this.lastDraw = 0;
    this.time = 0;
  }

  setVisible(v) { this.mesh.visible = !!v; }
  setHeight(headY) { this.mesh.position.y = Math.max(2.0, headY + 0.8); }

  set(partial) { Object.assign(this.state, partial); }
  flashCombo() { this.comboFlash = 1; }

  update(dt) {
    this.time += dt;
    this.comboFlash *= Math.exp(-dt * 4);
    if (!this.mesh.visible) return;
    const s = this.state, d = this.shown;
    const changed = s.score !== d.score || s.combo !== d.combo || s.multiplier !== d.multiplier || Math.abs(s.health - d.health) > 0.005 || Math.abs(s.progress - d.progress) > 0.004 || s.title !== d.title || Math.abs(s.accuracy - d.accuracy) > 0.002;
    if (!changed && this.comboFlash < 0.02) return;
    if (this.time - this.lastDraw < 1 / 20) return;
    this.lastDraw = this.time;
    Object.assign(d, s);
    this.draw();
  }

  draw() {
    const ctx = this.canvas.getContext('2d');
    const W = this.canvas.width, H = this.canvas.height;
    const s = this.state;
    ctx.clearRect(0, 0, W, H);
    roundRect(ctx, 4, 4, W - 8, H - 8, 40);
    ctx.fillStyle = 'rgba(12,6,28,0.72)';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(140,100,255,0.5)';
    ctx.stroke();

    // Title / difficulty
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = `600 34px ${UI_FONT}`;
    ctx.fillStyle = 'rgba(200,195,240,0.85)';
    ctx.fillText(fitText(ctx, s.title, 560), 40, 52);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#19e6ff';
    ctx.fillText(s.difficulty.toUpperCase(), W - 40, 52);

    // Score
    ctx.textAlign = 'left';
    ctx.font = `800 110px ${DISPLAY_FONT}`;
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#19e6ff'; ctx.shadowBlur = 22;
    ctx.fillText(formatScore(s.score), 40, 150);
    ctx.shadowBlur = 0;

    // Combo & multiplier
    ctx.textAlign = 'right';
    const flash = this.comboFlash;
    ctx.font = `800 ${Math.round(64 + flash * 22)}px ${DISPLAY_FONT}`;
    ctx.fillStyle = s.combo > 0 ? (flash > 0.2 ? '#ffd166' : '#ff2d95') : 'rgba(255,255,255,0.35)';
    ctx.shadowColor = '#ff2d95'; ctx.shadowBlur = s.combo > 0 ? 18 : 0;
    ctx.fillText(`${s.combo}`, W - 40, 128);
    ctx.shadowBlur = 0;
    ctx.font = `600 30px ${UI_FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText('COMBO', W - 40, 182);
    ctx.font = `800 44px ${DISPLAY_FONT}`;
    ctx.fillStyle = s.multiplier >= 8 ? '#ffd166' : s.multiplier >= 4 ? '#19e6ff' : '#eef0ff';
    ctx.fillText(`x${s.multiplier}`, W - 240, 150);

    // Accuracy
    ctx.textAlign = 'left';
    ctx.font = `600 32px ${UI_FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(`${Math.round(s.accuracy * 100)}% accuracy`, 40, 222);

    // Health bar
    const bx = 40, by = 272, bw = W - 80, bh = 34;
    roundRect(ctx, bx, by, bw, bh, 17);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fill();
    const hw = Math.max(0, Math.min(1, s.health)) * (bw - 8);
    if (hw > 1) {
      roundRect(ctx, bx + 4, by + 4, hw, bh - 8, 13);
      const g = ctx.createLinearGradient(bx, 0, bx + bw, 0);
      if (s.health < 0.3) { g.addColorStop(0, '#ff3b3b'); g.addColorStop(1, '#ff7a3b'); }
      else { g.addColorStop(0, '#ff2d95'); g.addColorStop(1, '#19e6ff'); }
      ctx.fillStyle = g;
      ctx.shadowColor = s.health < 0.3 ? '#ff3b3b' : '#19e6ff'; ctx.shadowBlur = 14;
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.font = `600 24px ${UI_FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('ENERGY', bx + 14, by + bh / 2 + 1);

    // Progress
    const py = 352;
    roundRect(ctx, bx, py, bw, 14, 7);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fill();
    const pw = Math.max(0, Math.min(1, s.progress)) * bw;
    if (pw > 1) { roundRect(ctx, bx, py, pw, 14, 7); ctx.fillStyle = '#b388ff'; ctx.fill(); }
    ctx.font = `500 24px ${UI_FONT}`;
    ctx.fillStyle = 'rgba(200,195,240,0.7)';
    ctx.fillText('SONG PROGRESS', bx, py + 44);
    this.texture.needsUpdate = true;
  }
}
