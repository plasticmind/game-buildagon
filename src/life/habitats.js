// Habitat analysis: reads the world and lists the places where each kind of
// wildlife can live. Wildlife.js turns these slots into creatures.
//
// What invites whom:
//   frog       lily pads
//   duck       a small pond (raised or enclosed water, up to 12 cells);
//              reeds on its bank bring ducklings
//   swan       a big lake (more than 12 cells)
//   koi        a pond with a bridge, walkway, footbridge, or stepping stones
//   fish       a lake of 4 or more cells, or the water around a rowboat
//   butterfly  two or more flower patches, flower beds, or flowering bushes
//   songbird   a grove of three or more trees
//   gull       a sandy beach of three or more cells on the open sea
//   rabbit     tall grass, bushes, and ferns on grassy ground
//   cat        a house: a door wall plus a roof or ceiling (or three walls)
//
// Rare visitors come and go on their own schedule (see Visitor.js):
//   fairy      three or more glowing mushrooms in a ring, past midnight
//   owl        a grove with three or more pines, at night
//   whale      a long coastline on the open sea, at sunrise or sunset
//   fox        a grove beside rabbit cover, at golden hour
//   bear       a waterfall pouring into a lake of 4 or more cells, at dawn
//   dragon     a campfire on a high stone or snow peak, late at night
//   turtle     a dark, quiet sandy beach (no lights or buildings), at night
//
// A slot is { key, species, x, y, z, ...data }. Keys stay the same while the
// build that created the slot stays put, so creatures keep their identity
// across unrelated edits.

import { DIRS, EDGE_NORMALS, hexToWorld, key as hexKey, worldToHex } from '../core/hex.js';
import { HEX_APOTHEM, SEA_Y } from '../core/constants.js';
import { getItem } from '../catalog/catalog.js';
import { rimY, cellSurfaceY, cellGroundY } from '../world/World.js';

export const SPECIES = [
  'frog', 'duck', 'swan', 'koi', 'fish', 'butterfly', 'songbird', 'gull', 'rabbit', 'cat',
  'fairy', 'owl', 'whale', 'fox', 'bear', 'dragon', 'turtle',
];
export const RARE = new Set(['fairy', 'owl', 'whale', 'fox', 'bear', 'dragon', 'turtle']);

// Most creatures of each kind alive at once, so big worlds stay cheap.
export const CAPS = {
  frog: 12, duck: 9, swan: 4, koi: 12, fish: 6, butterfly: 12, songbird: 10, gull: 5, rabbit: 8, cat: 3,
  fairy: 2, owl: 3, whale: 1, fox: 1, bear: 1, dragon: 1, turtle: 1,
};

const SMALL_POND = 12;
const TREES = new Set(['tree_round', 'tree_pine', 'tree_birch', 'tree_willow']);
const BRIDGES = new Set(['bridge_arch', 'walkway', 'footbridge', 'stepping_stones']);
const COVER = new Set(['tall_grass', 'bush', 'ferns']);
const ROOFS = new Set(['roof_hex', 'roof_cone', 'ceiling_wood']);
const WALLS = new Set(['wall_plain', 'wall_window', 'wall_door']);
const PERCHES = new Set(['fence', 'signpost', 'lantern', 'roof_hex', 'roof_cone', 'well', 'windmill', 'bench']);
const SOFT = new Set(['tall_grass', 'flowers', 'ferns', 'mushrooms', 'lily_pads', 'reeds', 'bush']);

// Footprint radius of solid free items, for ground walkers to steer around.
const SOLID_R = {
  tree_round: 0.4, tree_pine: 0.4, tree_birch: 0.35, tree_willow: 0.45,
  rock_boulder: 0.75, rock_cluster: 0.65, rock_spire: 0.6, stump_log: 0.55,
  flower_bed: 0.65, lantern: 0.25, campfire: 0.6, bench: 0.7, barrels: 0.6,
  well: 0.95, signpost: 0.25, windmill: 1.7,
};

// Footprint radius of things in the water that swimmers avoid.
const FLOAT_R = { boat: 1.3, stepping_stones: 1.15, footbridge: 1.4 };

// ---- Shared world queries --------------------------------------------------------

// What's at a point: land, raised water, or the open sea.
export function surfaceAt(world, x, z) {
  const { q, r } = worldToHex(x, z);
  const cell = world.getCell(q, r) ?? null;
  if (!cell) return { type: 'sea', y: SEA_Y, ground: cellGroundY(null), cell: null, key: hexKey(q, r) };
  const type = cell.type === 'water' ? 'water' : 'land';
  return { type, y: cellSurfaceY(cell), ground: cellGroundY(cell), cell, key: hexKey(q, r) };
}

// Distance from a point to the nearest edge of its cell whose neighbor fails
// `keep(neighborCell)`. Large when every neighbor passes.
export function edgeClearance(world, x, z, keep) {
  const { q, r } = worldToHex(x, z);
  const c = hexToWorld(q, r);
  const px = x - c.x;
  const pz = z - c.z;
  let best = Infinity;
  for (let i = 0; i < 6; i++) {
    const n = world.getCell(q + DIRS[i][0], r + DIRS[i][1]) ?? null;
    if (keep(n)) continue;
    best = Math.min(best, HEX_APOTHEM - (px * EDGE_NORMALS[i].x + pz * EDGE_NORMALS[i].z));
  }
  return best;
}

// Water bodies: connected water cells at the same level. A level-0 body that
// touches the open sea is part of the sea.
export function waterBodies(world) {
  const seen = new Set();
  const bodies = [];
  for (const start of world.cells.values()) {
    if (start.type !== 'water') continue;
    const k0 = hexKey(start.q, start.r);
    if (seen.has(k0)) continue;
    seen.add(k0);
    const body = { cells: [], keys: new Set(), centers: [], h: start.h, sea: false };
    const stack = [start];
    while (stack.length) {
      const c = stack.pop();
      const k = hexKey(c.q, c.r);
      body.cells.push(c);
      body.keys.add(k);
      body.centers.push(hexToWorld(c.q, c.r));
      for (const [dq, dr] of DIRS) {
        const nk = hexKey(c.q + dq, c.r + dr);
        const n = world.cells.get(nk);
        if (!n) {
          if (c.h === 0) body.sea = true;
          continue;
        }
        if (n.type === 'water' && n.h === c.h && !seen.has(nk)) {
          seen.add(nk);
          stack.push(n);
        }
      }
    }
    body.id = [...body.keys].sort()[0];
    body.y = cellSurfaceY(start);
    body.floorY = cellGroundY(start);
    body.x = body.centers.reduce((s, c) => s + c.x, 0) / body.centers.length;
    body.z = body.centers.reduce((s, c) => s + c.z, 0) / body.centers.length;
    bodies.push(body);
  }
  return bodies;
}

// Is (x, z) inside the body, at least `margin` from its banks?
export function inBody(world, body, x, z, margin = 0) {
  const { q, r } = worldToHex(x, z);
  if (!body.keys.has(hexKey(q, r))) return false;
  if (margin <= 0) return true;
  return edgeClearance(world, x, z, (n) => n && body.keys.has(hexKey(n.q, n.r))) >= margin;
}

// Single-linkage groups of objects within `radius` of each other, each sorted
// by id so the first object names the group. A grid keeps it near linear.
function cluster(list, radius) {
  const r2 = radius * radius;
  const cellOf = (o) => `${Math.floor(o.x / radius)}:${Math.floor(o.z / radius)}`;
  const grid = new Map();
  for (const o of list) {
    const k = cellOf(o);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(o);
  }
  const seen = new Set();
  const groups = [];
  for (const o of list) {
    if (seen.has(o)) continue;
    seen.add(o);
    const g = [o];
    for (let i = 0; i < g.length; i++) {
      const a = g[i];
      const gx = Math.floor(a.x / radius);
      const gz = Math.floor(a.z / radius);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (const b of grid.get(`${gx + dx}:${gz + dz}`) ?? []) {
            if (!seen.has(b) && (a.x - b.x) ** 2 + (a.z - b.z) ** 2 <= r2) {
              seen.add(b);
              g.push(b);
            }
          }
        }
      }
    }
    g.sort((a, b) => a.id - b.id);
    groups.push(g);
  }
  return groups.sort((a, b) => a[0].id - b[0].id);
}

// Bounding box of a group, grown by `pad`, for quick nearby filtering.
function bounds(list, pad) {
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const o of list) {
    x0 = Math.min(x0, o.x);
    x1 = Math.max(x1, o.x);
    z0 = Math.min(z0, o.z);
    z1 = Math.max(z1, o.z);
  }
  return (o) => o.x >= x0 - pad && o.x <= x1 + pad && o.z >= z0 - pad && o.z <= z1 + pad;
}

const near = (a, b, d) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2 <= d * d;

// ---- Analysis --------------------------------------------------------------------

// Returns { slots: Map<species, slot[]>, bodies }.
export function analyzeHabitats(world, objects) {
  const byItem = new Map();
  const all = [];
  for (const o of world.objects.values()) {
    if (!byItem.has(o.item)) byItem.set(o.item, []);
    byItem.get(o.item).push(o);
    all.push(o);
  }
  const items = (...ids) => ids.flatMap((id) => byItem.get(id) ?? []);
  // Top of an object's model, in world units.
  const topOf = (o, fallback = 0.5) => o.y + (objects?.boundsOf(o.id)?.max.y ?? fallback) * o.scale;
  const at = (o) => surfaceAt(world, o.x, o.z);

  const bodies = waterBodies(world);
  const bodyOf = new Map();
  for (const b of bodies) for (const k of b.keys) bodyOf.set(k, b);

  const slots = new Map(SPECIES.map((s) => [s, []]));
  const add = (species, slot) => slots.get(species).push({ species, ...slot });

  // Things in the water that swimmers steer around.
  const floating = all.filter((o) => FLOAT_R[o.item] && at(o).type !== 'land');
  const walkways = items('walkway').map((o) => ({ x: o.x, z: o.z, r: HEX_APOTHEM * 0.95 }));
  const floatObstacles = floating.map((o) => ({ x: o.x, z: o.z, r: FLOAT_R[o.item] * o.scale })).concat(walkways);

  const bodySlot = (b) => {
    const around = bounds(b.centers, HEX_APOTHEM * 2 + 2);
    return {
      id: b.id,
      keys: b.keys,
      centers: b.centers,
      y: b.y,
      floorY: b.floorY,
      obstacles: floatObstacles.filter((o) => around(o) && b.centers.some((c) => near(c, o, HEX_APOTHEM * 2 + o.r))),
    };
  };

  // ---- Frogs: lily pads ----
  const pads = items('lily_pads').filter((o) => at(o).type !== 'land');
  for (const g of cluster(pads, 4.5)) {
    const n = Math.min(4, Math.max(1, Math.round(g.length * 0.6)));
    const padList = g.map((o) => ({ id: o.id, x: o.x, y: o.y + 0.045 * o.scale, z: o.z }));
    for (let i = 0; i < n; i++) {
      const p = padList[i];
      add('frog', { key: `frog:${p.id}`, x: p.x, y: p.y, z: p.z, pads: padList });
    }
  }

  // ---- Ducks, swans, koi, and fish: ponds and lakes ----
  const reeds = items('reeds');
  const bridges = items(...BRIDGES);
  for (const b of bodies) {
    if (b.sea) continue;
    const n = b.cells.length;
    const around = bounds(b.centers, HEX_APOTHEM * 2.2);
    const shared = bodySlot(b);
    // Reeds count when they stand on the body's bank or in it.
    const bankReeds = reeds.filter((o) => around(o) && b.centers.some((c) => near(c, o, HEX_APOTHEM * 2.1)));
    const spawn = b.centers[0];
    if (n <= SMALL_POND) {
      const ducks = n <= 2 ? 1 : n <= 6 ? 2 : 3;
      for (let i = 0; i < ducks; i++) {
        add('duck', {
          key: `duck:${b.id}:${i}`,
          x: spawn.x, y: b.y, z: spawn.z,
          body: shared,
          ducklings: i === 0 && bankReeds.length ? 3 : 0,
          reeds: bankReeds.map((o) => ({ x: o.x, z: o.z })),
          hen: i === 0 && bankReeds.length > 0,
        });
      }
    } else {
      for (let i = 0; i < 2; i++) add('swan', { key: `swan:${b.id}:${i}`, x: spawn.x, y: b.y, z: spawn.z, body: shared });
    }
    const bridged = bridges.some((o) => around(o) && b.centers.some((c) => near(c, o, HEX_APOTHEM + 0.8)));
    if (bridged) {
      const koi = Math.max(2, Math.min(5, n));
      for (let i = 0; i < koi; i++) add('koi', { key: `koi:${b.id}:${i}`, x: spawn.x, y: b.y, z: spawn.z, body: shared });
    }
    if (n >= 4) add('fish', { key: `fish:${b.id}`, x: b.x, y: b.y, z: b.z, body: shared, ring: null });
  }
  for (const o of items('boat')) {
    if (at(o).type === 'land') continue;
    add('fish', { key: `fish:boat:${o.id}`, x: o.x, y: o.y, z: o.z, body: null, ring: { x: o.x, z: o.z, r0: 1.6 * o.scale, r1: 5 } });
  }

  // ---- Butterflies: flowers ----
  const flowerish = all.filter(
    (o) => (o.item === 'flowers' || o.item === 'flower_bed' || (o.item === 'bush' && o.variant === 2)) && at(o).type === 'land',
  );
  for (const g of cluster(flowerish, 5)) {
    if (g.length < 2) continue;
    const n = Math.min(4, Math.ceil(g.length / 2));
    const flowers = g.map((o) => ({ x: o.x, y: topOf(o, 0.4) - 0.04, z: o.z, r: 0.25 * o.scale }));
    for (let i = 0; i < n; i++) {
      const f = flowers[i % flowers.length];
      add('butterfly', { key: `butterfly:${g[0].id}:${i}`, x: f.x, y: f.y, z: f.z, flowers });
    }
  }

  // ---- Songbirds: groves ----
  const trees = items(...TREES).filter((o) => at(o).type === 'land');
  const perchProps = all.filter((o) => PERCHES.has(o.item) && !(o.item === 'lantern' && o.variant === 2));
  for (const g of cluster(trees, 7)) {
    if (g.length < 3) continue;
    const n = Math.min(3, Math.floor(g.length / 3));
    const perches = g.map((o) => ({ x: o.x, y: topOf(o, 3) - 0.08, z: o.z, tree: true }));
    const around = bounds(g, 8);
    for (const p of perchProps) {
      if (around(p) && g.some((t) => near(t, p, 8))) perches.push({ x: p.x, y: topOf(p, 1), z: p.z, tree: false });
    }
    const trunks = g.map((o) => ({ x: o.x, z: o.z, y: o.y }));
    for (let i = 0; i < n; i++) {
      const p = perches[i];
      add('songbird', { key: `songbird:${g[0].id}:${i}`, x: p.x, y: p.y, z: p.z, perches, trunks });
    }
  }

  // ---- Gulls: sandy beaches on the open sea ----
  const beach = [];
  for (const c of world.cells.values()) {
    if (c.type !== 'sand') continue;
    let seaward = null;
    for (const [dq, dr] of DIRS) {
      if (world.getCell(c.q + dq, c.r + dr)) continue;
      const w = hexToWorld(c.q, c.r);
      const n = hexToWorld(c.q + dq, c.r + dr);
      seaward = seaward ?? { x: 0, z: 0 };
      seaward.x += n.x - w.x;
      seaward.z += n.z - w.z;
    }
    if (!seaward) continue;
    const w = hexToWorld(c.q, c.r);
    beach.push({ id: hexKey(c.q, c.r), x: w.x, z: w.z, y: rimY(c.h), seaward, q: c.q, r: c.r });
  }
  const beachGroups = cluster(
    beach.map((b, i) => ({ ...b, id: i })),
    HEX_APOTHEM * 2.2,
  );
  const perchesAtSea = all
    .filter((o) => (o.item === 'boat' || o.item === 'stepping_stones' || o.item === 'walkway') && at(o).type !== 'land')
    .map((o) => ({ x: o.x, y: o.item === 'boat' ? o.y + 0.3 * o.scale : topOf(o, 0.1), z: o.z }));
  for (const g of beachGroups) {
    if (g.length < 3) continue;
    const n = Math.min(3, Math.floor(g.length / 3));
    let sx = 0;
    let sz = 0;
    for (const b of g) {
      sx += b.seaward.x;
      sz += b.seaward.z;
    }
    const len = Math.hypot(sx, sz) || 1;
    const cx = g.reduce((s, b) => s + b.x, 0) / g.length;
    const cz = g.reduce((s, b) => s + b.z, 0) / g.length;
    const spots = g.map((b) => ({ x: b.x, y: b.y, z: b.z, cell: true }));
    for (const p of perchesAtSea) if (near({ x: cx, z: cz }, p, 18)) spots.push({ ...p, cell: false });
    const name = beach[g[0].id].id;
    for (let i = 0; i < n; i++) {
      add('gull', {
        key: `gull:${name}:${i}`,
        x: cx, y: SEA_Y + 7, z: cz,
        spots,
        sea: { x: sx / len, z: sz / len },
      });
    }
  }

  // ---- Rabbits: cover on grassy ground ----
  const cover = all.filter((o) => COVER.has(o.item) && at(o).cell && ['grass', 'meadow'].includes(at(o).cell.type));
  for (const g of cluster(cover, 6)) {
    if (g.length < 3) continue;
    const n = Math.min(3, Math.floor(g.length / 3));
    const spots = g.map((o) => ({ x: o.x, y: o.y, z: o.z, r: 0.35 * o.scale }));
    for (let i = 0; i < n; i++) {
      const c = spots[i];
      add('rabbit', { key: `rabbit:${g[0].id}:${i}`, x: c.x, y: c.y, z: c.z, cover: spots });
    }
  }

  // ---- Cats: houses ----
  const doors = items('wall_door').sort((a, b) => a.id - b.id);
  for (const d of doors) {
    const inside = d.cell ? world.getCellByKey(d.cell) : null;
    if (!inside || inside.type === 'water' || Math.abs(d.y - rimY(inside.h)) > 0.3) continue;
    const inCell = [...world.objectsInCell(d.cell)];
    const roofed = inCell.some((o) => ROOFS.has(o.item));
    const walls = inCell.filter((o) => WALLS.has(o.item) && Math.abs(o.y - d.y) < 0.3).length;
    if (!roofed && walls < 3) continue;
    // Local +Z of an edge item faces the cell interior.
    const ix = Math.sin(d.rotY);
    const iz = Math.cos(d.rotY);
    const step = { x: d.x - ix * 0.75, z: d.z - iz * 0.75 };
    const outside = surfaceAt(world, step.x, step.z);
    if (outside.type !== 'land' || Math.abs(outside.y - d.y) > 0.65) continue;
    step.y = outside.y;
    const spots = [{ ...step, face: Math.atan2(-ix, -iz), kind: 'step' }];
    for (const o of all) {
      if (!near(o, step, 9)) continue;
      const it = o.item;
      if (it !== 'bench' && it !== 'campfire' && it !== 'flower_bed' && it !== 'well' && it !== 'lantern') continue;
      const fx = Math.sin(o.rotY);
      const fz = Math.cos(o.rotY);
      const off = it === 'bench' ? 0.75 : it === 'campfire' ? 1.1 : it === 'well' ? 1.2 : 0.6;
      // Benches face local +Z; sit in front. Others: the side toward the door.
      let dx = fx;
      let dz = fz;
      if (it !== 'bench') {
        const l = Math.hypot(step.x - o.x, step.z - o.z) || 1;
        dx = (step.x - o.x) / l;
        dz = (step.z - o.z) / l;
      }
      const p = { x: o.x + dx * off * o.scale, z: o.z + dz * off * o.scale };
      const s = surfaceAt(world, p.x, p.z);
      if (s.type !== 'land' || Math.abs(s.y - step.y) > 0.05) continue;
      spots.push({ x: p.x, y: s.y, z: p.z, face: Math.atan2(o.x - p.x, o.z - p.z), kind: it });
    }
    add('cat', {
      key: `cat:${d.id}`,
      x: step.x, y: step.y, z: step.z,
      door: { x: d.x, y: d.y, z: d.z, ix, iz },
      spots,
    });
  }

  // ---- Rare visitors ----

  // Fairy: a ring of glowing mushrooms.
  const glowing = items('mushrooms').filter((o) => o.variant === 2 && at(o).type === 'land');
  for (const g of cluster(glowing, 3)) {
    if (g.length < 3) continue;
    const caps = g.map((o) => ({ x: o.x, y: topOf(o, 0.3), z: o.z }));
    const cx = caps.reduce((t, c) => t + c.x, 0) / caps.length;
    const cz = caps.reduce((t, c) => t + c.z, 0) / caps.length;
    add('fairy', { key: `fairy:${g[0].id}`, x: cx, y: g[0].y, z: cz, caps });
  }

  // Owl: a grove with three or more pines.
  for (const g of cluster(trees, 7)) {
    const pines = g.filter((o) => o.item === 'tree_pine');
    if (pines.length < 3) continue;
    const perches = pines.map((o) => ({ x: o.x, y: topOf(o, 3.5) - 0.1, z: o.z }));
    add('owl', { key: `owl:${pines[0].id}`, x: perches[0].x, y: perches[0].y, z: perches[0].z, perches });
  }

  // Whale: a long coastline on the open sea.
  let coast = 0;
  let lx = 0;
  let lz = 0;
  let land = 0;
  let reach = 0;
  for (const c of world.cells.values()) {
    const w = hexToWorld(c.q, c.r);
    lx += w.x;
    lz += w.z;
    land++;
    if (DIRS.some(([dq, dr]) => !world.getCell(c.q + dq, c.r + dr))) coast++;
  }
  if (coast >= 12) {
    lx /= land;
    lz /= land;
    for (const c of world.cells.values()) {
      const w = hexToWorld(c.q, c.r);
      reach = Math.max(reach, Math.hypot(w.x - lx, w.z - lz));
    }
    add('whale', { key: 'whale', x: lx, y: SEA_Y, z: lz, reach });
  }

  // Fox: a grove next to rabbit cover.
  const coverGroups = cluster(
    all.filter((o) => COVER.has(o.item) && at(o).type === 'land'),
    6,
  ).filter((g) => g.length >= 3);
  const campfires = items('campfire');
  for (const g of cluster(trees, 7)) {
    if (g.length < 3) continue;
    const near12 = bounds(g, 12);
    const meadow = coverGroups.find((cg) => cg.some((o) => near12(o) && g.some((t) => near(t, o, 12))));
    if (!meadow) continue;
    const fire = campfires.find((f) => g.some((t) => near(t, f, 14)) || meadow.some((o) => near(o, f, 14)));
    // Groves chain across a whole island, so the fox only uses the trees at the
    // meadow's edge (or the closest few).
    const gap = (t) => Math.min(...meadow.map((o) => Math.hypot(t.x - o.x, t.z - o.z)));
    const byGap = [...g].sort((a, b) => gap(a) - gap(b));
    const edge = byGap.filter((t) => gap(t) <= 9);
    const trunks = (edge.length >= 2 ? edge : byGap.slice(0, 3)).map((o) => ({ x: o.x, y: o.y, z: o.z }));
    add('fox', {
      key: `fox:${g[0].id}`,
      x: trunks[0].x, y: trunks[0].y, z: trunks[0].z,
      trunks,
      cover: meadow.map((o) => ({ x: o.x, y: o.y, z: o.z })),
      fire: fire ? { x: fire.x, y: fire.y, z: fire.z } : null,
    });
  }

  // Bear: the foot of a waterfall that pours into a lake with fish.
  for (const b of bodies) {
    if (b.sea || b.cells.length < 4) continue;
    let falls = null;
    for (const c of b.cells) {
      for (let i = 0; i < 6 && !falls; i++) {
        const n = world.getCell(c.q + DIRS[i][0], c.r + DIRS[i][1]);
        if (!n || n.type !== 'water' || n.h <= c.h) continue;
        // A bank at the lake's own level to wade in from.
        let bank = null;
        for (let j = 0; j < 6 && !bank; j++) {
          const l = world.getCell(c.q + DIRS[j][0], c.r + DIRS[j][1]);
          if (l && l.type !== 'water' && l.h === c.h) bank = { l, j };
        }
        if (!bank) continue;
        const w = hexToWorld(c.q, c.r);
        const fx = w.x + EDGE_NORMALS[i].x * (HEX_APOTHEM - 0.8);
        const fz = w.z + EDGE_NORMALS[i].z * (HEX_APOTHEM - 0.8);
        const bw = hexToWorld(bank.l.q, bank.l.r);
        falls = {
          x: fx, y: cellGroundY(c), z: fz,
          face: Math.atan2(EDGE_NORMALS[i].x, EDGE_NORMALS[i].z),
          surface: cellSurfaceY(c),
          bank: { x: bw.x, y: rimY(bank.l.h), z: bw.z },
          edge: { x: w.x + EDGE_NORMALS[bank.j].x * HEX_APOTHEM, z: w.z + EDGE_NORMALS[bank.j].z * HEX_APOTHEM },
        };
      }
      if (falls) break;
    }
    if (falls) add('bear', { key: `bear:${b.id}`, x: falls.x, y: falls.y, z: falls.z, falls });
  }

  // Dragon: a campfire on a high stone or snow peak.
  for (const f of campfires) {
    const c = at(f).cell;
    if (!c || !['stone', 'snow'].includes(c.type) || c.h < 5) continue;
    add('dragon', { key: `dragon:${f.id}`, x: f.x, y: f.y, z: f.z, fire: { x: f.x, y: f.y, z: f.z } });
  }

  // Turtles: a dark, quiet beach with no lights or buildings nearby.
  const noisy = all.filter((o) => {
    const pl = getItem(o.item)?.placement;
    return pl === 'edge' || pl === 'cell' || o.item === 'lantern' || o.item === 'campfire' || o.item === 'windmill';
  });
  for (const g of beachGroups) {
    if (g.length < 3) continue;
    if (noisy.some((o) => g.some((b) => near(b, o, 8)))) continue;
    let sx = 0;
    let sz = 0;
    for (const b of g) {
      sx += b.seaward.x;
      sz += b.seaward.z;
    }
    const len = Math.hypot(sx, sz) || 1;
    // Nest on the most seaward cell, a little way back from the water.
    const nest = g.reduce((best, b) => (b.seaward.x * sx + b.seaward.z * sz > best.seaward.x * sx + best.seaward.z * sz ? b : best), g[0]);
    add('turtle', {
      key: `turtle:${beach[g[0].id].id}`,
      x: nest.x - (sx / len) * 0.6, y: nest.y, z: nest.z - (sz / len) * 0.6,
      sea: { x: sx / len, z: sz / len },
    });
  }

  // Ground obstacles near walkers, for path checks.
  const solids = all
    .filter((o) => SOLID_R[o.item] && !SOFT.has(o.item))
    .map((o) => ({ x: o.x, z: o.z, r: SOLID_R[o.item] * o.scale }));
  for (const species of ['rabbit', 'cat', 'songbird', 'fox']) {
    for (const s of slots.get(species)) s.solids = solids.filter((o) => near(o, s, 16));
  }

  for (const [species, list] of slots) {
    if (list.length > CAPS[species]) list.length = CAPS[species];
  }
  return { slots, bodies };
}
