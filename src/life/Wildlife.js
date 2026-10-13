// Wildlife: animals that move in when the world offers them a home.
//
// After every edit settles, the manager re-reads the world (habitats.js) and
// reconciles the habitat slots with the creatures alive now:
//   - a creature whose slot still exists keeps living (matched by key, or by
//     distance when an edit only reshaped the habitat),
//   - a new slot invites a new creature, which arrives with a flourish,
//   - a creature whose slot is gone leaves the way it came.
// Creatures are derived from the world, so saves never store them. A loaded
// world starts with its animals already settled in.
//
// While the camera can see a creature, the manager records it in the journal.
//
// Events: 'announce' (message) the first time each kind arrives in a world.

import * as THREE from 'three';
import { Emitter } from '../core/events.js';
import { U, addGust } from '../render/shared.js';
import { DIRS, edgeKey } from '../core/hex.js';
import { randomSeed } from '../core/random.js';
import { getItem } from '../catalog/catalog.js';
import { waveHeight } from '../world/water/shaders.js';
import { analyzeHabitats, surfaceAt, inBody, edgeClearance, CAPS } from './habitats.js';
import { Frog } from './species/frog.js';
import { Duck, Swan } from './species/waterfowl.js';
import { Koi, JumpingFish } from './species/fish.js';
import { Butterfly } from './species/butterfly.js';
import { Songbird, Gull } from './species/birds.js';
import { Rabbit } from './species/rabbit.js';
import { Cat } from './species/cat.js';
import { Fairy } from './species/fairy.js';
import { Owl } from './species/owl.js';
import { Whale } from './species/whale.js';
import { Fox } from './species/fox.js';
import { Bear } from './species/bear.js';
import { Dragon } from './species/dragon.js';
import { Turtles } from './species/turtle.js';

const CLASSES = {
  frog: Frog,
  duck: Duck,
  swan: Swan,
  koi: Koi,
  fish: JumpingFish,
  butterfly: Butterfly,
  songbird: Songbird,
  gull: Gull,
  rabbit: Rabbit,
  cat: Cat,
  fairy: Fairy,
  owl: Owl,
  whale: Whale,
  fox: Fox,
  bear: Bear,
  dragon: Dragon,
  turtle: Turtles,
};

// How close the camera must be for a sighting to count, by species.
const SIGHT_RANGE = { whale: 170, gull: 45, owl: 35, swan: 40, bear: 40 };
const SIGHT_INTERVAL = 0.25;

// First-arrival messages, keyed by species (or a family moment like ducklings).
const ANNOUNCE = {
  frog: 'A frog hopped onto your lily pads',
  duck: 'A duck found your pond',
  ducklings: 'Ducklings paddled out of the reeds',
  swan: 'A pair of swans glided onto your lake',
  koi: 'Koi are swimming under your bridge',
  fish: 'Fish are jumping in your water',
  butterfly: 'Butterflies found your flowers',
  songbird: 'Songbirds are singing in your grove',
  gull: 'Gulls are circling your beach',
  rabbit: 'A rabbit is nibbling in the long grass',
  cat: 'A cat moved into your house',
};

const SETTLE_DELAY = 0.8; // Seconds after the last edit before re-reading habitats.
const MATCH_DIST = 10; // A creature can follow its habitat this far when it changes.
const VIEW_RANGE = 110; // Creatures beyond this distance from the camera are hidden.

const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();

export class Wildlife extends Emitter {
  constructor(scene, world, { objects, particles, audio, sky = null, journal = null }) {
    super();
    this.world = world;
    this.objects = objects;
    this.particles = particles;
    this.audio = audio;
    this.sky = sky;
    this.journal = journal;
    this.sightT = 0;
    this.group = new THREE.Group();
    this.group.name = 'wildlife';
    scene.add(this.group);

    this.creatures = new Map(); // slot key → creature
    this.leaving = new Set(); // Creatures on their way out.
    this.announced = new Set();
    this.enabled = true;
    this.settled = false; // False until the first reconcile after a load.
    this.dirtyIn = SETTLE_DELAY;
    this.slots = null;
    this.quality = 'high';

    this.ctx = this._makeContext();

    const touch = () => (this.dirtyIn = SETTLE_DELAY);
    world.on('cell', touch);
    world.on('objectAdded', touch);
    world.on('objectRemoved', touch);
    world.on('objectUpdated', touch);
    world.on('reset', () => this._reset());
  }

  get count() {
    return this.creatures.size;
  }

  setEnabled(on) {
    on = !!on;
    if (on === this.enabled) return;
    this.enabled = on;
    this.settled = true; // Toggling on brings animals in with their arrival.
    this.dirtyIn = on ? 0.2 : 0;
  }

  // Low quality halves how many animals live at once and drops their shadows.
  setQuality(level) {
    if (level === this.quality) return;
    this.quality = level;
    this.ctx.shadows = level !== 'low';
    for (const c of [...this.creatures.values(), ...this.leaving]) c.syncShadows();
    this.dirtyIn = Math.max(this.dirtyIn, 0.1);
  }

  // Bring rare visitors of a kind at their next chance. For testing:
  // game.wildlife.summon('fairy'), then set the time of day to their hour.
  summon(species) {
    let n = 0;
    for (const c of this.creatures.values()) {
      if (c.species === species && c.summon) {
        c.summon();
        n++;
      }
    }
    return n;
  }

  // All live creatures, for debugging: game.wildlife.list().
  list() {
    return [...this.creatures.values()].map((c) => ({ key: c.key, state: c.state, x: c.pos.x, y: c.pos.y, z: c.pos.z }));
  }

  update(dt, camera) {
    if (this.dirtyIn >= 0) {
      this.dirtyIn -= dt;
      if (this.dirtyIn < 0) this._reconcile();
    }

    const ctx = this.ctx;
    ctx.dt = dt;
    ctx.time = U.uTime.value;
    ctx.night = U.uNight.value;
    ctx.wind = U.uWindStrength.value;
    ctx.hour = this.sky ? ((this.sky.time % 24) + 24) % 24 : 12;
    camera.getWorldPosition(ctx.cam);
    camera.getWorldDirection(ctx.camDir);
    _m.extractRotation(camera.matrixWorld);
    ctx.camRight.setFromMatrixColumn(_m, 0);

    const range2 = VIEW_RANGE * VIEW_RANGE;
    const step = (c) => {
      c.update(dt);
      c.root.visible = c.state !== 'wait' && !c.hidden && (c.species === 'whale' || c.pos.distanceToSquared(ctx.cam) < range2);
      // Golden animals glint now and then.
      if (c.golden && c.root.visible && c.pos.distanceToSquared(ctx.cam) < 35 * 35) {
        c.glintT = (c.glintT ?? 1) - dt;
        if (c.glintT <= 0) {
          c.glintT = 1.5 + Math.random() * 2;
          this.particles.sparkle({ x: c.pos.x, y: c.pos.y + 0.25, z: c.pos.z }, { color: '#fff2a8', count: 3 });
        }
      }
    };
    for (const c of this.creatures.values()) step(c);
    for (const c of this.leaving) {
      step(c);
      if (c.gone) {
        c.dispose();
        this.leaving.delete(c);
      }
    }

    this.sightT -= dt;
    if (this.sightT <= 0 && this.journal) {
      this.sightT = SIGHT_INTERVAL;
      this._sightings(camera);
    }
  }

  // Record what the camera can see: on screen, in range, and showing.
  _sightings(camera) {
    const cam = this.ctx.cam;
    for (const c of [...this.creatures.values(), ...this.leaving]) {
      if (!c.root.visible || !c.sightable()) continue;
      const range = SIGHT_RANGE[c.species] ?? 30;
      if (c.pos.distanceToSquared(cam) > range * range) continue;
      _v.copy(c.pos);
      _v.y += 0.3;
      _v.project(camera);
      if (_v.z > 1 || Math.abs(_v.x) > 0.95 || Math.abs(_v.y) > 0.95) continue;
      this.journal.see(c.species, { golden: c.golden });
      if (c.chicks?.some((ch) => !ch.out)) this.journal.see('duckling');
    }
  }

  // ---- Reconcile --------------------------------------------------------------

  _reset() {
    for (const c of [...this.creatures.values(), ...this.leaving]) c.dispose();
    this.creatures.clear();
    this.leaving.clear();
    this.announced.clear();
    this.ctx.claims.clear();
    this.settled = false;
    this.dirtyIn = 0.3;
  }

  _reconcile() {
    if (!this.enabled) {
      for (const c of this.creatures.values()) this._dismiss(c);
      this.creatures.clear();
      return;
    }
    const { slots } = analyzeHabitats(this.world, this.objects);
    this.slots = slots;
    for (const [species, list] of slots) {
      if (this.quality === 'low') list.length = Math.min(list.length, Math.ceil(CAPS[species] / 2));
      const current = [...this.creatures.values()].filter((c) => c.species === species);
      const byKey = new Map(current.map((c) => [c.key, c]));
      const free = new Set(current);
      const unmatched = [];
      for (const s of list) {
        const c = byKey.get(s.key);
        if (c) {
          c.setSlot(s);
          free.delete(c);
        } else {
          unmatched.push(s);
        }
      }
      // A creature whose habitat changed shape follows it to the nearest new slot.
      for (const s of unmatched) {
        let best = null;
        let bestD = MATCH_DIST * MATCH_DIST;
        for (const c of free) {
          const d = (c.slot.x - s.x) ** 2 + (c.slot.z - s.z) ** 2;
          if (d < bestD) {
            bestD = d;
            best = c;
          }
        }
        if (best) {
          free.delete(best);
          this.creatures.delete(best.key);
          best.key = s.key;
          best.setSlot(s);
          this.creatures.set(s.key, best);
        } else {
          this._spawn(s);
        }
      }
      for (const c of free) {
        this.creatures.delete(c.key);
        this._dismiss(c);
      }
    }
    this.settled = true;
  }

  _spawn(slot) {
    const Kind = CLASSES[slot.species];
    if (!Kind) return;
    const arrive = this.settled;
    const c = new Kind(this.ctx, slot, { arrive, delay: arrive ? 1.5 + Math.random() * 5 : 0 });
    if (!arrive) this.announced.add(slot.species);
    this.group.add(c.root);
    this.creatures.set(slot.key, c);
  }

  _dismiss(c) {
    if (c.state === 'wait') {
      c.dispose();
      return;
    }
    c.leave();
    this.leaving.add(c);
  }

  _announce(kind) {
    if (this.announced.has(kind)) return;
    this.announced.add(kind);
    if (ANNOUNCE[kind]) this.emit('announce', ANNOUNCE[kind]);
  }

  // ---- Context shared with every creature -------------------------------------

  _makeContext() {
    const { world, particles } = this;
    const ctx = {
      world,
      objects: this.objects,
      particles,
      dt: 0,
      time: 0,
      night: 0,
      wind: 1,
      hour: 12,
      group: this.group,
      cam: new THREE.Vector3(),
      camDir: new THREE.Vector3(0, 0, -1),
      camRight: new THREE.Vector3(1, 0, 0),
      creatures: this.creatures, // Every settled creature, by slot key.
      claims: new Map(), // "kind:id" → creature, so two animals don't share a perch.
      shadows: true,

      surfaceAt: (x, z) => surfaceAt(world, x, z),
      inBody: (body, x, z, margin) => inBody(world, body, x, z, margin),
      edgeClearance: (x, z, keep) => edgeClearance(world, x, z, keep),
      waveY: (x, z) => waveHeight(x, z, ctx.time, ctx.wind),
      gust: (x, z, s = 0.5) => addGust(x, z, s),
      splash: (pos, size = 1) => particles.splash(pos, { count: Math.round(10 * size), radius: 0.4 * size }),
      leaves: (pos, color, count = 5) => particles.leaves(pos, { color, count }),
      sound: (name, pos, opts) => this._sound(name, pos, opts),
      announce: (kind) => this._announce(kind),
      unlock: (itemId) => this.journal?.unlock(itemId),

      // Grow a plant at (x, z) as a gift from an animal. Needs open land, room
      // to stand, and fewer than `max` of the same plant within `near`.
      plant(item, variant, x, z, { near = 4, max = 3 } = {}) {
        const s = surfaceAt(world, x, z);
        if (s.type !== 'land') return null;
        if (edgeClearance(world, x, z, (n) => n && n.type !== 'water' && n.h === s.cell.h) < 0.4) return null;
        for (const o of world.objectsInCell(s.key)) if (o.edge === null) return null;
        let same = 0;
        for (const o of world.objects.values()) {
          const d2 = (o.x - x) ** 2 + (o.z - z) ** 2;
          if (o.item === item && d2 < near * near) same++;
          if (d2 < 0.5 * 0.5 && getItem(o.item)?.placement === 'free') return null;
        }
        if (same >= max) return null;
        return world.addObject(
          { item, variant, x, y: s.y, z, rotY: Math.random() * Math.PI * 2, scale: 1, seed: randomSeed(), cell: null, edge: null, ground: s.key, grown: true },
          { animate: true },
        );
      },

      claim(id, who) {
        const holder = ctx.claims.get(id);
        if (holder && holder !== who && !holder.gone) return false;
        ctx.claims.set(id, who);
        return true;
      },
      release(id, who) {
        if (ctx.claims.get(id) === who) ctx.claims.delete(id);
      },
      claimed(id, who) {
        const holder = ctx.claims.get(id);
        return !!holder && holder !== who && !holder.gone;
      },

      // Can a ground animal walk straight from (x0, z0) to (x1, z1)? It stays on
      // land, climbs at most `maxStep` levels between cells, never crosses a
      // wall or fence, and keeps `radius` clear of solid things.
      walkable(x0, z0, x1, z1, { maxStep = 1, solids = [], radius = 0.15 } = {}) {
        let prev = surfaceAt(world, x0, z0);
        if (prev.type !== 'land') return false;
        const blockers = solids.filter((o) => (x0 - o.x) ** 2 + (z0 - o.z) ** 2 > (o.r + radius) ** 2);
        const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.2));
        for (let i = 1; i <= n; i++) {
          const x = x0 + ((x1 - x0) * i) / n;
          const z = z0 + ((z1 - z0) * i) / n;
          const s = surfaceAt(world, x, z);
          if (s.type !== 'land') return false;
          if (s.key !== prev.key) {
            if (Math.abs(s.cell.h - prev.cell.h) > maxStep) return false;
            const dir = DIRS.findIndex(([dq, dr]) => prev.cell.q + dq === s.cell.q && prev.cell.r + dr === s.cell.r);
            if (dir < 0) return false;
            if (world.objectsOnEdge(edgeKey(prev.cell.q, prev.cell.r, dir)).size) return false;
            prev = s;
          }
          for (const o of blockers) if ((x - o.x) ** 2 + (z - o.z) ** 2 < (o.r + radius) ** 2) return false;
        }
        return true;
      },
    };
    return ctx;
  }

  // Positional animal call: quieter with distance, panned toward its side.
  _sound(name, pos, { volume = 1, pitch = 1, range = 30 } = {}) {
    const { cam, camRight } = this.ctx;
    const dx = pos.x - cam.x;
    const dy = pos.y - cam.y;
    const dz = pos.z - cam.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > range) return;
    const fall = 1 / (1 + (d / (range * 0.28)) ** 2);
    const pan = Math.max(-1, Math.min(1, (dx * camRight.x + dy * camRight.y + dz * camRight.z) / Math.max(d, 1))) * 0.75;
    this.audio.critter(name, { volume: volume * fall, pan, pitch });
  }
}
