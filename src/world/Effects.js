// Juice: GPU particle bursts, flying shards, shockwave rings, floating score popups and a
// camera-attached damage vignette. All effects are pooled; nothing allocates during play.

import * as THREE from 'three';
import { makeParticleMaterial, COLORS } from './Materials.js';
import { makeLabelTexture } from '../util/CanvasText.js';

const _v = new THREE.Vector3();

export class ParticleSystem {
  constructor(parent, capacity = 2500) {
    this.capacity = capacity;
    this.head = 0;
    this.time = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.birth = new Float32Array(capacity).fill(-1000);
    this.life = new Float32Array(capacity).fill(1);
    this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aVel', new THREE.BufferAttribute(this.vel, 3));
    g.setAttribute('aBirth', new THREE.BufferAttribute(this.birth, 1));
    g.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    for (const a of Object.values(g.attributes)) a.setUsage(THREE.DynamicDrawUsage);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, -5), 60);
    this.material = makeParticleMaterial();
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 20;
    parent.add(this.points);
    this.dirty = false;
  }

  /** Emit `count` particles at p (lane space) with colour, speed and spread. */
  burst(p, color, count = 24, { speed = 2.5, spread = 1, size = 0.05, life = 0.7, dir = null, upward = 0.4 } = {}) {
    const g = this.points.geometry;
    for (let i = 0; i < count; i++) {
      const idx = this.head;
      this.head = (this.head + 1) % this.capacity;
      // Random direction on a sphere, biased toward dir if provided.
      const u = Math.random() * 2 - 1, phi = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      let vx = r * Math.cos(phi), vy = r * Math.sin(phi) + upward, vz = u;
      if (dir) { vx += dir.x * 1.5; vy += dir.y * 1.5; vz += dir.z * 1.5; }
      const s = speed * (0.35 + Math.random() * 0.9) * spread;
      this.pos[idx * 3] = p.x + (Math.random() - 0.5) * 0.08;
      this.pos[idx * 3 + 1] = p.y + (Math.random() - 0.5) * 0.08;
      this.pos[idx * 3 + 2] = p.z + (Math.random() - 0.5) * 0.08;
      this.vel[idx * 3] = vx * s; this.vel[idx * 3 + 1] = vy * s; this.vel[idx * 3 + 2] = vz * s;
      this.birth[idx] = this.time;
      this.life[idx] = life * (0.6 + Math.random() * 0.7);
      const tint = 0.75 + Math.random() * 0.5;
      this.col[idx * 3] = Math.min(1.5, color.r * tint + 0.15);
      this.col[idx * 3 + 1] = Math.min(1.5, color.g * tint + 0.15);
      this.col[idx * 3 + 2] = Math.min(1.5, color.b * tint + 0.15);
      this.size[idx] = size * (0.5 + Math.random());
    }
    for (const a of Object.values(g.attributes)) a.needsUpdate = true;
  }

  update(dt, viewportHeight) {
    this.time += dt;
    this.material.uniforms.uTime.value = this.time;
    this.material.uniforms.uScale.value = Math.max(200, viewportHeight * 0.55);
  }
}

export class ShardPool {
  constructor(parent, count = 60) {
    this.items = [];
    const geo = new THREE.TetrahedronGeometry(0.028, 0);
    const mats = {};
    const mkMat = (c) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.7, roughness: 0.3, metalness: 0.2, flatShading: true });
    mats.L = mkMat(COLORS.left); mats.R = mkMat(COLORS.right); mats.A = mkMat(COLORS.any); mats.B = mkMat(COLORS.bomb);
    this.mats = mats;
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(geo, mats.L);
      m.visible = false;
      m.userData = { vel: new THREE.Vector3(), ang: new THREE.Vector3(), life: 0, max: 1 };
      parent.add(m);
      this.items.push(m);
    }
    this.next = 0;
  }

  burst(p, type, count = 6, dir = null) {
    for (let i = 0; i < count; i++) {
      const m = this.items[this.next];
      this.next = (this.next + 1) % this.items.length;
      m.visible = true;
      m.material = this.mats[type] || this.mats.A;
      m.position.copy(p);
      const d = m.userData;
      // Shards fly away from the player's face (toward -z) and up.
      d.vel.set((Math.random() - 0.5) * 2.2, Math.random() * 1.8 + 0.4, -Math.random() * 2.5 - 0.4);
      if (dir) d.vel.addScaledVector(dir, 1.5);
      d.ang.set(Math.random() * 12 - 6, Math.random() * 12 - 6, Math.random() * 12 - 6);
      d.life = 0; d.max = 0.6 + Math.random() * 0.4;
      const s = 0.7 + Math.random() * 0.8;
      m.scale.setScalar(s);
    }
  }

  update(dt) {
    for (const m of this.items) {
      if (!m.visible) continue;
      const d = m.userData;
      d.life += dt;
      if (d.life >= d.max) { m.visible = false; continue; }
      d.vel.y -= 7 * dt;
      m.position.addScaledVector(d.vel, dt);
      m.rotation.x += d.ang.x * dt; m.rotation.y += d.ang.y * dt; m.rotation.z += d.ang.z * dt;
      const k = 1 - d.life / d.max;
      m.scale.setScalar(Math.max(0.01, k) * 1.2);
    }
  }
}

export class ShockwavePool {
  constructor(parent, count = 12) {
    this.items = [];
    const geo = new THREE.RingGeometry(0.72, 1.0, 48);
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      m.visible = false;
      m.userData = { life: 0, max: 0.4, size: 0.6 };
      parent.add(m);
      this.items.push(m);
    }
    this.next = 0;
  }
  spawn(p, color, size = 0.6, duration = 0.4) {
    const m = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    m.visible = true;
    m.position.copy(p);
    m.material.color.copy(color);
    m.userData.life = 0; m.userData.max = duration; m.userData.size = size;
    m.scale.setScalar(0.01);
  }
  update(dt) {
    for (const m of this.items) {
      if (!m.visible) continue;
      const d = m.userData;
      d.life += dt;
      const k = d.life / d.max;
      if (k >= 1) { m.visible = false; continue; }
      const ease = 1 - Math.pow(1 - k, 3);
      m.scale.setScalar(0.05 + ease * d.size);
      m.material.opacity = (1 - k) * 0.9;
    }
  }
}

export class PopupPool {
  constructor(parent, count = 18) {
    this.items = [];
    this.cache = new Map();
    for (let i = 0; i < count; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: false }));
      s.visible = false;
      s.renderOrder = 30;
      s.userData = { life: 0, max: 0.9, vel: 0.5, baseScale: 0.3 };
      parent.add(s);
      this.items.push(s);
    }
    this.next = 0;
  }

  _texture(text, color, glow) {
    const key = `${text}|${color}`;
    let tex = this.cache.get(key);
    if (!tex) {
      if (this.cache.size > 160) { const first = this.cache.keys().next().value; this.cache.get(first).dispose(); this.cache.delete(first); }
      tex = makeLabelTexture(text, { size: 72, color, glow: glow || color, stroke: 'rgba(0,0,0,0.6)' });
      this.cache.set(key, tex);
    }
    return tex;
  }

  show(text, p, color = '#ffffff', { scale = 0.14, duration = 0.9, rise = 0.25 } = {}) {
    const s = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    const tex = this._texture(text, color);
    s.material.map = tex;
    s.material.opacity = 1;
    s.material.needsUpdate = true;
    s.visible = true;
    s.position.copy(p);
    s.userData.life = 0; s.userData.max = duration; s.userData.vel = rise; s.userData.baseScale = scale;
    s.scale.set(scale * tex.userData.aspect, scale, 1);
  }

  update(dt) {
    for (const s of this.items) {
      if (!s.visible) continue;
      const d = s.userData;
      d.life += dt;
      const k = d.life / d.max;
      if (k >= 1) { s.visible = false; continue; }
      s.position.y += d.vel * dt * (1 - k);
      const pop = k < 0.15 ? 1 + (0.15 - k) * 3 : 1;
      const aspect = s.material.map ? s.material.map.userData.aspect : 2;
      s.scale.set(d.baseScale * aspect * pop, d.baseScale * pop, 1);
      s.material.opacity = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
    }
  }
}

/** Red edge tint on damage and a slow pulse when health is low. Attached to the camera. */
export class Vignette {
  constructor(camera) {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uAmount: { value: 0 }, uColor: { value: new THREE.Color('#ff2040') } },
      vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */`uniform float uAmount; uniform vec3 uColor; varying vec2 vUv;
        void main(){ float d = length(vUv - 0.5) * 1.5; float a = uAmount * smoothstep(0.25, 1.1, d); gl_FragColor = vec4(uColor, a);
        #include <colorspace_fragment>
        }`,
      transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), mat);
    this.mesh.position.z = -0.6;
    this.mesh.renderOrder = 1000;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    camera.add(this.mesh);
    this.amount = 0;
    this.lowHealth = 0;
    this.time = 0;
  }
  hit(strength = 1) { this.amount = Math.min(1, this.amount + strength); }
  setLowHealth(v) { this.lowHealth = v; }
  update(dt) {
    this.time += dt;
    this.amount *= Math.exp(-dt * 3.5);
    const pulse = this.lowHealth * (0.25 + 0.2 * Math.sin(this.time * 4));
    const a = Math.max(this.amount * 0.85, pulse);
    this.mesh.material.uniforms.uAmount.value = a;
    this.mesh.visible = a > 0.01;
  }
}

export class Effects {
  constructor(laneRoot, camera) {
    this.particles = new ParticleSystem(laneRoot);
    this.shards = new ShardPool(laneRoot);
    this.shockwaves = new ShockwavePool(laneRoot);
    this.popups = new PopupPool(laneRoot);
    this.vignette = new Vignette(camera);
  }

  /** Target destroyed by a punch. */
  hit(p, type, color, quality, dir) {
    // Hits happen at arm's length, so everything here is small: a few centimetres, not metres.
    this.particles.burst(p, color, 14 + Math.round(quality * 14), { speed: 1.5 + quality * 1.3, size: 0.022, life: 0.55, dir });
    this.particles.burst(p, new THREE.Color(0xffffff), 4, { speed: 0.8, size: 0.04, life: 0.25 });
    this.shards.burst(p, type, 4 + Math.round(quality * 2), dir);
    this.shockwaves.spawn(p, color, 0.18 + quality * 0.12, 0.3);
  }
  bomb(p) {
    this.particles.burst(p, COLORS.bomb, 40, { speed: 2.4, size: 0.035, life: 0.8, upward: 0.6 });
    this.particles.burst(p, new THREE.Color(0xffaa33), 18, { speed: 1.4, size: 0.05, life: 0.45 });
    this.shards.burst(p, 'B', 7);
    this.shockwaves.spawn(p, COLORS.bomb, 0.55, 0.45);
    this.vignette.hit(1);
  }
  miss(p, color) {
    this.particles.burst(p, color, 6, { speed: 0.5, size: 0.02, life: 0.5, upward: 0.1 });
  }
  wall() { this.vignette.hit(0.5); }
  popup(text, p, color, opts) { _v.copy(p); this.popups.show(text, _v, color, opts); }

  update(dt, viewportHeight) {
    this.particles.update(dt, viewportHeight);
    this.shards.update(dt);
    this.shockwaves.update(dt);
    this.popups.update(dt);
    this.vignette.update(dt);
  }
}
