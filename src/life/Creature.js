// Base class and motion helpers for wildlife.
//
// A creature owns a THREE.Group (`root`) whose origin sits on the ground, the
// water surface, or a perch. Models face local +Z, so `heading` is the
// rotation.y that points the creature along (sin heading, cos heading) in X/Z.
//
// Lifecycle: the manager creates a creature for a habitat slot, calls
// update(dt) every frame, calls leave() when its slot disappears, and disposes
// it once `gone` is true. Pass { arrive: true } for an animated arrival after
// `delay` seconds; otherwise the creature starts settled in place.

import * as THREE from 'three';
import { mulberry32 } from '../core/random.js';
import { LAYERS } from '../render/shared.js';
import { RARE } from './habitats.js';
import { gild } from './models.js';

const GOLDEN_ODDS = 30; // About one in this many common animals is golden.

export const TAU = Math.PI * 2;

export class Creature {
  constructor(ctx, slot, { arrive = false, delay = 0 } = {}) {
    this.ctx = ctx;
    this.slot = slot;
    this.key = slot.key;
    this.species = slot.species;
    this.rng = mulberry32(hashString(slot.key));
    this.root = new THREE.Group();
    this.root.name = `creature:${slot.key}`;
    this.pos = this.root.position;
    this.heading = this.rng() * TAU;
    this.state = 'wait';
    this.t = 0;
    this.leaving = false;
    this.gone = false;
    this.arriving = arrive;
    this.delay = arrive ? delay : 0;
    // A few common animals are golden. The slot key decides, so the same habitat
    // keeps the same animal across reloads.
    this.golden = !RARE.has(slot.species) && hashString(`${slot.key}:gold`) % GOLDEN_ODDS === 0;
    this.hidden = false; // Out of sight (night roosts, burrows, between fish jumps).
    // The manager shows the root only outside 'wait', when not hidden, and in range.
  }

  // Random float in [a, b).
  r(a = 0, b = 1) {
    return a + (b - a) * Math.random();
  }

  set(state) {
    this.state = state;
    this.t = 0;
  }

  setSlot(slot) {
    this.slot = slot;
  }

  leave() {
    if (this.leaving || this.gone) return;
    this.leaving = true;
    this.onLeave();
  }

  // Species override these.
  start() {}
  // Whether a sighting counts right now (hatchlings only count once they hatch).
  sightable() {
    return true;
  }
  onLeave() {
    this.gone = true;
  }
  tick() {}

  update(dt) {
    if (this.gone) return;
    if (this.state === 'wait') {
      this.delay -= dt;
      if (this.delay > 0) return;
      if (this.arriving) this.ctx.announce(this.species);
      this.start(this.arriving);
      this.root.rotation.y = this.heading;
      return;
    }
    this.t += dt;
    this.tick(dt);
    this.root.rotation.y = this.heading;
  }

  // Add a model to the root. Shadows only for creatures big enough to show them.
  attach(model, { shadow = false } = {}) {
    this.shadow = shadow;
    if (this.golden) gild(model);
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.layers.set(LAYERS.WORLD);
      o.castShadow = shadow && this.ctx.shadows;
      o.receiveShadow = true;
    });
    this.root.add(model);
    return model;
  }

  syncShadows() {
    const on = !!this.shadow && this.ctx.shadows;
    this.root.traverse((o) => {
      if (o.isMesh) o.castShadow = on;
    });
  }

  // Swimmers show up in the water depth pre-pass, which draws a soft foam ring
  // where they meet the surface.
  touchWater(on = true) {
    this.root.traverse((o) => {
      if (!o.isMesh) return;
      if (on) o.layers.enable(LAYERS.DEPTH);
      else o.layers.disable(LAYERS.DEPTH);
    });
  }

  dispose() {
    this.root.parent?.remove(this.root);
    this.root.traverse((o) => {
      if (o.isMesh) o.geometry.dispose();
    });
  }

  // Turn toward a world-space direction at up to `rate` radians per second.
  turnToward(dx, dz, rate, dt) {
    if (dx * dx + dz * dz < 1e-8) return 0;
    const want = Math.atan2(dx, dz);
    const diff = wrapAngle(want - this.heading);
    const step = Math.max(-rate * dt, Math.min(rate * dt, diff));
    this.heading = wrapAngle(this.heading + step);
    return Math.abs(diff);
  }

  forward(out = { x: 0, z: 0 }) {
    out.x = Math.sin(this.heading);
    out.z = Math.cos(this.heading);
    return out;
  }
}

export function wrapAngle(a) {
  return a - TAU * Math.floor((a + Math.PI) / TAU);
}

export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
export const lerp = (a, b, t) => a + (b - a) * t;

// Arc from a to b ({x, y, z}) with a peak `height` above the straight line.
export function arc(a, b, s, height, out) {
  out.x = lerp(a.x, b.x, s);
  out.z = lerp(a.z, b.z, s);
  out.y = lerp(a.y, b.y, s) + Math.sin(Math.PI * s) * height;
  return out;
}

// Ease a scalar toward a target with a time constant in seconds.
export function approach(v, target, dt, tau = 0.15) {
  return v + (target - v) * (1 - Math.exp(-dt / tau));
}
