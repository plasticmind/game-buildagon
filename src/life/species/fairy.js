// The mushroom fairy. Past midnight, on about one night in three, she appears
// over a ring of glowing mushrooms with a chime and a burst of sparkles. She
// dances around the ring trailing fairy dust, rests on the caps, and leaves a
// moonflower behind. Fly close and she circles you once, then zips away.

import { Visitor } from '../Visitor.js';
import { approach } from '../Creature.js';
import { fairyModel } from '../models.js';

const DUST = ['#fff2a8', '#f7c8e0', '#c8ecff'];

export class Fairy extends Visitor {
  constructor(ctx, slot, opts) {
    super(ctx, slot, opts);
    this.model = this.attach(fairyModel(this.rng));
    this.wingL = this.model.getObjectByName('wingL');
    this.wingR = this.model.getObjectByName('wingR');
    this.cfg = { chance: 0.35, pity: 2, delay: [4, 25] };
    this.dustT = 0;
    this.angle = 0;
    this.gifted = false;
    this.curious = false;
  }

  inWindow() {
    return this.between(23.5, 4.5);
  }

  get center() {
    const s = this.slot;
    return { x: s.x, y: Math.max(...s.caps.map((c) => c.y)), z: s.z };
  }

  visit() {
    const c = this.center;
    this.angle = Math.random() * Math.PI * 2;
    this.pos.set(c.x, c.y + 0.5, c.z);
    this.elapsed = 0;
    this.stay = this.r(70, 110);
    this.gifted = false;
    this.curious = false;
    this.set('dance');
    this.ctx.particles.sparkle(this.pos, { color: '#fff2a8', count: 16 });
    this.ctx.sound('fairy', this.pos, { range: 55 });
  }

  depart() {
    // Zip up and away, then vanish in a puff of sparkles.
    this.set('zip');
    const a = Math.random() * Math.PI * 2;
    this.zip = { x: Math.cos(a), z: Math.sin(a) };
    this.ctx.sound('fairy', this.pos, { range: 55, pitch: 1.25, volume: 0.7 });
  }

  visitTick(dt) {
    const { ctx } = this;
    this.elapsed += dt;
    // Wings beat in a blur; the whole fairy bobs.
    const beat = Math.sin(this.t * 42);
    this.wingL.rotation.y = -0.35 - beat * 0.55;
    this.wingR.rotation.y = 0.35 + beat * 0.55;
    this.model.position.y = Math.sin(this.t * 3) * 0.03;

    // A trail of glowing dust.
    this.dustT -= dt;
    if (this.dustT <= 0 && this.state !== 'rest') {
      this.dustT = 0.04;
      ctx.particles.dust({ x: this.pos.x, y: this.pos.y + 0.12, z: this.pos.z }, { color: DUST[Math.floor(Math.random() * 3)] });
    }

    if (this.state === 'zip') {
      this.pos.x += this.zip.x * dt * 6;
      this.pos.z += this.zip.z * dt * 6;
      this.pos.y += dt * 4;
      this.turnToward(this.zip.x, this.zip.z, 8, dt);
      if (this.t > 0.9) {
        ctx.particles.sparkle(this.pos, { color: '#fff2a8', count: 14 });
        this.goAway();
      }
      return;
    }

    if (!this.leaving && (this.elapsed > this.stay || !this.inWindow())) {
      this.depart();
      return;
    }

    // Fly close and she comes to see you, circles once, and zips off.
    const toCam = Math.hypot(ctx.cam.x - this.pos.x, ctx.cam.y - this.pos.y, ctx.cam.z - this.pos.z);
    if (!this.curious && this.state !== 'curious' && toCam < 4.5 && this.elapsed > 3) {
      this.curious = true;
      this.set('curious');
      this.loop = { a: Math.atan2(this.pos.z - ctx.cam.z, this.pos.x - ctx.cam.x) };
      ctx.sound('fairy', this.pos, { range: 20, pitch: 1.5, volume: 0.6 });
    }

    const c = this.center;
    if (this.state === 'curious') {
      this.loop.a += dt * 2.6;
      const tx = ctx.cam.x + Math.cos(this.loop.a) * 1.1;
      const tz = ctx.cam.z + Math.sin(this.loop.a) * 1.1;
      const ty = ctx.cam.y - 0.15 + Math.sin(this.t * 4) * 0.1;
      this.pos.x = approach(this.pos.x, tx, dt, 0.15);
      this.pos.y = approach(this.pos.y, ty, dt, 0.15);
      this.pos.z = approach(this.pos.z, tz, dt, 0.15);
      this.heading = Math.atan2(ctx.cam.x - this.pos.x, ctx.cam.z - this.pos.z);
      if (this.t > 2.6) {
        this._gift();
        this.depart();
      }
      return;
    }

    if (this.state === 'rest') {
      const cap = this.cap;
      this.pos.x = approach(this.pos.x, cap.x, dt, 0.2);
      this.pos.y = approach(this.pos.y, cap.y + 0.02, dt, 0.2);
      this.pos.z = approach(this.pos.z, cap.z, dt, 0.2);
      this.wingL.rotation.y = -0.6 - Math.sin(this.t * 3) * 0.2;
      this.wingR.rotation.y = 0.6 + Math.sin(this.t * 3) * 0.2;
      if (this.t > 3.5) this.set('dance');
      return;
    }

    // Dance: loop around the ring in a lilting figure, now and then landing.
    this.angle += dt * 1.3;
    const radius = 0.55 + Math.max(...this.slot.caps.map((p) => Math.hypot(p.x - c.x, p.z - c.z))) + Math.sin(this.angle * 2) * 0.25;
    const tx = c.x + Math.cos(this.angle) * radius;
    const tz = c.z + Math.sin(this.angle) * radius;
    const ty = c.y + 0.45 + Math.sin(this.angle * 3) * 0.2;
    const px = this.pos.x;
    const pz = this.pos.z;
    this.pos.x = approach(this.pos.x, tx, dt, 0.25);
    this.pos.y = approach(this.pos.y, ty, dt, 0.25);
    this.pos.z = approach(this.pos.z, tz, dt, 0.25);
    this.turnToward(this.pos.x - px, this.pos.z - pz, 6, dt);
    if (this.t > 7 && Math.random() < dt * 0.25) {
      this.cap = this.slot.caps[Math.floor(Math.random() * this.slot.caps.length)];
      this.set('rest');
    }
    if (!this.gifted && this.elapsed > 25) this._gift();
  }

  // Leave a moonflower where she danced, once per visit.
  _gift() {
    if (this.gifted) return;
    this.gifted = true;
    const c = this.center;
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = 0.9 + Math.random() * 1.2;
      const obj = this.ctx.plant('moonflower', Math.floor(Math.random() * 2), c.x + Math.cos(a) * d, c.z + Math.sin(a) * d, { near: 4, max: 3 });
      if (obj) {
        this.ctx.particles.sparkle({ x: obj.x, y: obj.y + 0.3, z: obj.z }, { color: '#c8ecff', count: 14 });
        this.ctx.sound('gift', obj, { range: 40 });
        this.ctx.unlock('moonflower');
        return;
      }
    }
  }
}
