// Boxing gloves. They live at the scene root and copy the pose of whatever drives them each
// frame: XR controller grip, tracked hand joints, or the demo bot. They also estimate punch
// velocity (used for hit detection and scoring) and draw a speed trail.

import * as THREE from 'three';
import { COLORS, makeRibbonMaterial, makeHaloSprite } from './Materials.js';

const TRAIL_LEN = 16;
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _side = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _toCam = new THREE.Vector3();
const _fwd = new THREE.Vector3();

class Glove {
  constructor(hand, scene) {
    this.hand = hand; // 'L' | 'R'
    this.color = hand === 'L' ? COLORS.left.clone() : COLORS.right.clone();
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);

    // Visual model ------------------------------------------------------
    const tint = this.color;
    this.bodyMat = new THREE.MeshStandardMaterial({ color: tint.clone().multiplyScalar(0.85), roughness: 0.38, metalness: 0.12, emissive: tint, emissiveIntensity: 0.25 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.085, 28, 20), this.bodyMat);
    body.scale.set(1, 0.92, 1.18);
    body.position.z = -0.01;
    const thumb = new THREE.Mesh(new THREE.SphereGeometry(0.036, 16, 12), this.bodyMat);
    thumb.position.set(hand === 'L' ? 0.072 : -0.072, 0.005, 0.015);
    thumb.scale.set(1, 0.9, 1.3);
    // Padded wrist seen from the wearer's side, then a short dark cuff with two light bands.
    const wrist = new THREE.Mesh(new THREE.SphereGeometry(0.062, 24, 16), this.bodyMat);
    wrist.position.z = 0.075;
    wrist.scale.set(1, 0.95, 0.8);
    this.cuffMat = new THREE.MeshStandardMaterial({ color: tint.clone().multiplyScalar(0.35), roughness: 0.55, metalness: 0.15, emissive: tint, emissiveIntensity: 0.05, side: THREE.DoubleSide });
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.056, 0.06, 0.05, 24, 1, true), this.cuffMat);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.z = 0.1;
    this.bandMat = new THREE.MeshBasicMaterial({ color: tint.clone().lerp(new THREE.Color(1, 1, 1), 0.35) });
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.069, 0.009, 10, 40), this.bandMat);
    band.position.z = 0.055;
    const band2 = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.006, 10, 40), this.bandMat);
    band2.position.z = 0.12;
    // Knuckle ridge
    const ridge = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 10, 32, Math.PI), new THREE.MeshStandardMaterial({ color: tint.clone().multiplyScalar(0.7), roughness: 0.3, metalness: 0.1, emissive: tint, emissiveIntensity: 0.15 }));
    ridge.position.set(0, 0.03, -0.065);
    ridge.rotation.x = Math.PI / 2;
    this.halo = makeHaloSprite(tint.getStyle(), 0.3, 0.25);
    this.group.add(body, thumb, wrist, cuff, band, band2, ridge, this.halo);
    this.model = this.group;

    // Motion state ------------------------------------------------------
    this.position = new THREE.Vector3();      // world
    this.prevPosition = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.velocity = new THREE.Vector3();
    this.speed = 0;
    this.history = [];
    for (let i = 0; i < 8; i++) this.history.push({ t: 0, p: new THREE.Vector3() });
    this.histHead = 0;
    this.tracked = false;
    this.source = 'none'; // 'controller' | 'hand' | 'bot'

    // Trail --------------------------------------------------------------
    this.trailPts = [];
    for (let i = 0; i < TRAIL_LEN; i++) this.trailPts.push(new THREE.Vector3());
    this.trailCount = 0;
    const g = new THREE.BufferGeometry();
    this.trailPos = new Float32Array(TRAIL_LEN * 2 * 3);
    this.trailAlpha = new Float32Array(TRAIL_LEN * 2);
    g.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.trailAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < TRAIL_LEN - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 100);
    this.trailMat = makeRibbonMaterial(tint);
    this.trail = new THREE.Mesh(g, this.trailMat);
    this.trail.frustumCulled = false;
    this.trail.visible = false;
    this.trailOpacity = 0;
    scene.add(this.trail);
  }

  setColor(color) {
    this.color.copy(color);
    this.bodyMat.color.copy(color).multiplyScalar(0.85);
    this.bodyMat.emissive.copy(color);
    this.cuffMat.color.copy(color).multiplyScalar(0.35);
    this.cuffMat.emissive.copy(color);
    this.cuffMat.side = THREE.DoubleSide;
    this.bandMat.color.copy(color).lerp(new THREE.Color(1, 1, 1), 0.35);
    this.halo.material.color.copy(color);
    this.trailMat.uniforms.uColor.value.copy(color);
  }

  /** Feed a new world pose for this frame. */
  setPose(position, quaternion, source) {
    this.position.copy(position);
    this.quaternion.copy(quaternion);
    this.tracked = true;
    this.source = source;
  }

  update(dt, now, cameraPos) {
    this.group.visible = this.tracked;
    if (!this.tracked) { this.trail.visible = false; return; }
    // Velocity from a short history window (≈ 45 ms) to filter jitter but keep punches sharp.
    const h = this.history;
    this.histHead = (this.histHead + 1) % h.length;
    h[this.histHead].t = now;
    h[this.histHead].p.copy(this.position);
    // Always use at least the previous frame; extend the window while samples are recent.
    let oldest = (this.histHead - 1 + h.length) % h.length;
    for (let i = 2; i < h.length; i++) {
      const j = (this.histHead - i + h.length) % h.length;
      if (h[j].t === 0 || now - h[j].t > 0.045) break;
      oldest = j;
    }
    const span = now - h[oldest].t;
    if (h[oldest].t !== 0 && span > 0.004 && span < 0.5) {
      this.velocity.subVectors(this.position, h[oldest].p).divideScalar(span);
    } else {
      this.velocity.multiplyScalar(0.8);
    }
    this.speed = this.velocity.length();

    this.group.position.copy(this.position);
    this.group.quaternion.copy(this.quaternion);
    const glow = THREE.MathUtils.clamp((this.speed - 1.0) / 3.5, 0, 1);
    this.bodyMat.emissiveIntensity = 0.22 + glow * 1.1;
    this.halo.material.opacity = 0.18 + glow * 0.6;
    this.halo.scale.setScalar(0.28 + glow * 0.18);

    this._updateTrail(dt, cameraPos, glow);
  }

  _updateTrail(dt, cameraPos, glow) {
    // Shift history and push the current position.
    const pts = this.trailPts;
    const last = pts[0];
    if (this.trailCount === 0 || last.distanceToSquared(this.position) > 0.0001) {
      const tail = pts.pop();
      tail.copy(this.position);
      pts.unshift(tail);
      this.trailCount = Math.min(TRAIL_LEN, this.trailCount + 1);
    }
    const target = this.speed > 1.6 ? 1 : 0;
    this.trailOpacity += (target - this.trailOpacity) * Math.min(1, dt * (target ? 14 : 6));
    this.trail.visible = this.trailOpacity > 0.02 && this.trailCount > 2;
    if (!this.trail.visible) return;
    const width = 0.025 + Math.min(0.05, this.speed * 0.012);
    for (let i = 0; i < TRAIL_LEN; i++) {
      const p = pts[Math.min(i, this.trailCount - 1)];
      const next = pts[Math.min(i + 1, this.trailCount - 1)];
      _dir.subVectors(p, next);
      if (_dir.lengthSq() < 1e-8) _dir.set(0, 0, -1);
      _toCam.subVectors(cameraPos, p).normalize();
      _side.crossVectors(_dir.normalize(), _toCam).normalize();
      if (_side.lengthSq() < 0.5) _side.set(0, 1, 0);
      const k = 1 - i / (TRAIL_LEN - 1);
      const w = width * (0.3 + 0.7 * k);
      const o = i * 6;
      this.trailPos[o] = p.x + _side.x * w; this.trailPos[o + 1] = p.y + _side.y * w; this.trailPos[o + 2] = p.z + _side.z * w;
      this.trailPos[o + 3] = p.x - _side.x * w; this.trailPos[o + 4] = p.y - _side.y * w; this.trailPos[o + 5] = p.z - _side.z * w;
      const a = k * k * (i < this.trailCount ? 1 : 0);
      this.trailAlpha[i * 2] = a; this.trailAlpha[i * 2 + 1] = a;
    }
    this.trail.geometry.attributes.position.needsUpdate = true;
    this.trail.geometry.attributes.aAlpha.needsUpdate = true;
    this.trailMat.uniforms.uOpacity.value = this.trailOpacity * (0.35 + glow * 0.65);
  }

  clearTrail() { this.trailCount = 0; this.trail.visible = false; this.trailOpacity = 0; }
}

export class Gloves {
  constructor(scene) {
    this.scene = scene;
    this.L = new Glove('L', scene);
    this.R = new Glove('R', scene);
    this.list = [this.L, this.R];
    this.swapped = false;
    this.fistOffset = new THREE.Vector3(0, 0.0, -0.03);
  }

  setSwapped(on) {
    if (this.swapped === !!on) return;
    this.swapped = !!on;
    // Swapping colours only: the left controller still drives the left glove, but it now wants cyan notes.
    this.L.setColor(on ? COLORS.right : COLORS.left);
    this.R.setColor(on ? COLORS.left : COLORS.right);
  }

  /** The note type (colour) this glove is responsible for. */
  noteTypeFor(glove) {
    if (!this.swapped) return glove.hand;
    return glove.hand === 'L' ? 'R' : 'L';
  }
  gloveForType(type) {
    if (type === 'L') return this.swapped ? this.R : this.L;
    if (type === 'R') return this.swapped ? this.L : this.R;
    return null;
  }

  beginFrame() { this.L.tracked = false; this.R.tracked = false; }

  /** Drive a glove from an Object3D whose world matrix is current (XR grip). */
  driveFromObject(hand, object, source = 'controller') {
    object.matrixWorld.decompose(_p, _q, _s);
    _p.add(this.fistOffset.clone().applyQuaternion(_q));
    (hand === 'L' ? this.L : this.R).setPose(_p, _q, source);
  }

  /**
   * Drive a glove from WebXR hand joints (three.js XRHandSpace .joints). Joint spaces point
   * -Z toward the fingertips, so the glove (knuckles at -Z) can take the joint orientation.
   */
  driveFromHand(hand, handSpace) {
    const joints = handSpace.joints;
    if (!joints) return false;
    const j = joints['middle-finger-metacarpal'] || joints['wrist'];
    if (!j || j.visible === false) return false;
    j.updateMatrixWorld(true);
    j.matrixWorld.decompose(_p, _q, _s);
    _p.add(_fwd.set(0, 0, j === joints['wrist'] ? -0.09 : -0.035).applyQuaternion(_q));
    (hand === 'L' ? this.L : this.R).setPose(_p, _q, 'hand');
    return true;
  }

  drive(hand, position, quaternion, source = 'bot') {
    (hand === 'L' ? this.L : this.R).setPose(position, quaternion, source);
  }

  update(dt, now, cameraPos) {
    this.L.update(dt, now, cameraPos);
    this.R.update(dt, now, cameraPos);
  }

  clearTrails() { this.L.clearTrail(); this.R.clearTrail(); }
}
