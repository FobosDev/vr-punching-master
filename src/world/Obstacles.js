// Targets, bombs and walls. Everything is instanced: one draw call per visual layer no matter
// how many obstacles are in flight. Positions are derived from song time every frame, so the
// game never drifts from the music.

import * as THREE from 'three';
import { COLORS, makeWallMaterial } from './Materials.js';

export const MAX_TARGETS = 48;
export const MAX_BOMBS = 16;
export const MAX_WALLS = 6;

const TARGET_RADIUS = 0.15;
const GLOVE_RADIUS = 0.085;
const CONTACT = TARGET_RADIUS + GLOVE_RADIUS + 0.03;
const BOMB_CONTACT = 0.14 + GLOVE_RADIUS + 0.01;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
const _c = new THREE.Color();

// ---------------------------------------------------------------- shaders
const instancedHeader = /* glsl */`
  varying vec3 vN; varying vec3 vV; varying vec3 vColor; varying vec3 vLocal;
  void main() {
    mat4 model = modelMatrix;
    #ifdef USE_INSTANCING
      model = modelMatrix * instanceMatrix;
    #endif
    vec4 w = model * vec4(position, 1.0);
    vN = normalize(mat3(model) * normal);
    vV = cameraPosition - w.xyz;
    vLocal = position;
    vColor = vec3(1.0);
    #ifdef USE_INSTANCING_COLOR
      vColor = instanceColor;
    #endif
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const orbFrag = /* glsl */`
  uniform float uTime;
  varying vec3 vN; varying vec3 vV; varying vec3 vColor; varying vec3 vLocal;
  void main() {
    vec3 n = normalize(vN); vec3 v = normalize(vV);
    vec3 l = normalize(vec3(0.35, 0.8, 0.5));
    float diff = 0.5 + 0.5 * dot(n, l);
    vec3 h = normalize(l + v);
    float spec = pow(max(dot(n, h), 0.0), 48.0);
    float facing = max(dot(n, v), 0.0);
    float fres = pow(1.0 - facing, 2.5);
    float pulse = 0.85 + 0.15 * sin(uTime * 6.0);
    // Subtle facets: darken bands across the sphere for a crystal look.
    float facet = 0.9 + 0.1 * step(0.5, fract(vLocal.y * 12.0 + vLocal.x * 7.0));
    vec3 col = vColor * (0.28 + 0.6 * diff) * facet;
    col += vColor * fres * 1.4 * pulse;
    col += vColor * pow(facing, 5.0) * 0.5 * pulse;
    col += vec3(1.0) * spec * 0.9;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

const shellFrag = /* glsl */`
  varying vec3 vN; varying vec3 vV; varying vec3 vColor; varying vec3 vLocal;
  void main() {
    vec3 n = normalize(vN); vec3 v = normalize(vV);
    float f = pow(1.0 - abs(dot(n, v)), 2.2);
    gl_FragColor = vec4(vColor * f * 1.3, f);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

const bombFrag = /* glsl */`
  uniform float uTime;
  varying vec3 vN; varying vec3 vV; varying vec3 vColor; varying vec3 vLocal;
  void main() {
    vec3 n = normalize(vN); vec3 v = normalize(vV);
    vec3 l = normalize(vec3(0.35, 0.8, 0.5));
    float diff = 0.5 + 0.5 * dot(n, l);
    vec3 h = normalize(l + v);
    float spec = pow(max(dot(n, h), 0.0), 30.0);
    float fres = pow(1.0 - max(dot(n, v), 0.0), 2.0);
    float pulse = 0.6 + 0.4 * sin(uTime * 9.0 + vLocal.x * 3.0);
    vec3 dark = vec3(0.06, 0.05, 0.08) * (0.4 + diff);
    vec3 red = vec3(1.0, 0.18, 0.2);
    float core = smoothstep(0.1, 0.13, length(vLocal)) ; // spikes are further out
    vec3 col = dark + red * fres * (0.8 + pulse * 0.8) + red * (1.0 - core) * 0.6 * pulse + vec3(1.0, 0.6, 0.6) * spec * 0.5;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

const tailVert = /* glsl */`
  varying vec2 vUv; varying vec3 vColor;
  void main() {
    mat4 model = modelMatrix;
    #ifdef USE_INSTANCING
      model = modelMatrix * instanceMatrix;
    #endif
    vUv = uv;
    vColor = vec3(1.0);
    #ifdef USE_INSTANCING_COLOR
      vColor = instanceColor;
    #endif
    gl_Position = projectionMatrix * viewMatrix * model * vec4(position, 1.0);
  }`;
const tailFrag = /* glsl */`
  varying vec2 vUv; varying vec3 vColor;
  void main() {
    float along = 1.0 - vUv.y;                 // 1 at the orb, 0 at the far end
    float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
    float a = along * along * across * across * 0.55;
    gl_FragColor = vec4(vColor * a, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

function makeSpikyGeometry() {
  const g = new THREE.IcosahedronGeometry(0.125, 1);
  const base = new THREE.IcosahedronGeometry(1, 0);
  const dirs = [];
  const bp = base.attributes.position;
  for (let i = 0; i < bp.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(bp, i).normalize();
    if (!dirs.some((d) => d.dot(v) > 0.999)) dirs.push(v);
  }
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();
    if (dirs.some((d) => d.dot(n) > 0.999)) v.multiplyScalar(1.7);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

function makeTailGeometry() {
  const len = 1.0, half = 0.11;
  const positions = [
    // horizontal quad (y = 0)
    -half, 0, 0, half, 0, 0, half, 0, -len, -half, 0, -len,
    // vertical quad (x = 0)
    0, -half, 0, 0, half, 0, 0, half, -len, 0, -half, -len,
  ];
  const uvs = [0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0];
  const idx = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  return g;
}

export class Obstacles {
  constructor(laneRoot) {
    this.root = new THREE.Group();
    laneRoot.add(this.root);
    this.time = 0;

    this.colsX = [-0.42, 0, 0.42];
    this.rowsY = [1.05, 1.3, 1.55];
    this.hitZ = -0.55;
    this.spawnZ = -34;
    this.speed = 9;
    this.headY = 1.6;

    // Instanced layers ---------------------------------------------------
    const orbGeo = new THREE.IcosahedronGeometry(0.14, 3);
    const shellGeo = new THREE.IcosahedronGeometry(0.19, 2);
    const ringGeo = new THREE.TorusGeometry(0.2, 0.011, 8, 48);
    this.orbMat = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } }, vertexShader: instancedHeader, fragmentShader: orbFrag });
    this.shellMat = new THREE.ShaderMaterial({ vertexShader: instancedHeader, fragmentShader: shellFrag, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    this.tailMat = new THREE.ShaderMaterial({ vertexShader: tailVert, fragmentShader: tailFrag, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.orbs = new THREE.InstancedMesh(orbGeo, this.orbMat, MAX_TARGETS);
    this.shells = new THREE.InstancedMesh(shellGeo, this.shellMat, MAX_TARGETS);
    this.rings = new THREE.InstancedMesh(ringGeo, this.ringMat, MAX_TARGETS);
    this.tails = new THREE.InstancedMesh(makeTailGeometry(), this.tailMat, MAX_TARGETS);
    this.bombMat = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } }, vertexShader: instancedHeader, fragmentShader: bombFrag });
    this.bombs = new THREE.InstancedMesh(makeSpikyGeometry(), this.bombMat, MAX_BOMBS);
    this.bombShells = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.2, 2), this.shellMat, MAX_BOMBS);
    for (const im of [this.orbs, this.shells, this.rings, this.tails, this.bombs, this.bombShells]) {
      im.frustumCulled = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < im.count; i++) { im.setMatrixAt(i, _zero); im.setColorAt(i, _c.set(0xffffff)); }
      im.instanceMatrix.needsUpdate = true;
      im.instanceColor.needsUpdate = true;
      this.root.add(im);
    }
    this.shells.renderOrder = 5; this.bombShells.renderOrder = 5; this.rings.renderOrder = 6; this.tails.renderOrder = 4;

    // Walls -----------------------------------------------------------------
    this.wallMeshes = [];
    for (let i = 0; i < MAX_WALLS; i++) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), makeWallMaterial(new THREE.Vector3(1, 1, 1)));
      mesh.visible = false;
      mesh.renderOrder = 8;
      this.root.add(mesh);
      this.wallMeshes.push(mesh);
    }

    // Slots ------------------------------------------------------------------
    this.targetSlots = Array.from({ length: MAX_TARGETS }, () => ({ active: false }));
    this.bombSlots = Array.from({ length: MAX_BOMBS }, () => ({ active: false }));
    this.wallSlots = Array.from({ length: MAX_WALLS }, () => ({ active: false }));
    this.map = null;
    this.noteIndex = 0;
    this.wallIndex = 0;
    this.songTime = -10;
    this.onMiss = null;      // (note, position) => void
    this.onWallHit = null;   // (wall, dt) => void
  }

  setLayout(headY) {
    this.headY = headY;
    const base = THREE.MathUtils.clamp(headY, 0.9, 2.1);
    this.rowsY = [base - 0.6, base - 0.34, base - 0.08];
  }

  loadMap(map) {
    this.clear();
    this.map = map;
    this.speed = map.speed;
    this.noteIndex = 0;
    this.wallIndex = 0;
  }

  clear() {
    for (const s of this.targetSlots) s.active = false;
    for (const s of this.bombSlots) s.active = false;
    for (const s of this.wallSlots) s.active = false;
    for (const im of [this.orbs, this.shells, this.rings, this.tails, this.bombs, this.bombShells]) {
      for (let i = 0; i < im.count; i++) im.setMatrixAt(i, _zero);
      im.instanceMatrix.needsUpdate = true;
    }
    for (const m of this.wallMeshes) m.visible = false;
  }

  get travelTime() { return (this.hitZ - this.spawnZ) / this.speed; }

  cellPosition(col, row, out) { return out.set(this.colsX[col], this.rowsY[row], this.hitZ); }

  _spawnNote(note) {
    if (note.type === 'B') {
      const slot = this.bombSlots.find((s) => !s.active);
      if (!slot) return;
      Object.assign(slot, { active: true, note, x: this.colsX[note.col], y: this.rowsY[note.row], z: this.spawnZ, prevZ: this.spawnZ, state: 'approach', stateTime: 0, spin: Math.random() * 6 });
      return;
    }
    const slot = this.targetSlots.find((s) => !s.active);
    if (!slot) return;
    const color = note.type === 'L' ? COLORS.left : note.type === 'R' ? COLORS.right : COLORS.any;
    Object.assign(slot, { active: true, note, x: this.colsX[note.col], y: this.rowsY[note.row], z: this.spawnZ, prevZ: this.spawnZ, state: 'approach', stateTime: 0, color, spin: Math.random() * 6 });
    const i = this.targetSlots.indexOf(slot);
    _c.copy(color);
    this.orbs.setColorAt(i, _c); this.shells.setColorAt(i, _c); this.rings.setColorAt(i, _c.clone().lerp(new THREE.Color(1, 1, 1), 0.3)); this.tails.setColorAt(i, _c);
    this.orbs.instanceColor.needsUpdate = true; this.shells.instanceColor.needsUpdate = true; this.rings.instanceColor.needsUpdate = true; this.tails.instanceColor.needsUpdate = true;
  }

  _spawnWall(wall) {
    const slot = this.wallSlots.find((s) => !s.active);
    if (!slot) return;
    const i = this.wallSlots.indexOf(slot);
    const length = Math.max(0.6, (wall.end - wall.t) * this.speed);
    const top = this.headY + 0.55;
    let x0, x1, y0, y1;
    if (wall.kind === 'left') { x0 = -1.25; x1 = -0.12; y0 = 0.25; y1 = top; }
    else if (wall.kind === 'right') { x0 = 0.12; x1 = 1.25; y0 = 0.25; y1 = top; }
    else { x0 = -1.1; x1 = 1.1; y0 = this.headY - 0.28; y1 = top + 0.3; }
    Object.assign(slot, { active: true, wall, x0, x1, y0, y1, length, hit: false });
    const mesh = this.wallMeshes[i];
    mesh.geometry.dispose();
    mesh.geometry = new THREE.BoxGeometry(x1 - x0, y1 - y0, length);
    mesh.material.uniforms.uSize.value.set(x1 - x0, y1 - y0, length);
    mesh.material.uniforms.uWarn.value = 0;
    mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0);
    mesh.visible = true;
  }

  /** Advance to the given song time. */
  update(songTime, dt) {
    this.time += dt;
    this.songTime = songTime;
    this.orbMat.uniforms.uTime.value = this.time;
    this.bombMat.uniforms.uTime.value = this.time;
    const map = this.map;
    if (!map) return;
    const speed = this.speed;
    const travel = this.travelTime;

    // Spawn ------------------------------------------------------------------
    while (this.noteIndex < map.notes.length && map.notes[this.noteIndex].t - songTime <= travel) {
      this._spawnNote(map.notes[this.noteIndex++]);
    }
    while (this.wallIndex < map.walls.length && map.walls[this.wallIndex].t - songTime <= (-this.spawnZ) / speed) {
      this._spawnWall(map.walls[this.wallIndex++]);
    }

    // Targets ----------------------------------------------------------------
    for (let i = 0; i < MAX_TARGETS; i++) {
      const s = this.targetSlots[i];
      if (!s.active) continue;
      s.prevZ = s.z;
      s.z = this.hitZ - (s.note.t - songTime) * speed;
      const age = travel - (s.note.t - songTime);
      let scale = THREE.MathUtils.smoothstep(age, 0, 0.5);
      let ringScale = 1;
      if (s.state === 'approach') {
        if (s.z > this.hitZ + 0.45) { // passed the player without being punched
          s.state = 'missed'; s.stateTime = 0;
          if (this.onMiss) this.onMiss(s.note, _p.set(s.x, s.y, s.z));
        }
        const tth = s.note.t - songTime;
        ringScale = 1 + THREE.MathUtils.clamp(tth, 0, 1) * 1.1;
      } else {
        s.stateTime += dt;
        if (s.state === 'hit') { scale = Math.max(0, 1 - s.stateTime * 8); if (s.stateTime > 0.15) s.active = false; }
        if (s.state === 'missed') { scale *= Math.max(0, 1 - s.stateTime * 2.5); if (s.stateTime > 0.45 || s.z > 2) s.active = false; }
        ringScale = 0;
      }
      if (!s.active) { this.orbs.setMatrixAt(i, _zero); this.shells.setMatrixAt(i, _zero); this.rings.setMatrixAt(i, _zero); this.tails.setMatrixAt(i, _zero); continue; }
      const near = THREE.MathUtils.clamp((s.z - this.spawnZ) / 10, 0, 1); // grows slightly when close for readability
      const sc = scale * (0.9 + near * 0.1);
      _q.setFromEuler(new THREE.Euler(this.time * 0.9 + s.spin, this.time * 1.3 + s.spin, 0));
      _m.compose(_p.set(s.x, s.y, s.z), _q, _s.set(sc, sc, sc));
      this.orbs.setMatrixAt(i, _m);
      _m.compose(_p, _q, _s.set(sc * 1.05, sc * 1.05, sc * 1.05));
      this.shells.setMatrixAt(i, _m);
      _q.identity();
      _m.compose(_p, _q, _s.set(ringScale * scale, ringScale * scale, ringScale * scale));
      this.rings.setMatrixAt(i, _m);
      const tailLen = s.state === 'approach' ? 0.9 + speed * 0.06 : 0;
      _m.compose(_p, _q, _s.set(scale, scale, tailLen));
      this.tails.setMatrixAt(i, _m);
    }
    this.orbs.instanceMatrix.needsUpdate = true;
    this.shells.instanceMatrix.needsUpdate = true;
    this.rings.instanceMatrix.needsUpdate = true;
    this.tails.instanceMatrix.needsUpdate = true;

    // Bombs ------------------------------------------------------------------
    for (let i = 0; i < MAX_BOMBS; i++) {
      const s = this.bombSlots[i];
      if (!s.active) continue;
      s.prevZ = s.z;
      s.z = this.hitZ - (s.note.t - songTime) * speed;
      const age = travel - (s.note.t - songTime);
      let scale = THREE.MathUtils.smoothstep(age, 0, 0.5);
      if (s.state === 'approach') {
        if (s.z > 1.5) s.active = false; // dodged: drifts past
      } else {
        s.stateTime += dt;
        scale = Math.max(0, 1 - s.stateTime * 10);
        if (s.stateTime > 0.12) s.active = false;
      }
      if (!s.active) { this.bombs.setMatrixAt(i, _zero); this.bombShells.setMatrixAt(i, _zero); continue; }
      _q.setFromEuler(new THREE.Euler(this.time * 1.7 + s.spin, this.time * 2.1, s.spin));
      _m.compose(_p.set(s.x, s.y, s.z), _q, _s.set(scale, scale, scale));
      this.bombs.setMatrixAt(i, _m);
      this.bombShells.setMatrixAt(i, _m);
    }
    this.bombs.instanceMatrix.needsUpdate = true;
    this.bombShells.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < MAX_BOMBS; i++) if (this.bombSlots[i].active) { this.bombShells.setColorAt(i, _c.set(0xff2030)); }
    this.bombShells.instanceColor.needsUpdate = true;

    // Walls ------------------------------------------------------------------
    for (let i = 0; i < MAX_WALLS; i++) {
      const s = this.wallSlots[i];
      if (!s.active) continue;
      const front = -(s.wall.t - songTime) * speed;      // leading face (reaches the head at wall.t)
      const back = front - s.length;
      const mesh = this.wallMeshes[i];
      mesh.position.z = (front + back) / 2;
      mesh.material.uniforms.uTime.value = this.time;
      mesh.material.uniforms.uWarn.value *= Math.exp(-dt * 6);
      const fadeIn = THREE.MathUtils.smoothstep(front - this.spawnZ, 0, 6);
      mesh.material.uniforms.uAlpha.value = 0.85 * fadeIn;
      if (back > 1.0) { s.active = false; mesh.visible = false; }
    }
  }

  /**
   * Swept collision between a glove (lane space) and targets/bombs.
   * @returns {null | {kind:'hit'|'wrong'|'weak'|'bomb', slot, note, dz, quality, position}}
   */
  testPunch(glove) {
    const { prev, cur, speed, noteType } = glove;
    const steps = 6;
    const hitZ = this.hitZ;
    const windowFront = 0.95 + this.speed * 0.035; // metres before the strike plane that still count
    const windowBack = 0.42;
    // Bombs first: touching one with any part of the glove is a mistake.
    for (let i = 0; i < MAX_BOMBS; i++) {
      const s = this.bombSlots[i];
      if (!s.active || s.state !== 'approach') continue;
      if (s.z < hitZ - windowFront - 0.6 || s.z > hitZ + windowBack + 0.6) continue;
      if (this._sweep(prev, cur, s, steps, BOMB_CONTACT) && speed > 0.25) {
        s.state = 'hit'; s.stateTime = 0;
        return { kind: 'bomb', slot: s, note: s.note, dz: 0, quality: 0, position: new THREE.Vector3(s.x, s.y, s.z) };
      }
    }
    let best = null;
    for (let i = 0; i < MAX_TARGETS; i++) {
      const s = this.targetSlots[i];
      if (!s.active || s.state !== 'approach') continue;
      if (s.z < hitZ - windowFront - 0.4 || s.z > hitZ + windowBack + 0.4) continue;
      const f = this._sweep(prev, cur, s, steps, CONTACT);
      if (f === false) continue;
      const zAtContact = THREE.MathUtils.lerp(s.prevZ, s.z, f);
      const dz = zAtContact - hitZ;
      if (dz < -windowFront || dz > windowBack) continue;
      if (!best || Math.abs(dz) < Math.abs(best.dz)) best = { s, dz };
    }
    if (!best) return null;
    const s = best.s;
    const dz = best.dz;
    s.state = 'hit'; s.stateTime = 0;
    const early = dz < 0;
    const err = Math.abs(dz) * (early ? 0.7 : 1.0);
    const quality = THREE.MathUtils.clamp(1 - err / (windowFront * 0.75), 0, 1);
    const position = new THREE.Vector3(s.x, s.y, s.z);
    if (speed < 0.5) { s.state = 'approach'; return null; } // a resting glove does not punch
    const matches = s.note.type === 'A' || s.note.type === noteType;
    if (!matches) return { kind: 'wrong', slot: s, note: s.note, dz, quality, position };
    if (speed < 1.2) return { kind: 'weak', slot: s, note: s.note, dz, quality, position };
    return { kind: 'hit', slot: s, note: s.note, dz, quality, position };
  }

  _sweep(prev, cur, s, steps, radius) {
    const r2 = radius * radius;
    for (let k = 0; k <= steps; k++) {
      const f = k / steps;
      const gx = prev.x + (cur.x - prev.x) * f;
      const gy = prev.y + (cur.y - prev.y) * f;
      const gz = prev.z + (cur.z - prev.z) * f;
      const tz = s.prevZ + (s.z - s.prevZ) * f;
      const dx = gx - s.x, dy = gy - s.y, dz = gz - tz;
      if (dx * dx + dy * dy + dz * dz < r2) return f;
    }
    return false;
  }

  /** Head (lane space) against walls. Returns the wall slot being touched or null. */
  testHead(head) {
    const r = 0.11;
    for (let i = 0; i < MAX_WALLS; i++) {
      const s = this.wallSlots[i];
      if (!s.active) continue;
      const front = -(s.wall.t - this.songTime) * this.speed;
      const back = front - s.length;
      if (head.z < back - r || head.z > front + r) continue;
      if (head.x < s.x0 - r || head.x > s.x1 + r) continue;
      if (head.y < s.y0 - r || head.y > s.y1 + r) continue;
      this.wallMeshes[i].material.uniforms.uWarn.value = 1;
      return s;
    }
    return null;
  }

  /** Next upcoming note for a hand (for the demo bot). */
  nextNoteFor(type, songTime, lookahead = 1.2) {
    let best = null;
    for (const s of this.targetSlots) {
      if (!s.active || s.state !== 'approach') continue;
      const n = s.note;
      if (!(n.type === type || n.type === 'A')) continue;
      const tth = n.t - songTime;
      if (tth < -0.05 || tth > lookahead) continue;
      if (!best || tth < best.note.t - songTime) best = s;
    }
    return best;
  }

  activeCount() { return this.targetSlots.filter((s) => s.active).length; }
}
