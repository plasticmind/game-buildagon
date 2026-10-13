// The fox. At golden hour it trots out from behind the trees beside a rabbit
// meadow, sits and looks around, and pounces nose first into the long grass.
// Rabbits scatter while it's near. If a campfire burns close by, it curls up
// beside it for the evening; otherwise it slips back into the trees at dusk.

import { Visitor } from '../Visitor.js';
import { approach, arc } from '../Creature.js';
import { foxModel } from '../models.js';
import { PALETTE } from '../../core/constants.js';

const TROT = 1.0;

export class Fox extends Visitor {
  constructor(ctx, slot, opts) {
    super(ctx, slot, opts);
    this.model = this.attach(foxModel(this.rng), { shadow: true });
    this.bodyPart = this.model.getObjectByName('body');
    this.front = this.model.getObjectByName('front');
    this.hind = this.model.getObjectByName('hind');
    this.head = this.model.getObjectByName('head');
    this.tail = this.model.getObjectByName('tail');
    this.cfg = { chance: 0.5, pity: 1, delay: [2, 20] };
    this.sit = 0;
    this.loaf = 0;
    this.crouch = 0;
    this.walkPhase = 0;
    this.grow = 1;
    this.phase = this.rng() * 10;
  }

  inWindow() {
    return this.between(16.5, 19.5);
  }

  get walkOpts() {
    return { maxStep: 1, solids: this.slot.solids ?? [], radius: 0.15 };
  }

  visit() {
    const t = this.slot.trunks[Math.floor(Math.random() * this.slot.trunks.length)];
    this.pos.set(t.x, t.y, t.z);
    this.grow = 1;
    this.goal = this._spot(1.5, 4) ?? { x: t.x + 1, y: t.y, z: t.z };
    this.set('trot');
  }

  depart() {
    // Back into the trees.
    const t = [...this.slot.trunks].sort((a, b) => this._d2(a) - this._d2(b))[0];
    this.goal = { x: t.x, y: t.y, z: t.z, exit: true };
    this.set('trot');
  }

  _d2(p) {
    return (p.x - this.pos.x) ** 2 + (p.z - this.pos.z) ** 2;
  }

  visitTick(dt) {
    const { ctx } = this;
    let walking = false;
    let headX = 0;
    let headY = 0;
    let wantSit = 0;
    let wantLoaf = 0;
    let wantCrouch = 0;

    const late = !this.between(16.5, 20);
    if (!this.leaving && late && this.state !== 'curl' && this.state !== 'vanish' && !this.goal?.exit && !this.goal?.fire) {
      if (this.slot.fire && this.between(16.5, 23.5)) {
        const f = this.slot.fire;
        const l = Math.hypot(this.pos.x - f.x, this.pos.z - f.z) || 1;
        const spot = { x: f.x + ((this.pos.x - f.x) / l) * 1.1, z: f.z + ((this.pos.z - f.z) / l) * 1.1 };
        const s = ctx.surfaceAt(spot.x, spot.z);
        this.goal = s.type === 'land' ? { x: spot.x, y: s.y, z: spot.z, fire: true } : null;
        if (this.goal) this.set('trot');
        else this.depart();
      } else {
        this.depart();
      }
    }
    if (this.state === 'curl' && !this.between(16.5, 23.5)) this.depart();

    if (this.state === 'trot') {
      walking = this._trot(dt);
    } else if (this.state === 'sit') {
      wantSit = 1;
      headY = Math.sin(this.t * 0.8) * 0.9;
      if (this.t > this.wait) {
        if (Math.random() < 0.6) {
          const p = this._spot(0.8, 1.6, true);
          if (p) {
            this.pounceAt = p;
            this.heading = Math.atan2(p.x - this.pos.x, p.z - this.pos.z);
            this.set('crouch');
          } else {
            this.wait = this.t + 2;
          }
        } else {
          this.goal = this._spot(1.5, 4);
          if (this.goal) this.set('trot');
          else this.wait = this.t + 3;
        }
      }
    } else if (this.state === 'crouch') {
      wantCrouch = 1;
      headX = 0.35;
      this.bodyPart.rotation.z = Math.sin(this.t * 22) * 0.08 * Math.min(1, this.t * 2);
      if (this.t > 1.3) {
        this.bodyPart.rotation.z = 0;
        this.hop = { from: this.pos.clone(), to: { ...this.pounceAt } };
        this.set('pounce');
      }
    } else if (this.state === 'pounce') {
      const s = Math.min(1, this.t / 0.7);
      arc(this.hop.from, this.hop.to, s, 0.55, this.pos);
      this.bodyPart.rotation.x = -0.6 + 1.5 * s;
      if (s >= 1) {
        ctx.leaves({ x: this.pos.x, y: this.pos.y + 0.2, z: this.pos.z }, PALETTE.leafGreen, 5);
        ctx.gust(this.pos.x, this.pos.z, 0.6);
        if (Math.random() < 0.4) ctx.sound('yip', this.pos, { range: 30 });
        this.set('sit');
        this.wait = this.r(3, 6);
      }
    } else if (this.state === 'curl') {
      wantLoaf = 1;
      headX = 0.4;
      headY = 0.8;
    } else if (this.state === 'vanish') {
      this.grow = approach(this.grow, 0, dt, 0.1);
      if (this.grow < 0.03) {
        this.model.scale.setScalar(1);
        this.goAway();
        return;
      }
    }

    // Blend the poses.
    this.sit = approach(this.sit, wantSit, dt, 0.18);
    this.loaf = approach(this.loaf, wantLoaf, dt, 0.3);
    this.crouch = approach(this.crouch, wantCrouch, dt, 0.12);
    const { sit, loaf, crouch } = this;
    this.walkPhase += walking ? dt * 14 : 0;
    const swing = walking ? Math.sin(this.walkPhase) * 0.5 : 0;
    if (this.state !== 'pounce') this.bodyPart.rotation.x = -0.6 * sit + 0.22 * crouch;
    this.bodyPart.position.y = 0.2 - 0.1 * sit - 0.13 * loaf - 0.06 * crouch + (walking ? Math.abs(Math.sin(this.walkPhase)) * 0.02 : 0);
    this.front.rotation.x = 0.6 * sit + swing;
    this.front.scale.y = Math.max(0.05, (1 + 0.25 * sit) * (1 - 0.85 * loaf) * (1 - 0.25 * crouch));
    this.hind.rotation.x = -swing;
    this.hind.scale.y = Math.max(0.05, 1 - 0.6 * sit - 0.85 * loaf * (1 - sit) - 0.3 * crouch);
    this.head.rotation.x = approach(this.head.rotation.x, 0.6 * sit + headX, dt, 0.15);
    this.head.rotation.y = approach(this.head.rotation.y, headY, dt, 0.25);
    this.tail.rotation.x = approach(this.tail.rotation.x, walking ? -0.25 : -(0.9 * sit + 1.1 * loaf * (1 - sit)), dt, 0.2);
    this.tail.rotation.y = 0.9 * Math.max(sit, loaf) + Math.sin(ctx.time * 2 + this.phase) * 0.15;
    this.model.scale.setScalar(Math.max(0.001, this.grow));
  }

  // Returns true while moving.
  _trot(dt) {
    const g = this.goal;
    if (!g) {
      this.set('sit');
      this.wait = this.r(3, 6);
      return false;
    }
    const dx = g.x - this.pos.x;
    const dz = g.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.08) {
      this.goal = null;
      if (g.exit) this.set('vanish');
      else if (g.fire) {
        const f = this.slot.fire;
        this.heading = Math.atan2(f.x - this.pos.x, f.z - this.pos.z) + Math.PI / 2;
        this.set('curl');
      } else {
        this.set('sit');
        this.wait = this.r(3, 6);
      }
      return false;
    }
    if (this.turnToward(dx, dz, 5, dt) > 0.6) return true;
    const step = Math.min(d, TROT * dt);
    const nx = this.pos.x + (dx / d) * step;
    const nz = this.pos.z + (dz / d) * step;
    if (!g.exit && !this.ctx.walkable(this.pos.x, this.pos.z, nx, nz, this.walkOpts)) {
      if (g.fire) this.depart();
      else this.goal = null;
      return false;
    }
    this.pos.x = nx;
    this.pos.z = nz;
    const s = this.ctx.surfaceAt(nx, nz);
    if (s.type === 'land') this.pos.y = approach(this.pos.y, s.y, dt, 0.06);
    return true;
  }

  // A spot near the meadow's cover, reachable from here. With `onCover`, a
  // spot right in the long grass, for pouncing.
  _spot(min, max, onCover = false) {
    const cover = this.slot.cover;
    for (let i = 0; i < 10; i++) {
      let x;
      let z;
      if (onCover) {
        const c = [...cover].sort((a, b) => this._d2(a) - this._d2(b))[Math.floor(Math.random() * Math.min(3, cover.length))];
        x = c.x + this.r(-0.25, 0.25);
        z = c.z + this.r(-0.25, 0.25);
        const d = Math.hypot(x - this.pos.x, z - this.pos.z);
        if (d < min || d > max) continue;
      } else {
        const c = cover[Math.floor(Math.random() * cover.length)];
        const a = Math.random() * Math.PI * 2;
        const r = this.r(0.6, 2.2);
        x = c.x + Math.cos(a) * r;
        z = c.z + Math.sin(a) * r;
        const d = Math.hypot(x - this.pos.x, z - this.pos.z);
        if (d < min || d > max + 6) continue;
      }
      const s = this.ctx.surfaceAt(x, z);
      if (s.type !== 'land' || Math.abs(s.y - this.pos.y) > 0.65) continue;
      if (!onCover && !this.ctx.walkable(this.pos.x, this.pos.z, x, z, this.walkOpts)) continue;
      return { x, y: s.y, z };
    }
    return null;
  }
}
