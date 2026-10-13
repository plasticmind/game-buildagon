// Rabbits live in long grass, bushes, and ferns. They hop between patches of
// cover, nibble, sit up to look around, and twitch their ears. At night they
// slip into cover and come back out in the morning.

import { Creature, arc, approach } from '../Creature.js';
import { rabbitModel, RABBIT_LOOKS } from '../models.js';
import { PALETTE } from '../../core/constants.js';

const HOP = 0.42; // Length of one hop.
const GROUND = new Set(['grass', 'meadow', 'dirt']);

export class Rabbit extends Creature {
  constructor(ctx, slot, opts) {
    super(ctx, slot, opts);
    this.model = this.attach(rabbitModel(this.rng, RABBIT_LOOKS[Math.floor(this.rng() * RABBIT_LOOKS.length)]), { shadow: true });
    this.bodyPart = this.model.getObjectByName('body');
    this.torso = this.model.getObjectByName('torso');
    this.head = this.model.getObjectByName('head');
    this.ears = this.model.getObjectByName('ears');
    this.hop = null;
    this.goal = null;
    this.act = null;
    this.next = 0;
    this.grow = 1;
    this.phase = this.rng() * 10;
  }

  start(arrive) {
    if (this.ctx.night > 0.6) {
      this._hideAway();
      return;
    }
    if (arrive) {
      this._emerge();
      return;
    }
    const spot = this._spot(null) ?? this.slot.cover[0];
    this.pos.set(spot.x, spot.y, spot.z);
    this._sit();
  }

  onLeave() {
    if (this.state === 'hidden') {
      this.gone = true;
      return;
    }
    this._goHide();
  }

  tick(dt) {
    const { ctx } = this;
    if (this.state === 'hidden') {
      this.hidden = true;
      if (ctx.night < 0.4 && !this._foxNear()) this._emerge();
      return;
    }
    this.grow = approach(this.grow, this.state === 'vanish' ? 0 : 1, dt, 0.1);
    this.model.scale.setScalar(Math.max(0.001, this.grow));

    if (this.state === 'vanish') {
      if (this.grow < 0.03) {
        if (this.leaving) this.gone = true;
        else this._hideAway();
      }
      return;
    }

    if (this.state === 'hop') {
      this._tickHop(dt);
      return;
    }

    // Sitting. Off to cover at night, or when a fox comes close.
    if (!this.leaving && (ctx.night > 0.62 || this._foxNear())) {
      this._goHide();
      return;
    }
    const a = this.act;
    let sitUp = 0;
    let headX = 0;
    let headY = 0;
    if (a) {
      a.t += dt;
      const u = Math.min(1, a.t / a.time);
      const hump = Math.min(1, Math.sin(Math.PI * u) * 2.5);
      if (a.kind === 'nibble') {
        headX = 0.55 * hump;
        this.head.position.y = 0.17 + Math.sin(a.t * 18) * 0.004 * hump;
      } else if (a.kind === 'sitUp') {
        sitUp = hump;
        headY = Math.sin(a.t * 1.6) * 0.7 * hump;
      } else if (a.kind === 'look') {
        headY = a.side * 0.9 * hump;
      } else if (a.kind === 'groom') {
        headX = 0.4 * hump;
        headY = a.side * 0.6 * hump;
      }
      if (u >= 1) this.act = null;
    }
    this.bodyPart.rotation.x = approach(this.bodyPart.rotation.x, -0.75 * sitUp, dt, 0.12);
    this.head.rotation.x = approach(this.head.rotation.x, headX + 0.75 * sitUp * 0.8, dt, 0.12);
    this.head.rotation.y = approach(this.head.rotation.y, headY, dt, 0.18);
    // Ears twitch on their own little rhythm; the nose never stops.
    const twitch = Math.sin(ctx.time * 1.3 + this.phase) > 0.96 ? Math.sin(ctx.time * 40) * 0.25 : 0;
    this.ears.rotation.x = approach(this.ears.rotation.x, twitch - 0.1 * sitUp, dt, 0.05);
    this.torso.scale.y = 1 + Math.sin(ctx.time * 4 + this.phase) * 0.015;

    this.next -= dt;
    if (this.next > 0 || this.act) return;
    const roll = Math.random();
    if (roll < 0.4) {
      const spot = this._spot(this.pos);
      if (spot) {
        this.goal = spot;
        this._nextHop();
        return;
      }
    }
    const kinds = ['nibble', 'nibble', 'sitUp', 'look', 'groom'];
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    this.act = { kind, t: 0, time: kind === 'sitUp' ? 2.4 : kind === 'nibble' ? 2.2 : 1.4, side: Math.random() < 0.5 ? -1 : 1 };
    this.next = this.r(0.5, 2.5);
  }

  _tickHop(dt) {
    const h = this.hop;
    const s = Math.min(1, this.t / h.time);
    arc(h.from, h.to, s, h.height, this.pos);
    // Stretch out mid-air, squash on landing.
    const air = Math.sin(Math.PI * s);
    this.torso.scale.set(1 - 0.06 * air, 1 - 0.08 * air, 1 + 0.18 * air);
    this.bodyPart.rotation.x = approach(this.bodyPart.rotation.x, (s < 0.5 ? -0.25 : 0.2) * air, dt, 0.04);
    this.head.rotation.x = approach(this.head.rotation.x, 0, dt, 0.08);
    this.ears.rotation.x = -0.35 * air;
    if (s < 1) return;
    this.torso.scale.set(1, 1, 1);
    if (h.into) {
      this.ctx.leaves({ x: this.pos.x, y: this.pos.y + 0.3, z: this.pos.z }, PALETTE.leafGreen, 4);
      this.ctx.gust(this.pos.x, this.pos.z, 0.4);
      this.set('vanish');
      return;
    }
    this._nextHop();
  }

  // Hop toward the goal, one hop at a time, stopping where the way is blocked.
  _nextHop() {
    const g = this.goal;
    if (!g) {
      this._sit();
      return;
    }
    const dx = g.x - this.pos.x;
    const dz = g.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.08) {
      this.goal = null;
      if (g.into) {
        this.hop = { from: this.pos.clone(), to: this.pos.clone(), time: 0.01, height: 0, into: true };
        this.set('hop');
        return;
      }
      this._sit();
      return;
    }
    const step = Math.min(HOP, d);
    const tx = this.pos.x + (dx / d) * step;
    const tz = this.pos.z + (dz / d) * step;
    const opts = { maxStep: 1, solids: g.into ? [] : this.slot.solids ?? [], radius: 0.12 };
    if (!this.ctx.walkable(this.pos.x, this.pos.z, tx, tz, opts)) {
      this.goal = null;
      if (g.into) {
        this.set('vanish');
        return;
      }
      this._sit();
      return;
    }
    const ty = this.ctx.surfaceAt(tx, tz).y;
    this.heading = Math.atan2(dx, dz);
    this.hop = {
      from: { x: this.pos.x, y: this.pos.y, z: this.pos.z },
      to: { x: tx, y: ty, z: tz },
      time: 0.3 + Math.abs(ty - this.pos.y) * 0.2,
      height: 0.15 + Math.max(0, ty - this.pos.y) * 0.8,
      into: g.into && step >= d - 1e-6,
    };
    this.set('hop');
  }

  _sit() {
    this.set('sit');
    this.hop = null;
    this.next = this.r(1, 4);
  }

  // Pop out of a patch of cover and hop clear of it.
  _emerge() {
    this.hidden = false;
    const c = this.slot.cover[Math.floor(Math.random() * this.slot.cover.length)];
    this.pos.set(c.x, c.y, c.z);
    this.grow = 0.05;
    this.ctx.leaves({ x: c.x, y: c.y + 0.3, z: c.z }, PALETTE.leafGreen, 4);
    this.ctx.gust(c.x, c.z, 0.4);
    this.goal = this._spot(this.pos, 1.6) ?? null;
    this._nextHop();
  }

  _goHide() {
    const c = [...this.slot.cover].sort(
      (a, b) => (a.x - this.pos.x) ** 2 + (a.z - this.pos.z) ** 2 - ((b.x - this.pos.x) ** 2 + (b.z - this.pos.z) ** 2),
    )[0];
    this.act = null;
    this.goal = c ? { x: c.x, y: c.y, z: c.z, into: true } : null;
    if (!c) this.set('vanish');
    else this._nextHop();
  }

  _foxNear() {
    for (const c of this.ctx.creatures.values()) {
      if (c.species !== 'fox' || c.state === 'away' || c.hidden) continue;
      if ((c.pos.x - this.pos.x) ** 2 + (c.pos.z - this.pos.z) ** 2 < 4.5 * 4.5) return true;
    }
    return false;
  }

  _hideAway() {
    this.set('hidden');
    this.hidden = true;
  }

  // A grassy spot near some cover, reachable in a straight line from `from`.
  _spot(from, maxDist = 4) {
    const cover = this.slot.cover;
    for (let i = 0; i < 10; i++) {
      const c = cover[Math.floor(Math.random() * cover.length)];
      const a = Math.random() * Math.PI * 2;
      const d = this.r(0.5, 2.4);
      const x = c.x + Math.cos(a) * d;
      const z = c.z + Math.sin(a) * d;
      const s = this.ctx.surfaceAt(x, z);
      if (s.type !== 'land' || !GROUND.has(s.cell.type)) continue;
      if (from && Math.hypot(x - from.x, z - from.z) > maxDist) continue;
      if (from && !this.ctx.walkable(from.x, from.z, x, z, { maxStep: 1, solids: this.slot.solids ?? [], radius: 0.12 })) continue;
      return { x, y: s.y, z };
    }
    return null;
  }
}
