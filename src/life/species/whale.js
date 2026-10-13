// The whale. Around sunrise or sunset, every few days, a whale passes far out
// on the open sea: it surfaces three times with a spout, then lifts its tail
// and dives. It chooses a stretch of sea in front of the camera when it can,
// so whoever's watching the horizon gets to see it.

import { Visitor } from '../Visitor.js';
import { approach } from '../Creature.js';
import { SEA_Y } from '../../core/constants.js';
import { whaleModel } from '../models.js';

const SURFACE = 6; // Seconds per surfacing.
const UNDER = 3.5; // Seconds below between surfacings.
const SPEED = 1.3;

export class Whale extends Visitor {
  constructor(ctx, slot, opts) {
    super(ctx, slot, opts);
    this.model = this.attach(whaleModel(this.rng));
    this.touchWater(true);
    this.fluke = this.model.getObjectByName('fluke');
    this.cfg = { chance: 0.35, pity: 2, delay: [3, 25] };
  }

  inWindow() {
    return this.between(5.5, 8) || this.between(17, 19.5);
  }

  visit() {
    const spot = this._spot();
    this.pos.set(spot.x, SEA_Y - 3, spot.z);
    this.heading = spot.heading;
    this.set('swim');
    this.blown = new Set();
    this.ctx.sound('whale', this.pos, { range: 170 });
  }

  depart() {
    // Already far out at sea; slip under and away.
    this.set('sink');
  }

  visitTick(dt) {
    const { ctx } = this;
    this.pos.x += Math.sin(this.heading) * SPEED * dt;
    this.pos.z += Math.cos(this.heading) * SPEED * dt;

    if (this.state === 'sink') {
      this.pos.y = approach(this.pos.y, SEA_Y - 5, dt, 0.8);
      if (this.t > 3) this.goAway();
      return;
    }

    // Three surfacings, then the tail.
    const cycle = SURFACE + UNDER;
    const k = Math.floor(this.t / cycle);
    const local = this.t - k * cycle;
    let depth = -3;
    let pitch = 0;
    let flukeLift = 0;
    if (k < 3) {
      if (local < SURFACE) {
        const u = local / SURFACE;
        depth = -3 + 3.15 * Math.sin(Math.PI * u);
        pitch = -0.16 * Math.cos(Math.PI * u);
        if (u > 0.4 && !this.blown.has(k)) {
          this.blown.add(k);
          const blow = { x: this.pos.x + Math.sin(this.heading) * 2.6, y: SEA_Y + 0.3, z: this.pos.z + Math.cos(this.heading) * 2.6 };
          ctx.particles.spout(blow, { height: 3.2 });
          ctx.sound('spout', blow, { range: 170 });
        }
      }
    } else {
      // The final dive: arch, lift the tail clear of the water, and slide under.
      const u = Math.min(1, (this.t - 3 * cycle) / 7);
      depth = -3 + 3 * Math.sin(Math.PI * Math.min(1, u * 1.4));
      pitch = 0.55 * Math.sin(Math.PI * u);
      flukeLift = 0.5 * Math.sin(Math.PI * u);
      if (u > 0.5 && !this.blown.has('tail')) {
        this.blown.add('tail');
        const tail = { x: this.pos.x - Math.sin(this.heading) * 5, y: SEA_Y, z: this.pos.z - Math.cos(this.heading) * 5 };
        ctx.splash(tail, 2.5);
      }
      if (u >= 1) {
        this.goAway();
        return;
      }
    }
    this.pos.y = approach(this.pos.y, SEA_Y + depth, dt, 0.4);
    this.model.rotation.x = approach(this.model.rotation.x, pitch, dt, 0.4);
    this.fluke.rotation.x = flukeLift * 0.8 + Math.sin(this.t * 0.8) * 0.12;
  }

  // Open sea in front of the camera, well away from the island.
  _spot() {
    const { ctx, slot } = this;
    const fx = ctx.camDir.x;
    const fz = ctx.camDir.z;
    const len = Math.hypot(fx, fz) || 1;
    const base = Math.atan2(fx / len, fz / len);
    for (const dist of [50, 65, 80]) {
      for (const off of [0, 0.35, -0.35, 0.7, -0.7]) {
        const a = base + off;
        const x = ctx.cam.x + Math.sin(a) * dist;
        const z = ctx.cam.z + Math.cos(a) * dist;
        if (Math.hypot(x - slot.x, z - slot.z) < slot.reach + 12) continue;
        if (!this._openSea(x, z)) continue;
        // Swim across the view, so the whole length shows.
        return { x, z, heading: a + (Math.random() < 0.5 ? 1 : -1) * Math.PI / 2 };
      }
    }
    const a = Math.random() * Math.PI * 2;
    const d = slot.reach + 30;
    return { x: slot.x + Math.sin(a) * d, z: slot.z + Math.cos(a) * d, heading: a + Math.PI / 2 };
  }

  _openSea(x, z) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      if (this.ctx.surfaceAt(x + Math.cos(a) * 12, z + Math.sin(a) * 12).type !== 'sea') return false;
    }
    return this.ctx.surfaceAt(x, z).type === 'sea';
  }
}
