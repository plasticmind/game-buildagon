// Frogs live on lily pads. They sit, turn, croak (more after dark), and hop
// between the pads of their patch. They arrive by leaping out of the water and
// leave with a plop.

import * as THREE from 'three';
import { Creature, arc, ease, approach } from '../Creature.js';
import { frogModel, FROG_SKINS } from '../models.js';

const _p = new THREE.Vector3();

export class Frog extends Creature {
  constructor(ctx, slot, opts) {
    super(ctx, slot, opts);
    this.model = this.attach(frogModel(this.rng, FROG_SKINS[Math.floor(this.rng() * FROG_SKINS.length)]));
    this.legs = this.model.getObjectByName('legs');
    this.throat = this.model.getObjectByName('throat');
    this.pad = null;
    this.hop = null;
    this.croak = 0; // Seconds left in the current croak.
    this.next = 0;
  }

  start(arrive) {
    this.pad = this._freePad(this.slot);
    if (!arrive) {
      this.pos.set(this.pad.x, this.pad.y, this.pad.z);
      this._sit();
      return;
    }
    // Leap up out of the water onto the pad.
    const a = this.r(0, Math.PI * 2);
    const from = { x: this.pad.x + Math.cos(a) * 0.7, y: this.pad.y - 0.25, z: this.pad.z + Math.sin(a) * 0.7 };
    this.ctx.splash(from, 0.6);
    this.ctx.sound('plop', from, { volume: 0.6 });
    this._hopTo(from, this.pad, 0.5);
  }

  setSlot(slot) {
    super.setSlot(slot);
    // If our pad went away, hop to one that still exists.
    if (this.pad && !slot.pads.some((p) => p.id === this.pad.id) && this.state === 'sit') {
      const to = this._freePad(slot);
      if (to) this._hopFrom(to);
    }
  }

  onLeave() {
    this.ctx.release(`pad:${this.pad?.id}`, this);
    const a = this.heading + this.r(-0.6, 0.6);
    const to = { x: this.pos.x + Math.sin(a) * 0.8, y: this.pos.y - 0.35, z: this.pos.z + Math.cos(a) * 0.8 };
    this._hopTo(this.pos.clone(), to, 0.45);
    this.hop.dive = true;
  }

  tick(dt) {
    const { ctx } = this;
    if (this.state === 'hop') {
      const h = this.hop;
      const s = Math.min(1, this.t / h.time);
      arc(h.from, h.to, ease(s * 0.9 + 0.1 * s * s), h.height, this.pos);
      // Legs kick out on take-off and fold back in the air.
      const kick = Math.sin(Math.min(1, s * 1.8) * Math.PI);
      this.legs.rotation.x = -0.9 * kick;
      this.legs.scale.z = 1 + 0.5 * kick;
      this.model.scale.set(1 - 0.12 * kick, 1 + 0.18 * kick, 1);
      if (s >= 1) {
        this.legs.rotation.x = 0;
        this.legs.scale.z = 1;
        this.model.scale.set(1, 1, 1);
        if (h.dive) {
          ctx.splash(this.pos, 0.7);
          ctx.sound('plop', this.pos);
          this.gone = true;
          return;
        }
        this._sit();
      }
      return;
    }

    // Sitting: breathe, now and then turn, croak, or hop to another pad.
    if (this.pad) this.pos.y = approach(this.pos.y, this.pad.y, dt, 0.2);
    const breathe = 1 + Math.sin(this.t * 3.1) * 0.025;
    this.model.scale.set(1, breathe, 1);
    if (this.croak > 0) {
      this.croak -= dt;
      const puff = Math.max(0, Math.sin((0.6 - this.croak) * Math.PI * 3.3));
      this.throat.scale.setScalar(0.4 + 0.9 * puff);
      if (this.croak <= 0) this.throat.scale.setScalar(0.4);
    }
    this.next -= dt;
    if (this.next > 0) return;
    const roll = Math.random();
    const chorus = ctx.night > 0.4 || ctx.night < 0.05;
    if (roll < (chorus ? 0.5 : 0.3)) {
      this.croak = 0.6;
      ctx.sound('frog', this.pos, { volume: chorus ? 1 : 0.7, pitch: this.slot.pads.length > 2 ? 1 : 0.92 });
      this.next = this.r(2.5, 7);
    } else if (roll < 0.75) {
      this.heading += this.r(-1.2, 1.2);
      this.next = this.r(2, 6);
    } else {
      const to = this._freePad(this.slot, true);
      if (to) this._hopFrom(to);
      else this.next = this.r(3, 7);
    }
  }

  _sit() {
    this.set('sit');
    this.hop = null;
    this.next = this.r(1.5, 5);
  }

  _hopFrom(pad) {
    this.ctx.release(`pad:${this.pad?.id}`, this);
    this.pad = pad;
    this._hopTo(this.pos.clone(), pad, 0.35);
  }

  _hopTo(from, to, height) {
    const d = Math.hypot(to.x - from.x, to.z - from.z);
    this.hop = {
      from: { x: from.x, y: from.y, z: from.z },
      to: { x: to.x, y: to.y, z: to.z },
      time: 0.4 + d * 0.07,
      height: height + d * 0.12,
    };
    _p.set(to.x - from.x, 0, to.z - from.z);
    if (d > 0.01) this.heading = Math.atan2(_p.x, _p.z);
    this.set('hop');
  }

  // A pad no other frog sits on. With `other`, never the current pad and only
  // within hopping reach.
  _freePad(slot, other = false) {
    const pads = slot.pads.filter((p) => {
      if (other && (p.id === this.pad?.id || Math.hypot(p.x - this.pos.x, p.z - this.pos.z) > 3.2)) return false;
      return !this.ctx.claimed(`pad:${p.id}`, this);
    });
    if (!pads.length) return other ? null : slot.pads.find((p) => p.x === slot.x && p.z === slot.z) ?? slot.pads[0];
    const mine = pads.find((p) => p.x === slot.x && p.z === slot.z);
    const pad = !other && mine ? mine : pads[Math.floor(Math.random() * pads.length)];
    this.ctx.claim(`pad:${pad.id}`, this);
    return pad;
  }
}
