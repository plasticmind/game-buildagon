// Butterflies flit between the flowers of a garden by day, resting with their
// wings slowly opening and closing. At dusk they flutter off to roost, and
// they come back in the morning.

import { Creature, approach, lerp } from '../Creature.js';
import { butterflyModel, BUTTERFLY_LOOKS } from '../models.js';

export class Butterfly extends Creature {
  constructor(ctx, slot, opts) {
    super(ctx, slot, opts);
    const look = BUTTERFLY_LOOKS[Math.floor(this.rng() * BUTTERFLY_LOOKS.length)];
    this.model = this.attach(butterflyModel(this.rng, look));
    this.wingL = this.model.getObjectByName('wingL');
    this.wingR = this.model.getObjectByName('wingR');
    this.phase = this.rng() * 10;
    this.flight = null;
    this.rest = 0;
  }

  start(arrive) {
    if (this.ctx.night > 0.55) {
      this._roost();
      return;
    }
    const spot = this._flowerSpot();
    if (arrive) {
      this.pos.set(spot.x + this.r(-8, 8), spot.y + this.r(3, 5), spot.z + this.r(-8, 8));
      this._flyTo(spot, 'land');
    } else {
      this.pos.set(spot.x, spot.y, spot.z);
      this._rest();
    }
  }

  onLeave() {
    if (this.state === 'roost') {
      this.gone = true;
      return;
    }
    this._flyTo(this._away(), 'leave');
  }

  tick(dt) {
    const { ctx } = this;
    if (this.state === 'roost') {
      this.hidden = true;
      if (ctx.night < 0.42) {
        this.hidden = false;
        const spot = this._flowerSpot();
        this.pos.set(spot.x + this.r(-6, 6), spot.y + 4, spot.z + this.r(-6, 6));
        this._flyTo(spot, 'land');
      }
      return;
    }
    if (!this.leaving && ctx.night > 0.58 && !(this.state === 'fly' && this.flight.mode !== 'land')) {
      this._flyTo(this._away(), 'roost');
    }

    let wing;
    if (this.state === 'fly') {
      const f = this.flight;
      const s = Math.min(1, this.t / f.time);
      const bump = Math.sin(Math.PI * s);
      const px = this.pos.x;
      const pz = this.pos.z;
      this.pos.x = lerp(f.from.x, f.to.x, s) + f.side.x * Math.sin(this.t * 4.1 + this.phase) * 0.18 * bump;
      this.pos.z = lerp(f.from.z, f.to.z, s) + f.side.z * Math.sin(this.t * 4.1 + this.phase) * 0.18 * bump;
      this.pos.y = lerp(f.from.y, f.to.y, s) + bump * f.lift + Math.sin(this.t * 9 + this.phase) * 0.04 * bump;
      const dx = this.pos.x - px;
      const dz = this.pos.z - pz;
      if (dx * dx + dz * dz > 1e-8) this.turnToward(dx, dz, 6, dt);
      wing = 0.15 + 1.15 * (0.5 + 0.5 * Math.sin(this.t * 32 + this.phase));
      this.model.rotation.x = approach(this.model.rotation.x, -0.2, dt, 0.1);
      if (s >= 1) {
        if (f.mode === 'leave') {
          this.gone = true;
          return;
        }
        if (f.mode === 'roost') this._roost();
        else this._rest();
      }
    } else {
      // Resting: wings drift open and closed, with a quick flick now and then.
      wing = 0.2 + 1.1 * (0.5 + 0.5 * Math.sin(this.t * 2.1 + this.phase)) ** 2;
      if (Math.sin(this.t * 0.7 + this.phase * 3) > 0.97) wing = 0.15 + Math.abs(Math.sin(this.t * 30)) * 1.2;
      this.model.rotation.x = approach(this.model.rotation.x, 0, dt, 0.2);
      this.rest -= dt;
      if (this.rest <= 0) this._flyTo(this._flowerSpot(true), 'land');
    }
    this.wingR.rotation.z = wing;
    this.wingL.rotation.z = -wing;
  }

  _rest() {
    this.set('rest');
    this.rest = this.r(2, 7);
    this.heading += this.r(-1, 1);
  }

  _roost() {
    this.set('roost');
    this.hidden = true;
  }

  _flyTo(to, mode) {
    const from = { x: this.pos.x, y: this.pos.y, z: this.pos.z };
    const d = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    const l = Math.hypot(to.x - from.x, to.z - from.z) || 1;
    this.flight = {
      from,
      to,
      mode,
      time: d / 1.1 + 0.4,
      lift: mode === 'land' ? 0.3 + Math.min(1, d * 0.15) : 0,
      side: { x: -(to.z - from.z) / l, z: (to.x - from.x) / l },
    };
    this.set('fly');
  }

  // A landing spot on one of the garden's flowers (a different one if `other`).
  _flowerSpot(other = false) {
    const list = this.slot.flowers;
    let f = list[Math.floor(Math.random() * list.length)];
    if (other && list.length > 1) {
      for (let i = 0; i < 4 && Math.hypot(f.x - this.pos.x, f.z - this.pos.z) < 0.4; i++) f = list[Math.floor(Math.random() * list.length)];
    }
    const a = Math.random() * Math.PI * 2;
    const d = Math.random() * f.r;
    return { x: f.x + Math.cos(a) * d, y: f.y, z: f.z + Math.sin(a) * d };
  }

  _away() {
    const a = Math.random() * Math.PI * 2;
    return { x: this.pos.x + Math.cos(a) * 10, y: this.pos.y + 6, z: this.pos.z + Math.sin(a) * 10 };
  }
}
