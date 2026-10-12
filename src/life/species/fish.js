// Koi drift under the surface of bridged ponds and rise now and then to kiss
// it. Silver fish live out of sight in lakes and around rowboats and leap
// from the water every so often.

import { Creature, approach, ease } from '../Creature.js';
import { fishModel, KOI_LOOKS, SILVER } from '../models.js';
import { pickSwimPoint, swimOk } from '../swim.js';

const _f = { x: 0, z: 0 };

export class Koi extends Creature {
  constructor(ctx, slot, opts) {
    super(ctx, slot, opts);
    const look = KOI_LOOKS[Math.floor(this.rng() * KOI_LOOKS.length)];
    this.model = this.attach(fishModel(this.rng, look, 0.9 + this.rng() * 0.35));
    this.size = this.model.scale.x;
    this.tail = this.model.getObjectByName('tail');
    this.depth = 0.13 + this.rng() * 0.1;
    this.phase = this.rng() * 10;
    this.speed = 0;
    this.target = null;
    this.grow = 1;
  }

  get body() {
    return this.slot.body;
  }

  // Cruising depth, kept clear of the basin floor.
  _swimY() {
    const b = this.body;
    return Math.max(b.floorY + 0.14, b.y - this.depth) + Math.sin(this.ctx.time * 0.7 + this.phase) * 0.03;
  }

  start(arrive) {
    const p = pickSwimPoint(this.ctx, this.body, 0.4) ?? this.body.centers[0];
    this.pos.set(p.x, arrive ? this.body.floorY + 0.06 : this._swimY(), p.z);
    this.grow = arrive ? 0.3 : 1;
    this.set(arrive ? 'rise' : 'swim');
  }

  onLeave() {
    this.set('sink');
  }

  tick(dt) {
    const { ctx, body } = this;
    let wag = 4;
    if (this.state === 'rise' || this.state === 'sink') {
      const down = this.state === 'sink';
      this.pos.y = approach(this.pos.y, down ? body.floorY + 0.05 : this._swimY(), dt, 0.6);
      this.grow = approach(this.grow, down ? 0 : 1, dt, 0.5);
      if (down && this.grow < 0.03) {
        this.gone = true;
        return;
      }
      if (!down && this.t > 2.2) this.set('swim');
    } else {
      if (!ctx.inBody(body, this.pos.x, this.pos.z, 0.1)) {
        // The pond changed shape; slip over to open water.
        const p = pickSwimPoint(ctx, body, 0.4);
        if (p) this.pos.set(p.x, this._swimY(), p.z);
        this.target = null;
      }
      if (this.state === 'swim') {
        if (!this.target) this.target = pickSwimPoint(ctx, body, 0.4, this.pos, 5);
        if (this.target) {
          const dx = this.target.x - this.pos.x;
          const dz = this.target.z - this.pos.z;
          const d = Math.hypot(dx, dz);
          const off = this.turnToward(dx, dz, 1.6, dt);
          this.speed = approach(this.speed, off < 0.8 ? 0.32 * Math.min(1, d + 0.3) : 0.1, dt, 0.5);
          if (d < 0.2) {
            this.set(Math.random() < 0.3 ? 'kiss' : 'hover');
            this.target = null;
          }
        } else {
          this.set('hover');
        }
        this.pos.y = approach(this.pos.y, this._swimY(), dt, 0.5);
      } else if (this.state === 'hover') {
        this.speed = approach(this.speed, 0, dt, 0.6);
        this.pos.y = approach(this.pos.y, this._swimY(), dt, 0.5);
        wag = 1.5;
        if (this.t > 2.5) this.set('swim');
      } else if (this.state === 'kiss') {
        // Rise, touch the surface with a little ring, and sink back.
        this.speed = approach(this.speed, 0.05, dt, 0.5);
        const up = this.t < 1.2;
        this.pos.y = approach(this.pos.y, up ? body.y - 0.07 : this._swimY(), dt, 0.35);
        this.model.rotation.x = approach(this.model.rotation.x, up ? -0.35 : 0, dt, 0.3);
        if (up && this.t > 0.9 && !this.kissed) {
          this.kissed = true;
          ctx.splash({ x: this.pos.x + Math.sin(this.heading) * 0.15 * this.size, y: body.y, z: this.pos.z + Math.cos(this.heading) * 0.15 * this.size }, 0.22);
          ctx.sound('plip', this.pos, { volume: 0.35, pitch: 1.3 });
        }
        if (this.t > 2.6) {
          this.kissed = false;
          this.set('swim');
        }
      }
      if (this.speed > 0.001) {
        this.forward(_f);
        const nx = this.pos.x + _f.x * this.speed * dt;
        const nz = this.pos.z + _f.z * this.speed * dt;
        if (swimOk(ctx, body, nx, nz, 0.3)) {
          this.pos.x = nx;
          this.pos.z = nz;
        } else {
          this.speed = 0;
          this.target = null;
        }
      }
      wag = this.state === 'hover' ? wag : 3 + this.speed * 18;
    }
    this.tail.rotation.y = Math.sin(this.t * wag + this.phase) * 0.45;
    this.model.rotation.z = Math.sin(this.t * wag * 0.5) * 0.04;
    this.model.scale.setScalar(this.size * Math.max(0.001, this.grow));
  }
}

export class JumpingFish extends Creature {
  constructor(ctx, slot, opts) {
    super(ctx, slot, opts);
    this.model = this.attach(fishModel(this.rng, SILVER, 0.85 + this.rng() * 0.3));
    this.tail = this.model.getObjectByName('tail');
    this.hidden = true;
    this.wait = 0;
    this.jump = null;
  }

  start(arrive) {
    this.wait = arrive ? 0.3 : this.r(2, 9);
    this.set('under');
  }

  onLeave() {
    if (this.state !== 'jump') this.gone = true;
  }

  tick(dt) {
    const { ctx } = this;
    if (this.state === 'under') {
      this.hidden = true;
      if (this.leaving) {
        this.gone = true;
        return;
      }
      this.wait -= dt;
      if (this.wait > 0) return;
      // Jump only where someone might see it.
      const near = Math.hypot(ctx.cam.x - this.slot.x, ctx.cam.z - this.slot.z) < 70;
      const spot = near ? this._spot() : null;
      if (!spot) {
        this.wait = this.r(3, 7);
        return;
      }
      this.jump = spot;
      this.heading = spot.dir;
      this.pos.set(spot.x, spot.y - 0.2, spot.z);
      this.hidden = false;
      this.set('jump');
      ctx.splash({ x: spot.x, y: spot.y, z: spot.z }, 0.35);
      return;
    }
    // A leap: out of the water, over, and back in nose first.
    const j = this.jump;
    const time = 0.55 + j.height * 0.5;
    const s = Math.min(1, this.t / time);
    const k = ease(s * 0.15 + s * 0.85);
    this.pos.x = j.x + Math.sin(j.dir) * j.travel * k;
    this.pos.z = j.z + Math.cos(j.dir) * j.travel * k;
    this.pos.y = j.y - 0.2 + Math.sin(Math.PI * s) * (j.height + 0.2);
    this.model.rotation.x = -Math.atan2((j.height + 0.2) * Math.PI * Math.cos(Math.PI * s), j.travel);
    this.tail.rotation.y = Math.sin(this.t * 30) * 0.5;
    if (s < 1) return;
    ctx.splash({ x: this.pos.x, y: j.y, z: this.pos.z }, 0.5);
    ctx.sound('splash', this.pos, { volume: 0.45, pitch: 1.4 });
    this.hidden = true;
    this.set('under');
    this.wait = this.r(5, 14);
    if (this.leaving) this.gone = true;
  }

  // A patch of water with room to leap: inside the lake, or around the boat.
  _spot() {
    const { ctx, slot } = this;
    for (let i = 0; i < 10; i++) {
      let x;
      let z;
      if (slot.body) {
        const p = pickSwimPoint(ctx, slot.body, 0.7);
        if (!p) return null;
        ({ x, z } = p);
      } else {
        const a = Math.random() * Math.PI * 2;
        const d = slot.ring.r0 + Math.random() * (slot.ring.r1 - slot.ring.r0);
        x = slot.ring.x + Math.cos(a) * d;
        z = slot.ring.z + Math.sin(a) * d;
      }
      const dir = Math.random() * Math.PI * 2;
      const travel = this.r(0.8, 1.4);
      const s0 = ctx.surfaceAt(x, z);
      const s1 = ctx.surfaceAt(x + Math.sin(dir) * travel, z + Math.cos(dir) * travel);
      if (s0.type === 'land' || s1.type === 'land' || Math.abs(s0.y - s1.y) > 0.01) continue;
      if (slot.body && !swimOk(ctx, slot.body, x + Math.sin(dir) * travel, z + Math.cos(dir) * travel, 0.4)) continue;
      return { x, y: s0.y, z, dir, travel, height: this.r(0.35, 0.8) };
    }
    return null;
  }
}
