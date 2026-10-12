// Geometry for water surfaces: subdivided hex patches for raised water cells,
// flat raycast proxies, and the big ocean sheet.
//
// Every water cell classifies its six edges:
//   EDGE_JOIN   same-level water: share the edge exactly, so patches join seamlessly
//   EDGE_WALL   land at the same level or higher: push the edge out a little so
//               it tucks into the cliff wall
//   EDGE_UNDER  higher water: keep the edge exact, since the higher cell's basin
//               is translucent and its waterfall covers the seam
//   EDGE_SPILL  lower or empty neighbor: the water spills over as a waterfall
//
// Corners move with their edges. Where two pushed edges meet, the corner moves
// to the intersection of both offset lines. Where a pushed edge meets an exact
// one, the corner slides along the exact edge, so the neighbor across that
// edge computes the same point and the seam stays closed.

import * as THREE from 'three';
import { HEX_SIZE, SEA_Y } from '../../core/constants.js';
import { hexToWorld, cornerOffset, DIRS, EDGE_NORMALS, key as hexKey } from '../../core/hex.js';

export const SUBDIV = 4; // Edge subdivisions per hex side.
export const EDGE_TUCK = HEX_SIZE * 0.02; // How far a wall-facing edge reaches into the wall.

export const EDGE_JOIN = 0;
export const EDGE_WALL = 1;
export const EDGE_SPILL = 2;
export const EDGE_UNDER = 3;

const SIN60 = Math.sqrt(3) / 2;
const SHORE_REACH = 1.0; // Shore foam distance is clamped to this.
const FLOW_REACH = 1.5; // Flow streaks fade out this far from a spilling edge.


export function edgeKind(world, cell, i) {
  const n = world.getCell(cell.q + DIRS[i][0], cell.r + DIRS[i][1]);
  // Level-0 water merges into the open ocean.
  if (!n) return cell.h > 0 ? EDGE_SPILL : EDGE_JOIN;
  if (n.h < cell.h) return EDGE_SPILL;
  if (n.type !== 'water') return EDGE_WALL;
  return n.h === cell.h ? EDGE_JOIN : EDGE_UNDER;
}

// Per-pass cache of cell edge data, shared by surface and waterfall builders.
export class SurfaceContext {
  constructor(world, mask) {
    this.world = world;
    this.mask = mask;
    this._info = new Map();
    this._tint = new THREE.Color();
  }

  // { center, raw, corners, kinds, candidates } for a water cell. `raw` holds
  // the true hex corners; `corners` are moved to tuck into walls.
  info(cell) {
    const k = hexKey(cell.q, cell.r);
    let g = this._info.get(k);
    if (g) return g;

    const center = hexToWorld(cell.q, cell.r);
    const kinds = [];
    for (let i = 0; i < 6; i++) kinds.push(edgeKind(this.world, cell, i));

    const raw = [];
    for (let i = 0; i < 6; i++) {
      const o = cornerOffset(i);
      raw.push({ x: center.x + o.x, z: center.z + o.z });
    }

    const corners = raw.map((p, i) => {
      const prevWall = kinds[(i + 5) % 6] === EDGE_WALL; // Edge i-1 ends at corner i.
      const nextWall = kinds[i] === EDGE_WALL; // Edge i starts at corner i.
      if (prevWall && nextWall) {
        const s = EDGE_TUCK / SIN60 / HEX_SIZE;
        return { x: p.x + (p.x - center.x) * s, z: p.z + (p.z - center.z) * s };
      }
      if (nextWall) return slide(p, raw[(i + 5) % 6]);
      if (prevWall) return slide(p, raw[(i + 1) % 6]);
      return { x: p.x, z: p.z };
    });

    // Cells whose edges shape this cell's shore and flow: itself plus the
    // same-level water around it.
    const candidates = [cell];
    for (let i = 0; i < 6; i++) {
      if (kinds[i] !== EDGE_JOIN) continue;
      const n = this.world.getCell(cell.q + DIRS[i][0], cell.r + DIRS[i][1]);
      if (n) candidates.push(n);
    }

    g = { center, raw, corners, kinds, candidates };
    this._info.set(k, g);
    return g;
  }

  // Non-joined edges of the local water body, the only edges that shape
  // shore foam and flow for this cell's vertices.
  segments(cell) {
    const g = this.info(cell);
    if (g.segs) return g.segs;
    g.segs = [];
    for (const d of g.candidates) {
      const h = this.info(d);
      for (let i = 0; i < 6; i++) {
        const kind = h.kinds[i];
        if (kind === EDGE_JOIN) continue;
        g.segs.push({ a: h.raw[i], b: h.raw[(i + 1) % 6], n: EDGE_NORMALS[i], spill: kind === EDGE_SPILL });
      }
    }
    return g.segs;
  }

  // Shore distance and flow toward spilling edges at (x, z), for a vertex of
  // `cell`. Depends only on position and the local water body, so vertices
  // shared by two cells get identical values.
  surfaceAttrs(cell, x, z, out) {
    let shore = SHORE_REACH;
    let fx = 0;
    let fz = 0;
    let fs = 0;
    for (const s of this.segments(cell)) {
      const dist = segDist(x, z, s.a, s.b);
      if (!s.spill) {
        if (dist < shore) shore = dist;
      } else if (dist < FLOW_REACH) {
        const t = dist / FLOW_REACH;
        const w = 1 - t * t * (3 - 2 * t);
        fx += s.n.x * w;
        fz += s.n.z * w;
        if (w > fs) fs = w;
      }
    }
    out[0] = fx;
    out[1] = fz;
    out[2] = fs;
    out[3] = shore;
    return out;
  }
}

// Slide corner p away from its neighbor corner `from`, along their shared edge,
// until it reaches the offset line of the other edge at p.
function slide(p, from) {
  const dx = p.x - from.x;
  const dz = p.z - from.z;
  const len = Math.hypot(dx, dz);
  const s = EDGE_TUCK / SIN60 / len;
  return { x: p.x + dx * s, z: p.z + dz * s };
}

export function segDist(x, z, a, b) {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  let t = ((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(x - a.x - abx * t, z - a.z - abz * t);
}

// Barycentric lattice of one hex sector: (n + 1)(n + 2) / 2 points per sector.
const ROW_START = [];
for (let a = 0, s = 0; a <= SUBDIV; a++) {
  ROW_START.push(s);
  s += SUBDIV - a + 1;
}
const PER_SECTOR = ((SUBDIV + 1) * (SUBDIV + 2)) / 2;
export const CELL_VERTS = PER_SECTOR * 6;

// Triangle indices for one cell patch, wound to face up (+Y).
const CELL_INDEX = (() => {
  const out = [];
  for (let i = 0; i < 6; i++) {
    const at = (a, b) => i * PER_SECTOR + ROW_START[a] + b;
    for (let a = 0; a < SUBDIV; a++) {
      for (let b = 0; b < SUBDIV - a; b++) {
        out.push(at(a, b), at(a, b + 1), at(a + 1, b));
        if (a + b + 1 < SUBDIV) out.push(at(a + 1, b), at(a, b + 1), at(a + 1, b + 1));
      }
    }
  }
  return out;
})();

// Vertex data for one water cell's patch: { pos, tint, flow } typed arrays.
// aFlow packs flow x, flow z, flow strength, and shore distance.
export function buildCellSurface(cell, ctx) {
  const n = SUBDIV;
  const pos = new Float32Array(CELL_VERTS * 3);
  const tint = new Float32Array(CELL_VERTS * 3);
  const flow = new Float32Array(CELL_VERTS * 4);
  const attrs = [0, 0, 0, 0];
  const col = ctx._tint;
  const g = ctx.info(cell);
  const y = ctx.world.waterY(cell.q, cell.r);
  const o = g.center;
  let v = 0;
  for (let i = 0; i < 6; i++) {
    const k0 = g.corners[i];
    const k1 = g.corners[(i + 1) % 6];
    for (let a = 0; a <= n; a++) {
      for (let b = 0; b <= n - a; b++) {
        // Points on the outer edge come straight from the corners, so cells
        // sharing that edge compute the same positions.
        let x;
        let z;
        if (a + b === n) {
          x = k0.x + (k1.x - k0.x) * (b / n);
          z = k0.z + (k1.z - k0.z) * (b / n);
        } else {
          x = o.x + (k0.x - o.x) * (a / n) + (k1.x - o.x) * (b / n);
          z = o.z + (k0.z - o.z) * (a / n) + (k1.z - o.z) * (b / n);
        }
        pos[v * 3] = x;
        pos[v * 3 + 1] = y;
        pos[v * 3 + 2] = z;
        ctx.mask.tintAt(x, z, col);
        tint[v * 3] = col.r;
        tint[v * 3 + 1] = col.g;
        tint[v * 3 + 2] = col.b;
        ctx.surfaceAttrs(cell, x, z, attrs);
        flow.set(attrs, v * 4);
        v++;
      }
    }
  }
  return { pos, tint, flow };
}

// Merge cell patches from buildCellSurface into one geometry.
export function mergeSurfaces(parts) {
  const count = parts.length * CELL_VERTS;
  const pos = new Float32Array(count * 3);
  const tint = new Float32Array(count * 3);
  const flow = new Float32Array(count * 4);
  const IndexArray = count > 65535 ? Uint32Array : Uint16Array;
  const index = new IndexArray(parts.length * CELL_INDEX.length);
  parts.forEach((p, c) => {
    pos.set(p.pos, c * CELL_VERTS * 3);
    tint.set(p.tint, c * CELL_VERTS * 3);
    flow.set(p.flow, c * CELL_VERTS * 4);
    const base = c * CELL_VERTS;
    const at = c * CELL_INDEX.length;
    for (let i = 0; i < CELL_INDEX.length; i++) index[at + i] = base + CELL_INDEX[i];
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aTint', new THREE.BufferAttribute(tint, 3));
  geo.setAttribute('aFlow', new THREE.BufferAttribute(flow, 4));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeBoundingSphere();
  return geo;
}

// Subdivided water patches for the given cells, merged into one geometry.
export function buildSurfaceGeometry(cells, ctx) {
  return mergeSurfaces(cells.map((c) => buildCellSurface(c, ctx)));
}

// Flat hexes at each cell's water height, for cheap raycasts.
export function buildProxyGeometry(cells, world) {
  const pos = new Float32Array(cells.length * 7 * 3);
  const index = [];
  let v = 0;
  for (const cell of cells) {
    const c = hexToWorld(cell.q, cell.r);
    const y = world.waterY(cell.q, cell.r);
    const base = v;
    pos.set([c.x, y, c.z], v++ * 3);
    for (let i = 0; i < 6; i++) {
      const o = cornerOffset(i);
      pos.set([c.x + o.x, y, c.z + o.z], v++ * 3);
    }
    for (let i = 0; i < 6; i++) index.push(base, base + 1 + ((i + 1) % 6), base + 1 + i);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(index);
  geo.computeBoundingSphere();
  return geo;
}

// Grid coordinates: even spacing near the island, then growing toward the horizon.
function oceanAxis(inner, step, outer) {
  const out = [0];
  let x = 0;
  let s = step;
  while (x < inner) out.push((x += s));
  while (x < outer) {
    s *= 1.22;
    out.push((x += s));
  }
  return [...out.slice(1).reverse().map((p) => -p), ...out];
}

// One sheet at SEA_Y out past the camera's far plane: a fine core of `step`
// spacing within `inner`, then coarser rings. WaterRenderer keeps it centered
// under the camera, snapped to `step` so the waves don't swim.
export const OCEAN_STEP = 1;
export function buildOceanGeometry({ inner = 64, step = OCEAN_STEP, outer = 950 } = {}) {
  const axis = oceanAxis(inner, step, outer);
  const nx = axis.length;
  const pos = new Float32Array(nx * nx * 3);
  let p = 0;
  for (let j = 0; j < nx; j++) {
    for (let i = 0; i < nx; i++) {
      pos[p++] = axis[i];
      pos[p++] = SEA_Y;
      pos[p++] = axis[j];
    }
  }
  const index = new Uint32Array((nx - 1) * (nx - 1) * 6);
  let t = 0;
  for (let j = 0; j < nx - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      index[t++] = a;
      index[t++] = c;
      index[t++] = b;
      index[t++] = b;
      index[t++] = c;
      index[t++] = d;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeBoundingSphere();
  return geo;
}

// A single flat quad standing in for the ocean in raycasts.
export function buildOceanProxyGeometry(size = 2000) {
  const geo = new THREE.PlaneGeometry(size, size);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, SEA_Y, 0);
  return geo;
}
