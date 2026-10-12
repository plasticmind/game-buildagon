// Terrain renderer: chunked hex columns with blended tops, soft lips, and banded cliffs.
//
// Each chunk (CHUNK_SIZE × CHUNK_SIZE axial cells) is one merged, vertex-colored mesh.
// A cell top is a center vertex, an inner ring in the cell's own color, a bevel ring,
// and an outer ring of 6 corners plus 6 edge midpoints. Outer vertices blend their
// color with every same-height cell that shares them, so terrain types melt into each
// other instead of meeting at hard hex borders. Outer vertices also jitter by a hash
// of their world position, so every cell that owns a vertex moves it the same way
// and the grid stays watertight. Where a neighbor is lower, the outer ring drops a
// little to form a rounded lip, and walls follow the same vertices down.
//
// Walls follow the "Terrain and water geometry rules" in docs/ARCHITECTURE.md.

import * as THREE from 'three';
import { DIRS, hexToWorld, cornerOffset, edgeMidOffset, hash2, key as hexKey, mod6, chunkKey, parseKey } from '../core/hex.js';
import {
  LEVEL_H,
  BASE_Y,
  WATER_DROP,
  BASIN_DEPTH,
  CHUNK_SIZE,
  TERRAIN,
  GRASSY_TYPES,
} from '../core/constants.js';
import { toon } from '../render/materials.js';
import { LAYERS } from '../render/shared.js';
import { popScale, springValue, shrinkScale } from '../fx/spring.js';
import { smoothstep } from '../core/math.js';
import { cellGroundY, cellSurfaceY } from './World.js';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';

// Face tag slot for top faces; slots 0-5 are the wall on that edge.
const TOP_SLOT = 6;
const REBUILD_BUDGET_MS = 3; // Chunk rebuild time per frame after edits.

// Chunk raycasts go through a bounding volume hierarchy, built on the first ray
// after each rebuild. `indirect` keeps triangle order, so face tags still line up.
function bvhRaycast(raycaster, intersects) {
  const geo = this.geometry;
  if (!geo.boundsTree) geo.boundsTree = new MeshBVH(geo, { indirect: true });
  acceleratedRaycast.call(this, raycaster, intersects);
}

const EPS = 1e-4;
const CORNER_JITTER = 0.11; // Max X/Z jitter of shared hex corners.
const MID_JITTER = 0.09; // Max X/Z jitter of shared edge midpoints.
const LIP_DROP = 0.1; // How far a top edge rolls down toward a lower neighbor.
const BEVEL = 0.88; // Bevel ring, as a fraction of the center-to-outer distance.
const INNER = 0.5; // Inner ring (pure cell color), same units.
const INNER_WOBBLE = 0.08; // Random variation of the inner ring fraction.
const GRASS_LIP = [0.12, 0.24]; // Depth range of the grassy lip band on walls.
const POP_RISE = 2 * LEVEL_H; // How far below its rim a brand-new column rises from.

const CORNERS = Array.from({ length: 6 }, (_, i) => cornerOffset(i));
const MIDS = Array.from({ length: 6 }, (_, i) => edgeMidOffset(i));

// Linear-space colors per terrain type and variant.
const PAL = {};
for (const [type, def] of Object.entries(TERRAIN)) {
  PAL[type] = def.variants.map((v) => ({
    top: rgb(v.top),
    side: rgb(v.side),
  }));
}

function rgb(hex) {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Ground height of a raw cell: rim for land, basin floor for water.
// Cached per-build facts about a cell.
function makeInfo(c, floor) {
  const pal = PAL[c.type]?.[c.variant] ?? PAL[c.type]?.[0] ?? PAL.grass[0];
  const { x, z } = hexToWorld(c.q, c.r);
  const g = cellGroundY(c);
  // A small per-cell brightness shift keeps large fields from looking flat.
  const k = 1 + (hash2(x, z, 3) - 0.5) * 0.06;
  return {
    cell: c,
    h: c.h,
    g,
    floor: Math.min(g, floor ?? g), // Lowest ground while a pop animation runs.
    water: c.type === 'water',
    grassy: GRASSY_TYPES.has(c.type),
    top: [pal.top[0] * k, pal.top[1] * k, pal.top[2] * k],
    side: pal.side,
    x,
    z,
  };
}

const groundOf = (n) => (n ? n.g : BASE_Y);

// Top height of cell `a` at a corner it shares with `b` and `c` (either may be null).
function cornerY(a, b, c) {
  if (a.water) return a.g;
  const lim = a.g - EPS;
  return groundOf(b) < lim || groundOf(c) < lim ? a.g - LIP_DROP : a.g;
}

// Top height of cell `a` at the midpoint of the edge it shares with `b`.
function midY(a, b) {
  if (a.water) return a.g;
  return groundOf(b) < a.g - EPS ? a.g - LIP_DROP : a.g;
}

// Wall bottom under a neighbor vertex: its top there, or lower while it pops.
function bottomAt(n, y) {
  return n ? Math.min(y, n.floor) : BASE_Y;
}

// Blend a vertex color from every same-height cell that shares the vertex.
function blendColor(out, a, b, c) {
  out[0] = a.top[0];
  out[1] = a.top[1];
  out[2] = a.top[2];
  let n = 1;
  if (b && Math.abs(b.g - a.g) < EPS) n += addColor(out, b.top);
  if (c && Math.abs(c.g - a.g) < EPS) n += addColor(out, c.top);
  out[0] /= n;
  out[1] /= n;
  out[2] /= n;
  return out;
}

function addColor(out, c) {
  out[0] += c[0];
  out[1] += c[1];
  out[2] += c[2];
  return 1;
}

// Strata shading: alternate bands per level, and darken toward the seabed.
function stripe(k) {
  return ((k % 2) + 2) % 2 === 0 ? 1.035 : 0.955;
}

function depthShade(y) {
  return 0.66 + 0.34 * smoothstep(BASE_Y, 1.2, y);
}

// Growable vertex buffer for one merged mesh.
class MeshBuilder {
  constructor(ox = 0, oz = 0) {
    this.ox = ox;
    this.oz = oz;
    this.pos = [];
    this.nor = [];
    this.col = [];
    this.idx = [];
    this.faces = []; // Per triangle: cellIndex * 8 + slot (0-5 wall edge, 6 top).
    this.count = 0;
  }

  vert(x, y, z, nx, ny, nz, r, g, b) {
    this.pos.push(x - this.ox, y, z - this.oz);
    this.nor.push(nx, ny, nz);
    this.col.push(r, g, b);
    return this.count++;
  }

  tri(a, b, c, face) {
    this.idx.push(a, b, c);
    this.faces.push(face);
  }

  // A triangle with its own vertices and a face normal, for sloped facets.
  flatTri(p0, p1, p2, face) {
    const ux = p1.x - p0.x;
    const uy = p1.y - p0.y;
    const uz = p1.z - p0.z;
    const vx = p2.x - p0.x;
    const vy = p2.y - p0.y;
    const vz = p2.z - p0.z;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    const a = this.vert(p0.x, p0.y, p0.z, nx, ny, nz, p0.c[0], p0.c[1], p0.c[2]);
    const b = this.vert(p1.x, p1.y, p1.z, nx, ny, nz, p1.c[0], p1.c[1], p1.c[2]);
    const c = this.vert(p2.x, p2.y, p2.z, nx, ny, nz, p2.c[0], p2.c[1], p2.c[2]);
    this.tri(a, b, c, face);
  }

  toGeometry() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    geo.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    return geo;
  }
}

// Scratch buffers reused by every cell build.
const ring = Array.from({ length: 12 }, () => ({ x: 0, z: 0, y: 0, c: [0, 0, 0] }));
const bevel = Array.from({ length: 12 }, () => ({ x: 0, z: 0, y: 0, c: null }));
const nb = new Array(6);
const nbY = Array.from({ length: 6 }, () => [0, 0, 0]); // Neighbor top at corner i, mid i, corner i+1.

export class TerrainRenderer {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    scene.add(this.group);

    this.material = toon({ vertexColors: true });
    this.chunks = new Map(); // chunk key → Mesh
    this.dirty = new Set(); // chunk keys to rebuild
    this.pops = new Map(); // cell key → in-flight pop animation
    this._cut = null; // Extra wall cut height while building a pop mesh.

    world.on('cell', (e, opts) => this._onCell(e, opts ?? {}));
    world.on('reset', () => this._rebuildAll());
    this._rebuildAll();
  }

  // ---- Public API --------------------------------------------------------

  update(dt) {
    for (const [k, pop] of this.pops) {
      pop.t += dt;
      if (pop.dirty) this._buildPopGeometry(pop);
      if (this._animatePop(pop)) {
        this._removePop(k);
        this._markAround(pop.q, pop.r);
      }
    }
    // Rebuild edited chunks within a frame budget, so a paint stroke spreads
    // its rebuilds over frames instead of stalling one.
    const start = performance.now();
    for (const ck of this.dirty) {
      this._buildChunk(ck);
      this.dirty.delete(ck);
      if (performance.now() - start > REBUILD_BUDGET_MS) break;
    }
  }

  // True while a placement pop is moving terrain that raycasts can hit.
  get isAnimating() {
    return this.pops.size > 0;
  }

  getRaycastTargets() {
    const out = [...this.chunks.values()];
    for (const pop of this.pops.values()) if (pop.mesh) out.push(pop.mesh);
    return out;
  }

  // Map a raycast hit on a terrain mesh to its cell. For a wall, `edge` is the
  // edge it faces; for a top, `top` is true and `edge` is null.
  cellFromHit(hit) {
    const ud = hit?.object?.userData;
    if (!ud?.faces || hit.faceIndex == null) return null;
    const v = ud.faces[hit.faceIndex];
    if (v === undefined) return null;
    const c = ud.cells[v >> 3];
    const slot = v & 7;
    return { q: c.q, r: c.r, key: hexKey(c.q, c.r), top: slot === TOP_SLOT, edge: slot < 6 ? slot : null };
  }

  dispose() {
    for (const k of [...this.pops.keys()]) this._removePop(k);
    for (const mesh of this.chunks.values()) {
      mesh.geometry.dispose();
      this.group.remove(mesh);
    }
    this.chunks.clear();
    this.scene.remove(this.group);
    this.material.dispose();
  }

  // ---- Events ------------------------------------------------------------

  _onCell({ q, r, key, cell, prev }, opts) {
    // Popping neighbors need fresh walls and blending.
    for (const [dq, dr] of DIRS) {
      const pop = this.pops.get(hexKey(q + dq, r + dr));
      if (pop) pop.dirty = true;
    }
    if (this.pops.has(key)) this._removePop(key);
    if (opts.animate) this._startPop(q, r, key, cell, prev);
    this._markAround(q, r);
  }

  _rebuildAll() {
    for (const k of [...this.pops.keys()]) this._removePop(k);
    for (const mesh of this.chunks.values()) {
      mesh.geometry.dispose();
      this.group.remove(mesh);
    }
    this.chunks.clear();
    this.dirty.clear();
    for (const c of this.world.cells.values()) this.dirty.add(chunkKey(c.q, c.r));
    for (const ck of this.dirty) this._buildChunk(ck);
    this.dirty.clear();
  }

  _markAround(q, r) {
    this.dirty.add(chunkKey(q, r));
    for (const [dq, dr] of DIRS) this.dirty.add(chunkKey(q + dq, r + dr));
  }

  // ---- Chunks ------------------------------------------------------------

  _buildChunk(ck) {
    const [cq, cr] = parseKey(ck);
    const b = new MeshBuilder();
    const cache = new Map();
    const cells = [];
    for (let q = cq * CHUNK_SIZE; q < (cq + 1) * CHUNK_SIZE; q++) {
      for (let r = cr * CHUNK_SIZE; r < (cr + 1) * CHUNK_SIZE; r++) {
        const k = hexKey(q, r);
        const cell = this.world.cells.get(k);
        if (!cell || this.pops.has(k)) continue;
        this._emitCell(b, this._info(q, r, cache), cache, cells.length);
        cells.push(cell);
      }
    }

    const old = this.chunks.get(ck);
    if (!b.idx.length) {
      if (old) {
        old.geometry.dispose();
        this.group.remove(old);
        this.chunks.delete(ck);
      }
      return;
    }
    const geo = b.toGeometry();
    let mesh = old;
    if (mesh) {
      mesh.geometry.dispose();
      mesh.geometry = geo;
    } else {
      mesh = this._makeMesh(geo);
      mesh.name = `terrain:${ck}`;
      this.chunks.set(ck, mesh);
      this.group.add(mesh);
    }
    mesh.userData.cells = cells;
    mesh.userData.faces = Int32Array.from(b.faces);
  }

  _makeMesh(geo) {
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.raycast = bvhRaycast;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.layers.set(LAYERS.WORLD);
    mesh.layers.enable(LAYERS.DEPTH);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    return mesh;
  }

  // Per-build cell facts, with pop floors applied so neighbor walls stay closed.
  _info(q, r, cache) {
    const k = hexKey(q, r);
    let v = cache.get(k);
    if (v !== undefined) return v;
    const c = this.world.cells.get(k);
    v = c ? makeInfo(c, this.pops.get(k)?.floor) : null;
    cache.set(k, v);
    return v;
  }

  // ---- Cell geometry -----------------------------------------------------

  // Append one cell column (top, lip, walls) to the builder. `skirt`, when set,
  // extends every wall down to that height so a squashed pop column stays closed.
  _emitCell(b, X, cache, cellIndex, skirt = null) {
    const { q, r } = X.cell;
    const cx = X.x;
    const cz = X.z;
    for (let i = 0; i < 6; i++) nb[i] = this._info(q + DIRS[i][0], r + DIRS[i][1], cache);

    // Outer ring: corner i at index 2i, edge midpoint i at index 2i + 1.
    for (let i = 0; i < 6; i++) {
      const a = nb[mod6(i - 1)];
      const n = nb[i];
      const nn = nb[mod6(i + 1)];

      // Corner i, shared with neighbors i - 1 and i.
      const co = ring[2 * i];
      let bx = cx + CORNERS[i].x;
      let bz = cz + CORNERS[i].z;
      const cj = X.water || a?.water || n?.water ? 0 : CORNER_JITTER;
      co.x = bx + (hash2(bx, bz, 1) - 0.5) * 2 * cj;
      co.z = bz + (hash2(bx, bz, 2) - 0.5) * 2 * cj;
      co.y = cornerY(X, a, n);
      blendColor(co.c, X, a, n);
      tint(co.c, bx, bz);

      // Midpoint of edge i, shared with neighbor i.
      const mo = ring[2 * i + 1];
      bx = cx + MIDS[i].x;
      bz = cz + MIDS[i].z;
      const mj = X.water || n?.water ? 0 : MID_JITTER;
      mo.x = bx + (hash2(bx, bz, 1) - 0.5) * 2 * mj;
      mo.z = bz + (hash2(bx, bz, 2) - 0.5) * 2 * mj;
      mo.y = midY(X, n);
      blendColor(mo.c, X, n, null);
      tint(mo.c, bx, bz);

      // The neighbor's own top along this edge, for wall bottoms.
      if (n) {
        nbY[i][0] = bottomAt(n, cornerY(n, X, a));
        nbY[i][1] = bottomAt(n, midY(n, X));
        nbY[i][2] = bottomAt(n, cornerY(n, X, nn));
      } else {
        nbY[i][0] = nbY[i][1] = nbY[i][2] = BASE_Y;
      }
      if (skirt !== null) {
        for (let j = 0; j < 3; j++) nbY[i][j] = Math.min(nbY[i][j], skirt);
      }
    }

    this._emitTop(b, X, cellIndex);
    for (let i = 0; i < 6; i++) this._emitWall(b, X, i, nb[i], cellIndex);
  }

  _emitTop(b, X, cellIndex) {
    const cx = X.x;
    const cz = X.z;
    const y = X.g;
    const own = X.top;
    const face = cellIndex * 8 + TOP_SLOT;
    const base = b.count;

    b.vert(cx, y, cz, 0, 1, 0, own[0], own[1], own[2]);
    // Inner ring: own color, slightly wobbly so the blend line isn't a perfect hexagon.
    for (let k = 0; k < 12; k++) {
      const o = ring[k];
      const f = INNER + (hash2(cx + k, cz, 4) - 0.5) * 2 * INNER_WOBBLE;
      b.vert(cx + (o.x - cx) * f, y, cz + (o.z - cz) * f, 0, 1, 0, own[0], own[1], own[2]);
    }
    // Bevel ring: rim height, blended color.
    for (let k = 0; k < 12; k++) {
      const o = ring[k];
      const v = bevel[k];
      v.x = cx + (o.x - cx) * BEVEL;
      v.y = y;
      v.z = cz + (o.z - cz) * BEVEL;
      v.c = o.c;
      b.vert(v.x, y, v.z, 0, 1, 0, o.c[0], o.c[1], o.c[2]);
    }
    // Outer ring: shared, jittered, dropped toward lower neighbors.
    for (let k = 0; k < 12; k++) {
      const o = ring[k];
      b.vert(o.x, o.y, o.z, 0, 1, 0, o.c[0], o.c[1], o.c[2]);
    }

    const C = base;
    const I = base + 1;
    const B = base + 13;
    const O = base + 25;
    for (let k = 0; k < 12; k++) {
      const k1 = (k + 1) % 12;
      b.tri(C, I + k1, I + k, face);
      b.tri(I + k, B + k1, B + k, face);
      b.tri(I + k, I + k1, B + k1, face);
      if (ring[k].y > y - EPS && ring[k1].y > y - EPS) {
        b.tri(B + k, O + k1, O + k, face);
        b.tri(B + k, B + k1, O + k1, face);
      } else {
        // Sloped lip facets get their own normals so the toon ramp shades them.
        b.flatTri(bevel[k], ring[k1], ring[k], face);
        b.flatTri(bevel[k], bevel[k1], ring[k1], face);
      }
    }
  }

  // Walls on edge i, toward neighbor n. Implements the geometry rules: land and
  // water basins close down to the neighbor's ground; a water cell above a lower or
  // empty neighbor also gets a dam up to its surface, except level-0 water at the
  // ocean, which stays open so it merges with the sea.
  _emitWall(b, X, i, n, cellIndex) {
    const c0 = ring[2 * i];
    const m = ring[2 * i + 1];
    const c1 = ring[(2 * i + 2) % 12];
    const bot = nbY[i];
    const face = cellIndex * 8 + i;
    const wallTop = X.g;

    const dam = X.water && (!n || n.h < X.h) && !(X.h === 0 && !n);
    if (dam) {
      const wy = cellSurfaceY(X.cell);
      const side = X.side;
      // Outside of the dam, banded like any cliff.
      this._wallSegment(b, c0, m, bot[0], wy, bot[1], wy, wy, wy, side, null, face);
      this._wallSegment(b, m, c1, bot[1], wy, bot[2], wy, wy, wy, side, null, face);
      // Inside face of the basin rim, above whatever the neighbor already closes.
      const lo0 = Math.max(X.g, bot[0]);
      const lom = Math.max(X.g, bot[1]);
      const lo1 = Math.max(X.g, bot[2]);
      this._innerSegment(b, c0, m, lo0, lom, wy, side, face);
      this._innerSegment(b, m, c1, lom, lo1, wy, side, face);
      return;
    }

    // Plain wall: only where the neighbor's ground is below ours.
    if (Math.min(bot[0], bot[1], bot[2]) >= wallTop - EPS) return;
    const t0 = c0.y;
    const tm = m.y;
    const t1 = c1.y;
    let l0 = t0;
    let lm = tm;
    let l1 = t1;
    let lipColor = null;
    if (X.grassy) {
      lipColor = X.top;
      l0 = t0 - lipDepth(c0);
      lm = tm - lipDepth(m);
      l1 = t1 - lipDepth(c1);
    }
    this._wallSegment(b, c0, m, bot[0], t0, bot[1], tm, l0, lm, X.side, lipColor, face);
    this._wallSegment(b, m, c1, bot[1], tm, bot[2], t1, lm, l1, X.side, lipColor, face);
  }

  // One outward-facing wall segment from p0 to p1, split into strata bands per
  // LEVEL_H. Below the lip line (l0, l1) it uses the side color; above it, the
  // lip color. Bottoms and tops can differ per end.
  _wallSegment(b, p0, p1, b0, t0, b1, t1, l0, l1, side, lipColor, face) {
    if (t0 - b0 < EPS && t1 - b1 < EPS) return;
    let dx = p1.x - p0.x;
    let dz = p1.z - p0.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    const nx = dz;
    const nz = -dx;

    const cut = this._cut;
    const quad = (lo0, hi0, lo1, hi1, col, k0, k1) => {
      if (hi0 - lo0 < EPS && hi1 - lo1 < EPS) return;
      // Pop meshes need a vertex row at the pivot so squash and stretch stays closed.
      if (cut !== null && (cut > lo0 + EPS || cut > lo1 + EPS) && (cut < hi0 - EPS || cut < hi1 - EPS)) {
        const m0 = clamp(cut, lo0, hi0);
        const m1 = clamp(cut, lo1, hi1);
        const km = k0 + (k1 - k0) * 0.5;
        emit(lo0, m0, lo1, m1, col, k0, km);
        emit(m0, hi0, m1, hi1, col, km, k1);
      } else {
        emit(lo0, hi0, lo1, hi1, col, k0, k1);
      }
    };
    const emit = (lo0, hi0, lo1, hi1, col, k0, k1) => {
      if (hi0 - lo0 < EPS && hi1 - lo1 < EPS) return;
      const sa = k0 * depthShade(lo0);
      const sb = k0 * depthShade(lo1);
      const sc = k1 * depthShade(hi1);
      const sd = k1 * depthShade(hi0);
      const a = b.vert(p0.x, lo0, p0.z, nx, 0, nz, col[0] * sa, col[1] * sa, col[2] * sa);
      const bb = b.vert(p1.x, lo1, p1.z, nx, 0, nz, col[0] * sb, col[1] * sb, col[2] * sb);
      const c = b.vert(p1.x, hi1, p1.z, nx, 0, nz, col[0] * sc, col[1] * sc, col[2] * sc);
      const d = b.vert(p0.x, hi0, p0.z, nx, 0, nz, col[0] * sd, col[1] * sd, col[2] * sd);
      b.tri(a, c, bb, face);
      b.tri(a, d, c, face);
    };

    // Strata bands below the lip line.
    const yMin = Math.min(b0, b1);
    const yMax = Math.max(l0, l1);
    const kMin = Math.floor(yMin / LEVEL_H);
    const kMax = Math.ceil(yMax / LEVEL_H);
    for (let k = kMin; k < kMax; k++) {
      const ylo = k * LEVEL_H;
      const yhi = ylo + LEVEL_H;
      const s = stripe(k);
      quad(
        clamp(ylo, b0, Math.max(b0, l0)),
        clamp(yhi, b0, Math.max(b0, l0)),
        clamp(ylo, b1, Math.max(b1, l1)),
        clamp(yhi, b1, Math.max(b1, l1)),
        side,
        s,
        s,
      );
    }

    // Grassy lip: a short band of top color that fades into the cliff.
    if (lipColor) {
      quad(Math.max(b0, l0), t0, Math.max(b1, l1), t1, lipColor, 0.78, 0.94);
    }
  }

  // Inward-facing basin rim face (seen through the water surface).
  _innerSegment(b, p0, p1, lo0, lo1, hi, col, face) {
    if (hi - lo0 < EPS && hi - lo1 < EPS) return;
    const cut = this._cut;
    if (cut !== null && (cut > lo0 + EPS || cut > lo1 + EPS) && cut < hi - EPS) {
      const m0 = clamp(cut, lo0, hi);
      const m1 = clamp(cut, lo1, hi);
      this._innerQuad(b, p0, p1, lo0, lo1, m0, m1, col, face);
      this._innerQuad(b, p0, p1, m0, m1, hi, hi, col, face);
    } else {
      this._innerQuad(b, p0, p1, lo0, lo1, hi, hi, col, face);
    }
  }

  _innerQuad(b, p0, p1, lo0, lo1, hi0, hi1, col, face) {
    if (hi0 - lo0 < EPS && hi1 - lo1 < EPS) return;
    const dx = p1.x - p0.x;
    const dz = p1.z - p0.z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len;
    const nz = dx / len;
    const k = 0.9;
    const a = b.vert(p0.x, lo0, p0.z, nx, 0, nz, col[0] * k, col[1] * k, col[2] * k);
    const bb = b.vert(p1.x, lo1, p1.z, nx, 0, nz, col[0] * k, col[1] * k, col[2] * k);
    const c = b.vert(p1.x, hi1, p1.z, nx, 0, nz, col[0], col[1], col[2]);
    const d = b.vert(p0.x, hi0, p0.z, nx, 0, nz, col[0], col[1], col[2]);
    b.tri(a, bb, c, face);
    b.tri(a, c, d, face);
  }

  // ---- Pop animation -----------------------------------------------------

  _startPop(q, r, key, cell, prev) {
    const gNew = cell ? cellGroundY(cell) : null;
    const gPrev = prev ? cellGroundY(prev) : null;
    const pop = { q, r, key, cell: cell ?? prev, t: 0, dirty: true, mesh: null, base: null };

    if (!cell) {
      if (!prev) return;
      pop.mode = 'remove';
      pop.pivot = BASE_Y;
      pop.duration = 0.28;
    } else if (gPrev === null || gNew > gPrev + EPS) {
      pop.mode = 'raise';
      // New columns rise from a little below; tall jumps cap their travel.
      pop.pivot = gPrev === null ? gNew - POP_RISE : Math.max(gPrev, gNew - 2 * POP_RISE);
      pop.duration = 0.55;
    } else if (gNew < gPrev - EPS) {
      // Fall from the old height, then land with a small squash.
      pop.mode = 'settle';
      pop.pivot = gNew - LEVEL_H;
      pop.gNew = gNew;
      pop.gPrev = gPrev;
      pop.fall = clamp(0.08 + 0.04 * (gPrev - gNew), 0.1, 0.22);
      pop.duration = pop.fall + 0.38;
    } else {
      pop.mode = 'bump';
      pop.pivot = gNew - LEVEL_H;
      pop.duration = 0.45;
    }
    // Neighbors extend their walls down to here while the column moves.
    pop.floor = cell ? Math.min(pop.pivot, gNew) : undefined;

    const { x, z } = hexToWorld(q, r);
    pop.cx = x;
    pop.cz = z;
    this.pops.set(key, pop);
  }

  _buildPopGeometry(pop) {
    pop.dirty = false;
    const cache = new Map();
    const b = new MeshBuilder(pop.cx, pop.cz);
    // A removed cell is drawn from its previous state; neighbors come from the world.
    const X = makeInfo(pop.cell);
    cache.set(pop.key, X);
    this._cut = pop.pivot;
    this._emitCell(b, X, cache, 0, pop.pivot);
    this._cut = null;
    const geo = b.toGeometry();
    pop.base = Float32Array.from(geo.attributes.position.array);
    geo.boundingSphere.radius += 1.5;
    geo.attributes.position.setUsage(THREE.DynamicDrawUsage);
    if (pop.mesh) {
      pop.mesh.geometry.dispose();
      pop.mesh.geometry = geo;
    } else {
      pop.mesh = new THREE.Mesh(geo, this.material);
      pop.mesh.castShadow = true;
      pop.mesh.receiveShadow = true;
      pop.mesh.layers.set(LAYERS.WORLD);
      pop.mesh.layers.enable(LAYERS.DEPTH);
      pop.mesh.position.set(pop.cx, 0, pop.cz);
      pop.mesh.name = `terrain-pop:${pop.key}`;
      this.group.add(pop.mesh);
    }
    pop.mesh.userData.cells = [pop.cell];
    pop.mesh.userData.faces = Int32Array.from(b.faces);
  }

  // Deform the pop mesh for the current time. Returns true when finished.
  _animatePop(pop) {
    const t = pop.t;
    let sy = 1;
    let sxz = 1;
    let done = t >= pop.duration;
    if (!done) {
      if (pop.mode === 'raise') {
        const p = popScale(t, pop.duration);
        sy = p.y;
        sxz = 1 + (p.xz - 1) * 0.6;
      } else if (pop.mode === 'remove') {
        const s = shrinkScale(t, pop.duration);
        sy = sxz = s.s;
        done = s.done;
      } else if (pop.mode === 'settle') {
        const span = pop.gNew - pop.pivot;
        if (t < pop.fall) {
          const k = t / pop.fall;
          const top = pop.gPrev - (pop.gPrev - pop.gNew) * k * k;
          sy = (top - pop.pivot) / span;
          sxz = 1 - 0.06 * k;
        } else {
          const u = t - pop.fall;
          const top = pop.gNew - 0.16 * Math.exp(-7 * u) * Math.sin(16 * u);
          sy = (top - pop.pivot) / span;
          sxz = clamp(1 + (1 - sy) * 0.6, 0.9, 1.12);
        }
      } else {
        // Same height, new look: a gentle bounce.
        sy = 0.55 + 0.45 * springValue(t);
        sxz = clamp(1 + (1 - sy) * 0.3, 0.88, 1.12);
      }
    }
    if (done) return true;

    // Squash and stretch everything above the pivot: Y about the pivot, X/Z about
    // the cell center. Everything below stays put so the column never opens up.
    const pos = pop.mesh.geometry.attributes.position;
    const arr = pos.array;
    const base = pop.base;
    const pivot = pop.pivot;
    for (let i = 0; i < arr.length; i += 3) {
      const y = base[i + 1];
      if (y > pivot + EPS) {
        arr[i] = base[i] * sxz;
        arr[i + 1] = pivot + (y - pivot) * sy;
        arr[i + 2] = base[i + 2] * sxz;
      } else {
        arr[i] = base[i];
        arr[i + 1] = y;
        arr[i + 2] = base[i + 2];
      }
    }
    pos.needsUpdate = true;
    return false;
  }

  _removePop(key) {
    const pop = this.pops.get(key);
    if (!pop) return;
    if (pop.mesh) {
      pop.mesh.geometry.dispose();
      this.group.remove(pop.mesh);
    }
    this.pops.delete(key);
  }
}

// Tiny hand-painted brightness variation, identical for every cell sharing a vertex.
function tint(c, x, z) {
  const k = 1 + (hash2(x, z, 9) - 0.5) * 0.05;
  c[0] *= k;
  c[1] *= k;
  c[2] *= k;
}

// Depth of the grassy lip band at a wall vertex, shared by neighboring walls.
function lipDepth(v) {
  return GRASS_LIP[0] + (GRASS_LIP[1] - GRASS_LIP[0]) * hash2(v.x, v.z, 5);
}
