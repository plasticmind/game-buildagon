// The owl. On most nights it glides silently into a grove of pines, perches,
// hoots, and blinks. Its head follows you as you fly past, all the way around
// until it whips back to the other side. It leaves at dawn.

import { Visitor } from '../Visitor.js';
import { approach, wrapAngle } from '../Creature.js';
import { owlModel } from '../models.js';
import { poseWings, flightPoint, farPoint } from '../flight.js';

const NECK = 2.75; // How far the head turns before whipping around.

export class Owl extends Visitor {
  constructor(ctx, slot, opts) {
    super(ctx, slot, opts);
    this.model = this.attach(owlModel(this.rng), { shadow: true });
    this.bodyPart = this.model.getObjectByName('body');
    this.head = this.model.getObjectByName('head');
    this.lids = this.model.getObjectByName('lids');
    this.wingL = this.model.getObjectByName('wingL');
    this.wingR = this.model.getObjectByName('wingR');
    this.cfg = { chance: 0.7, pity: 1, delay: [2, 30] };
    this.wingOpen = 0;
    this.flapPhase = 0;
    this.blink = 0;
    this.nextBlink = 2;
    this.nextHoot = 4;
    this.puff = 0;
  }

  inWindow() {
    return this.ctx.night > 0.6;
  }

  visit() {
    this.perch = this._pickPerch();
    this.pos.copy(farPoint(this.perch, 26, 8));
    this._flyTo(this.perch, 'perch');
  }

  depart() {
    this._flyTo(farPoint(this.pos, 28, 9), 'away');
  }

  _flyTo(to, mode) {
    const from = { x: this.pos.x, y: this.pos.y, z: this.pos.z };
    const d = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    this.flight = { from, to, mode, time: Math.max(1, d / 5) };
    this.heading = Math.atan2(to.x - from.x, to.z - from.z);
    this.set('fly');
  }

  _pickPerch() {
    const list = this.slot.perches;
    const others = list.filter((p) => !this.perch || Math.hypot(p.x - this.perch.x, p.z - this.perch.z) > 0.1);
    const p = (others.length ? others : list)[Math.floor(Math.random() * (others.length || list.length))];
    return { x: p.x, y: p.y, z: p.z };
  }

  visitTick(dt) {
    const { ctx } = this;
    if (this.state === 'fly') {
      const f = this.flight;
      const s = Math.min(1, this.t / f.time);
      flightPoint(f.from, f.to, s, this.pos, { lift: f.mode === 'hop' ? 0.8 : 0, landing: f.mode !== 'away' });
      // Owls fly silently: slow, deep wingbeats with long glides.
      this.flapPhase += dt * 7;
      const glide = Math.sin(this.t * 0.9) > 0.3;
      this.wingOpen = approach(this.wingOpen, 1, dt, 0.08);
      poseWings(this.wingL, this.wingR, this.wingOpen, glide ? 0.1 : Math.sin(this.flapPhase) * 0.8 + 0.1);
      this.head.rotation.y = approach(this.head.rotation.y, 0, dt, 0.2);
      if (s < 1) return;
      if (f.mode === 'away') {
        this.goAway();
        return;
      }
      this.set('perch');
      this.stay = this.r(25, 60);
      return;
    }

    // Perched.
    this.wingOpen = approach(this.wingOpen, 0, dt, 0.1);
    poseWings(this.wingL, this.wingR, this.wingOpen, 0.3 * this.wingOpen);
    if (!this.leaving && !this.inWindow()) {
      this.depart();
      return;
    }
    this.stay -= dt;
    if (this.stay <= 0 && this.slot.perches.length > 1) {
      this.perch = this._pickPerch();
      this._flyTo(this.perch, 'hop');
      return;
    }

    // Watch the camera, turning the head as far as it goes, then whipping
    // around to the other side.
    const dx = ctx.cam.x - this.pos.x;
    const dz = ctx.cam.z - this.pos.z;
    const near = dx * dx + dz * dz < 30 * 30;
    let want = near ? wrapAngle(Math.atan2(dx, dz) - this.heading) : Math.sin(this.t * 0.4) * 1.2;
    want = Math.max(-NECK, Math.min(NECK, want));
    this.head.rotation.y = approach(this.head.rotation.y, want, dt, near ? 0.1 : 0.6);
    const up = near ? Math.atan2(ctx.cam.y - this.pos.y - 0.3, Math.hypot(dx, dz)) : 0;
    this.head.rotation.x = approach(this.head.rotation.x, -Math.max(-0.5, Math.min(0.5, up)) * 0.6, dt, 0.2);

    // Blink, and now and then hoot with a puffed chest.
    this.nextBlink -= dt;
    if (this.nextBlink <= 0) {
      this.nextBlink = this.r(2, 6);
      this.blink = 0.18;
    }
    this.blink = Math.max(0, this.blink - dt);
    this.lids.scale.y = this.blink > 0 ? 1 : 0.01;
    this.nextHoot -= dt;
    if (this.nextHoot <= 0) {
      this.nextHoot = this.r(6, 15);
      this.puff = 1;
      ctx.sound('hoot', this.pos, { range: 50 });
    }
    this.puff = Math.max(0, this.puff - dt * 0.8);
    this.bodyPart.scale.setScalar(1 + Math.sin(this.puff * Math.PI) * 0.06);
  }
}
