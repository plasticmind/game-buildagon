// The world data model: hex terrain cells plus placed objects.
// Renderers subscribe to its events and never mutate it. Gameplay code mutates it.
//
// Events (every payload's last argument is `opts`, which may carry `animate: true`):
//   'cell'          ({ q, r, key, cell, prev }, opts)   cell is null when removed
//   'objectAdded'   (obj, opts)
//   'objectRemoved' (obj, opts)
//   'objectUpdated' (obj, prev, opts)
//   'reset'         ()                                  rebuild everything from scratch

import { Emitter } from '../core/events.js';
import { key as hexKey, pointKey } from '../core/hex.js';
import { LEVEL_H, WATER_DROP, BASIN_DEPTH, SEA_Y, BASE_Y, MAX_LEVEL } from '../core/constants.js';

export const SAVE_VERSION = 1;

// Cell: { q, r, h, type, variant }
//   h        terrain level, 0..MAX_LEVEL. The rim (top) sits at y = h * LEVEL_H.
//   type     a key of TERRAIN in constants.js, including 'water'.
//   variant  index into TERRAIN[type].variants.
//
// Object: { id, item, variant, x, y, z, rotY, scale, seed, cell, edge, ground }
//   item     catalog item id.
//   x, y, z  world position of the model's origin (its base).
//   rotY     rotation around Y, in radians.
//   cell     'q,r' key of the hex the object is snapped to (grid items), else null.
//   edge     edge index 0-5 for edge items (walls, fences), else null.
//   ground   'q,r' key of the terrain cell the object rests on, else null. When that
//            cell's height changes, the object moves with it.
//   grown    true when nature grew the object on its own (see life/Growth.js).

export function rimY(h) {
  return h * LEVEL_H;
}

// The terrain height rules, shared by every renderer and by placement. Pass a
// cell, or null for an empty (ocean) cell.
// Solid ground: the rim for land, the basin floor for water, the seabed if empty.
export function cellGroundY(c) {
  if (!c) return BASE_Y;
  return c.type === 'water' ? rimY(c.h) - BASIN_DEPTH : rimY(c.h);
}

// Where you'd stand: the rim for land, the water surface for water and ocean.
export function cellSurfaceY(c) {
  if (!c) return SEA_Y;
  return c.type === 'water' ? rimY(c.h) - WATER_DROP : rimY(c.h);
}

export class World extends Emitter {
  constructor() {
    super();
    this.cells = new Map();
    this.objects = new Map();
    this.byCell = new Map();
    this.byEdge = new Map();
    this.byGround = new Map();
    this.nextId = 1;
    this.meta = {};
  }

  _clearObjects() {
    this.objects.clear();
    this.byCell.clear();
    this.byEdge.clear();
    this.byGround.clear();
  }

  // ---- Cells -------------------------------------------------------------

  getCell(q, r) {
    return this.cells.get(hexKey(q, r));
  }

  getCellByKey(k) {
    return this.cells.get(k);
  }

  hasCell(q, r) {
    return this.cells.has(hexKey(q, r));
  }

  setCell(q, r, data, opts = {}) {
    const k = hexKey(q, r);
    const prev = this.cells.get(k) ?? null;
    const cell = {
      q,
      r,
      h: Math.max(0, Math.min(MAX_LEVEL, data.h | 0)),
      type: data.type,
      variant: data.variant ?? 0,
    };
    this.cells.set(k, cell);
    this.emit('cell', { q, r, key: k, cell, prev }, opts);
    return cell;
  }

  removeCell(q, r, opts = {}) {
    const k = hexKey(q, r);
    const prev = this.cells.get(k);
    if (!prev) return;
    this.cells.delete(k);
    this.emit('cell', { q, r, key: k, cell: null, prev }, opts);
  }

  // Rim height of a cell, or null when the cell is empty (open ocean).
  topY(q, r) {
    const c = this.getCell(q, r);
    return c ? rimY(c.h) : null;
  }

  // Height of the solid ground: the rim for land, the basin floor for water,
  // and the seabed for empty cells.
  groundY(q, r) {
    return cellGroundY(this.getCell(q, r));
  }

  // Height you'd stand on: the rim for land, the water surface for water and ocean.
  surfaceY(q, r) {
    return cellSurfaceY(this.getCell(q, r));
  }

  // Water surface height for a water cell, SEA_Y for empty cells, null for land.
  waterY(q, r) {
    const c = this.getCell(q, r);
    if (!c) return SEA_Y;
    return c.type === 'water' ? rimY(c.h) - WATER_DROP : null;
  }

  // ---- Objects -----------------------------------------------------------

  addObject(o, opts = {}) {
    const obj = {
      id: o.id ?? this.nextId++,
      item: o.item,
      variant: o.variant ?? 0,
      x: o.x,
      y: o.y,
      z: o.z,
      rotY: o.rotY ?? 0,
      scale: o.scale ?? 1,
      seed: o.seed ?? 1,
      cell: o.cell ?? null,
      edge: o.edge ?? null,
      ground: o.ground ?? null,
    };
    if (o.grown) obj.grown = true;
    if (obj.id >= this.nextId) this.nextId = obj.id + 1;
    this.objects.set(obj.id, obj);
    this._index(obj, true);
    this.emit('objectAdded', obj, opts);
    return obj;
  }

  removeObject(id, opts = {}) {
    const obj = this.objects.get(id);
    if (!obj) return null;
    this.objects.delete(id);
    this._index(obj, false);
    this.emit('objectRemoved', obj, opts);
    return obj;
  }

  updateObject(id, patch, opts = {}) {
    const obj = this.objects.get(id);
    if (!obj) return null;
    const prev = { ...obj };
    this._index(obj, false);
    Object.assign(obj, patch);
    this._index(obj, true);
    this.emit('objectUpdated', obj, prev, opts);
    return obj;
  }

  getObject(id) {
    return this.objects.get(id);
  }

  // Indexed lookups, so placement never scans every object. Each returns a Set;
  // don't modify it.
  objectsInCell(k) {
    return this.byCell.get(k) ?? NONE;
  }

  // Edge items on the edge whose midpoint key is `ek` (see edgeKey in hex.js).
  objectsOnEdge(ek) {
    return this.byEdge.get(ek) ?? NONE;
  }

  // Objects resting on the terrain of cell `k`; they move when it changes.
  objectsOnGround(k) {
    return this.byGround.get(k) ?? NONE;
  }

  _index(o, add) {
    const f = add ? addTo : removeFrom;
    f(this.byCell, o.cell, o);
    f(this.byGround, o.ground, o);
    if (o.edge !== null) f(this.byEdge, pointKey(o.x, o.z), o);
  }

  // ---- Bulk --------------------------------------------------------------

  clear() {
    this.cells.clear();
    this._clearObjects();
    this.nextId = 1;
    this.emit('reset');
  }

  serialize() {
    const cells = [];
    for (const c of this.cells.values()) cells.push([c.q, c.r, c.h, c.type, c.variant]);
    const objects = [];
    for (const o of this.objects.values()) {
      const out = {
        id: o.id,
        item: o.item,
        variant: o.variant,
        p: [round3(o.x), round3(o.y), round3(o.z)],
        rotY: round3(o.rotY),
        scale: round3(o.scale),
        seed: o.seed,
        cell: o.cell,
        edge: o.edge,
        ground: o.ground,
      };
      if (o.grown) out.grown = true;
      objects.push(out);
    }
    return { version: SAVE_VERSION, cells, objects, meta: { ...this.meta } };
  }

  // Replaces the whole world. Emits a single 'reset', not per-item events.
  load(data) {
    this.cells.clear();
    this._clearObjects();
    this.nextId = 1;
    for (const [q, r, h, type, variant] of data.cells ?? []) {
      this.cells.set(hexKey(q, r), { q, r, h, type, variant: variant ?? 0 });
    }
    for (const o of data.objects ?? []) {
      const obj = {
        id: o.id,
        item: o.item,
        variant: o.variant ?? 0,
        x: o.p[0],
        y: o.p[1],
        z: o.p[2],
        rotY: o.rotY ?? 0,
        scale: o.scale ?? 1,
        seed: o.seed ?? 1,
        cell: o.cell ?? null,
        edge: o.edge ?? null,
        ground: o.ground ?? null,
      };
      if (o.grown) obj.grown = true;
      this.objects.set(obj.id, obj);
      this._index(obj, true);
      if (obj.id >= this.nextId) this.nextId = obj.id + 1;
    }
    this.meta = { ...(data.meta ?? {}) };
    this.emit('reset');
  }
}

function round3(v) {
  return Math.round(v * 1000) / 1000;
}

const NONE = new Set();

function addTo(map, k, o) {
  if (k === null || k === undefined) return;
  let set = map.get(k);
  if (!set) map.set(k, (set = new Set()));
  set.add(o);
}

function removeFrom(map, k, o) {
  const set = map.get(k);
  if (!set) return;
  set.delete(o);
  if (!set.size) map.delete(k);
}
