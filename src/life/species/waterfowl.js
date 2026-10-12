// Ducks paddle around small ponds; swans glide on big lakes. Both fly in to
// land with a splash and skid, dabble or dip, preen, call, and sleep on the
// water at night with their heads tucked. A hen whose pond has reeds on the
// bank raises a line of ducklings that paddle out of the reeds after her.

import * as THREE from 'three';
import { Creature, approach } from '../Creature.js';
import { LAYERS } from '../../render/shared.js';
import { duckModel, ducklingModel, swanModel } from '../models.js';
import { swimOk, pickSwimPoint, nearestSwimPoint } from '../swim.js';
import { poseWings, flightPoint, farPoint } from '../flight.js';

const _f = { x: 0, z: 0 };

class Waterfowl extends Creature {
  constructor(ctx, slot, opts, cfg) {
    super(ctx, slot, opts);
    this.cfg = cfg;
    this.model = this.attach(cfg.build(this.rng, slot), { shadow: true });
    this.touchWater(true);
    this.bodyPart = this.model.getObjectByName('body');
    this.head = this.model.getObjectByName('head');
    this.wingL = this.model.getObjectByName('wingL');
    this.wingR = this.model.getObjectByName('wingR');
    this.wingOpen = 0;
    this.flapPhase = 0;
    this.speed = 0;
    this.target = null;
    this.action = null;
    this.fly = null;
    this.stuck = 0;
    this.splashT = 0;
    this.phase = this.rng() * 10;
    this.chicks = [];
  }

  get body() {
    return this.slot.body;
  }

  start(arrive) {
    const body = this.body;
    const p = pickSwimPoint(this.ctx, body, this.cfg.margin) ?? { x: body.centers[0].x, z: body.centers[0].z };
    const land = { x: p.x, y: body.y, z: p.z };
    if (!arrive) {
      this.pos.set(land.x, land.y, land.z);
      this._idle();
      this._syncChicks(false);
      return;
    }
    this._flyTo(farPoint(land, 34, 13), land, 'land');
  }

  setSlot(slot) {
    super.setSlot(slot);
    if (!this.leaving && this._onWater()) this._syncChicks(true);
  }

  onLeave() {
    for (const c of this.chicks) c.out = true;
    if (this.state === 'fly') {
      if (this.fly.mode !== 'leave') this._flyTo(this.pos.clone(), farPoint(this.pos, 34, 14), 'leave');
      return;
    }
    this.speed = Math.max(this.speed, this.cfg.speed);
    this.set('takeoff');
    this.ctx.sound('flap', this.pos);
  }

  dispose() {
    for (const c of this.chicks) this._dropChick(c);
    this.chicks = [];
    super.dispose();
  }

  tick(dt) {
    if (this.state === 'fly') this._tickFly(dt);
    else if (this.state === 'takeoff') this._tickTakeoff(dt);
    else if (this.state === 'skid') this._tickSkid(dt);
    else this._tickWater(dt);
    this._tickChicks(dt);
  }

  _onWater() {
    return this.state === 'swim' || this.state === 'idle' || this.state === 'sleep';
  }

  // ---- Flight --------------------------------------------------------------------

  _flyTo(from, to, mode) {
    const d = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    this.fly = { from: { x: from.x, y: from.y, z: from.z }, to, mode, time: Math.max(1.2, d / this.cfg.flySpeed) };
    this.pos.set(from.x, from.y, from.z);
    if (Math.hypot(to.x - from.x, to.z - from.z) > 0.01) this.heading = Math.atan2(to.x - from.x, to.z - from.z);
    this.set('fly');
  }

  _tickFly(dt) {
    const f = this.fly;
    const s = Math.min(1, this.t / f.time);
    flightPoint(f.from, f.to, s, this.pos, { landing: f.mode !== 'leave', lift: f.mode === 'hop' ? 1.2 : 0 });
    const gliding = f.mode !== 'leave' && s > 0.78;
    this.flapPhase += dt * this.cfg.flapRate;
    const flap = gliding ? 0.12 : Math.sin(this.flapPhase) * 0.85 + 0.15;
    this.wingOpen = approach(this.wingOpen, 1, dt, 0.08);
    poseWings(this.wingL, this.wingR, this.wingOpen, flap);
    // Nose down in the descent, then flare up just before touchdown.
    const flare = f.mode !== 'leave' && s > 0.86 ? -0.4 * ((s - 0.86) / 0.14) : f.mode === 'leave' ? -0.2 : 0.12;
    this.bodyPart.rotation.x = approach(this.bodyPart.rotation.x, flare, dt, 0.08);
    if (s < 1) return;
    if (f.mode === 'leave') {
      this.gone = true;
      return;
    }
    this.ctx.splash(this.pos, this.cfg.size);
    this.ctx.sound('splash', this.pos, { volume: 0.7 });
    this.speed = this.cfg.speed * 2.4;
    this.set('skid');
  }

  _tickSkid(dt) {
    this.speed = approach(this.speed, 0, dt, 0.3);
    this.forward(_f);
    const nx = this.pos.x + _f.x * this.speed * dt;
    const nz = this.pos.z + _f.z * this.speed * dt;
    if (swimOk(this.ctx, this.body, nx, nz, this.cfg.margin * 0.5)) this.pos.set(nx, this.pos.y, nz);
    this.pos.y = approach(this.pos.y, this.body.y + this.ctx.waveY(this.pos.x, this.pos.z), dt, 0.1);
    this.wingOpen = approach(this.wingOpen, 0, dt, 0.18);
    poseWings(this.wingL, this.wingR, this.wingOpen, 0.6 * this.wingOpen);
    this.bodyPart.rotation.x = approach(this.bodyPart.rotation.x, 0, dt, 0.15);
    if (this.t > 0.9) {
      this._idle();
      this._syncChicks(true);
    }
  }

  _tickTakeoff(dt) {
    // Run along the water, flapping hard, then climb away.
    this.speed = approach(this.speed, this.cfg.flySpeed * 0.45, dt, 0.4);
    this.forward(_f);
    this.pos.x += _f.x * this.speed * dt;
    this.pos.z += _f.z * this.speed * dt;
    this.pos.y += dt * 0.35;
    this.flapPhase += dt * this.cfg.flapRate * 1.2;
    this.wingOpen = approach(this.wingOpen, 1, dt, 0.06);
    poseWings(this.wingL, this.wingR, this.wingOpen, Math.sin(this.flapPhase) * 0.9 + 0.2);
    this.bodyPart.rotation.x = approach(this.bodyPart.rotation.x, -0.25, dt, 0.1);
    this.splashT -= dt;
    if (this.splashT <= 0 && this.t < 0.6) {
      this.splashT = 0.14;
      this.ctx.splash(this.pos, this.cfg.size * 0.45);
    }
    if (this.t > 0.7) this._flyTo(this.pos.clone(), farPoint(this.pos, 36, 14, this.heading + this.r(-0.3, 0.3)), 'leave');
  }

  // ---- On the water --------------------------------------------------------------

  _idle() {
    this.set('idle');
    const acts = this.cfg.actions;
    const kind = acts[Math.floor(Math.random() * acts.length)];
    const time = { rest: this.r(2, 5), dabble: 2.4, dip: 3, preen: 1.8, call: 0.9, flap: 1 }[kind];
    this.action = { kind, time, side: Math.random() < 0.5 ? -1 : 1, done: false };
  }

  _tickWater(dt) {
    const { ctx, body, cfg } = this;
    this.wingOpen = approach(this.wingOpen, 0, dt, 0.12);
    poseWings(this.wingL, this.wingR, this.wingOpen, 0.3 * this.wingOpen);
    const surf = body.y + ctx.waveY(this.pos.x, this.pos.z);
    this.pos.y = approach(this.pos.y, surf, dt, 0.12);
    this.bodyPart.rotation.z = Math.sin(ctx.time * 1.3 + this.phase) * 0.04;

    // The pond was reshaped under us: flap over to open water.
    if (!ctx.inBody(body, this.pos.x, this.pos.z, 0.05)) {
      const p = nearestSwimPoint(ctx, body, this.pos.x, this.pos.z, cfg.margin) ?? pickSwimPoint(ctx, body, cfg.margin);
      if (p) this._flyTo(this.pos.clone(), { x: p.x, y: body.y, z: p.z }, 'hop');
      return;
    }

    const sleepy = ctx.night > (this.state === 'sleep' ? 0.5 : 0.62);
    if (sleepy && this.state !== 'sleep') this.set('sleep');
    let headY = 0;
    let headX = 0;
    let tip = 0;
    if (this.state === 'sleep') {
      if (!sleepy) {
        this._idle();
      } else {
        headY = 2.3;
        headX = 0.45;
        this.speed = approach(this.speed, 0, dt, 0.5);
      }
    }

    if (this.state === 'swim') {
      if (!this.target) this.target = pickSwimPoint(ctx, body, cfg.margin, this.pos, 7);
      if (!this.target) {
        this._idle();
      } else {
        const dx = this.target.x - this.pos.x;
        const dz = this.target.z - this.pos.z;
        const d = Math.hypot(dx, dz);
        const off = this.turnToward(dx, dz, cfg.turn, dt);
        this.speed = approach(this.speed, off < 0.6 ? cfg.speed * Math.min(1, d * 1.5 + 0.3) : cfg.speed * 0.3, dt, 0.4);
        headX = Math.sin(this.t * 6) * 0.05;
        if (d < 0.15) this._idle();
      }
    } else if (this.state === 'idle') {
      this.speed = approach(this.speed, 0, dt, 0.6);
      const a = this.action;
      const u = Math.min(1, this.t / a.time);
      const hump = Math.sin(Math.PI * u);
      switch (a.kind) {
        case 'rest':
          headY = Math.sin(this.t * 0.9 + this.phase) * 0.6;
          break;
        case 'dabble':
          tip = Math.min(1, hump * 2.2) * 1.25;
          if (!a.done && u > 0.15) {
            a.done = true;
            ctx.splash({ x: this.pos.x + Math.sin(this.heading) * 0.25, y: this.pos.y, z: this.pos.z + Math.cos(this.heading) * 0.25 }, 0.3);
            ctx.sound('plip', this.pos, { volume: 0.5 });
          }
          break;
        case 'dip':
          headX = Math.min(1, hump * 1.8) * 1.3;
          break;
        case 'preen':
          headY = a.side * 2.1 * Math.min(1, hump * 2);
          headX = 0.5 * Math.min(1, hump * 2);
          break;
        case 'call':
          headX = -0.25 * Math.sin(this.t * 14) * hump;
          if (!a.done) {
            a.done = true;
            ctx.sound(cfg.call, this.pos, { volume: cfg.call === 'honk' ? 0.6 : 0.9 });
          }
          break;
        case 'flap':
          poseWings(this.wingL, this.wingR, hump, Math.sin(this.t * cfg.flapRate) * 0.8 + 0.3);
          this.pos.y += hump * 0.06;
          if (!a.done) {
            a.done = true;
            ctx.splash(this.pos, cfg.size * 0.5);
            ctx.sound('flap', this.pos, { volume: 0.5 });
          }
          break;
      }
      if (u >= 1) {
        this.set('swim');
        this.target = null;
      }
    }

    this._keepApart(dt);

    // Paddle forward, stopping at banks and obstacles.
    if (this.speed > 0.001) {
      this.forward(_f);
      const nx = this.pos.x + _f.x * this.speed * dt;
      const nz = this.pos.z + _f.z * this.speed * dt;
      if (swimOk(ctx, body, nx, nz, cfg.margin * 0.6)) {
        this.pos.x = nx;
        this.pos.z = nz;
        this.stuck = 0;
      } else {
        this.speed = 0;
        this.target = null;
        this.stuck += dt;
      }
    }
    this.head.rotation.y = approach(this.head.rotation.y, headY, dt, 0.25);
    this.head.rotation.x = approach(this.head.rotation.x, headX, dt, 0.2);
    this.bodyPart.rotation.x = approach(this.bodyPart.rotation.x, tip, dt, 0.12);
  }

  // Drift gently away from other ducks and swans that swim too close.
  _keepApart(dt) {
    const { ctx, body, cfg } = this;
    for (const o of ctx.creatures.values()) {
      if (o === this || !(o instanceof Waterfowl) || o.slot.body?.id !== body.id || !o._onWater()) continue;
      const dx = this.pos.x - o.pos.x;
      const dz = this.pos.z - o.pos.z;
      const d = Math.hypot(dx, dz);
      const min = cfg.space + o.cfg.space;
      if (d >= min || d < 1e-4) continue;
      const push = Math.min(1, dt * 2) * (min - d) * 0.5;
      const nx = this.pos.x + (dx / d) * push;
      const nz = this.pos.z + (dz / d) * push;
      if (swimOk(ctx, body, nx, nz, cfg.margin * 0.6)) {
        this.pos.x = nx;
        this.pos.z = nz;
      }
    }
  }

  // ---- Ducklings -----------------------------------------------------------------

  _syncChicks(animate) {
    const want = this.leaving ? 0 : this.slot.ducklings ?? 0;
    const live = this.chicks.filter((c) => !c.out);
    for (let i = live.length; i < want; i++) this._addChick(animate, i);
    for (let i = want; i < live.length; i++) live[i].out = true;
  }

  _addChick(animate, i) {
    const { ctx } = this;
    const model = ducklingModel(this.rng);
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.layers.set(LAYERS.WORLD);
      o.layers.enable(LAYERS.DEPTH);
      o.castShadow = false;
      o.receiveShadow = true;
    });
    const root = new THREE.Group();
    root.add(model);
    this.root.parent?.add(root);
    let p = null;
    if (animate && this.slot.reeds?.length) {
      // Paddle out from the reeds nearest the hen.
      const reed = [...this.slot.reeds].sort(
        (a, b) => (a.x - this.pos.x) ** 2 + (a.z - this.pos.z) ** 2 - ((b.x - this.pos.x) ** 2 + (b.z - this.pos.z) ** 2),
      )[0];
      p = nearestSwimPoint(ctx, this.body, reed.x, reed.z, 0.3);
    }
    if (!p) {
      this.forward(_f);
      p = { x: this.pos.x - _f.x * (0.45 + i * 0.28), z: this.pos.z - _f.z * (0.45 + i * 0.28) };
    }
    root.position.set(p.x, this.body.y, p.z);
    const chick = { root, model, pos: root.position, heading: this.heading, scale: animate ? 0.01 : 1, out: false, phase: Math.random() * 10 };
    root.scale.setScalar(chick.scale);
    if (animate) {
      ctx.splash(root.position, 0.3);
      ctx.announce('ducklings');
    }
    this.chicks.push(chick);
  }

  _dropChick(c) {
    c.root.parent?.remove(c.root);
    c.root.traverse((o) => {
      if (o.isMesh) o.geometry.dispose();
    });
  }

  _tickChicks(dt) {
    if (!this.chicks.length) return;
    const { ctx } = this;
    let leader = { pos: this.pos, heading: this.heading, gap: 0.42 };
    for (const c of [...this.chicks]) {
      if (c.out) {
        if (c.scale > 0.98) ctx.splash(c.pos, 0.25);
        c.scale = approach(c.scale, 0, dt, 0.12);
        c.root.scale.setScalar(Math.max(0.001, c.scale));
        if (c.scale < 0.03) {
          this._dropChick(c);
          this.chicks.splice(this.chicks.indexOf(c), 1);
        }
        continue;
      }
      c.scale = approach(c.scale, 1, dt, 0.25);
      const tx = leader.pos.x - Math.sin(leader.heading) * leader.gap;
      const tz = leader.pos.z - Math.cos(leader.heading) * leader.gap;
      const dx = tx - c.pos.x;
      const dz = tz - c.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.02) {
        const want = Math.atan2(dx, dz);
        let diff = want - c.heading;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        c.heading += Math.max(-5 * dt, Math.min(5 * dt, diff));
      }
      const sp = Math.min(1.4, Math.max(0, d - 0.03) * 2.6);
      c.pos.x += Math.sin(c.heading) * sp * dt;
      c.pos.z += Math.cos(c.heading) * sp * dt;
      c.pos.y = approach(c.pos.y, this.body.y + ctx.waveY(c.pos.x, c.pos.z), dt, 0.1);
      c.root.rotation.y = c.heading;
      c.root.scale.setScalar(Math.max(0.001, c.scale));
      c.model.rotation.z = Math.sin(ctx.time * 7 + c.phase) * 0.1 * Math.min(1, sp + 0.2);
      c.root.visible = this.root.visible;
      leader = { pos: c.pos, heading: c.heading, gap: 0.24 };
    }
  }
}

export class Duck extends Waterfowl {
  constructor(ctx, slot, opts) {
    super(ctx, slot, opts, {
      // The first duck on a pond is a hen, so reeds can bring her ducklings later.
      build: (rng, s) => duckModel(rng, s.hen || s.key.endsWith(':0') ? 'hen' : rng() < 0.7 ? 'drake' : 'hen'),
      speed: 0.42,
      turn: 2.4,
      margin: 0.5,
      flySpeed: 8,
      flapRate: 19,
      size: 0.8,
      space: 0.3,
      call: 'quack',
      actions: ['rest', 'rest', 'dabble', 'dabble', 'preen', 'call', 'call', 'flap'],
    });
  }
}

export class Swan extends Waterfowl {
  constructor(ctx, slot, opts) {
    super(ctx, slot, opts, {
      build: (rng) => swanModel(rng),
      speed: 0.26,
      turn: 1.1,
      margin: 0.9,
      flySpeed: 7,
      flapRate: 9,
      size: 1.4,
      space: 0.6,
      call: 'honk',
      actions: ['rest', 'rest', 'dip', 'dip', 'preen', 'call', 'flap'],
    });
  }
}
