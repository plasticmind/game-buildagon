// Sandy seabed under the ocean. A shallow shelf hugs the island, then the floor
// falls away to BASE_Y over about ten cells, which gives turquoise shallows
// around the coast and deep blue water further out.
//
// Heights come from each cell's hex distance to the nearest island cell. The
// mesh has one vertex per cell center and per shared corner, so it stays
// cheap to refresh, and it eases toward new heights instead of popping.

import * as THREE from 'three';
import { BASE_Y, BASIN_DEPTH, WORLD_RADIUS } from '../../core/constants.js';
import { hexToWorld, cornerOffset, cornerKey, hexesInRadius, hash2, DIRS } from '../../core/hex.js';
import { LAYERS } from '../../render/shared.js';
import { toon } from '../../render/materials.js';

const RADIUS = WORLD_RADIUS + 14; // Cells covered by the seabed mesh.
const GRID = RADIUS + 1; // BFS grid half-width (one ring past the mesh).
const GRID_W = GRID * 2 + 1;

// Stay below every basin floor (a level-0 lake's floor is at -BASIN_DEPTH), so
// the seabed never pokes into a cell.
export const SHELF_Y = -(BASIN_DEPTH + 0.17);
const DEEP_Y = BASE_Y + 0.05;
const JITTER = 0.12;
const SHELF_CELLS = 1.5; // Shelf stays flat this many cells from land…
const SLOPE_CELLS = 11; // …and reaches the deep floor here.

const SAND_SHALLOW = new THREE.Color('#f1dfae');
const SAND_MID = new THREE.Color('#dcc797');
const SAND_DEEP = new THREE.Color('#b4ad8c');

function gridIndex(q, r) {
  const x = q + GRID;
  const y = r + GRID;
  if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_W) return -1;
  return y * GRID_W + x;
}

function shelfHeight(d) {
  const t = Math.min(1, Math.max(0, (d - SHELF_CELLS) / (SLOPE_CELLS - SHELF_CELLS)));
  return SHELF_Y + (DEEP_Y - SHELF_Y) * t * t * (3 - 2 * t);
}

export class Seabed {
  constructor() {
    const cells = hexesInRadius(0, 0, RADIUS);
    const cornerIndex = new Map();
    const xs = [];
    const zs = [];
    // For each vertex, the grid cells whose shelf height it averages.
    const sources = [];
    const index = [];

    for (const { q, r } of cells) {
      const c = hexToWorld(q, r);
      const center = xs.length;
      xs.push(c.x);
      zs.push(c.z);
      sources.push([gridIndex(q, r)]);
      const ring = [];
      for (let i = 0; i < 6; i++) {
        const k = cornerKey(q, r, i);
        let vi = cornerIndex.get(k);
        if (vi === undefined) {
          vi = xs.length;
          cornerIndex.set(k, vi);
          const o = cornerOffset(i);
          xs.push(c.x + o.x);
          zs.push(c.z + o.z);
          // Corner i is shared by this cell and neighbors i-1 and i.
          const a = DIRS[(i + 5) % 6];
          const b = DIRS[i];
          sources.push([gridIndex(q, r), gridIndex(q + a[0], r + a[1]), gridIndex(q + b[0], r + b[1])]);
        }
        ring.push(vi);
      }
      for (let i = 0; i < 6; i++) index.push(center, ring[(i + 1) % 6], ring[i]);
    }

    const count = xs.length;
    this.count = count;
    this.sources = sources;
    this.jitter = new Float32Array(count);
    this.shade = new Float32Array(count);
    for (let v = 0; v < count; v++) {
      this.jitter[v] = (hash2(xs[v], zs[v], 11) - 0.5) * JITTER;
      this.shade[v] = (hash2(xs[v], zs[v], 23) - 0.5) * 0.06;
    }
    this.target = new Float32Array(count).fill(DEEP_Y);
    this.current = new Float32Array(count).fill(DEEP_Y);
    this.dist = new Uint8Array(GRID_W * GRID_W);
    this.easing = false;
    this.moving = [];

    const pos = new Float32Array(count * 3);
    for (let v = 0; v < count; v++) {
      pos[v * 3] = xs[v];
      pos[v * 3 + 2] = zs[v];
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setIndex(index);
    this.geometry = geo;

    this.mesh = new THREE.Mesh(geo, toon({ vertexColors: true }));
    this.mesh.name = 'seabed';
    this.mesh.userData.seabed = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.layers.set(LAYERS.WORLD);
    this.mesh.layers.enable(LAYERS.DEPTH);

    // A flat floor past the shelf mesh so depth reads stay sane to the horizon.
    const floorGeo = new THREE.PlaneGeometry(2400, 2400);
    floorGeo.rotateX(-Math.PI / 2);
    floorGeo.translate(0, BASE_Y - 0.15, 0);
    this.floor = new THREE.Mesh(floorGeo, toon({ vertexColors: false, color: SAND_DEEP.clone() }));
    this.floor.name = 'seabed-floor';
    this.floor.userData.seabed = true;
    this.floor.layers.set(LAYERS.WORLD);
    this.floor.layers.enable(LAYERS.DEPTH);

    this._write(Array.from({ length: count }, (_, v) => v), true);
  }

  // Recompute target heights from the world's occupied cells. With `snap`, jump
  // there; otherwise ease over the next second or so.
  setCells(world, snap = false) {
    const dist = this.dist;
    dist.fill(255);
    const queue = new Int32Array(GRID_W * GRID_W);
    let head = 0;
    let tail = 0;
    for (const c of world.cells.values()) {
      const i = gridIndex(c.q, c.r);
      if (i < 0 || dist[i] === 0) continue;
      dist[i] = 0;
      queue[tail++] = i;
    }
    while (head < tail) {
      const i = queue[head++];
      const d = dist[i];
      if (d >= SLOPE_CELLS + 1) continue;
      const q = (i % GRID_W) - GRID;
      const r = Math.floor(i / GRID_W) - GRID;
      for (const [dq, dr] of DIRS) {
        const j = gridIndex(q + dq, r + dr);
        if (j < 0 || dist[j] <= d + 1) continue;
        dist[j] = d + 1;
        queue[tail++] = j;
      }
    }

    const moving = [];
    for (let v = 0; v < this.count; v++) {
      const src = this.sources[v];
      let h = 0;
      for (const i of src) h += shelfHeight(i < 0 ? 255 : dist[i]);
      h /= src.length;
      const y = Math.fround(Math.min(SHELF_Y + JITTER * 0.4, Math.max(BASE_Y, h + this.jitter[v])));
      if (y !== this.target[v] || y !== this.current[v]) moving.push(v);
      this.target[v] = y;
    }
    this.moving = moving;
    if (snap) {
      this.current.set(this.target);
      this.easing = false;
      this._write(this.moving, true);
    } else {
      this.easing = moving.length > 0;
    }
  }

  update(dt) {
    if (!this.easing) return;
    const k = 1 - Math.exp(-dt * 4);
    let still = true;
    for (const v of this.moving) {
      const d = this.target[v] - this.current[v];
      if (Math.abs(d) > 0.002) {
        this.current[v] += d * k;
        still = false;
      } else {
        this.current[v] = this.target[v];
      }
    }
    // Normals are the slow part: refresh them once the floor settles.
    this.easing = !still;
    this._write(this.moving, still);
  }

  // Push heights and sand colors for the given vertices to the GPU.
  _write(verts, normals = false) {
    const pos = this.geometry.attributes.position;
    const col = this.geometry.attributes.color;
    const c = new THREE.Color();
    for (const v of verts) {
      const y = this.current[v];
      pos.array[v * 3 + 1] = y;
      const t = (y - SHELF_Y) / (DEEP_Y - SHELF_Y);
      if (t < 0.5) c.copy(SAND_SHALLOW).lerp(SAND_MID, t * 2);
      else c.copy(SAND_MID).lerp(SAND_DEEP, t * 2 - 1);
      const s = 1 + this.shade[v];
      col.array[v * 3] = c.r * s;
      col.array[v * 3 + 1] = c.g * s;
      col.array[v * 3 + 2] = c.b * s;
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    if (normals) this.geometry.computeVertexNormals();
  }
}
