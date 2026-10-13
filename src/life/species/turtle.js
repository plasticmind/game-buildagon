// Sea turtle hatchlings. On a dark, quiet beach at night, rarely, a little
// nest of sand starts to wiggle. Tiny turtles pop out one by one and scramble
// down the sand toward the sea, flippers paddling, then swim off into the
// waves. Lanterns, campfires, and buildings nearby keep them away.

import * as THREE from 'three';
import { Visitor } from '../Visitor.js';
import { approach } from '../Creature.js';
import { hatchlingModel, nestModel } from '../models.js';
import { LAYERS } from '../../render/shared.js';

const SAND = '#efd9a2';

export class Turtles extends Visitor {
  constructor(ctx, slot, opts) {
    super(ctx, slot, opts);
    this.nest = this.attach(nestModel(this.rng));
    this.cfg = { chance: 0.3, pity: 2, delay: [5, 40] };
    this.babies = [];
  }

  inWindow() {
    return this.between(21, 3.5);
  }

  sightable() {
    return this.babies.length > 0;
  }

  visit() {
    this.pos.set(this.slot.x, this.slot.y, this.slot.z);
    this.heading = Math.atan2(this.slot.sea.x, this.slot.sea.z);
    this.nest.scale.setScalar(1);
    this.nest.visible = true;
    this.hatched = 0;
    this.set('wiggle');
  }

  depart() {
    for (const b of this.babies) b.out = true;
    this.set('fade');
  }

  visitTick(dt) {
    const { ctx } = this;
    if (this.state === 'wiggle') {
      this.nest.scale.set(1 + Math.sin(this.t * 17) * 0.05, 1 + Math.sin(this.t * 13) * 0.08, 1);
      if (Math.random() < dt * 2) ctx.particles.puff(this.pos, { color: SAND, count: 4, radius: 0.25, size: 0.2 });
      if (this.t > 4) {
        this.set('hatch');
        this.nextBaby = 0;
      }
    } else if (this.state === 'hatch') {
      this.nest.scale.set(1, 1, 1);
      this.nextBaby -= dt;
      if (this.nextBaby <= 0 && this.hatched < 6) {
        this.nextBaby = this.r(0.5, 1.4);
        this.hatched++;
        this._addBaby();
      }
      if (this.hatched >= 6 && !this.babies.length) this.set('fade');
    } else if (this.state === 'fade') {
      this.nest.scale.setScalar(Math.max(0.001, 1 - this.t / 3));
      if (this.t > 3 && !this.babies.length) {
        this.nest.visible = false;
        this.goAway();
        return;
      }
    }
    this._tickBabies(dt);
  }

  _addBaby() {
    const model = hatchlingModel(this.rng);
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.layers.set(LAYERS.WORLD);
      o.layers.enable(LAYERS.DEPTH);
      o.castShadow = false;
    });
    const root = new THREE.Group();
    root.add(model);
    const a = Math.random() * Math.PI * 2;
    root.position.set(this.pos.x + Math.cos(a) * 0.08, this.pos.y + 0.06, this.pos.z + Math.sin(a) * 0.08);
    root.scale.setScalar(0.01);
    this.root.parent.add(root);
    this.ctx.particles.puff(root.position, { color: SAND, count: 5, radius: 0.2, size: 0.18 });
    this.babies.push({
      root,
      front: model.getObjectByName('front'),
      back: model.getObjectByName('back'),
      heading: this.heading + this.r(-0.5, 0.5),
      speed: this.r(0.3, 0.45),
      grow: 0.01,
      phase: Math.random() * 10,
      swim: 0,
      out: false,
    });
  }

  _tickBabies(dt) {
    const { ctx } = this;
    for (const b of [...this.babies]) {
      const p = b.root.position;
      const s = ctx.surfaceAt(p.x, p.z);
      const inWater = s.type !== 'land';
      if (inWater && !b.swim) {
        b.swim = 0.001;
        ctx.splash({ x: p.x, y: s.y, z: p.z }, 0.2);
        ctx.sound('plip', p, { range: 20, volume: 0.6, pitch: 1.4 });
      }
      if (b.swim) b.swim += dt;
      const gone = b.out || b.swim > 2.2;
      b.grow = approach(b.grow, gone ? 0 : 1, dt, gone ? 0.25 : 0.15);
      if (gone && b.grow < 0.03) {
        b.root.parent?.remove(b.root);
        b.root.traverse((o) => {
          if (o.isMesh) o.geometry.dispose();
        });
        this.babies.splice(this.babies.indexOf(b), 1);
        continue;
      }
      // Scramble toward the sea, wobbling side to side.
      b.heading = approach(b.heading, Math.atan2(this.slot.sea.x, this.slot.sea.z), dt, 2) + Math.sin(ctx.time * 6 + b.phase) * dt * 0.8;
      const sp = b.speed * (b.swim ? 1.3 : 0.6 + 0.4 * Math.abs(Math.sin(ctx.time * 8 + b.phase)));
      p.x += Math.sin(b.heading) * sp * dt;
      p.z += Math.cos(b.heading) * sp * dt;
      p.y = approach(p.y, inWater ? s.y - 0.03 - b.swim * 0.05 : s.y, dt, 0.08);
      b.root.rotation.y = b.heading;
      b.root.rotation.z = Math.sin(ctx.time * 9 + b.phase) * (b.swim ? 0.05 : 0.15);
      b.front.rotation.y = Math.sin(ctx.time * (b.swim ? 7 : 12) + b.phase) * 0.6;
      b.back.rotation.y = -Math.sin(ctx.time * 12 + b.phase) * 0.4;
      b.root.scale.setScalar(Math.max(0.001, b.grow) * 1.4);
      b.root.visible = this.root.visible;
    }
  }

  dispose() {
    for (const b of this.babies) {
      b.root.parent?.remove(b.root);
      b.root.traverse((o) => {
        if (o.isMesh) o.geometry.dispose();
      });
    }
    this.babies = [];
    super.dispose();
  }
}
