// The arena. In VR mode it is a synthwave horizon: sky dome, striped sun, neon grid, mountain
// ridge, glass towers and a tunnel of rings that pulse with the music. In passthrough mode
// everything that would hide the real room is switched off and only the "holographic" lane
// (guide lines, chevrons, strike zone, rings) stays.

import * as THREE from 'three';
import { COLORS, makeGridMaterial, makeSkyMaterial, makeSunMaterial, makeHaloSprite, getSoftSpriteTexture, makeEnvironmentCubeMap } from './Materials.js';
import { makeRng } from '../util/math.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

export class Environment {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Group} laneRoot  group positioned/rotated to the player's start pose
   */
  constructor(scene, laneRoot) {
    this.scene = scene;
    this.laneRoot = laneRoot;
    this.mode = 'vr';
    this.beatPulse = 0;
    this.flashColor = new THREE.Color();
    this.flashAmount = 0;
    this.rng = makeRng(1337);
    this.time = 0;

    this.arena = new THREE.Group();   // VR only
    this.lane = new THREE.Group();    // both modes
    laneRoot.add(this.arena, this.lane);

    this.skyGroup = new THREE.Group(); // follows the head, VR only
    scene.add(this.skyGroup);

    this.envMap = makeEnvironmentCubeMap();
    this._buildLights();
    this._buildSky();
    this._buildFloor();
    this._buildHorizon();
    this._buildRings();
    this._buildLaneGuides();
    this._buildDust();
    this.setMode('vr');
  }

  _buildLights() {
    this.hemi = new THREE.HemisphereLight(0x7a55c8, 0x120820, 1.1);
    this.sun = new THREE.DirectionalLight(0xffb8d8, 1.4);
    this.sun.position.set(0.5, 0.45, -1);
    this.fill = new THREE.DirectionalLight(0x40e0ff, 0.5);
    this.fill.position.set(-1, 0.8, 0.6);
    this.scene.add(this.hemi, this.sun, this.fill);
  }

  _buildSky() {
    this.skyMat = makeSkyMaterial();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(480, 32, 16), this.skyMat);
    dome.frustumCulled = false;
    dome.renderOrder = -10;
    this.skyGroup.add(dome);

    // Stars
    const count = 1400;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const rng = this.rng;
    for (let i = 0; i < count; i++) {
      const u = rng(), v = rng();
      const theta = u * Math.PI * 2;
      const phi = Math.acos(1 - v) * 0.5; // upper hemisphere, denser toward the top
      const r = 440;
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.cos(phi) * 0.9 + 4;
      pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
      const bright = 0.35 + rng() * 0.65;
      const tint = rng();
      col[i * 3] = bright * (tint < 0.2 ? 1.0 : 0.8);
      col[i * 3 + 1] = bright * 0.85;
      col[i * 3 + 2] = bright * (tint > 0.7 ? 1.0 : 0.9);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, map: getSoftSpriteTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.stars.renderOrder = -9;
    this.skyGroup.add(this.stars);

    // Retro sun on the horizon ahead.
    this.sunMat = makeSunMaterial();
    this.sunMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.sunMat);
    this.sunMesh.scale.setScalar(150);
    this.sunMesh.position.set(0, 46, -430);
    this.sunMesh.renderOrder = -8;
    this.arena.add(this.sunMesh);
    this.sunHalo = makeHaloSprite('#ff5aa0', 420, 0.45);
    this.sunHalo.position.copy(this.sunMesh.position);
    this.sunHalo.renderOrder = -8;
    this.arena.add(this.sunHalo);
  }

  _buildFloor() {
    this.gridMat = makeGridMaterial();
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(420, 420, 1, 1), this.gridMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.002;
    floor.renderOrder = -5;
    this.floor = floor;
    this.arena.add(floor);
  }

  _buildHorizon() {
    // Mountain ridge: a dark silhouette ring with a neon rim line.
    const segs = 220;
    const radius = 140;
    const top = new Float32Array((segs + 1) * 3);
    const verts = new Float32Array((segs + 1) * 2 * 3);
    const idx = [];
    const rng = makeRng(99);
    const phase = [rng() * 6.28, rng() * 6.28, rng() * 6.28];
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const h = 6 + 9 * Math.abs(Math.sin(a * 3 + phase[0])) + 7 * Math.abs(Math.sin(a * 7 + phase[1])) + 3 * Math.sin(a * 17 + phase[2]) + 10 * Math.max(0, Math.sin(a * 1.5 + 1.2));
      const x = Math.cos(a) * radius, z = Math.sin(a) * radius;
      verts.set([x, -2, z], i * 6);
      verts.set([x, h, z], i * 6 + 3);
      top.set([x, h, z], i * 3);
      if (i < segs) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    g.setIndex(idx);
    const ridge = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x08040f, side: THREE.DoubleSide }));
    ridge.renderOrder = -6;
    this.arena.add(ridge);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(top, 3));
    this.ridgeLine = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xff2d95, transparent: true, opacity: 0.8 }));
    this.ridgeLine.renderOrder = -6;
    this.arena.add(this.ridgeLine);

    // Glass towers with neon edge strips.
    const count = 90;
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    const towerMat = new THREE.MeshStandardMaterial({ color: 0x0b0718, emissive: 0x120a2a, metalness: 0.7, roughness: 0.3, envMap: this.envMap, envMapIntensity: 0.8 });
    this.towers = new THREE.InstancedMesh(box, towerMat, count);
    const stripMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    this.strips = new THREE.InstancedMesh(box, stripMat, count);
    this.towerData = [];
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    const r2 = makeRng(7);
    for (let i = 0; i < count; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const x = side * (7 + r2() * 38 + (i % 5) * 3);
      const z = -8 - r2() * 130;
      const w = 1.5 + r2() * 3.5;
      const h = 3 + r2() * 22 + Math.max(0, 30 - Math.abs(x)) * 0.2;
      const d = 1.5 + r2() * 3;
      this.towerData.push({ x, z, w, h, d, phase: r2() * 6.28, speed: 0.5 + r2() });
      m.compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion(), new THREE.Vector3(w, h, d));
      this.towers.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(x - side * w * 0.5, 0, z + d * 0.5), new THREE.Quaternion(), new THREE.Vector3(0.12, h, 0.12));
      this.strips.setMatrixAt(i, m);
      c.copy(i % 3 === 0 ? COLORS.right : COLORS.left).multiplyScalar(0.9);
      this.strips.setColorAt(i, c);
    }
    this.towers.instanceMatrix.needsUpdate = true;
    this.strips.instanceMatrix.needsUpdate = true;
    this.arena.add(this.towers, this.strips);

    // Light beams beside the lane.
    this.beams = [];
    const beamGeo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 10; i++) {
      const mat = new THREE.SpriteMaterial({ map: getSoftSpriteTexture(), color: i % 2 ? COLORS.left : COLORS.right, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.35 });
      const s = new THREE.Sprite(mat);
      const side = i % 2 ? -1 : 1;
      s.position.set(side * (4 + (i % 3)), 9, -14 - i * 7);
      s.scale.set(1.6, 26, 1);
      s.userData.base = 0.25 + (i % 3) * 0.05;
      this.beams.push(s);
      this.arena.add(s);
    }
    void beamGeo;
  }

  _buildRings() {
    this.rings = [];
    const geo = new THREE.TorusGeometry(2.6, 0.035, 6, 64);
    for (let i = 0; i < 8; i++) {
      const color = i % 2 ? COLORS.violet : COLORS.right;
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
      const ring = new THREE.Mesh(geo, mat);
      ring.position.set(0, 1.9, -6 - i * 5.5);
      ring.rotation.z = Math.PI / 6 * (i % 2);
      ring.userData.color = color;
      this.rings.push(ring);
      this.lane.add(ring);
    }
  }

  _buildLaneGuides() {
    // Two glowing guide lines on the floor.
    const len = 48;
    const mk = (x) => {
      const g = new THREE.PlaneGeometry(0.06, len, 1, 8);
      const colors = new Float32Array(g.attributes.position.count * 3);
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const t = (pos.getY(i) + len / 2) / len; // 0 near player .. 1 far
        const fade = Math.max(0, 1 - t) * 0.9 + 0.1;
        colors[i * 3] = COLORS.violet.r * fade; colors[i * 3 + 1] = COLORS.violet.g * fade; colors[i * 3 + 2] = COLORS.violet.b * fade;
      }
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0.004, -len / 2 + 1);
      return m;
    };
    this.lane.add(mk(-1.0), mk(1.0));

    // Chevrons flowing toward the player at note speed.
    const shape = new THREE.Shape();
    shape.moveTo(-0.35, 0.25); shape.lineTo(0, 0); shape.lineTo(0.35, 0.25); shape.lineTo(0.35, 0.12); shape.lineTo(0, -0.13); shape.lineTo(-0.35, 0.12); shape.closePath();
    const chevGeo = new THREE.ShapeGeometry(shape);
    chevGeo.rotateX(-Math.PI / 2);
    this.chevronCount = 14;
    this.chevrons = new THREE.InstancedMesh(chevGeo, new THREE.MeshBasicMaterial({ color: COLORS.right, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), this.chevronCount);
    this.chevrons.frustumCulled = false;
    this.lane.add(this.chevrons);

    // Strike marker: a glowing line on the floor plus two short posts at the sides of the lane.
    // Nothing sits at eye level, so the view down the lane stays clear.
    this.strike = new THREE.Group();
    const barMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
    this.strikeMat = barMat;
    const bar = new THREE.BoxGeometry(1, 1, 1);
    this.strikeParts = [new THREE.Mesh(bar, barMat), new THREE.Mesh(bar, barMat), new THREE.Mesh(bar, barMat)];
    for (const m of this.strikeParts) this.strike.add(m);
    this.strikeCorners = [];
    for (let i = 0; i < 2; i++) { const h = makeHaloSprite('#b388ff', 0.22, 0.6); this.strikeCorners.push(h); this.strike.add(h); }
    const glowLine = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: getSoftSpriteTexture(), color: 0xb388ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    glowLine.rotation.x = -Math.PI / 2;
    this.strikeGlow = glowLine;
    this.strike.add(glowLine);
    this.lane.add(this.strike);
    this.setStrikeZone(1.3, 0.75, 0.5, -0.55);
  }

  setStrikeZone(centerY, halfW, halfH, z) {
    const [line, left, right] = this.strikeParts;
    const w = halfW + 0.3;
    line.position.set(0, 0.012, z); line.scale.set(w * 2, 0.012, 0.03);
    const postH = Math.max(0.3, centerY - halfH - 0.15);
    left.position.set(-w, postH / 2, z); left.scale.set(0.016, postH, 0.016);
    right.position.set(w, postH / 2, z); right.scale.set(0.016, postH, 0.016);
    this.strikeCorners[0].position.set(-w, postH, z);
    this.strikeCorners[1].position.set(w, postH, z);
    this.strikeGlow.position.set(0, 0.006, z);
    this.strikeGlow.scale.set(w * 2 + 0.6, 0.5, 1);
    void centerY;
  }

  _buildDust() {
    const count = 260;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (this.rng() - 0.5) * 8;
      pos[i * 3 + 1] = this.rng() * 3.2;
      pos[i * 3 + 2] = -this.rng() * 14 + 2;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.02, color: 0xbfaaff, map: getSoftSpriteTexture(), transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.dust.frustumCulled = false;
    this.lane.add(this.dust);
  }

  setMode(mode) {
    this.mode = mode;
    const vr = mode !== 'ar';
    this.arena.visible = vr;
    this.skyGroup.visible = vr;
    this.scene.background = vr ? COLORS.sky.clone() : null;
    this.scene.fog = vr ? new THREE.FogExp2(COLORS.fog.getHex(), 0.016) : null;
    this.scene.environment = vr ? this.envMap : null;
    if (vr) {
      this.hemi.color.set(0x7a55c8); this.hemi.groundColor.set(0x120820); this.hemi.intensity = 1.1;
      this.sun.color.set(0xffb8d8); this.sun.intensity = 1.4;
      this.fill.intensity = 0.5;
    } else {
      // Neutral light so colours read correctly over the real room.
      this.hemi.color.set(0xffffff); this.hemi.groundColor.set(0x667788); this.hemi.intensity = 1.3;
      this.sun.color.set(0xffffff); this.sun.intensity = 1.0;
      this.fill.intensity = 0.35;
    }
    for (const r of this.rings) r.material.opacity = vr ? 0.55 : 0.4;
    this.chevrons.material.opacity = vr ? 0.35 : 0.5;
  }

  setReducedMotion(on) { this.reducedMotion = on; }

  /** Call when a beat happens (music clock). */
  onBeat(strength = 1) { this.beatPulse = Math.max(this.beatPulse, strength); }

  /** Brief tint of the whole arena, e.g. combo milestones. */
  flash(color, amount = 1) { this.flashColor.set(color); this.flashAmount = amount; }

  /**
   * @param {number} dt
   * @param {{songTime:number, speed:number, energy:{bass:number,mid:number,high:number,level:number}, headWorld:THREE.Vector3}} ctx
   */
  update(dt, ctx) {
    this.time += dt;
    const e = ctx.energy;
    this.beatPulse *= Math.exp(-dt * 5);
    this.flashAmount *= Math.exp(-dt * 4);
    const pulse = this.beatPulse;
    const scroll = this.reducedMotion ? 0 : (ctx.songTime > 0 ? ctx.songTime * ctx.speed : this.time * 1.5);

    if (this.mode !== 'ar') {
      this.skyGroup.position.copy(ctx.headWorld);
      this.skyMat.uniforms.uEnergy.value = e.level;
      this.sunMat.uniforms.uTime.value = this.time;
      this.sunMat.uniforms.uEnergy.value = e.bass;
      this.sunHalo.material.opacity = 0.35 + e.bass * 0.35 + pulse * 0.2;
      this.gridMat.uniforms.uScroll.value = scroll % 4;
      this.gridMat.uniforms.uPulse.value = pulse * 0.8 + e.bass * 0.5;
      this.ridgeLine.material.opacity = 0.5 + e.mid * 0.5;
      this.ridgeLine.material.color.copy(COLORS.left).lerp(this.flashColor, this.flashAmount);
      // Towers breathe with the bass.
      if (!this.reducedMotion) {
        const m = _m, q = _q, p = _p, s = _s;
        const data = this.towerData;
        const stride = 3; // update a third of the towers per frame
        const off = Math.floor(this.time * 60) % stride;
        for (let i = off; i < data.length; i += stride) {
          const d = data[i];
          const grow = 1 + e.bass * 0.18 * Math.sin(d.phase + this.time * d.speed) + pulse * 0.05;
          p.set(d.x, 0, d.z); s.set(d.w, d.h * grow, d.d);
          m.compose(p, q, s); this.towers.setMatrixAt(i, m);
        }
        this.towers.instanceMatrix.needsUpdate = true;
      }
      this.strips.material.opacity = 0.55 + e.high * 0.6 + pulse * 0.3;
      for (const b of this.beams) b.material.opacity = b.userData.base + e.mid * 0.35 + pulse * 0.25;
      if (this.scene.background) this.scene.background.copy(COLORS.sky).lerp(this.flashColor, this.flashAmount * 0.35);
    }

    // Rings: traveling pulse away from the player on each beat.
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      const wave = Math.max(0, pulse - i * 0.09) * 1.6;
      const base = this.mode === 'ar' ? 0.35 : 0.45;
      r.material.opacity = Math.min(1, base + wave + e.level * 0.25);
      r.material.color.copy(r.userData.color).lerp(this.flashColor, this.flashAmount);
      if (!this.reducedMotion) r.rotation.z += dt * (i % 2 ? 0.15 : -0.12);
      r.scale.setScalar(1 + wave * 0.04);
    }

    // Chevrons conveyor.
    {
      const m = _m;
      const spacing = 48 / this.chevronCount;
      for (let i = 0; i < this.chevronCount; i++) {
        let z = ((i * spacing + scroll) % 48);
        z = -48 + z + 1;
        m.makeTranslation(0, 0.006, z);
        this.chevrons.setMatrixAt(i, m);
      }
      this.chevrons.instanceMatrix.needsUpdate = true;
      this.chevrons.material.opacity = (this.mode === 'ar' ? 0.45 : 0.3) + pulse * 0.3;
    }

    // Strike marker glow.
    this.strikeMat.opacity = 0.45 + pulse * 0.45;
    for (const c of this.strikeCorners) c.material.opacity = 0.45 + pulse * 0.5;
    this.strikeGlow.material.opacity = 0.3 + pulse * 0.35;

    // Dust drifts toward the player.
    if (!this.reducedMotion) {
      const arr = this.dust.geometry.attributes.position.array;
      const v = 0.35 + ctx.speed * 0.03;
      for (let i = 0; i < arr.length; i += 3) {
        arr[i + 2] += v * dt;
        arr[i + 1] += Math.sin(this.time * 0.7 + i) * 0.02 * dt;
        if (arr[i + 2] > 2.5) { arr[i + 2] -= 16; arr[i] = (this.rng() - 0.5) * 8; }
      }
      this.dust.geometry.attributes.position.needsUpdate = true;
    }
  }
}
