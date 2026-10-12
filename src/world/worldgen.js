// World generation: the cozy starter island and a small empty island.
//
// The starter island mixes a hand-tuned layout for the set pieces (cottage, hill
// pond, waterfall, stream, bridge, lagoon, windmill) with seeded noise for the
// coastline, the rolling terrain, and the decoration scatter. The same seed always
// gives the same island.

import { key as hexKey, hexToWorld, worldToHex, hexDistance, hexesInRadius, DIRS, EDGE_NORMALS, neighbor } from '../core/hex.js';
import { LEVEL_H, HEX_APOTHEM, HEX_SIZE, BASIN_DEPTH, WATER_DROP, STORY_H, TERRAIN } from '../core/constants.js';
import { mulberry32, createNoise2D, fbm } from '../core/random.js';
import { getItem } from '../catalog/catalog.js';
import { edgeTransform, cellTransform } from '../build/placement.js';
import { SAVE_VERSION, rimY, cellGroundY, cellSurfaceY } from './World.js';
import { smoothstep } from '../core/math.js';

const FLOOR_TOP = 0.18; // Height of a floor tile's walking surface.
const MAX_RADIUS = 13; // Nothing generates beyond this hex distance.

// ---- Hand-tuned layout (axial coordinates) ----------------------------------

const PEAK = [3, -8]; // Snowy summit.
const POND = [
  [-1, -4],
  [0, -4],
];
const POND_LEVEL = 4;
// Stream from the waterfall foot down to the lagoon, with its level per cell.
const STREAM = [
  [-1, -3, 1],
  [-2, -2, 1],
  [-2, -1, 1],
  [-3, 0, 1],
  [-3, 1, 1],
  [-4, 2, 0],
  [-5, 3, 0],
];
const LAGOON = [
  [-6, 4],
  [-6, 5],
  [-7, 5],
  [-5, 4],
  [-7, 6],
  [-6, 6],
];
const BRIDGE = { at: [-2, -1], steps: 0 }; // Spans from (-1, -1) to (-3, -1).
const HOUSE = [
  [2, 0],
  [3, 0],
  [2, 1],
];
const HOUSE_LEVEL = 2;
const YARD = new Set(HOUSE.flatMap(([q, r]) => DIRS.map(([dq, dr]) => hexKey(q + dq, r + dr))));
const DOOR = { cell: [2, 0], edge: 3 }; // Faces west, toward the path.
const WINDOWS = [
  [3, 0, 0],
  [2, 1, 2],
  [2, 0, 4],
];
const MILL_HILL = [7, -3];
// Dirt paths, each walked from its first cell. The bridge sits between the first
// two segments.
const PATHS = [
  [
    [1, 0],
    [0, 0],
    [0, -1],
    [-1, -1],
  ],
  [
    [-3, -1],
    [-4, -1],
    [-5, -1],
  ],
  // South to the beach.
  [
    [1, 0],
    [0, 1],
    [-1, 2],
    [-1, 3],
    [-1, 4],
    [-2, 5],
  ],
  // Around the cottage and up to the windmill.
  [
    [1, 0],
    [2, -1],
    [3, -1],
    [4, -2],
    [5, -2],
    [6, -2],
  ],
];
const PATH = PATHS.flat();
const PATH_SET = new Set(PATH.map(([q, r]) => hexKey(q, r)));
const GORGE_VIEW = [-1, -2]; // Kept low so the waterfall shows from the south.
// No trees on the gorge rim, so nothing hides the waterfall from the south.
const OPEN_VIEW = new Set(['-1,-2', '0,-3', '-2,-3']);

// ---- Public API -------------------------------------------------------------

export function generateStarterWorld({ seed = 1 } = {}) {
  const gen = new IslandGen(seed >>> 0);
  gen.terrain();
  gen.decorate();
  return gen.save();
}

export function generateEmptyIsland() {
  const cells = hexesInRadius(0, 0, 4).map(({ q, r }) => {
    const coast = hexDistance(q, r) === 4;
    return [q, r, 0, coast ? 'sand' : 'grass', 0];
  });
  return { version: SAVE_VERSION, cells, objects: [], meta: { time: 9.5 } };
}

// ---- Generator ----------------------------------------------------------------

class IslandGen {
  constructor(seed) {
    this.seed = seed;
    this.rng = mulberry32(seed ^ 0x9e3779b9);
    this.noiseA = createNoise2D(seed + 11);
    this.noiseB = createNoise2D(seed + 23);
    this.noiseC = createNoise2D(seed + 37);
    this.cells = new Map(); // key → { q, r, h, type, variant }
    this.objects = [];
    this.nextId = 1;
    this.discs = []; // Footprints: { x, z, r, core, item }. Small plants only avoid `core`.
    this.reserved = new Set(); // Cell keys kept clear of scattered decoration.
    this.seeds = new Set(); // Object seeds handed out so far.
  }

  // ---- Terrain --------------------------------------------------------------

  terrain() {
    const { rng, noiseA, noiseB } = this;
    const fixed = new Set([
      ...POND.map(k2),
      ...STREAM.map(k2),
      ...LAGOON.map(k2),
      ...HOUSE.map(k2),
      ...PATH.map(k2),
      k2(BRIDGE.at),
      k2(MILL_HILL),
      k2(PEAK),
    ]);
    const lagoonSet = new Set(LAGOON.map(k2));

    // Coastline: a noisy radius per direction.
    const coastR = (x, z) => {
      const a = Math.atan2(z, x);
      const n = fbm(noiseA, Math.cos(a) * 1.6 + 7, Math.sin(a) * 1.6 + 3, 3);
      return 9.3 + (n - 0.5) * 3.4;
    };

    const peak = hexToWorld(...PEAK);
    const mill = hexToWorld(...MILL_HILL);
    for (const { q, r } of hexesInRadius(0, 0, MAX_RADIUS)) {
      const k = hexKey(q, r);
      const { x, z } = hexToWorld(q, r);
      const d = Math.hypot(x, z) / (HEX_APOTHEM * 2); // Distance in cells.
      const R = coastR(x, z);
      const t = 1 - d / R; // 1 at the center, 0 at the coast.
      if (t <= 0 && !fixed.has(k)) continue;

      // Rolling midlands, a snowy hill in the north, a windmill knoll in the east.
      const roll = fbm(noiseB, x * 0.045 + 5, z * 0.045 - 2, 3);
      const hill = 6 * Math.exp(-((x - peak.x) ** 2 + (z - peak.z) ** 2) / (2 * 8 ** 2));
      const knoll = 2.1 * Math.exp(-((x - mill.x) ** 2 + (z - mill.z) ** 2) / (2 * 5 ** 2));
      let H = 0.5 + 2.2 * smoothstep(0.04, 0.55, t) + (roll - 0.5) * 1.6 + hill + knoll;
      // Beaches, except under the mountain, where the coast stays a cliff.
      if (t < 0.11) H = Math.min(H, 0.9 + hill * 0.7);
      const h = clampInt(Math.floor(H), 0, 9);
      this.cells.set(k, { q, r, h, type: 'grass', variant: 0 });
    }

    // Lagoon mouth: open the coast in front of the lagoon so it meets the sea.
    for (const [q, r] of LAGOON) {
      for (let i = 0; i < 6; i++) {
        const n = neighbor(q, r, i);
        const nk = hexKey(n.q, n.r);
        if (lagoonSet.has(nk)) continue;
        if (hexDistance(n.q, n.r) > hexDistance(q, r)) this.cells.delete(nk);
      }
    }

    this._shapeSetPieces();
    this._paint(rng);
    this._enforceWater();
  }

  // Flatten and raise the ground around the set pieces.
  _shapeSetPieces() {
    const set = (q, r, h, type, variant = 0) => {
      this.cells.set(hexKey(q, r), { q, r, h, type, variant });
    };
    const atLeast = (q, r, h) => {
      const c = this.cells.get(hexKey(q, r));
      if (c) c.h = Math.max(c.h, h);
      else set(q, r, h, 'grass');
    };

    // The hill pond and its rim.
    for (const [q, r] of POND) {
      for (let i = 0; i < 6; i++) {
        const n = neighbor(q, r, i);
        atLeast(n.q, n.r, POND_LEVEL);
      }
    }
    // Stream banks never sit below the water they hold.
    for (const [q, r, h] of STREAM) {
      for (let i = 0; i < 6; i++) {
        const n = neighbor(q, r, i);
        atLeast(n.q, n.r, h);
      }
    }
    // Cottage plateau: the house and its yard sit flat.
    for (const [q, r] of HOUSE) {
      set(q, r, HOUSE_LEVEL, 'grass', 0);
      for (let i = 0; i < 6; i++) {
        const n = neighbor(q, r, i);
        const c = this.cells.get(hexKey(n.q, n.r));
        if (!c || c.h !== HOUSE_LEVEL) set(n.q, n.r, HOUSE_LEVEL, c?.type ?? 'grass', c?.variant ?? 0);
      }
    }
    // The bridge banks match the stream so the bridge lands flush.
    const [bq, br] = BRIDGE.at;
    for (const s of [BRIDGE.steps, BRIDGE.steps + 3]) {
      const n = neighbor(bq, br, s);
      set(n.q, n.r, 1, 'dirt', 0);
    }
    // Windmill knoll: a flat top.
    const [mq, mr] = MILL_HILL;
    const millH = Math.max(3, this.cells.get(k2(MILL_HILL))?.h ?? 3);
    set(mq, mr, millH, 'grass', 2);

    // A low step in front of the gorge opens the view to the waterfall.
    const [gq, gr] = GORGE_VIEW;
    set(gq, gr, 2, this.cells.get(k2(GORGE_VIEW))?.type ?? 'grass');

    // Paths climb at most one level per cell. The yard and the bridge banks stay put.
    const pinned = new Set([...HOUSE.map(k2)]);
    for (const [q, r] of HOUSE) for (const [dq, dr] of DIRS) pinned.add(hexKey(q + dq, r + dr));
    for (const s of [BRIDGE.steps, BRIDGE.steps + 3]) {
      const n = neighbor(bq, br, s);
      pinned.add(hexKey(n.q, n.r));
    }
    for (let pass = 0; pass < 6; pass++) {
      for (const path of PATHS) {
        for (let i = 1; i < path.length; i++) {
          const a = this.cells.get(k2(path[i - 1]));
          const b = this.cells.get(k2(path[i]));
          if (!a || !b || Math.abs(a.h - b.h) <= 1) continue;
          const [hi, lo] = a.h > b.h ? [a, b] : [b, a];
          if (!pinned.has(hexKey(hi.q, hi.r))) hi.h = lo.h + 1;
          else if (!pinned.has(hexKey(lo.q, lo.r))) lo.h = hi.h - 1;
        }
      }
    }

    for (const [q, r] of POND) set(q, r, POND_LEVEL, 'water', 2);
    for (const [q, r, h] of STREAM) set(q, r, h, 'water', 0);
    for (const [q, r] of LAGOON) set(q, r, 0, 'water', 1);
  }

  // Assign terrain types: beaches, meadows, the snowy hill, and the dirt path.
  _paint(rng) {
    const { noiseC } = this;
    const water = new Set([...POND.map(k2), ...STREAM.map(k2), ...LAGOON.map(k2)]);
    const peak = hexToWorld(...PEAK);
    for (const c of this.cells.values()) {
      if (c.type === 'water') continue;
      const { x, z } = hexToWorld(c.q, c.r);
      const coastal = this._touchesOcean(c.q, c.r);
      const m = fbm(noiseC, x * 0.07 + 9, z * 0.07 + 4, 3);
      const nearPeak = Math.hypot(x - peak.x, z - peak.z) < 13;
      const dunes = fbm(noiseC, x * 0.13 - 3, z * 0.13 + 8, 2);
      if (c.h >= 6) c.type = 'snow';
      else if (c.h === 5 && nearPeak) c.type = rng() < 0.7 ? 'stone' : 'snow';
      else if (coastal && c.h >= 2 && nearPeak) c.type = 'stone';
      else if (c.h === 0 && coastal) c.type = 'sand';
      else if (c.h === 0 && dunes > 0.6 && this._ringDistance(c.q, c.r) <= 1) c.type = 'sand';
      else if (c.h === 1 && coastal && dunes > 0.62) c.type = 'sand';
      else if (m > 0.56) c.type = 'meadow';
      else c.type = 'grass';
      c.variant = pickVariant(c.type, m, rng);
      // Stone outcrops on the hill shoulders.
      if (c.type === 'grass' && c.h >= 4 && nearPeak && m < 0.36) {
        c.type = 'stone';
        c.variant = 0;
      }
      // Lagoon and pond shores get soft sand.
      if (c.h === 0 && this._nearSet(c.q, c.r, water) && c.type !== 'snow') {
        c.type = 'sand';
        c.variant = 0;
      }
    }
    for (const [q, r] of PATH) {
      const c = this.cells.get(hexKey(q, r));
      if (c && c.type !== 'water') {
        c.type = 'dirt';
        c.variant = 0;
      }
    }
    for (const [q, r] of HOUSE) {
      const c = this.cells.get(hexKey(q, r));
      c.type = 'grass';
      c.variant = 0;
    }
  }

  // Raise any land that would make water spill where it shouldn't. Every water
  // cell may only spill into lower water along the stream, or merge with the sea.
  _enforceWater() {
    for (let pass = 0; pass < 4; pass++) {
      for (const c of this.cells.values()) {
        if (c.type !== 'water') continue;
        for (let i = 0; i < 6; i++) {
          const n = neighbor(c.q, c.r, i);
          const nk = hexKey(n.q, n.r);
          const nc = this.cells.get(nk);
          if (!nc) {
            // Only sea-level water may touch the ocean.
            if (c.h > 0) this.cells.set(nk, { q: n.q, r: n.r, h: c.h, type: 'stone', variant: 1 });
            continue;
          }
          if (nc.type !== 'water' && nc.h < c.h) nc.h = c.h;
        }
      }
    }
  }

  _touchesOcean(q, r) {
    for (let i = 0; i < 6; i++) {
      const n = neighbor(q, r, i);
      if (!this.cells.has(hexKey(n.q, n.r))) return true;
    }
    return false;
  }

  // Hex steps to the nearest ocean cell, capped at 3.
  _ringDistance(q, r) {
    for (let d = 1; d <= 3; d++) {
      for (const h of hexesInRadius(q, r, d)) {
        if (!this.cells.has(hexKey(h.q, h.r))) return d - 1;
      }
    }
    return 3;
  }

  _nearSet(q, r, set) {
    for (let i = 0; i < 6; i++) {
      const n = neighbor(q, r, i);
      if (set.has(hexKey(n.q, n.r))) return true;
    }
    return false;
  }

  // ---- Decoration -----------------------------------------------------------

  decorate() {
    this._house();
    this._waterside();
    this._props();
    this._scatter();
  }

  // The cottage: wood floors, walls on the outer edges, and a hex roof per cell.
  _house() {
    const houseSet = new Set(HOUSE.map(k2));
    const windows = new Set(WINDOWS.map(([q, r, e]) => `${hexKey(q, r)}|${e}`));
    const doorKey = `${k2(DOOR.cell)}|${DOOR.edge}`;
    for (const [q, r] of HOUSE) {
      const k = hexKey(q, r);
      const rim = this._rim(q, r);
      this.reserved.add(k);
      this._addGrid('floor_wood', 0, cellTransform(q, r, rim, 0), k);
      for (let e = 0; e < 6; e++) {
        const n = neighbor(q, r, e);
        if (houseSet.has(hexKey(n.q, n.r))) continue;
        const ek = `${k}|${e}`;
        const item = ek === doorKey ? 'wall_door' : windows.has(ek) ? 'wall_window' : 'wall_plain';
        this._addGrid(item, 1, edgeTransform(q, r, e, rim + FLOOR_TOP), k);
      }
      this._addGrid('roof_hex', 0, cellTransform(q, r, rim + FLOOR_TOP + STORY_H, 0), k);
      const c = hexToWorld(q, r);
      this.discs.push({ x: c.x, z: c.z, r: HEX_SIZE * 1.05, core: HEX_SIZE * 1.05 });
    }
  }

  // Bridge, waterfall-side greenery, lily pads, reeds, stepping stones, and a boat.
  _waterside() {
    const { rng } = this;
    // Arched bridge over the stream.
    const [bq, br] = BRIDGE.at;
    const bk = hexKey(bq, br);
    this.reserved.add(bk);
    this._addGrid('bridge_arch', 0, cellTransform(bq, br, this._rim(bq, br), BRIDGE.steps), bk);
    const bc = hexToWorld(bq, br);
    this.discs.push({ x: bc.x, z: bc.z, r: HEX_SIZE, core: HEX_SIZE });
    for (const s of [BRIDGE.steps, BRIDGE.steps + 3]) {
      const a = (s * Math.PI) / 3;
      const d = HEX_APOTHEM + 0.6;
      this.discs.push({ x: bc.x + Math.cos(a) * d, z: bc.z + Math.sin(a) * d, r: 0.9, core: 0.9 });
    }

    // Boat moored in the lagoon.
    const lagoonCells = LAGOON.map(([q, r]) => ({ q, r }));
    const boatCell = lagoonCells[1];
    const boat = hexToWorld(boatCell.q, boatCell.r);
    this._free('boat', 1, boat.x - 0.3, boat.z + 0.2, 1.5, { rotY: 0.6 + rng() * 0.6 });

    // Lily pads on still water.
    const still = [...POND.map(([q, r]) => ({ q, r, n: 2 })), ...lagoonCells.map((c) => ({ ...c, n: 1 }))];
    for (const { q, r, n } of still) {
      for (let i = 0; i < n + 1; i++) {
        const c = hexToWorld(q, r);
        const a = rng() * Math.PI * 2;
        const d = rng() * 1.1;
        this._free('lily_pads', Math.floor(rng() * 3), c.x + Math.cos(a) * d, c.z + Math.sin(a) * d, 0.55);
      }
    }

    // Stepping stones across the lower stream.
    const [sq, sr] = STREAM[STREAM.length - 2];
    const sc = hexToWorld(sq, sr);
    const across = Math.PI / 6; // Perpendicular-ish to the flow there.
    for (const t of [-0.95, 0, 0.95]) {
      this._free('stepping_stones', 0, sc.x + Math.cos(across) * t, sc.z + Math.sin(across) * t, 0.5, {
        ignoreOverlapWith: 'stepping_stones',
      });
    }

    // Willows lean over the water, with reeds tucked along the banks.
    const water = new Set([...POND.map(k2), ...STREAM.map(k2), ...LAGOON.map(k2)]);
    for (const c of this.cells.values()) {
      if (c.type === 'water' || c.type === 'sand' || !this._nearSet(c.q, c.r, water)) continue;
      if (rng() > 0.5) continue;
      const center = hexToWorld(c.q, c.r);
      for (let tries = 0; tries < 3; tries++) {
        const x = center.x + (rng() - 0.5) * 1.6;
        const z = center.z + (rng() - 0.5) * 1.6;
        if (this._free('tree_willow', rng() < 0.8 ? 0 : 1, x, z, 1.2)) break;
      }
    }
    for (const c of this.cells.values()) {
      if (c.type === 'water' || this.reserved.has(hexKey(c.q, c.r)) || this._isPath(c)) continue;
      const center = hexToWorld(c.q, c.r);
      for (let e = 0; e < 6; e++) {
        const n = neighbor(c.q, c.r, e);
        if (!water.has(hexKey(n.q, n.r))) continue;
        if (rng() < 0.6) {
          // A clump of reeds on the bank, just back from the water's edge.
          const a = (e * Math.PI) / 3 + (rng() - 0.5) * 0.7;
          const d = HEX_APOTHEM - 0.68;
          this._free('reeds', Math.floor(rng() * 3), center.x + Math.cos(a) * d, center.z + Math.sin(a) * d, 0.4);
        }
      }
    }
  }

  // Cozy props around the cottage, the beach, and the windmill knoll.
  _props() {
    const { rng } = this;
    const at = (q, r, dx = 0, dz = 0) => {
      const c = hexToWorld(q, r);
      return [c.x + dx, c.z + dz];
    };
    // Lantern beside the door, just outside.
    const [dq, dr] = DOOR.cell;
    const dc = hexToWorld(dq, dr);
    const da = (DOOR.edge * Math.PI) / 3;
    const out = HEX_APOTHEM + 0.75;
    const side = 0.95;
    this._free(
      'lantern',
      0,
      dc.x + Math.cos(da) * out - Math.sin(da) * side,
      dc.z + Math.sin(da) * out + Math.cos(da) * side,
      0.3,
      { allowPath: true, rotY: rng() * Math.PI * 2 },
    );
    // Signpost where the paths meet.
    this._free('signpost', 0, ...at(0, 0, 0.9, 0.7), 0.35, { allowPath: true, rotY: 0.4 });
    // Well and bench in the yard, barrels by the side wall, flower beds out front.
    this._free('well', 0, ...at(3, 1, 0.2, 0.3), 1.0, { rotY: rng() * Math.PI * 2 });
    this._free('bench', 0, ...at(1, 1, -0.3, 0.2), 0.8, { rotY: angleTo(at(1, 1), at(-3, 4)) });
    this._free('barrels', 0, ...at(4, 0, -0.5, -0.4), 0.6);
    this._free('barrels', 1, ...at(4, 0, -0.2, 0.7), 0.6);
    this._free('flower_bed', 0, ...at(2, 2, -0.2, -0.9), 0.8, { rotY: 0.5 });
    this._free('flower_bed', 1, ...at(3, 1, -1.2, 1.0), 0.8, { rotY: -0.4 });
    // Windmill on the knoll.
    this._free('windmill', 0, ...at(...MILL_HILL), 1.8, { rotY: 2.2 + rng() * 0.6 });
    // Campfire on the beach with log seats.
    for (const [fx, fz] of this._beachSpots()) {
      if (!this._free('campfire', 0, fx, fz, 0.8)) continue;
      for (let i = 0; i < 2; i++) {
        const a = rng() * Math.PI * 2 + i * Math.PI;
        this._free('stump_log', 1, fx + Math.cos(a) * 1.4, fz + Math.sin(a) * 1.4, 0.55, { rotY: Math.PI / 2 - a });
      }
      break;
    }
  }

  // Sandy spots near the end of the south path, nearest first, for the campfire.
  _beachSpots() {
    const end = PATHS[2][PATHS[2].length - 1];
    const sand = [...this.cells.values()]
      .filter((c) => c.type === 'sand' && c.h === 0 && !this._isPath(c))
      .map((c) => ({ c, d: hexDistance(c.q, c.r, end[0], end[1]) + (this._touchesOcean(c.q, c.r) ? 1.5 : 0) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 8);
    const spots = [];
    for (const { c } of sand) {
      const p = hexToWorld(c.q, c.r);
      spots.push([p.x, p.z], [p.x + 0.4, p.z - 0.3], [p.x - 0.4, p.z + 0.3]);
    }
    return spots;
  }

  // Seeded scatter: trees first, then shrubs and rocks, then small flora.
  _scatter() {
    const { rng, noiseB, noiseC } = this;
    const forest = (x, z) => fbm(noiseB, x * 0.075 - 13, z * 0.075 + 21, 3);
    const lush = (x, z) => fbm(noiseC, x * 0.11 + 40, z * 0.11 - 9, 2);
    const extent = (MAX_RADIUS + 1) * HEX_SIZE * 1.8;

    const pass = (spacing, choose) => {
      for (let gx = -extent; gx <= extent; gx += spacing) {
        for (let gz = -extent; gz <= extent; gz += spacing) {
          const x = gx + (rng() - 0.5) * spacing * 0.9;
          const z = gz + (rng() - 0.5) * spacing * 0.9;
          const h = worldToHex(x, z);
          const c = this.cells.get(hexKey(h.q, h.r));
          const roll = rng();
          const pickA = rng();
          const pickB = rng();
          if (!c || c.type === 'water' || this.reserved.has(hexKey(c.q, c.r)) || this._isPath(c)) continue;
          const spec = choose(c, x, z, roll, pickA, pickB);
          if (spec) this._free(spec[0], spec[1], x, z, spec[2]);
        }
      }
    };

    // Trees in clustered groves.
    pass(2.3, (c, x, z, roll, a, b) => {
      const f = forest(x, z);
      if (c.type === 'snow') return roll < 0.5 ? ['tree_pine', 2, 1.0] : null;
      if (c.type === 'stone') return roll < 0.42 ? ['tree_pine', a < 0.6 ? 0 : 1, 1.0] : null;
      if (c.type === 'sand') return null;
      const p = f > 0.56 ? 0.62 : f > 0.48 ? 0.16 : 0.035;
      if (roll > p) return null;
      if (c.h >= 3) return a < 0.55 ? ['tree_pine', b < 0.75 ? 0 : 1, 1.0] : a < 0.8 ? ['tree_birch', b < 0.6 ? 0 : 1, 1.0] : ['tree_round', 0, 1.3];
      if (a < 0.6) return ['tree_round', b < 0.68 ? 0 : b < 0.86 ? 1 : 2, 1.3];
      if (a < 0.9) return ['tree_birch', b < 0.65 ? 0 : 1, 1.0];
      return ['tree_pine', 0, 1.0];
    });

    // Shrubs, rocks, and logs.
    pass(1.9, (c, x, z, roll, a, b) => {
      const f = forest(x, z);
      if (c.type === 'snow' || c.type === 'stone') {
        if (roll < 0.1) return ['rock_cluster', 0, 0.9];
        if (roll < 0.16) return ['rock_boulder', 0, 0.8];
        if (roll < 0.18 && c.type === 'stone') return ['rock_spire', 0, 0.7];
        return null;
      }
      if (c.type === 'sand') {
        if (roll < 0.035) return ['rock_boulder', 2, 0.8];
        if (roll < 0.06) return ['rock_cluster', 2, 0.9];
        return null;
      }
      const edge = f > 0.46 && f < 0.6;
      if (roll < (edge ? 0.14 : 0.05)) return ['bush', b < 0.55 ? 0 : b < 0.8 ? 1 : 2, 0.7];
      if (roll < (edge ? 0.17 : 0.07)) return ['rock_boulder', a < 0.6 ? 1 : 0, 0.8];
      if (f > 0.58 && roll < 0.18) return ['stump_log', a < 0.4 ? 0 : a < 0.7 ? 1 : 2, 0.6];
      if (roll < 0.085 + (edge ? 0.06 : 0)) return ['rock_cluster', 1, 0.9];
      return null;
    });

    // Small flora: flowers in meadows, ferns and mushrooms under trees, tall grass.
    pass(1.25, (c, x, z, roll, a, b) => {
      const f = forest(x, z);
      const l = lush(x, z);
      if (c.type === 'snow' || c.type === 'stone') return null;
      if (c.type === 'sand') return roll < 0.05 ? ['tall_grass', a < 0.5 ? 1 : 2, 0.4] : null;
      if (f > 0.56) {
        if (roll < 0.075) return ['ferns', a < 0.75 ? 0 : 1, 0.45];
        if (roll < 0.105) return ['mushrooms', a < 0.5 ? 0 : a < 0.85 ? 1 : 2, 0.3];
      }
      if (c.type === 'meadow' && roll < 0.08 + l * 0.14) return ['flowers', Math.floor(b * 4), 0.45];
      if (c.type === 'grass' && roll < 0.035) return ['flowers', Math.floor(b * 4), 0.45];
      if (roll < 0.06 + (l > 0.55 ? 0.05 : 0)) return ['tall_grass', a < 0.7 ? 0 : 1, 0.4];
      return null;
    });
  }

  // ---- Placement helpers ----------------------------------------------------

  _rim(q, r) {
    return rimY(this.cells.get(hexKey(q, r)).h);
  }

  _isPath(c) {
    return c.type === 'dirt' && PATH_SET.has(hexKey(c.q, c.r));
  }

  // Grid items (floors, walls, roofs, bridges) from a placement transform.
  _addGrid(item, variant, t, ground) {
    return this._push({
      item,
      variant,
      p: [t.x, t.y, t.z],
      rotY: t.rotY,
      scale: 1,
      cell: t.cell,
      edge: t.edge ?? null,
      ground,
    });
  }

  // A freeform item at (x, z), resting on whatever the point is over. Returns the
  // object, or null when the spot is taken, off the island, or too close to a drop.
  _free(item, variant, x, z, radius, opts = {}) {
    const def = getItem(item);
    const h = worldToHex(x, z);
    const k = hexKey(h.q, h.r);
    const c = this.cells.get(k);
    if (!c || this.reserved.has(k)) return null;
    if (this._isPath(c) && !opts.allowPath) return null;
    if (item.startsWith('tree_') && (OPEN_VIEW.has(k) || YARD.has(k))) return null;
    const water = c.type === 'water';
    const float = def?.onWater === 'float';
    if (water && !float) return null;

    // Stay clear of drops, cliffs, and banks.
    const center = hexToWorld(h.q, h.r);
    const px = x - center.x;
    const pz = z - center.z;
    const g = cellGroundY(c);
    const nb = DIRS.map(([dq, dr]) => this.cells.get(hexKey(h.q + dq, h.r + dr)));
    const lower = nb.map((n) => cellGroundY(n) < g - 1e-4);
    for (let i = 0; i < 6; i++) {
      const d = HEX_APOTHEM - (px * EDGE_NORMALS[i].x + pz * EDGE_NORMALS[i].z);
      const n = nb[i];
      let need = 0.06; // Never straddle a cell border.
      if (water) need = n?.type === 'water' && n.h === c.h ? 0.06 : radius * 0.85 + 0.25;
      else if (lower[i]) need = 0.4 + radius * 0.5;
      else if (cellGroundY(n) > g + 1e-4) need = radius * 0.75;
      // A lowered corner rounds off part of this edge too.
      else if (lower[(i + 5) % 6] || lower[(i + 1) % 6]) need = 0.34 + radius * 0.4;
      if (d < need) return null;
    }

    // Keep footprints apart. Small plants may tuck under tree canopies.
    const small = radius < 0.5;
    for (const disc of this.discs) {
      if (opts.ignoreOverlapWith && disc.item === opts.ignoreOverlapWith) continue;
      const min = (radius + (small ? disc.core : disc.r)) * 0.92;
      if ((disc.x - x) ** 2 + (disc.z - z) ** 2 < min * min) return null;
    }

    const y = float ? cellSurfaceY(c) : cellGroundY(c);
    const [s0, s1] = def?.scaleRange ?? [1, 1];
    const scale = opts.scale ?? s0 + (s1 - s0) * this.rng();
    const rotY = opts.rotY ?? (def?.randomRotation ? this.rng() * Math.PI * 2 : 0);
    const tree = item.startsWith('tree_');
    this.discs.push({ x, z, r: radius * Math.max(1, scale), core: tree ? 0.45 : radius, item });
    return this._push({ item, variant, p: [x, y, z], rotY, scale, cell: null, edge: null, ground: k });
  }

  _push(o) {
    let seed;
    do seed = 1 + Math.floor(this.rng() * 0x7ffffffe);
    while (this.seeds.has(seed));
    this.seeds.add(seed);
    const obj = {
      id: this.nextId++,
      item: o.item,
      variant: o.variant,
      p: o.p.map(round3),
      rotY: round3(o.rotY),
      scale: round3(o.scale),
      seed,
      cell: o.cell,
      edge: o.edge,
      ground: o.ground,
    };
    this.objects.push(obj);
    return obj;
  }

  save() {
    const cells = [];
    for (const c of this.cells.values()) cells.push([c.q, c.r, c.h, c.type, c.variant]);
    return { version: SAVE_VERSION, cells, objects: this.objects, meta: { time: 9.5 } };
  }
}

// ---- Helpers ------------------------------------------------------------------

function k2([q, r]) {
  return hexKey(q, r);
}

function round3(v) {
  return Math.round(v * 1000) / 1000;
}

// rotation.y that turns a model's local +X from point a toward point b.
function angleTo([ax, az], [bx, bz]) {
  return -Math.atan2(bz - az, bx - ax);
}

function clampInt(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v | 0));
}

function pickVariant(type, m, rng) {
  const n = TERRAIN[type].variants.length;
  switch (type) {
    case 'grass':
      return m < 0.4 ? 0 : rng() < 0.6 ? 1 : 0;
    case 'meadow':
      return m > 0.66 ? 0 : 1;
    case 'sand':
      return rng() < 0.8 ? 0 : 1;
    case 'stone':
      return rng() < 0.7 ? 0 : 1;
    default:
      return Math.floor(rng() * n) % n;
  }
}
