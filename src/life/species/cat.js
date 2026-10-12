// A cat moves into a finished house. It strolls out of the door, sits on the
// step, wanders over to benches, campfires, and flower beds nearby, grooms,
// loafs, meows when you fly close, and curls up to sleep at night.

import { Creature, approach } from '../Creature.js';
import { catModel, CAT_LOOKS } from '../models.js';

const SPEED = 0.55;

export class Cat extends Creature {
  constructor(ctx, slot, opts) {
    super(ctx, slot, opts);
    this.model = this.attach(catModel(this.rng, CAT_LOOKS[Math.floor(this.rng() * CAT_LOOKS.length)]), { shadow: true });
    this.bodyPart = this.model.getObjectByName('body');
    this.front = this.model.getObjectByName('front');
    this.hind = this.model.getObjectByName('hind');
    this.head = this.model.getObjectByName('head');
    this.tail = this.model.getObjectByName('tail');
    this.sit = 0;
    this.loaf = 0;
    this.pose = 'sit';
    this.goal = null;
    this.act = null;
    this.next = 0;
    this.stay = 0;
    this.grow = 1;
    this.walkPhase = 0;
    this.phase = this.rng() * 10;
    this.meowIn = this.r(4, 12);
  }

  get step() {
    return this.slot.spots[0];
  }

  _inside() {
    const d = this.slot.door;
    return { x: d.x + d.ix * 0.45, y: d.y, z: d.z + d.iz * 0.45 };
  }

  start(arrive) {
    const step = this.step;
    if (!arrive) {
      this.pos.set(step.x, step.y, step.z);
      this.heading = step.face;
      this._rest(step);
      this.sit = this.pose === 'sit' ? 1 : 0;
      this.loaf = this.pose === 'sit' ? 0 : 1;
      return;
    }
    // Stroll out through the door.
    const inside = this._inside();
    this.pos.set(inside.x, inside.y, inside.z);
    this.sit = 0;
    this.loaf = 0;
    this.goal = { ...step, scripted: true };
    this.set('walk');
  }

  onLeave() {
    // Head home if the way is clear; otherwise slip away where it stands.
    const door = this.slot.door;
    const home = this.ctx.surfaceAt(door.x + door.ix * 0.45, door.z + door.iz * 0.45);
    if (home.type === 'land' && this.ctx.walkable(this.pos.x, this.pos.z, this.step.x, this.step.z, { maxStep: 0 })) {
      this.goal = { ...this.step, then: { ...this._inside(), scripted: true, vanish: true } };
      this.set('walk');
    } else {
      this.set('vanish');
    }
  }

  tick(dt) {
    const { ctx } = this;
    this.grow = approach(this.grow, this.state === 'vanish' ? 0 : 1, dt, 0.12);
    this.model.scale.setScalar(Math.max(0.001, this.grow));
    if (this.state === 'vanish') {
      if (this.grow < 0.03) this.gone = true;
      return;
    }

    let headX = 0;
    let headY = 0;
    let walking = false;
    if (this.state === 'walk') {
      walking = this._tickWalk(dt);
    } else {
      // Resting: sit or loaf, groom, look around, flick the tail, and meow.
      const night = ctx.night > 0.6;
      if (night && this.pose !== 'sleep') this.pose = 'sleep';
      if (!night && this.pose === 'sleep') this.pose = 'sit';
      const a = this.act;
      if (a) {
        a.t += dt;
        const u = Math.min(1, a.t / a.time);
        const hump = Math.min(1, Math.sin(Math.PI * u) * 2);
        if (a.kind === 'groom') {
          headX = 0.6 * hump;
          headY = a.side * 0.5 * hump + Math.sin(a.t * 9) * 0.1 * hump;
        } else if (a.kind === 'look') {
          headY = a.side * 1.0 * hump;
        } else if (a.kind === 'meow') {
          headX = -0.3 * hump;
        }
        if (u >= 1) this.act = null;
      }
      if (this.pose === 'sleep') {
        headX = 0.35;
        headY = 0.7;
      }
      this.next -= dt;
      this.stay -= dt;
      if (!this.act && this.next <= 0 && this.pose !== 'sleep') {
        this.next = this.r(2, 5);
        const kinds = ['groom', 'look', 'look'];
        this.act = { kind: kinds[Math.floor(Math.random() * kinds.length)], t: 0, time: this.r(1.5, 3), side: Math.random() < 0.5 ? -1 : 1 };
      }
      // Meow when someone comes close.
      this.meowIn -= dt;
      const near = Math.hypot(ctx.cam.x - this.pos.x, ctx.cam.z - this.pos.z) < 9;
      if (this.meowIn <= 0 && this.pose !== 'sleep') {
        this.meowIn = this.r(8, 20);
        if (near) {
          ctx.sound('meow', this.pos, { volume: 0.8 });
          this.act = { kind: 'meow', t: 0, time: 0.8, side: 1 };
          // Look up at whoever's there.
          this.heading = Math.atan2(ctx.cam.x - this.pos.x, ctx.cam.z - this.pos.z);
        }
      }
      if (this.stay <= 0 && this.pose !== 'sleep') this._wander();
    }

    // Blend the poses: standing, sitting, and loafing (lying with paws tucked).
    const wantSit = walking ? 0 : this.pose === 'sit' ? 1 : 0;
    const wantLoaf = walking ? 0 : this.pose === 'sit' ? 0 : 1;
    this.sit = approach(this.sit, wantSit, dt, 0.18);
    this.loaf = approach(this.loaf, wantLoaf, dt, 0.25);
    const { sit, loaf } = this;
    this.walkPhase += walking ? dt * 11 : 0;
    const swing = walking ? Math.sin(this.walkPhase) * 0.4 : 0;
    this.bodyPart.rotation.x = -0.55 * sit;
    this.bodyPart.position.y = 0.15 - 0.08 * sit - 0.075 * loaf + (walking ? Math.abs(Math.sin(this.walkPhase)) * 0.012 : 0);
    this.front.rotation.x = 0.55 * sit + swing;
    this.front.scale.y = Math.max(0.05, (1 + 0.28 * sit) * (1 - 0.85 * loaf));
    this.hind.rotation.x = -swing;
    this.hind.scale.y = Math.max(0.05, 1 - 0.7 * sit - 0.85 * loaf * (1 - sit));
    this.head.rotation.x = approach(this.head.rotation.x, 0.55 * sit + headX, dt, 0.15);
    this.head.rotation.y = approach(this.head.rotation.y, headY, dt, 0.2);
    const flick = Math.sin(ctx.time * 1.7 + this.phase) * (this.pose === 'sleep' ? 0.05 : 0.3);
    // Sitting or lying, the tail rests along the ground and curls to one side.
    this.tail.rotation.x = approach(this.tail.rotation.x, walking ? -0.2 : -(1.0 * sit + 1.3 * loaf * (1 - sit)), dt, 0.2);
    this.tail.rotation.y = (walking ? 0 : 0.9 * Math.max(sit, loaf)) + flick;
    this.tail.rotation.z = walking ? Math.sin(this.walkPhase * 0.5) * 0.2 : 0;
  }

  // Returns true while moving.
  _tickWalk(dt) {
    const g = this.goal;
    if (!g) {
      this._rest(null);
      return false;
    }
    const dx = g.x - this.pos.x;
    const dz = g.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) {
      if (g.vanish) {
        this.set('vanish');
        return false;
      }
      if (g.then) {
        this.goal = g.then;
        return true;
      }
      if (g.face !== undefined) this.heading = g.face;
      this._rest(g);
      return false;
    }
    const off = this.turnToward(dx, dz, 4, dt);
    if (off > 0.5) return true;
    const step = Math.min(d, SPEED * dt);
    const nx = this.pos.x + (dx / d) * step;
    const nz = this.pos.z + (dz / d) * step;
    if (!g.scripted && !this.ctx.walkable(this.pos.x, this.pos.z, nx, nz, { maxStep: 0, solids: this.slot.solids ?? [], radius: 0.15 })) {
      this._rest(null);
      return false;
    }
    this.pos.x = nx;
    this.pos.z = nz;
    const s = this.ctx.surfaceAt(nx, nz);
    this.pos.y = approach(this.pos.y, g.scripted ? g.y : s.y, dt, 0.08);
    return true;
  }

  _rest(spot) {
    this.set('rest');
    this.goal = null;
    const night = this.ctx.night > 0.6;
    this.pose = night ? 'sleep' : spot?.kind === 'campfire' || Math.random() < 0.35 ? 'loaf' : 'sit';
    this.stay = this.r(10, 24);
    this.next = this.r(1, 4);
  }

  // Stroll to another favorite spot, or just a little way along.
  _wander() {
    const spots = this.slot.spots.filter((s) => Math.hypot(s.x - this.pos.x, s.z - this.pos.z) > 0.3);
    const opts = { maxStep: 0, solids: this.slot.solids ?? [], radius: 0.15 };
    const reachable = spots.filter((s) => this.ctx.walkable(this.pos.x, this.pos.z, s.x, s.z, opts));
    if (reachable.length) {
      this.goal = reachable[Math.floor(Math.random() * reachable.length)];
      this.set('walk');
      return;
    }
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = this.r(0.8, 2);
      const x = this.step.x + Math.cos(a) * d;
      const z = this.step.z + Math.sin(a) * d;
      if (this.ctx.walkable(this.pos.x, this.pos.z, x, z, opts)) {
        this.goal = { x, y: this.step.y, z };
        this.set('walk');
        return;
      }
    }
    this.stay = this.r(6, 12);
  }
}
