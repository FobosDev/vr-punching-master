import * as THREE from 'three';

// Canvas based text rendering for world-space UI. We draw into 2D canvases and upload them as
// textures; for a VR UI this is far cheaper and sharper than SDF fonts for the amount of text we show.

export const UI_FONT = '"Rajdhani", "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
export const DISPLAY_FONT = '"Orbitron", "Rajdhani", "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

export function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function fitText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
  return t + '…';
}

export function makeTexture(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  return tex;
}

/**
 * Renders a label into a texture. Options: font, size (px), color, glow, padding, width/height (px),
 * align, weight, stroke.
 */
export function makeLabelTexture(text, opts = {}) {
  const size = opts.size || 64;
  const font = `${opts.weight || 700} ${size}px ${opts.font || DISPLAY_FONT}`;
  const measure = makeCanvas(8, 8).getContext('2d');
  measure.font = font;
  const metrics = measure.measureText(text);
  const pad = opts.padding ?? Math.round(size * 0.5);
  const w = opts.width || Math.ceil(metrics.width + pad * 2);
  const h = opts.height || Math.ceil(size * 1.4 + pad);
  const canvas = makeCanvas(nextPow2(w), nextPow2(h));
  const ctx = canvas.getContext('2d');
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  if (opts.glow) {
    ctx.shadowColor = opts.glow;
    ctx.shadowBlur = size * 0.35;
  }
  if (opts.stroke) {
    ctx.lineWidth = Math.max(2, size * 0.08);
    ctx.strokeStyle = opts.stroke;
    ctx.strokeText(text, canvas.width / 2, canvas.height / 2);
  }
  ctx.fillStyle = opts.color || '#ffffff';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  if (opts.glow) {
    // Second pass for a brighter core.
    ctx.shadowBlur = size * 0.12;
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  }
  const tex = makeTexture(canvas);
  tex.userData.aspect = canvas.width / canvas.height;
  return tex;
}

export function nextPow2(n) { let p = 1; while (p < n) p <<= 1; return p; }
