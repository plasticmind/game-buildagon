// The bear. At dawn, now and then, a bear lumbers to a lake where a waterfall
// pours in, wades to the foot of the falls, and fishes: it watches, rears up,
// and slams its paws down with a splash, sometimes coming up with a fish. When
// the morning wears on it wades out, shakes itself off, and wanders away.

import { Visitor } from '../Visitor.js';
import { approach, arc } from '../Creature.js';
import { bearModel, fishModel, SILVER } from '../models.js';

const WALK = 0.6;

export class Bear extends Visitor {
  constructor(ctx, slot, opts) {
    super(ctx, slot, opts);
    this.model = this.attach(bearModel(this.rng), { shadow: true });
    this.touchWater(true);
    this.bodyPart = this.model.getObjectByName('body');
    this.front = this.model.getObjectByName('front');
    this.hind = this.model.getObjectByName('hind');
    this.head = this.model.getObjectByName('head');
    this.cfg = { chance: 0.4, pity: 2, delay: [3, 25] };
    this.rear = 0;
    this.walkPhase = 0;
    this.grow = 1;
    this.fish = null;
  }

  inWindow() {
    return this.between(5, 8.5);
  }

  visit() {
    const f = this.slot.falls;
    // Come out of the woods behind the bank when there's room.
    const bx = f.bank.x - f.edge.x;
    const bz = f.bank.z - f.edge.z;
    const l = Math.hypot(bx, bz) || 1;
    const start = { x: f.bank.x + (bx / l) * 3, z: f.bank.z + (bz / l) * 3 };
    const s = this.ctx.surfaceAt(start.x, start.z);
    const from = s.type === 'land' && Math.abs(s.y - f.bank.y) < 0.65 ? { ...start, y: s.y } : { ...f.bank };
    this.pos.set(from.x, from.y, from.z);
    this.grow = 0.2;
    this.path = [f.bank, { x: f.edge.x, y: f.bank.y, z: f.edge.z }, { x: f.x, y: f.y, z: f.z, water: true }];
    this.set('walk');
    this.elapsed = 0;
    this.exitTo = from;
  }

  depart() {
    const f = this.slot.falls;
    this.path = [{ x: f.edge.x, y: f.bank.y, z: f.edge.z }, f.bank, { ...this.exitTo, exit: true }];
    this._dropFish();
    this.set('walk');
  }

  visitTick(dt) {
    const { ctx } = this;
    const f = this.slot.falls;
    this.elapsed += dt;
    this.grow = approach(this.grow, this.state === 'vanish' ? 0 : 1, dt, 0.25);
    this.model.scale.setScalar(Math.max(0.001, this.grow));
    let walking = false;
    let wantRear = 0;
    let headX = 0.15;

    if (this.state === 'walk') {
      walking = this._walk(dt);
    } else if (this.state === 'vanish') {
      if (this.grow < 0.03) {
        this.model.scale.setScalar(1);
        this.goAway();
      }
      return;
    } else if (this.state === 'fish') {
      if (!this.leaving && (!this.inWindow() || this.elapsed > 100)) {
        this.depart();
        return;
      }
      // Watch the water, rear up, then slam down.
      const a = this.act;
      a.t += dt;
      if (a.kind === 'watch') {
        headX = 0.45 + Math.sin(a.t * 2) * 0.05;
        if (a.t > a.time) this.act = { kind: 'rear', t: 0 };
      } else if (a.kind === 'rear') {
        wantRear = 1;
        headX = -0.2;
        if (a.t > 1.6) this.act = { kind: 'slam', t: 0 };
      } else if (a.kind === 'slam') {
        wantRear = 0;
        headX = 0.5;
        if (!a.hit && a.t > 0.25) {
          a.hit = true;
          const p = this._paws();
          ctx.splash({ x: p.x, y: f.surface, z: p.z }, 1.4);
          ctx.sound('splash', p, { range: 40 });
          if (Math.random() < 0.45) this._catch(p);
        }
        if (a.t > 1.2) this.act = { kind: 'watch', t: 0, time: this.r(2, 4) };
      }
    } else if (this.state === 'shake') {
      this.bodyPart.rotation.z = Math.sin(this.t * 30) * 0.18 * Math.max(0, 1 - this.t / 1.2);
      if (Math.random() < dt * 20) ctx.splash({ x: this.pos.x + this.r(-0.4, 0.4), y: this.pos.y + 0.6, z: this.pos.z + this.r(-0.4, 0.4) }, 0.4);
      if (this.t > 1.3) {
        this.bodyPart.rotation.z = 0;
        this.set('walk');
      }
    }

    this._tickFish(dt);

    // Pose: walk cycle, and rearing up on the hind legs.
    this.rear = approach(this.rear, wantRear, dt, wantRear ? 0.25 : 0.08);
    this.walkPhase += walking ? dt * 7 : 0;
    const swing = walking ? Math.sin(this.walkPhase) * 0.35 : 0;
    this.bodyPart.rotation.x = -1.0 * this.rear;
    this.bodyPart.position.y = 0.55 + 0.05 * this.rear + (walking ? Math.abs(Math.sin(this.walkPhase)) * 0.025 : 0);
    this.front.rotation.x = swing + 0.9 * this.rear;
    this.hind.rotation.x = -swing + 1.0 * this.rear;
    this.head.rotation.x = approach(this.head.rotation.x, headX + 0.9 * this.rear, dt, 0.15);
  }

  // Front paws, in world space.
  _paws() {
    const d = 0.9;
    return { x: this.pos.x + Math.sin(this.heading) * d, y: this.pos.y, z: this.pos.z + Math.cos(this.heading) * d };
  }

  _walk(dt) {
    const g = this.path[0];
    if (!g) {
      this.set('fish');
      this.heading = this.slot.falls.face;
      this.act = { kind: 'watch', t: 0, time: this.r(2, 4) };
      return false;
    }
    const dx = g.x - this.pos.x;
    const dz = g.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.08) {
      this.path.shift();
      if (g.exit) {
        this.set('vanish');
        return false;
      }
      // Fresh out of the water: shake off.
      if (!g.water && this.wet && this.path.length) {
        this.wet = false;
        this.set('shake');
      }
      if (g.water) this.wet = true;
      if (!this.path.length && g.water) {
        this.set('fish');
        this.heading = this.slot.falls.face;
        this.act = { kind: 'watch', t: 0, time: this.r(2, 4) };
      }
      return false;
    }
    if (this.turnToward(dx, dz, 2.5, dt) > 0.7) return true;
    const step = Math.min(d, WALK * dt);
    this.pos.x += (dx / d) * step;
    this.pos.z += (dz / d) * step;
    const s = this.ctx.surfaceAt(this.pos.x, this.pos.z);
    const y = s.type === 'land' ? s.y : s.ground;
    this.pos.y = approach(this.pos.y, y, dt, 0.25);
    if (s.type !== 'land' && Math.random() < dt * 3) this.ctx.splash({ x: this.pos.x, y: this.slot.falls.surface, z: this.pos.z }, 0.5);
    return true;
  }

  // A fish leaps from the falls into the bear's mouth.
  _catch(p) {
    this._dropFish();
    const fish = fishModel(this.rng, SILVER, 1.1);
    fish.traverse((o) => {
      if (o.isMesh) o.castShadow = false;
    });
    this.root.parent.add(fish);
    this.fish = { model: fish, t: 0, from: { x: p.x, y: this.slot.falls.surface, z: p.z } };
  }

  _tickFish(dt) {
    const f = this.fish;
    if (!f) return;
    f.t += dt;
    if (f.t < 0.4) {
      // Arc up to the mouth.
      const head = this.head.getWorldPosition(f.model.position.clone());
      const mouth = { x: head.x + Math.sin(this.heading) * 0.3, y: head.y, z: head.z + Math.cos(this.heading) * 0.3 };
      arc(f.from, mouth, f.t / 0.4, 0.5, f.model.position);
      f.model.rotation.set(0, this.heading + Math.PI / 2, Math.sin(f.t * 40) * 0.4);
    } else if (!f.held) {
      f.held = true;
      this.root.parent.remove(f.model);
      this.head.add(f.model);
      f.model.position.set(0, -0.02, 0.32);
      f.model.rotation.set(0, Math.PI / 2, 0);
      this.ctx.sound('munch', this.pos, { range: 25 });
    } else if (f.t > 2.8) {
      this._dropFish();
    } else {
      f.model.rotation.z = Math.sin(f.t * 25) * 0.3 * Math.max(0, 1 - f.t / 1.5);
    }
  }

  _dropFish() {
    const f = this.fish;
    if (!f) return;
    f.model.parent?.remove(f.model);
    f.model.traverse((o) => {
      if (o.isMesh) o.geometry.dispose();
    });
    this.fish = null;
  }

  dispose() {
    this._dropFish();
    super.dispose();
  }
}
