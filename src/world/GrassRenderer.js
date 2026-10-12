// Grass renderer: instanced, wind-swept blades on grass and meadow cells, plus tiny
// flower heads sprinkled over meadows.
//
// Each chunk gets one InstancedMesh of blades and one of flowers. Instances are
// ordered so blade j of every cell comes before blade j + 1 of any cell, and blade
// positions follow a low-discrepancy sequence. Any prefix of the instance list
// therefore covers the whole chunk evenly, so density and distance thinning only
// change `mesh.count`.

import * as THREE from 'three';
import { DIRS, EDGE_NORMALS, hexToWorld, key as hexKey, parseKey, chunkKey } from '../core/hex.js';
import { HEX_APOTHEM, LEVEL_H, BASIN_DEPTH, BASE_Y, CHUNK_SIZE, TERRAIN, GRASSY_TYPES, PALETTE } from '../core/constants.js';
import { mulberry32, createNoise2D } from '../core/random.js';
import { toon } from '../render/materials.js';
import { applyWind } from '../render/wind.js';
import { LAYERS } from '../render/shared.js';
import { getItem } from '../catalog/catalog.js';
import { smoothstep } from '../core/math.js';
import { cellGroundY as groundOf } from './World.js';

const BLADES_PER_CELL = 110;
const FLOWERS_PER_CELL = 14; // Meadow cells only.
const EPS = 1e-4;
const LOW_EDGE_MARGIN = 0.4; // Keep clear of the rounded lip toward lower cells.
const HIGH_EDGE_MARGIN = 0.14; // Keep blades out of taller neighbors' cliffs.
const FADE_WIDTH = 0.9; // Grass thins out over this distance toward non-grassy cells.
const GROW_DELAY = 0.18; // Let the terrain pop land before new grass grows.
const REBUILD_BUDGET_MS = 3; // Chunk rebuild time per frame after edits.
const GROW_TIME = 0.42;
const LOD_NEAR = 70; // Full density inside this distance from the camera.
const LOD_FAR = 160; // Thinned to LOD_MIN here, hidden beyond.
const LOD_MIN = 0.2;

// R2 low-discrepancy sequence constants.
const R2X = 0.7548776662466927;
const R2Z = 0.5698402909980532;
const SIXTH = Math.PI / 3;


const FLOWER_COLORS = [PALETTE.flowerWhite, PALETTE.flowerYellow, PALETTE.flowerPink, PALETTE.flowerPurple].map(
  (c) => new THREE.Color(c),
);
const DRY_TINT = new THREE.Color('#d9d98a');
const noise = createNoise2D(4242);

// Tapered, slightly curved blade, 1 unit tall. Darker at the root.
function makeBladeGeometry() {
  const ys = [0, 0.38, 0.72, 1];
  const ws = [0.075, 0.06, 0.034, 0];
  const bend = [0, 0.035, 0.11, 0.2];
  const shade = [0.5, 0.7, 0.9, 1.06];
  const pos = [];
  const col = [];
  for (let i = 0; i < 3; i++) {
    pos.push(-ws[i], ys[i], bend[i], ws[i], ys[i], bend[i]);
    col.push(shade[i], shade[i], shade[i], shade[i], shade[i], shade[i]);
  }
  pos.push(0, 1, bend[3]);
  col.push(shade[3], shade[3], shade[3]);
  return finishGeometry(pos, col, [0, 1, 3, 0, 3, 2, 2, 3, 5, 2, 5, 4, 4, 5, 6]);
}

// Five-petal flower head sitting at y = 1, with a warm center.
function makeFlowerGeometry() {
  const pos = [0, 0.99, 0];
  const col = [1, 0.84, 0.42];
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    const tip = k % 2 === 0;
    const r = tip ? 0.12 : 0.05;
    pos.push(Math.cos(a) * r, tip ? 1.02 : 1, Math.sin(a) * r);
    const s = tip ? 1.04 : 0.94;
    col.push(s, s, s);
  }
  const idx = [];
  for (let k = 0; k < 10; k++) idx.push(0, 1 + k, 1 + ((k + 1) % 10));
  return finishGeometry(pos, col, idx);
}

function finishGeometry(pos, col, idx) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  // Up-facing normals light every blade like the ground it grows from.
  const nor = new Float32Array(pos.length);
  for (let i = 1; i < nor.length; i += 3) nor[i] = 1;
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}

function makeGrassMaterial() {
  // Smooth shading, so the up-facing blade normals light grass like the ground.
  const m = toon({ vertexColors: true, side: THREE.DoubleSide, flatShading: false });
  // Keep the up-facing normal on back faces too, so blades don't flip dark.
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      '#include <normal_fragment_begin>\n#ifndef FLAT_SHADED\n\tnormal = normalize( vNormal );\n#endif',
    );
  };
  m.customProgramCacheKey = () => 'grass-up-normal';
  return applyWind(m, { swayHeight: 1, amp: 0.3, flutter: 0.6 });
}

function cellSeed(q, r) {
  return (Math.imul(q, 73856093) ^ Math.imul(r, 19349663) ^ 0x5bd1e995) >>> 0;
}

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _c = new THREE.Color();

export class GrassRenderer {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.group = new THREE.Group();
    this.group.name = 'grass';
    scene.add(this.group);

    this.bladeGeo = makeBladeGeometry();
    this.flowerGeo = makeFlowerGeometry();
    this.material = makeGrassMaterial();

    this.density = 1;
    this.chunks = new Map(); // chunk key → { blades, flowers, bladeCut, flowerCut, center }
    this.dirty = new Set();
    this.cleared = new Map(); // cell key → number of grass-clearing objects on it
    this.growing = new Map(); // cell key → { t, meshes }
    this._camPos = new THREE.Vector3();

    world.on('cell', (e, opts) => this._onCell(e, opts ?? {}));
    world.on('objectAdded', (obj) => this._onObject(obj, 1));
    world.on('objectRemoved', (obj) => this._onObject(obj, -1));
    world.on('objectUpdated', (obj, prev) => {
      this._onObject(prev, -1);
      this._onObject(obj, 1);
    });
    world.on('reset', () => this._reset());
    this._reset();
  }

  // ---- Public API --------------------------------------------------------

  setDensity(d) {
    this.density = Math.min(1, Math.max(0, Number(d) || 0));
    for (const g of this.growing.values()) this._applyGrowCounts(g);
  }

  update(dt, camera) {
    for (const [k, g] of this.growing) {
      g.t += dt;
      const u = (g.t - GROW_DELAY) / GROW_TIME;
      if (u >= 1) {
        this._removeGrowth(k);
        this.dirty.add(chunkKey(g.q, g.r));
        continue;
      }
      const s = u <= 0 ? 0 : easeOutBack(u);
      for (const m of g.meshes) {
        m.visible = s > 0.01;
        m.scale.set(0.7 + 0.3 * Math.min(1, s), Math.max(0.001, s), 0.7 + 0.3 * Math.min(1, s));
      }
    }

    // Grass is visual only, so edits rebuild chunks within a frame budget. After
    // a world load (bulk), everything builds at once so the island never fills in.
    const start = performance.now();
    for (const ck of this.dirty) {
      this._buildChunk(ck);
      this.dirty.delete(ck);
      if (!this.bulk && performance.now() - start > REBUILD_BUDGET_MS) break;
    }
    this.bulk = false;

    // Distance thinning: drop the tail of the evenly ordered instance list.
    const cam = camera ? camera.getWorldPosition(this._camPos) : null;
    for (const ch of this.chunks.values()) {
      let f = this.density;
      if (cam) {
        const d = Math.max(0, cam.distanceTo(ch.center) - ch.radius);
        if (d > LOD_FAR) f = 0;
        else if (d > LOD_NEAR) f *= 1 - (1 - LOD_MIN) * ((d - LOD_NEAR) / (LOD_FAR - LOD_NEAR));
      }
      setCount(ch.blades, ch.bladeCut, f, BLADES_PER_CELL);
      setCount(ch.flowers, ch.flowerCut, f, FLOWERS_PER_CELL);
    }
  }

  dispose() {
    for (const k of [...this.growing.keys()]) this._removeGrowth(k);
    for (const ck of [...this.chunks.keys()]) this._clearChunk(ck);
    this.scene.remove(this.group);
    this.bladeGeo.dispose();
    this.flowerGeo.dispose();
    this.material.dispose();
  }

  // ---- Events ------------------------------------------------------------

  _onCell({ q, r, key, cell }, opts) {
    this._markAround(q, r);
    if (this.growing.has(key)) this._removeGrowth(key);
    if (opts.animate && cell && GRASSY_TYPES.has(cell.type) && !this.cleared.get(key)) {
      this._startGrowth(cell);
    }
  }

  _onObject(obj, delta) {
    if (!obj?.cell || !getItem(obj.item)?.clearsGrass) return;
    const n = (this.cleared.get(obj.cell) ?? 0) + delta;
    if (n > 0) this.cleared.set(obj.cell, n);
    else this.cleared.delete(obj.cell);
    const [q, r] = parseKey(obj.cell);
    this.dirty.add(chunkKey(q, r));
    if (this.growing.has(obj.cell)) this._removeGrowth(obj.cell);
  }

  _reset() {
    for (const k of [...this.growing.keys()]) this._removeGrowth(k);
    for (const ck of [...this.chunks.keys()]) this._clearChunk(ck);
    this.dirty.clear();
    this.cleared.clear();
    for (const obj of this.world.objects.values()) {
      if (obj.cell && getItem(obj.item)?.clearsGrass) {
        this.cleared.set(obj.cell, (this.cleared.get(obj.cell) ?? 0) + 1);
      }
    }
    for (const c of this.world.cells.values()) {
      if (GRASSY_TYPES.has(c.type)) this.dirty.add(chunkKey(c.q, c.r));
    }
    this.bulk = true;
  }

  _markAround(q, r) {
    this.dirty.add(chunkKey(q, r));
    for (const [dq, dr] of DIRS) this.dirty.add(chunkKey(q + dq, r + dr));
  }

  // ---- Chunks ------------------------------------------------------------

  _clearChunk(ck) {
    const ch = this.chunks.get(ck);
    if (!ch) return;
    for (const m of [ch.blades, ch.flowers]) {
      if (!m) continue;
      this.group.remove(m);
      m.dispose();
    }
    this.chunks.delete(ck);
  }

  _buildChunk(ck) {
    this._clearChunk(ck);
    const [cq, cr] = parseKey(ck);
    const blades = [];
    const flowers = [];
    for (let q = cq * CHUNK_SIZE; q < (cq + 1) * CHUNK_SIZE; q++) {
      for (let r = cr * CHUNK_SIZE; r < (cr + 1) * CHUNK_SIZE; r++) {
        const k = hexKey(q, r);
        const cell = this.world.cells.get(k);
        if (!cell || !GRASSY_TYPES.has(cell.type) || this.cleared.get(k) || this.growing.has(k)) continue;
        const res = this._cellInstances(cell, 0, 0, 0);
        blades.push(res.blades);
        if (res.flowers) flowers.push(res.flowers);
      }
    }
    if (!blades.length) return;

    const b = this._makeInstanced(this.bladeGeo, blades, BLADES_PER_CELL);
    const f = flowers.length ? this._makeInstanced(this.flowerGeo, flowers, FLOWERS_PER_CELL) : null;
    if (!b && !f) return;
    const center = new THREE.Vector3();
    const c = hexToWorld(cq * CHUNK_SIZE + (CHUNK_SIZE - 1) / 2, cr * CHUNK_SIZE + (CHUNK_SIZE - 1) / 2);
    center.set(c.x, 1, c.z);
    this.chunks.set(ck, {
      blades: b?.mesh ?? null,
      bladeCut: b?.cut ?? null,
      flowers: f?.mesh ?? null,
      flowerCut: f?.cut ?? null,
      center,
      radius: CHUNK_SIZE * HEX_APOTHEM * 1.8,
    });
  }

  // Interleave per-cell slots (slot j of each cell, then j + 1) into one mesh.
  // Returns the mesh and `cut`, where cut[j] is the instance count for slots < j.
  _makeInstanced(geo, cellSlots, perCell) {
    let total = 0;
    for (const s of cellSlots) total += s.count;
    if (!total) return null;
    const mesh = new THREE.InstancedMesh(geo, this.material, total);
    const mat = mesh.instanceMatrix.array;
    const col = new Float32Array(total * 3);
    const cut = new Uint32Array(perCell + 1);
    let i = 0;
    for (let j = 0; j < perCell; j++) {
      for (const s of cellSlots) {
        if (!s.ok[j]) continue;
        mat.set(s.m.subarray(j * 16, j * 16 + 16), i * 16);
        col.set(s.c.subarray(j * 3, j * 3 + 3), i * 3);
        i++;
      }
      cut[j + 1] = i;
    }
    mesh.instanceColor = new THREE.InstancedBufferAttribute(col, 3);
    mesh.instanceMatrix.needsUpdate = true;
    this._setupMesh(mesh);
    mesh.computeBoundingSphere();
    mesh.boundingSphere.radius += 1;
    this.group.add(mesh);
    return { mesh, cut };
  }

  _setupMesh(mesh) {
    mesh.layers.set(LAYERS.FX);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
  }

  // Blade and flower slots for one cell. Positions are relative to (ox, oy, oz).
  _cellInstances(cell, ox, oy, oz) {
    const { q, r } = cell;
    const { x: cx, z: cz } = hexToWorld(q, r);
    const g = groundOf(cell);
    const variant = TERRAIN[cell.type].variants[cell.variant] ?? TERRAIN[cell.type].variants[0];
    const meadow = cell.type === 'meadow';
    const rng = mulberry32(cellSeed(q, r));

    // Edge rules: hard margins toward lower or taller cells, a soft fade toward
    // same-height cells without grass.
    const margin = new Float32Array(6);
    const fade = new Uint8Array(6);
    const flowerFade = new Uint8Array(6);
    for (let i = 0; i < 6; i++) {
      const n = this.world.getCell(q + DIRS[i][0], r + DIRS[i][1]);
      const gn = groundOf(n);
      if (gn < g - EPS) margin[i] = LOW_EDGE_MARGIN;
      else if (gn > g + EPS) margin[i] = HIGH_EDGE_MARGIN;
      else if (!GRASSY_TYPES.has(n.type)) fade[i] = 1;
      if (n?.type !== 'meadow') flowerFade[i] = 1;
    }

    _c.set(variant.blade);
    const baseR = _c.r;
    const baseG = _c.g;
    const baseB = _c.b;
    const [hMin, hMax] = meadow ? [0.38, 0.76] : [0.3, 0.62];

    const blades = makeSlots(BLADES_PER_CELL);
    let ou = rng();
    let ov = rng();
    for (let j = 0; j < BLADES_PER_CELL; j++) {
      const p = samplePoint(ou, ov, j, 0.985, rng);
      const keep = edgeKeep(p.x, p.z, margin, fade, rng);
      const rot = rng() * Math.PI * 2;
      const leanX = (rng() - 0.5) * 0.5;
      const leanZ = (rng() - 0.5) * 0.5;
      const wScale = 0.8 + rng() * 0.55;
      const hRand = rng();
      const shade = 0.82 + rng() * 0.3;
      if (!keep) continue;

      const wx = cx + p.x;
      const wz = cz + p.z;
      const patch = noise(wx * 0.22, wz * 0.22);
      const h = (hMin + (hMax - hMin) * hRand) * (0.78 + 0.44 * patch) * keep;
      _p.set(wx - ox, g - 0.03 - oy, wz - oz);
      _e.set(leanX, rot, leanZ);
      _q.setFromEuler(_e);
      _s.set(wScale, h, wScale);
      _m.compose(_p, _q, _s);

      // Color: variant tint, per-blade lightness, and drier patches.
      const dry = Math.max(0, noise(wx * 0.09 + 31, wz * 0.09 - 17) - 0.45) * 0.45;
      setSlot(
        blades,
        j,
        (baseR + (DRY_TINT.r - baseR) * dry) * shade,
        (baseG + (DRY_TINT.g - baseG) * dry) * shade,
        (baseB + (DRY_TINT.b - baseB) * dry) * shade,
      );
    }

    let flowers = null;
    if (meadow) {
      flowers = makeSlots(FLOWERS_PER_CELL);
      // Each meadow favors two colors, with an occasional third.
      const c1 = FLOWER_COLORS[Math.floor(rng() * FLOWER_COLORS.length)];
      const c2 = FLOWER_COLORS[Math.floor(rng() * FLOWER_COLORS.length)];
      ou = rng();
      ov = rng();
      for (let j = 0; j < FLOWERS_PER_CELL; j++) {
        const p = samplePoint(ou, ov, j, 0.95, rng);
        const keep = edgeKeep(p.x, p.z, margin, flowerFade, rng);
        const rot = rng() * Math.PI * 2;
        const tilt = (rng() - 0.5) * 0.4;
        const h = 0.36 + rng() * 0.28;
        const sc = 0.8 + rng() * 0.45;
        const pickC = rng();
        const shade = 0.92 + rng() * 0.12;
        if (keep < 0.7) continue;
        _p.set(cx + p.x - ox, g - 0.03 - oy, cz + p.z - oz);
        _e.set(tilt, rot, 0);
        _q.setFromEuler(_e);
        _s.set(sc, h, sc);
        _m.compose(_p, _q, _s);
        const fc = pickC < 0.45 ? c1 : pickC < 0.9 ? c2 : FLOWER_COLORS[Math.floor(pickC * 37) % FLOWER_COLORS.length];
        setSlot(flowers, j, fc.r * shade, fc.g * shade, fc.b * shade);
      }
    }
    return { blades, flowers };
  }

  // ---- Growth animation --------------------------------------------------

  _startGrowth(cell) {
    const k = hexKey(cell.q, cell.r);
    const { x, z } = hexToWorld(cell.q, cell.r);
    const y = groundOf(cell);
    const res = this._cellInstances(cell, x, y, z);
    const meshes = [];
    const g = { q: cell.q, r: cell.r, t: 0, meshes, cuts: [] };
    const parts = [
      [this.bladeGeo, res.blades, BLADES_PER_CELL],
      [this.flowerGeo, res.flowers, FLOWERS_PER_CELL],
    ];
    for (const [geo, slots, per] of parts) {
      if (!slots) continue;
      const built = this._makeInstanced(geo, [slots], per);
      if (!built) continue;
      built.mesh.matrixAutoUpdate = true;
      built.mesh.position.set(x, y, z);
      built.mesh.scale.set(0.7, 0.001, 0.7);
      built.mesh.visible = false;
      built.mesh.boundingSphere.radius += 1;
      meshes.push(built.mesh);
      g.cuts.push([built.mesh, built.cut, per]);
    }
    if (!meshes.length) return;
    this.growing.set(k, g);
    this._applyGrowCounts(g);
  }

  _applyGrowCounts(g) {
    for (const [mesh, cut, per] of g.cuts) setCount(mesh, cut, this.density, per);
  }

  _removeGrowth(k) {
    const g = this.growing.get(k);
    if (!g) return;
    for (const m of g.meshes) {
      this.group.remove(m);
      m.dispose();
    }
    this.growing.delete(k);
  }
}

// Point j of a cell's R2 sequence, mapped from the unit disk onto the hexagon.
// `fill` scales the hexagon (1 = reach the edges). Coordinates are relative to
// the cell center.
function samplePoint(ou, ov, j, fill, rng) {
  const u = (ou + j * R2X) % 1;
  const v = (ov + j * R2Z) % 1;
  const a = v * Math.PI * 2;
  const rel = a - Math.round(a / SIXTH) * SIXTH;
  const rho = (HEX_APOTHEM / Math.cos(rel)) * fill;
  const rr = Math.sqrt(u) * rho;
  // A little jitter hides the sequence's lattice.
  return {
    x: Math.cos(a) * rr + (rng() - 0.5) * 0.12,
    z: Math.sin(a) * rr + (rng() - 0.5) * 0.12,
  };
}

// 0 to reject, otherwise a 0..1 size factor (1 = full size). Blades near a fading
// edge get rarer and shorter.
function edgeKeep(x, z, margin, fade, rng) {
  let keep = 1;
  const roll = rng();
  for (let i = 0; i < 6; i++) {
    const d = HEX_APOTHEM - (x * EDGE_NORMALS[i].x + z * EDGE_NORMALS[i].z);
    if (d < 0.02) return 0;
    if (margin[i] && d < margin[i]) return 0;
    if (fade[i] && d < FADE_WIDTH) {
      const p = smoothstep(0.08, FADE_WIDTH, d);
      if (roll > p) return 0;
      keep = Math.min(keep, 0.55 + 0.45 * p);
    }
  }
  return keep;
}

// Per-cell instance slots: matrices, colors, and which slots hold an instance.
function makeSlots(n) {
  return { m: new Float32Array(n * 16), c: new Float32Array(n * 3), ok: new Uint8Array(n), count: 0 };
}

// Store the scratch matrix `_m` and a color in slot j.
function setSlot(slots, j, r, g, b) {
  slots.m.set(_m.elements, j * 16);
  slots.c[j * 3] = r;
  slots.c[j * 3 + 1] = g;
  slots.c[j * 3 + 2] = b;
  slots.ok[j] = 1;
  slots.count++;
}

function setCount(mesh, cut, f, perCell) {
  if (!mesh) return;
  const j = Math.max(0, Math.min(perCell, Math.round(perCell * f)));
  mesh.count = cut[j];
  mesh.visible = mesh.count > 0;
}

function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
