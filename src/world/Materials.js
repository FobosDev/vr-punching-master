// Shared shaders and material factories. Everything is tuned for a mobile GPU (Quest 3): no
// post-processing, glow is faked with additive fresnel shells, sprites and emissive colours
// under ACES tone mapping.

import * as THREE from 'three';

export const COLORS = {
  left: new THREE.Color('#ff2d95'),
  right: new THREE.Color('#19e6ff'),
  any: new THREE.Color('#ffd166'),
  bomb: new THREE.Color('#ff3b3b'),
  wall: new THREE.Color('#ff3d5a'),
  violet: new THREE.Color('#7c4dff'),
  sky: new THREE.Color('#07030f'),
  horizon: new THREE.Color('#3a0f5c'),
  fog: new THREE.Color('#0b0518'),
};

// ---------------------------------------------------------------- fresnel glow shell
const fresnelVert = /* glsl */`
  varying vec3 vN; varying vec3 vV;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;
const fresnelFrag = /* glsl */`
  uniform vec3 uColor; uniform float uIntensity; uniform float uPower; uniform float uBase;
  varying vec3 vN; varying vec3 vV;
  void main() {
    float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), uPower);
    float a = clamp(uBase + f, 0.0, 1.0) * uIntensity;
    gl_FragColor = vec4(uColor * a, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export function makeGlowMaterial(color, { intensity = 1.0, power = 2.5, base = 0.0, side = THREE.FrontSide } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uIntensity: { value: intensity }, uPower: { value: power }, uBase: { value: base } },
    vertexShader: fresnelVert,
    fragmentShader: fresnelFrag,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side,
  });
}

// ---------------------------------------------------------------- neon grid floor
const gridVert = /* glsl */`
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;
const gridFrag = /* glsl */`
  uniform float uScroll; uniform vec3 uColorA; uniform vec3 uColorB; uniform vec3 uFog;
  uniform float uPulse; uniform vec3 uCenter; uniform float uLaneHalf;
  varying vec3 vWorld;
  void main() {
    vec2 p = vWorld.xz - uCenter.xz;
    p.y += uScroll;
    vec2 g = abs(fract(p - 0.5) - 0.5) / fwidth(p);
    float line = min(g.x, g.y);
    float thin = 1.0 - smoothstep(0.0, 1.6, line);
    float soft = exp(-line * 0.45) * 0.22;
    vec2 g4 = abs(fract(p / 4.0 - 0.5) - 0.5) / fwidth(p / 4.0);
    float major = 1.0 - smoothstep(0.0, 2.2, min(g4.x, g4.y));
    float dist = length(vWorld.xz - uCenter.xz);
    float fade = exp(-dist * 0.028);
    float lane = 1.0 - smoothstep(uLaneHalf, uLaneHalf + 2.5, abs(vWorld.x - uCenter.x));
    vec3 col = mix(uColorA, uColorB, clamp(abs(vWorld.x - uCenter.x) / 18.0, 0.0, 1.0));
    float pulse = 1.0 + uPulse * 0.9;
    vec3 c = col * ((thin * 0.9 + major * 0.8 + soft) * pulse * (0.75 + lane * 0.5)) * fade;
    c += uColorA * 0.025 * lane * fade;
    c = mix(uFog * 0.9, c + uFog * 0.15, fade);
    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export function makeGridMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uScroll: { value: 0 },
      uColorA: { value: COLORS.left.clone().multiplyScalar(0.9) },
      uColorB: { value: COLORS.right.clone().multiplyScalar(0.9) },
      uFog: { value: COLORS.fog.clone() },
      uPulse: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uLaneHalf: { value: 1.2 },
    },
    vertexShader: gridVert,
    fragmentShader: gridFrag,
  });
}

// ---------------------------------------------------------------- sky dome
const skyVert = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = (modelMatrix * vec4(position, 1.0)).xyz - cameraPosition;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_Position.z = gl_Position.w; // always at the far plane
  }`;
const skyFrag = /* glsl */`
  uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uBottom; uniform vec3 uGlow; uniform float uEnergy;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 col = h > 0.0 ? mix(uHorizon, uTop, pow(h, 0.5)) : mix(uHorizon, uBottom, pow(-h, 0.35));
    float band = exp(-abs(h) * 9.0);
    col += uGlow * band * (0.5 + uEnergy * 0.6);
    // Faint aurora streaks
    float streak = sin(d.x * 6.0 + h * 20.0) * sin(d.z * 5.0 - h * 14.0);
    col += uGlow * 0.08 * max(streak, 0.0) * smoothstep(0.0, 0.5, h);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export function makeSkyMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color('#05020c') },
      uHorizon: { value: new THREE.Color('#2a0b4a') },
      uBottom: { value: new THREE.Color('#06030c') },
      uGlow: { value: new THREE.Color('#ff2d95').multiplyScalar(0.55) },
      uEnergy: { value: 0 },
    },
    vertexShader: skyVert,
    fragmentShader: skyFrag,
    side: THREE.BackSide,
    depthWrite: false,
    toneMapped: false,
  });
}

// ---------------------------------------------------------------- retro sun
const sunVert = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const sunFrag = /* glsl */`
  uniform float uTime; uniform float uEnergy;
  varying vec2 vUv;
  void main() {
    vec2 c = vUv - 0.5;
    float r = length(c) * 2.0;
    if (r > 1.0) discard;
    float y = vUv.y;
    vec3 top = vec3(1.0, 0.85, 0.35);
    vec3 bottom = vec3(1.0, 0.2, 0.55);
    vec3 col = mix(bottom, top, smoothstep(0.1, 0.95, y));
    float stripes = 1.0;
    if (y < 0.5) {
      float freq = 14.0;
      float w = (0.5 - y) * 1.6;          // stripes get thicker toward the bottom
      stripes = step(w, fract(y * freq - uTime * 0.25));
    }
    float edge = 1.0 - smoothstep(0.92, 1.0, r);
    float alpha = stripes * edge;
    col *= 1.1 + uEnergy * 0.5;
    gl_FragColor = vec4(col * alpha, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export function makeSunMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uEnergy: { value: 0 } },
    vertexShader: sunVert,
    fragmentShader: sunFrag,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
}

// ---------------------------------------------------------------- energy wall
const wallVert = /* glsl */`
  varying vec3 vN; varying vec3 vV; varying vec3 vLocal;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    vLocal = position;
    gl_Position = projectionMatrix * mv;
  }`;
const wallFrag = /* glsl */`
  uniform vec3 uColor; uniform float uTime; uniform float uAlpha; uniform vec3 uSize; uniform float uWarn;
  varying vec3 vN; varying vec3 vV; varying vec3 vLocal;
  void main() {
    vec3 a = abs(vLocal) / (uSize * 0.5);
    float e1 = max(min(a.x, a.y), max(min(a.y, a.z), min(a.x, a.z)));
    float edge = smoothstep(0.93, 0.995, e1);
    float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
    float scan = 0.5 + 0.5 * sin(vLocal.y * 30.0 + vLocal.z * 2.0 - uTime * 8.0);
    float cells = step(0.92, fract(vLocal.x * 2.0)) + step(0.92, fract(vLocal.y * 2.0));
    vec3 col = uColor * (0.3 + fres * 0.9 + edge * 2.5 + scan * 0.12 + cells * 0.25) * (1.0 + uWarn * 0.8);
    float alpha = uAlpha * clamp(0.22 + fres * 0.45 + edge + cells * 0.1 + uWarn * 0.2, 0.0, 1.0);
    gl_FragColor = vec4(col, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export function makeWallMaterial(size) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: COLORS.wall.clone() }, uTime: { value: 0 }, uAlpha: { value: 0.85 }, uSize: { value: size.clone() }, uWarn: { value: 0 } },
    vertexShader: wallVert,
    fragmentShader: wallFrag,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

// ---------------------------------------------------------------- GPU particles
const particleVert = /* glsl */`
  attribute vec3 aVel; attribute float aBirth; attribute float aLife; attribute vec3 aColor; attribute float aSize;
  uniform float uTime; uniform float uScale; uniform vec3 uGravity;
  varying vec3 vColor; varying float vFade;
  void main() {
    float age = uTime - aBirth;
    float k = age / max(aLife, 0.001);
    vFade = (k < 0.0 || k > 1.0) ? 0.0 : (1.0 - k) * (1.0 - k);
    float drag = 1.0 - 0.55 * k;
    vec3 p = position + aVel * age * drag + 0.5 * uGravity * age * age;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = (vFade > 0.0) ? aSize * (0.4 + 0.6 * (1.0 - k)) * uScale / max(-mv.z, 0.1) : 0.0;
    gl_Position = projectionMatrix * mv;
    vColor = aColor;
  }`;
const particleFrag = /* glsl */`
  varying vec3 vColor; varying float vFade;
  void main() {
    if (vFade <= 0.0) discard;
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d) * 2.0;
    float a = (1.0 - smoothstep(0.35, 1.0, r)) * vFade;
    gl_FragColor = vec4(vColor * (1.0 + (1.0 - r) * 0.8) * a, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export function makeParticleMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uScale: { value: 600 }, uGravity: { value: new THREE.Vector3(0, -2.2, 0) } },
    vertexShader: particleVert,
    fragmentShader: particleFrag,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

// ---------------------------------------------------------------- additive ribbon (glove trails)
const ribbonVert = /* glsl */`
  attribute float aAlpha;
  varying float vAlpha;
  void main() { vAlpha = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const ribbonFrag = /* glsl */`
  uniform vec3 uColor; uniform float uOpacity;
  varying float vAlpha;
  void main() {
    float a = vAlpha * uOpacity;
    gl_FragColor = vec4(uColor * a, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export function makeRibbonMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: 1 } },
    vertexShader: ribbonVert,
    fragmentShader: ribbonFrag,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

// ---------------------------------------------------------------- soft radial sprite texture
let _spriteTex = null;
export function getSoftSpriteTexture() {
  if (_spriteTex) return _spriteTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  _spriteTex = new THREE.CanvasTexture(c);
  _spriteTex.colorSpace = THREE.SRGBColorSpace;
  return _spriteTex;
}

export function makeHaloSprite(color, scale = 0.5, opacity = 0.8) {
  const mat = new THREE.SpriteMaterial({ map: getSoftSpriteTexture(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity });
  const s = new THREE.Sprite(mat);
  s.scale.setScalar(scale);
  return s;
}

// ---------------------------------------------------------------- environment cubemap (reflections)
export function makeEnvironmentCubeMap() {
  const size = 32;
  const faces = [];
  const mk = (fn) => {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const ctx = c.getContext('2d'); fn(ctx); return c;
  };
  const side = (hue) => mk((ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, size);
    g.addColorStop(0, '#0a0518');
    g.addColorStop(0.5, hue);
    g.addColorStop(0.55, '#2a1050');
    g.addColorStop(1, '#040208');
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  });
  const flat = (col) => mk((ctx) => { ctx.fillStyle = col; ctx.fillRect(0, 0, size, size); });
  faces.push(side('#6a2fa0'), side('#3a1f7a'), flat('#160a2c'), flat('#07030f'), side('#8a2a90'), side('#1f2a70'));
  const tex = new THREE.CubeTexture(faces);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
