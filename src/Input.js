// XR input: controllers and tracked hands via three.js' WebXRManager, with button edge
// detection and haptics. Handedness is taken from the input source, never from the slot index.

import * as THREE from 'three';

const BUTTONS = { trigger: 0, squeeze: 1, stick: 3, ax: 4, by: 5 };

export class Input {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.slots = [];
    this.onSelect = null;   // (slot, 'start'|'end')
    this.onButton = null;   // (slot, name, pressed)
    for (let i = 0; i < 2; i++) {
      const controller = renderer.xr.getController(i);
      const grip = renderer.xr.getControllerGrip(i);
      const hand = renderer.xr.getHand(i);
      scene.add(controller, grip, hand);
      const slot = { index: i, controller, grip, hand, source: null, handedness: 'none', isHand: false, connected: false, pressed: {}, selecting: false };
      controller.addEventListener('connected', (e) => {
        slot.source = e.data;
        slot.handedness = e.data.handedness || 'none';
        slot.isHand = !!e.data.hand;
        slot.connected = true;
      });
      controller.addEventListener('disconnected', () => { slot.connected = false; slot.source = null; slot.selecting = false; slot.pressed = {}; });
      controller.addEventListener('selectstart', () => { slot.selecting = true; if (this.onSelect) this.onSelect(slot, 'start'); });
      controller.addEventListener('selectend', () => { slot.selecting = false; if (this.onSelect) this.onSelect(slot, 'end'); });
      this.slots.push(slot);
    }
    this._origin = new THREE.Vector3();
    this._dir = new THREE.Vector3();
  }

  /** Poll gamepad buttons (A/X, B/Y, stick), report edges and refresh pose matrices. */
  update(dt = 0) {
    for (const slot of this.slots) {
      if (!slot.connected) { slot.selectTime = 0; continue; }
      // three.js writes fresh XR poses into the local matrices before our frame callback; world
      // matrices are normally refreshed only during render, so update them here for hit tests.
      slot.controller.updateMatrixWorld(true);
      slot.grip.updateMatrixWorld(true);
      slot.selectTime = slot.selecting ? (slot.selectTime || 0) + dt : 0;
      const gp = slot.source && slot.source.gamepad;
      if (!gp) continue;
      for (const [name, idx] of Object.entries(BUTTONS)) {
        const b = gp.buttons[idx];
        const pressed = !!(b && b.pressed);
        if (pressed !== !!slot.pressed[name]) {
          slot.pressed[name] = pressed;
          if (this.onButton && name !== 'trigger') this.onButton(slot, name, pressed);
        }
      }
    }
  }

  /** World-space ray of a slot's target ray space. Returns false when not connected. */
  getRay(slot, origin, direction) {
    if (!slot.connected) return false;
    const m = slot.controller.matrixWorld;
    origin.setFromMatrixPosition(m);
    direction.set(0, 0, -1).transformDirection(m);
    return true;
  }

  haptic(handedness, intensity = 0.7, ms = 50) {
    for (const slot of this.slots) {
      if (handedness !== 'both' && slot.handedness !== handedness) continue;
      const gp = slot.source && slot.source.gamepad;
      const act = gp && gp.hapticActuators && gp.hapticActuators[0];
      if (act && act.pulse) { try { act.pulse(intensity, ms); } catch { /* unsupported */ } }
    }
  }

  slotFor(handedness) { return this.slots.find((s) => s.connected && s.handedness === handedness) || null; }

  /** True while both tracked hands pinch (used as the pause gesture when there are no buttons). */
  get bothHandsPinching() {
    const hands = this.slots.filter((s) => s.connected && s.isHand);
    return hands.length === 2 && hands.every((s) => s.selectTime > 0.9);
  }
}
