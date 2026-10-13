// The baby dragon. Late at night, rarely, a little dragon glides down to a
// campfire on a high stone peak, turns in a circle like a puppy, and curls up
// beside the fire to sleep, breathing slow wisps of smoke. Come close and it
// wakes, blinks at you, and puffs a smoke ring. It flies off before dawn.

import * as THREE from 'three';
import { Visitor } from '../Visitor.js';
import { approach, lerp } from '../Creature.js';
import { dragonModel, DRAGON_LOOKS } from '../models.js';
import { LAYERS } from '../../render/shared.js';
import { flightPoint, farPoint } from '../flight.js';

const CURL_R = 0.95; // Radius of the curl around the fire.
const RING_MAT = new THREE.MeshBasicMaterial({ color: '#e9e4de', transparent: true, depthWrite: false });

export class Dragon extends Visitor {
  constructor(ctx, slot, opts) {
    super(ctx, slot, opts);
    const look = DRAGON_LOOKS[Math.floor(this.rng() * DRAGON_LOOKS.length)];
    this.model = this.attach(dragonModel(this.rng, look), { shadow: true });
    this.segs = this.model.userData.segs;
    this.head = this.model.getObjectByName('head');
    this.lids = this.model.getObjectByName('lids');
    this.wingL = this.model.getObjectByName('wingL');
    this.wingR = this.model.getObjectByName('wingR');
    this.cfg = { chance: 0.3, pity: 3, delay: [5, 30] };
    this.curl = 0;
    this.wings = 0; // 0 folded, 1 spread.
    this.rings = [];
    this.wokenAt = -99;
    this.phase = this.rng() * 10;
  }

  inWindow() {
    return this.between(22, 4.5);
  }

  // Where the dragon lies so its curl wraps around the fire.
  _bed() {
    const f = this.slot.fire;
    const a = this.bedAngle;
    // The curl bends toward local +X; the fire sits at its center.
    const heading = a;
    const rx = Math.cos(heading);
    const rz = -Math.sin(heading);
    return { x: f.x - rx * CURL_R, y: f.y, z: f.z - rz * CURL_R, heading };
  }

  visit() {
    this.bedAngle = Math.random() * Math.PI * 2;
    const f = this.slot.fire;
    const land = { x: f.x + Math.sin(this.bedAngle) * 1.6, y: f.y, z: f.z + Math.cos(this.bedAngle) * 1.6 };
    this.pos.copy(farPoint(land, 22, 10));
    this.flight = { from: this.pos.clone(), to: land, time: 4.5, away: false };
    this.heading = Math.atan2(land.x - this.pos.x, land.z - this.pos.z);
    this.set('fly');
  }

  depart() {
    this.set('stretch');
  }

  visitTick(dt) {
    const { ctx } = this;
    const f = this.slot.fire;
    let wantCurl = 0;
    let wantWings = 0;
    let headX = 0;
    let headY = 0;
    let eyesOpen = true;

    if (!this.leaving && !this.inWindow() && ['circle', 'sleep', 'wake'].includes(this.state)) this.depart();

    if (this.state === 'fly') {
      const fl = this.flight;
      const s = Math.min(1, this.t / fl.time);
      flightPoint(fl.from, fl.to, s, this.pos, { landing: !fl.away });
      wantWings = 1;
      headX = fl.away ? -0.2 : 0.15;
      if (s >= 1) {
        if (fl.away) {
          this._clearRings();
          this.goAway();
          return;
        }
        ctx.particles.puff(this.pos, { color: '#c9c3b8', count: 10, radius: 0.6, size: 0.35 });
        this.circleA = Math.atan2(this.pos.z - f.z, this.pos.x - f.x);
        this.set('circle');
      }
    } else if (this.state === 'circle') {
      // Turn around once or twice like a puppy settling in, then lie down.
      const dir = 1;
      this.circleA += dt * 1.6 * dir;
      const r = 1.5 - Math.min(0.5, this.t * 0.15);
      const tx = f.x + Math.cos(this.circleA) * r;
      const tz = f.z + Math.sin(this.circleA) * r;
      this.heading = Math.atan2(tx - this.pos.x, tz - this.pos.z);
      this.pos.x = tx;
      this.pos.z = tz;
      wantCurl = 0.35;
      this.model.rotation.z = Math.sin(this.t * 9) * 0.06;
      if (this.t > 5) {
        this.model.rotation.z = 0;
        const bed = this._bed();
        this.pos.set(bed.x, bed.y, bed.z);
        this.heading = bed.heading;
        this.set('sleep');
        this.puffIn = this.r(3, 6);
      }
    } else if (this.state === 'sleep' || this.state === 'wake') {
      wantCurl = 1;
      // Rest the head toward the fire.
      headY = 0.6;
      headX = 0.25;
      eyesOpen = false;
      const near = Math.hypot(ctx.cam.x - this.pos.x, ctx.cam.y - this.pos.y, ctx.cam.z - this.pos.z) < 5;
      if (this.state === 'sleep') {
        this.puffIn -= dt;
        if (this.puffIn <= 0) {
          this.puffIn = this.r(4, 8);
          const n = this._snout();
          ctx.particles.puff(n, { color: '#d9d5d1', count: 3, radius: 0.1, size: 0.25 });
        }
        if (near && ctx.time - this.wokenAt > 12) {
          this.wokenAt = ctx.time;
          this.set('wake');
        }
      } else {
        // Lift the head, blink at the camera, and puff a smoke ring.
        const look = Math.atan2(ctx.cam.x - this.pos.x, ctx.cam.z - this.pos.z) - this.heading;
        headY = Math.atan2(Math.sin(look), Math.cos(look));
        headX = -0.25;
        eyesOpen = !(this.t > 0.8 && this.t < 0.95) && !(this.t > 1.2 && this.t < 1.35);
        if (this.t > 1.8 && !this.puffed) {
          this.puffed = true;
          this._ring();
          ctx.sound('puff', this.pos, { range: 30 });
        }
        if (this.t > 5) {
          this.puffed = false;
          this.set('sleep');
        }
      }
    } else if (this.state === 'stretch') {
      wantCurl = 0;
      wantWings = this.t > 1 ? 1 : 0.5;
      headX = -0.3;
      if (this.t > 1.8) {
        this.flight = { from: this.pos.clone(), to: farPoint(this.pos, 24, 12), time: 4.5, away: true };
        this.heading = Math.atan2(this.flight.to.x - this.pos.x, this.flight.to.z - this.pos.z);
        this.set('fly');
      }
    }

    // Body: bend the chain of segments, and give it a little wave in flight.
    this.curl = approach(this.curl, wantCurl, dt, 0.5);
    this.wings = approach(this.wings, wantWings, dt, 0.2);
    const k = this.curl / CURL_R;
    const flying = this.state === 'fly';
    for (const { group, s } of this.segs) {
      const wave = flying ? Math.sin(ctx.time * 3 - s * 4) * 0.15 * s : 0;
      if (k < 1e-3) {
        group.position.set(wave, 0, -s);
        group.rotation.y = 0;
      } else {
        group.position.set((1 - Math.cos(k * s)) / k + wave, 0, -Math.sin(k * s) / k);
        group.rotation.y = -k * s;
      }
      // Breathing.
      group.scale.setScalar(1 + Math.sin(ctx.time * (flying ? 3 : 1.4) + this.phase - s) * 0.025);
    }
    // The tail tip flicks now and then.
    const tip = this.segs[this.segs.length - 1].group;
    tip.rotation.y += Math.max(0, Math.sin(ctx.time * 0.7 + this.phase)) ** 8 * 0.6;
    const flap = flying ? Math.sin(ctx.time * 9) * 0.7 : 0;
    this.wingL.scale.setScalar(lerp(0.45, 1, this.wings));
    this.wingR.scale.setScalar(lerp(0.45, 1, this.wings));
    this.wingL.rotation.z = lerp(-1.1, -0.1, this.wings) - flap;
    this.wingR.rotation.z = lerp(1.1, 0.1, this.wings) + flap;
    this.head.rotation.y = approach(this.head.rotation.y, headY, dt, 0.2);
    this.head.rotation.x = approach(this.head.rotation.x, headX, dt, 0.2);
    this.lids.scale.y = eyesOpen ? 0.01 : 1;
    this._tickRings(dt);
  }

  _snout() {
    const p = new THREE.Vector3(0, 0.12, 0.25);
    this.head.localToWorld(p);
    return p;
  }

  _ring() {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.025, 6, 16), RING_MAT.clone());
    ring.layers.set(LAYERS.WORLD);
    ring.position.copy(this._snout());
    const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(this.head.getWorldQuaternion(new THREE.Quaternion()));
    ring.lookAt(ring.position.clone().add(dir));
    this.root.parent.add(ring);
    this.rings.push({ mesh: ring, dir, t: 0 });
  }

  _tickRings(dt) {
    for (const r of [...this.rings]) {
      r.t += dt;
      r.mesh.position.addScaledVector(r.dir, dt * 0.45);
      r.mesh.position.y += dt * 0.15;
      r.mesh.scale.setScalar(1 + r.t * 1.4);
      r.mesh.material.opacity = Math.max(0, 0.85 * (1 - r.t / 2.6));
      if (r.t > 2.6) {
        r.mesh.parent?.remove(r.mesh);
        r.mesh.geometry.dispose();
        r.mesh.material.dispose();
        this.rings.splice(this.rings.indexOf(r), 1);
      }
    }
  }

  _clearRings() {
    for (const r of this.rings) {
      r.mesh.parent?.remove(r.mesh);
      r.mesh.geometry.dispose();
      r.mesh.material.dispose();
    }
    this.rings = [];
  }

  dispose() {
    this._clearRings();
    super.dispose();
  }
}
