// Songbirds hop and sing in the treetops of a grove, flit between perches, and
// drop to the ground to peck. Gulls wheel over sandy beaches, land on the sand
// or a boat to stand and call, and take off again.

import { Creature, approach } from '../Creature.js';
import { SEA_Y } from '../../core/constants.js';
import { songbirdModel, gullModel, SONGBIRD_LOOKS } from '../models.js';
import { poseWings, flightPoint, farPoint } from '../flight.js';

class Bird extends Creature {
  constructor(ctx, slot, opts, build, { shadow = false } = {}) {
    super(ctx, slot, opts);
    this.model = this.attach(build(this.rng), { shadow });
    this.bodyPart = this.model.getObjectByName('body');
    this.head = this.model.getObjectByName('head');
    this.legs = this.model.getObjectByName('legs');
    this.wingL = this.model.getObjectByName('wingL');
    this.wingR = this.model.getObjectByName('wingR');
    this.wingOpen = 0;
    this.flapPhase = this.rng() * 10;
    this.flight = null;
    this.phase = this.rng() * 10;
  }

  _flyTo(to, mode, { speed = 5, lift = 0, landing = true } = {}) {
    const from = { x: this.pos.x, y: this.pos.y, z: this.pos.z };
    const d = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    this.flight = { from, to, mode, lift, landing, time: Math.max(0.6, d / speed) };
    if (Math.hypot(to.x - from.x, to.z - from.z) > 0.01) this.heading = Math.atan2(to.x - from.x, to.z - from.z);
    this.set('fly');
  }

  // Advance the current flight. Returns true on arrival.
  _tickFlight(dt, flapRate, glideFrom = 1) {
    const f = this.flight;
    const s = Math.min(1, this.t / f.time);
    flightPoint(f.from, f.to, s, this.pos, { lift: f.lift, landing: f.landing });
    this.flapPhase += dt * flapRate;
    const glide = s > glideFrom && s < 0.93;
    this.wingOpen = approach(this.wingOpen, 1, dt, 0.06);
    poseWings(this.wingL, this.wingR, this.wingOpen, glide ? 0.1 : Math.sin(this.flapPhase) * 0.9 + 0.15);
    const climb = (f.to.y - f.from.y) / Math.max(0.5, Math.hypot(f.to.x - f.from.x, f.to.z - f.from.z));
    this.bodyPart.rotation.x = approach(this.bodyPart.rotation.x, -Math.max(-0.5, Math.min(0.5, climb * 0.6)), dt, 0.1);
    return s >= 1;
  }

  _fold(dt) {
    this.wingOpen = approach(this.wingOpen, 0, dt, 0.08);
    poseWings(this.wingL, this.wingR, this.wingOpen, 0.4 * this.wingOpen);
    this.bodyPart.rotation.x = approach(this.bodyPart.rotation.x, 0, dt, 0.12);
    this.bodyPart.rotation.z = approach(this.bodyPart.rotation.z, 0, dt, 0.15);
  }
}

// ---- Songbird ------------------------------------------------------------------------

export class Songbird extends Bird {
  constructor(ctx, slot, opts) {
    super(ctx, slot, opts, (rng) => songbirdModel(rng, SONGBIRD_LOOKS[Math.floor(rng() * SONGBIRD_LOOKS.length)]));
    this.perch = null;
    this.next = 0;
    this.hops = 0;
    this.sleep = 0;
  }

  start(arrive) {
    this.perch = this._pickPerch();
    if (!arrive) {
      this.pos.set(this.perch.x, this.perch.y, this.perch.z);
      this._land();
      return;
    }
    this.pos.copy(farPoint(this.perch, 26, 9));
    this._flyTo(this.perch, 'perch', { speed: 6 });
  }

  setSlot(slot) {
    super.setSlot(slot);
    // Our perch was cut down: find another.
    if (this.perch && !this.perch.ground && !slot.perches.some((p) => Math.abs(p.x - this.perch.x) < 0.01 && Math.abs(p.z - this.perch.z) < 0.01)) {
      if (this.state === 'perch') this._flyTo((this.perch = this._pickPerch()), 'perch', { lift: 0.8 });
    }
  }

  onLeave() {
    this._release();
    this._flyTo(farPoint(this.pos, 28, 10), 'leave', { speed: 7, landing: false });
  }

  tick(dt) {
    const { ctx } = this;
    if (this.state === 'fly') {
      if (!this._tickFlight(dt, 34, 0.7)) return;
      if (this.flight.mode === 'leave') {
        this.gone = true;
        return;
      }
      this._land();
      return;
    }
    this._fold(dt);
    const asleep = ctx.night > 0.6 && this.state === 'perch';
    this.sleep = approach(this.sleep, asleep ? 1 : 0, dt, 0.6);
    this.model.scale.setScalar(1 + this.sleep * 0.12);
    this.head.rotation.x = approach(this.head.rotation.x, this.sleep * 0.6, dt, 0.2);
    // A perky tail bob.
    this.bodyPart.rotation.x = Math.sin(this.t * 3 + this.phase) * 0.04 * (1 - this.sleep);
    if (asleep) return;

    this.next -= dt;
    if (this.state === 'ground') {
      if (this.hop) {
        const s = Math.min(1, this.hop.t / 0.18);
        this.hop.t += dt;
        this.pos.x = this.hop.x + Math.sin(this.heading) * 0.18 * s;
        this.pos.z = this.hop.z + Math.cos(this.heading) * 0.18 * s;
        this.pos.y = this.hop.y + Math.sin(Math.PI * s) * 0.08;
        if (s >= 1) this.hop = null;
        return;
      }
      if (this.next > 0) {
        // Peck, peck.
        this.head.rotation.x = Math.max(0, Math.sin(this.t * 9)) * 0.9;
        return;
      }
      if (this.hops-- > 0) {
        this.heading += this.r(-1.2, 1.2);
        const nx = this.pos.x + Math.sin(this.heading) * 0.18;
        const nz = this.pos.z + Math.cos(this.heading) * 0.18;
        const s = ctx.surfaceAt(nx, nz);
        if (s.type === 'land' && Math.abs(s.y - this.pos.y) < 0.05) this.hop = { t: 0, x: this.pos.x, y: this.pos.y, z: this.pos.z };
        this.next = this.r(0.4, 1.4);
        return;
      }
      this.perch = this._pickPerch();
      this._flyTo(this.perch, 'perch', { speed: 5, lift: 0.6 });
      return;
    }

    // Perched.
    if (this.next > 0) return;
    const roll = Math.random();
    if (roll < 0.35) {
      ctx.sound('chirp', this.pos, { volume: 0.8, pitch: 0.9 + (this.phase % 0.3) });
      this.head.rotation.x = -0.35;
      this.next = this.r(1.5, 4);
    } else if (roll < 0.55) {
      this.head.rotation.y = this.r(-1.1, 1.1);
      this.next = this.r(1, 3);
    } else if (roll < 0.7) {
      this.heading += this.r(-1.4, 1.4);
      this.next = this.r(1, 3);
    } else if (roll < 0.88 && this.slot.perches.length > 1) {
      this._release();
      this.perch = this._pickPerch();
      this._flyTo(this.perch, 'perch', { speed: 5, lift: 0.8 });
    } else {
      const g = this._groundSpot();
      if (g) {
        this._release();
        this.perch = g;
        this._flyTo(g, 'ground', { speed: 5, lift: 0.4 });
      } else {
        this.next = this.r(1, 3);
      }
    }
  }

  _land() {
    const ground = this.perch?.ground;
    this.set(ground ? 'ground' : 'perch');
    this.next = this.r(1, 3);
    this.hops = ground ? 2 + Math.floor(Math.random() * 3) : 0;
    this.hop = null;
    this.head.rotation.y = 0;
  }

  _pickPerch() {
    const list = this.slot.perches;
    const order = list.map((p, i) => [Math.random(), i]).sort((a, b) => a[0] - b[0]);
    for (const [, i] of order) {
      const p = list[i];
      if (this.perch && Math.abs(p.x - this.perch.x) < 0.01 && Math.abs(p.z - this.perch.z) < 0.01) continue;
      const id = `perch:${p.x.toFixed(2)},${p.z.toFixed(2)}`;
      if (this.ctx.claim(id, this)) {
        this.claim = id;
        // Trees have room for a bird anywhere on top of the crown.
        const j = p.tree ? 0.25 : 0;
        return { x: p.x + this.r(-j, j), y: p.y, z: p.z + this.r(-j, j) };
      }
    }
    const p = list[Math.floor(Math.random() * list.length)];
    return { x: p.x, y: p.y, z: p.z };
  }

  _release() {
    if (this.claim) this.ctx.release(this.claim, this);
    this.claim = null;
  }

  _groundSpot() {
    const trunks = this.slot.trunks;
    if (!trunks?.length) return null;
    for (let i = 0; i < 6; i++) {
      const t = trunks[Math.floor(Math.random() * trunks.length)];
      const a = Math.random() * Math.PI * 2;
      const d = this.r(1.1, 2.4);
      const x = t.x + Math.cos(a) * d;
      const z = t.z + Math.sin(a) * d;
      const s = this.ctx.surfaceAt(x, z);
      if (s.type === 'land' && Math.abs(s.y - t.y) < 0.7) return { x, y: s.y, z, ground: true };
    }
    return null;
  }
}

// ---- Gull ----------------------------------------------------------------------------

export class Gull extends Bird {
  constructor(ctx, slot, opts) {
    super(ctx, slot, opts, (rng) => gullModel(rng), { shadow: true });
    this.dir = this.rng() < 0.5 ? 1 : -1;
    this.angle = this.rng() * Math.PI * 2;
    this.radius = 5 + this.rng() * 3;
    this.height = 6 + this.rng() * 3;
    this.flapT = 0;
    this.next = 0;
    this.legs.visible = false;
  }

  // The circle the gull soars on, out over the water off the beach.
  _orbit(angle, out = {}) {
    const s = this.slot;
    const cx = s.x + s.sea.x * 4;
    const cz = s.z + s.sea.z * 4;
    const top = Math.max(SEA_Y, ...s.spots.map((p) => p.y));
    out.x = cx + Math.cos(angle) * this.radius;
    out.z = cz + Math.sin(angle) * this.radius;
    out.y = top + this.height + Math.sin(angle * 2 + this.phase) * 0.6;
    return out;
  }

  start(arrive) {
    if (!arrive) {
      this._orbit(this.angle, this.pos);
      this._soar();
      return;
    }
    const s = this.slot;
    this.pos.set(s.x + s.sea.x * 45, SEA_Y + 14, s.z + s.sea.z * 45);
    this._flyTo(this._orbit(this.angle), 'join', { speed: 7, landing: false });
  }

  onLeave() {
    const s = this.slot;
    this.legs.visible = false;
    this._flyTo({ x: this.pos.x + s.sea.x * 45, y: SEA_Y + 15, z: this.pos.z + s.sea.z * 45 }, 'leave', { speed: 7, landing: false });
  }

  tick(dt) {
    const { ctx } = this;
    if (this.state === 'fly') {
      const f = this.flight;
      const landing = f.mode === 'land';
      if (landing) this.legs.visible = this.t / f.time > 0.75;
      if (!this._tickFlight(dt, landing && this.t / f.time > 0.8 ? 16 : 7, landing ? 0.15 : 0.35)) return;
      if (f.mode === 'leave') {
        this.gone = true;
      } else if (landing) {
        this.set('stand');
        this.next = this.r(1, 3);
        this.stay = this.r(7, 16);
      } else {
        this._soar();
      }
      return;
    }

    if (this.state === 'soar') {
      // Wheel around the circle, banking into the turn, with lazy wingbeats.
      this.angle += (this.dir * 0.75 * dt) / (this.radius / 6);
      this._orbit(this.angle, this.pos);
      this.heading = Math.atan2(-Math.sin(this.angle) * this.dir, Math.cos(this.angle) * this.dir);
      this.bodyPart.rotation.z = approach(this.bodyPart.rotation.z, this.dir * 0.32, dt, 0.4);
      this.bodyPart.rotation.x = approach(this.bodyPart.rotation.x, 0, dt, 0.3);
      this.flapT -= dt;
      if (this.flapT < -this.r(3, 7)) this.flapT = this.r(0.8, 1.6);
      this.flapPhase += dt * 7;
      this.wingOpen = approach(this.wingOpen, 1, dt, 0.1);
      poseWings(this.wingL, this.wingR, this.wingOpen, this.flapT > 0 ? Math.sin(this.flapPhase) * 0.7 + 0.1 : 0.12);
      this.next -= dt;
      if (this.next <= 0) {
        this.next = this.r(5, 12);
        if (Math.random() < 0.5) ctx.sound('gull', this.pos, { volume: 0.8, range: 45 });
        const spot = Math.random() < 0.35 || ctx.night > 0.6 ? this._landingSpot() : null;
        if (spot) {
          this.heading = Math.atan2(spot.x - this.pos.x, spot.z - this.pos.z);
          this._flyTo(spot, 'land', { speed: 5 });
        }
      }
      return;
    }

    // Standing on the sand or a boat.
    this._fold(dt);
    this.legs.visible = true;
    const asleep = ctx.night > 0.6;
    if (asleep) this.head.rotation.y = approach(this.head.rotation.y, 2.2, dt, 0.4);
    this.head.rotation.x = approach(this.head.rotation.x, 0, dt, 0.5);
    this.next -= dt;
    this.stay -= dt;
    if (asleep) return;
    if (this.stay <= 0) {
      this.legs.visible = false;
      this._flyTo(this._orbit(this.angle), 'join', { speed: 4.5, landing: false });
      ctx.sound('flap', this.pos, { volume: 0.5 });
      return;
    }
    if (this.next <= 0) {
      this.next = this.r(1.5, 4);
      const roll = Math.random();
      if (roll < 0.3) {
        ctx.sound('gull', this.pos, { volume: 0.9, range: 40 });
        this.head.rotation.x = -0.5;
      } else if (roll < 0.6) {
        this.head.rotation.y = this.r(-1.2, 1.2);
        this.head.rotation.x = 0;
      } else {
        this.heading += this.r(-1.5, 1.5);
      }
    }
  }

  _soar() {
    this.set('soar');
    this.next = this.r(4, 10);
    this.legs.visible = false;
  }

  _landingSpot() {
    const spots = this.slot.spots;
    for (let i = 0; i < 6; i++) {
      const p = spots[Math.floor(Math.random() * spots.length)];
      if (!p.cell) return { x: p.x, y: p.y, z: p.z };
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * 1.2;
      const x = p.x + Math.cos(a) * d;
      const z = p.z + Math.sin(a) * d;
      const s = this.ctx.surfaceAt(x, z);
      if (s.type === 'land' && Math.abs(s.y - p.y) < 0.01) return { x, y: s.y, z };
    }
    return null;
  }
}
