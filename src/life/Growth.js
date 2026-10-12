// Nature growth: plants spread on their own, a little at a time, near where
// you're looking.
//
//   wildflowers  a flower patch next to two or more flower items seeds another
//   lily pads    lily pads on a pond spread across it
//   reeds        reeds on a bank spread along the shore
//   mushrooms    sprout beside logs and stumps and in the shade of groves
//   saplings     a grove of three or more trees grows a sapling, which grows
//                up to a full tree over the next few minutes
//
// Grown plants are ordinary world objects with `grown: true`. They save with the
// world and you can remove them like anything else, but they stay out of the
// undo history. When the ground under one changes in a way that strands it
// (an undo that refills a pond, say), it quietly goes away.

import { DIRS, EDGE_NORMALS, hexToWorld, key as hexKey, worldToHex } from '../core/hex.js';
import { HEX_APOTHEM, PALETTE } from '../core/constants.js';
import { getItem } from '../catalog/catalog.js';
import { rimY, cellSurfaceY, cellGroundY } from '../world/World.js';
import { randomSeed } from '../core/random.js';
import { hashString } from './Creature.js';

const TICK = [24, 42]; // Seconds of game time between growth attempts.
const RANGE = 40; // Only grow within this distance of the camera's focus.
const SAPLING_START = 0.35;
const SAPLING_STEP = 0.2;
const MAX_GROWN = 120; // Grown plants in the whole world.
const CROWD = 10; // Grown plants allowed within 8 units of a new one.

const TREES = new Set(['tree_round', 'tree_pine', 'tree_birch', 'tree_willow']);
const FLOWERY = new Set(['flowers', 'flower_bed']);
const GRASSY = new Set(['grass', 'meadow']);
// Space each kind of thing takes up, so new plants never crowd into it.
const ROOM = {
  tree_round: 1.1, tree_pine: 0.9, tree_birch: 0.9, tree_willow: 1.3, bush: 0.6,
  rock_boulder: 0.9, rock_cluster: 0.8, rock_spire: 0.8, stump_log: 0.7, flower_bed: 0.8,
  lantern: 0.4, campfire: 0.9, bench: 0.9, barrels: 0.8, well: 1.1, signpost: 0.4,
  windmill: 2, boat: 1.4, footbridge: 1.5, stepping_stones: 1.2,
};

const near2 = (a, x, z) => (a.x - x) ** 2 + (a.z - z) ** 2;

export class Growth {
  constructor(world, { particles, sound }) {
    this.world = world;
    this.particles = particles;
    this.sound = sound; // (name, pos, opts) => void, positional.
    this.enabled = true;
    this.timer = this._interval();
    this.pending = new Set(); // Cell keys whose ground changed.
    world.on('cell', ({ key }) => this.pending.add(key));
    world.on('reset', () => {
      this.pending.clear();
      this.timer = this._interval();
    });
  }

  setEnabled(on) {
    this.enabled = !!on;
  }

  // dt is game time, so the time-lapse (T) speeds growth up too.
  update(dt, focus) {
    if (this.pending.size) this._cleanup();
    if (!this.enabled) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = this._interval();
    this.grow(focus);
  }

  _interval() {
    return TICK[0] + Math.random() * (TICK[1] - TICK[0]);
  }

  // One round of growth near `focus`: mature a sapling, then try to spread
  // something new. Returns what grew, for testing.
  grow(focus) {
    const nearby = [];
    let grown = 0;
    for (const o of this.world.objects.values()) {
      if (o.grown) grown++;
      if (near2(o, focus.x, focus.z) < RANGE * RANGE) nearby.push(o);
    }
    const out = [];
    const sapling = this._matureSapling(nearby);
    if (sapling) out.push(sapling);
    if (grown >= MAX_GROWN || !nearby.length) return out;
    const rules = [this._wildflower, this._lilyPad, this._reeds, this._mushroom, this._sapling];
    for (let i = rules.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rules[i], rules[j]] = [rules[j], rules[i]];
    }
    for (const rule of rules) {
      const obj = rule.call(this, nearby);
      if (obj) {
        out.push(obj);
        break;
      }
    }
    return out;
  }

  // ---- Rules -----------------------------------------------------------------------

  _wildflower(nearby) {
    const flowers = nearby.filter((o) => FLOWERY.has(o.item));
    const sources = flowers.filter((o) => flowers.filter((f) => f !== o && near2(f, o.x, o.z) < 25).length >= 2);
    return this._spread(sources, (src) => {
      const p = this._around(src, 1.2, 3.2);
      if (!this._land(p, GRASSY, 0.45)) return null;
      if (nearby.filter((o) => FLOWERY.has(o.item) && near2(o, p.x, p.z) < 4.5 * 4.5).length >= 8) return null;
      if (!this._roomy(nearby, p, 0.75)) return null;
      const variant = src.item === 'flowers' && Math.random() < 0.7 ? src.variant : Math.floor(Math.random() * 4);
      return { item: 'flowers', variant, ...p };
    });
  }

  _lilyPad(nearby) {
    const sources = nearby.filter((o) => o.item === 'lily_pads' && this.world.getCell(...this._qr(o))?.type === 'water');
    return this._spread(sources, (src) => {
      const home = this.world.getCell(...this._qr(src));
      const p = this._around(src, 0.9, 2.2);
      const cell = this.world.getCell(...this._qr(p));
      if (!cell || cell.type !== 'water' || cell.h !== home.h) return null;
      const keep = (n) => n && n.type === 'water' && n.h === cell.h;
      if (this._clearance(p, keep) < 0.6) return null;
      const body = this._bodySize(cell);
      const pads = nearby.filter((o) => o.item === 'lily_pads' && near2(o, p.x, p.z) < 36).length;
      if (pads >= Math.min(8, Math.ceil(body * 1.5))) return null;
      if (!this._roomy(nearby, p, 0.7)) return null;
      const variant = Math.random() < 0.8 ? src.variant : Math.floor(Math.random() * 3);
      return { item: 'lily_pads', variant, ...p, y: cellSurfaceY(cell) };
    });
  }

  _reeds(nearby) {
    const sources = nearby.filter((o) => o.item === 'reeds');
    return this._spread(sources, (src) => {
      // A bank cell near the source with water beside it.
      const [q0, r0] = this._qr(src);
      const options = [];
      for (const [dq, dr] of [[0, 0], ...DIRS]) {
        const c = this.world.getCell(q0 + dq, r0 + dr);
        if (!c || c.type === 'water') continue;
        for (let e = 0; e < 6; e++) {
          const n = this.world.getCell(c.q + DIRS[e][0], c.r + DIRS[e][1]);
          if (n?.type === 'water' && n.h <= c.h) options.push({ c, e });
        }
      }
      if (!options.length) return null;
      const { c, e } = options[Math.floor(Math.random() * options.length)];
      const center = hexToWorld(c.q, c.r);
      const a = (e * Math.PI) / 3 + (Math.random() - 0.5) * 0.8;
      const d = HEX_APOTHEM - 0.68;
      const p = { x: center.x + Math.cos(a) * d, z: center.z + Math.sin(a) * d };
      if (!this._land(p, null, 0.3, true)) return null;
      if (nearby.filter((o) => o.item === 'reeds' && near2(o, p.x, p.z) < 36).length >= 6) return null;
      if (!this._roomy(nearby, p, 0.75)) return null;
      return { item: 'reeds', variant: src.variant, ...p };
    });
  }

  _mushroom(nearby) {
    const trees = nearby.filter((o) => TREES.has(o.item));
    const shady = trees.filter((o) => trees.filter((t) => t !== o && near2(t, o.x, o.z) < 25).length >= 2);
    const sources = nearby.filter((o) => o.item === 'stump_log').concat(shady);
    return this._spread(sources, (src) => {
      const log = src.item === 'stump_log';
      const p = this._around(src, log ? 0.6 : 0.8, log ? 1.3 : 1.6);
      if (!this._land(p, new Set(['grass', 'meadow', 'dirt']), 0.35)) return null;
      if (nearby.filter((o) => o.item === 'mushrooms' && near2(o, p.x, p.z) < 9).length >= 2) return null;
      if (nearby.filter((o) => o.item === 'mushrooms' && near2(o, p.x, p.z) < 100).length >= 5) return null;
      if (!this._roomy(nearby, p, 0.4, src)) return null;
      const glowing = log && src.variant === 2 && Math.random() < 0.6;
      return { item: 'mushrooms', variant: glowing ? 2 : Math.random() < 0.5 ? 0 : 1, ...p };
    });
  }

  _sapling(nearby) {
    const trees = nearby.filter((o) => TREES.has(o.item));
    const sources = trees.filter((o) => trees.filter((t) => t !== o && near2(t, o.x, o.z) < 36).length >= 2);
    if (nearby.filter((o) => o.grown && TREES.has(o.item)).length >= 12) return null;
    return this._spread(sources, (src) => {
      const p = this._around(src, 2.2, 4.5);
      const types = src.item === 'tree_pine' ? new Set(['grass', 'meadow', 'snow', 'dirt']) : GRASSY;
      if (!this._land(p, types, 0.6)) return null;
      if (trees.filter((t) => near2(t, p.x, p.z) < 36).length >= 7) return null;
      if (!this._roomy(nearby, p, 1.5)) return null;
      // Keep saplings out of the village: nothing built within a few units.
      for (const o of nearby) {
        const pl = getItem(o.item)?.placement;
        if ((pl === 'edge' || pl === 'cell') && near2(o, p.x, p.z) < 16) return null;
      }
      return { item: src.item, variant: src.variant, ...p, scale: SAPLING_START };
    });
  }

  // Grow one young tree a step toward its full size.
  _matureSapling(nearby) {
    const young = nearby.filter((o) => o.grown && TREES.has(o.item) && o.scale < this._fullSize(o) - 0.01);
    if (!young.length) return null;
    const o = young[Math.floor(Math.random() * young.length)];
    const scale = Math.min(this._fullSize(o), o.scale + SAPLING_STEP);
    this.world.updateObject(o.id, { scale }, { grow: true });
    this._celebrate(o, true);
    return o;
  }

  _fullSize(o) {
    const [s0, s1] = getItem(o.item)?.scaleRange ?? [1, 1];
    return s0 + (s1 - s0) * ((hashString(String(o.seed)) % 1000) / 1000);
  }

  // ---- Helpers ---------------------------------------------------------------------

  // Try a few sources and spots; place the first plant that fits.
  _spread(sources, propose) {
    if (!sources.length) return null;
    for (let i = 0; i < 6; i++) {
      const src = sources[Math.floor(Math.random() * sources.length)];
      const plan = propose(src);
      if (plan && !this._crowded(plan)) return this._place(plan);
    }
    return null;
  }

  // Nature fills in gently: no more than a handful of grown plants per area.
  _crowded(p) {
    let n = 0;
    for (const o of this.world.objects.values()) {
      if (o.grown && near2(o, p.x, p.z) < 64 && ++n >= CROWD) return true;
    }
    return false;
  }

  _place(plan) {
    const item = getItem(plan.item);
    const [s0, s1] = item?.scaleRange ?? [1, 1];
    const { q, r } = worldToHex(plan.x, plan.z);
    const obj = this.world.addObject(
      {
        item: plan.item,
        variant: plan.variant,
        x: plan.x,
        y: plan.y,
        z: plan.z,
        rotY: item?.randomRotation ? Math.random() * Math.PI * 2 : 0,
        scale: plan.scale ?? s0 + (s1 - s0) * Math.random(),
        seed: randomSeed(),
        cell: null,
        edge: null,
        ground: hexKey(q, r),
        grown: true,
      },
      { animate: true },
    );
    this._celebrate(obj, false);
    return obj;
  }

  _celebrate(o, bigger) {
    const pos = { x: o.x, y: o.y + 0.3, z: o.z };
    this.particles.sparkle(pos, { color: '#fff2a8', count: bigger ? 8 : 6 });
    if (o.item !== 'lily_pads') this.particles.leaves(pos, { color: PALETTE.leafLight, count: bigger ? 5 : 3 });
    this.sound?.('sprout', pos, { volume: 0.8 });
  }

  _qr(p) {
    const { q, r } = worldToHex(p.x, p.z);
    return [q, r];
  }

  _around(src, d0, d1) {
    const a = Math.random() * Math.PI * 2;
    const d = d0 + Math.random() * (d1 - d0);
    return { x: src.x + Math.cos(a) * d, z: src.z + Math.sin(a) * d };
  }

  // Distance from p to the nearest edge whose neighbor fails `keep`.
  _clearance(p, keep) {
    const { q, r } = worldToHex(p.x, p.z);
    const c = hexToWorld(q, r);
    let best = Infinity;
    for (let i = 0; i < 6; i++) {
      const n = this.world.getCell(q + DIRS[i][0], r + DIRS[i][1]) ?? null;
      if (keep(n)) continue;
      best = Math.min(best, HEX_APOTHEM - ((p.x - c.x) * EDGE_NORMALS[i].x + (p.z - c.z) * EDGE_NORMALS[i].z));
    }
    return best;
  }

  // Is p on open land of one of `types` (any land when null), clear of cliffs
  // and of anything built on the cell? Sets p.y to the ground height.
  _land(p, types, margin, waterOk = false) {
    const cell = this.world.getCell(...this._qr(p));
    if (!cell || cell.type === 'water' || (types && !types.has(cell.type))) return false;
    const keep = (n) => (n && n.type !== 'water' && n.h === cell.h) || (waterOk && n?.type === 'water');
    if (this._clearance(p, keep) < margin) return false;
    for (const o of this.world.objectsInCell(hexKey(cell.q, cell.r))) {
      if (o.edge === null) return false; // A floor, bridge, or roof claims the cell.
    }
    p.y = rimY(cell.h);
    return true;
  }

  _roomy(nearby, p, r, ignore = null) {
    for (const o of nearby) {
      if (o === ignore) continue;
      const pl = getItem(o.item)?.placement;
      if (pl === 'edge' || pl === 'cell') continue;
      const room = (ROOM[o.item] ?? 0.45) * o.scale + r;
      if (near2(o, p.x, p.z) < room * room) return false;
    }
    return true;
  }

  _bodySize(cell) {
    const seen = new Set([hexKey(cell.q, cell.r)]);
    const stack = [cell];
    while (stack.length && seen.size < 40) {
      const c = stack.pop();
      for (const [dq, dr] of DIRS) {
        const n = this.world.getCell(c.q + dq, c.r + dr);
        const k = hexKey(c.q + dq, c.r + dr);
        if (n && n.type === 'water' && n.h === cell.h && !seen.has(k)) {
          seen.add(k);
          stack.push(n);
        }
      }
    }
    return seen.size;
  }

  // Grown plants on changed ground that no longer fit there go away.
  _cleanup() {
    const keys = [...this.pending];
    this.pending.clear();
    for (const k of keys) {
      const cell = this.world.getCellByKey(k);
      for (const o of [...this.world.objectsOnGround(k)]) {
        if (!o.grown) continue;
        let ok = false;
        if (cell) {
          if (o.item === 'lily_pads') ok = cell.type === 'water' && Math.abs(o.y - cellSurfaceY(cell)) < 0.05;
          else ok = cell.type !== 'water' && Math.abs(o.y - cellGroundY(cell)) < 0.05;
        }
        if (!ok) this.world.removeObject(o.id, { animate: true });
      }
    }
  }
}
