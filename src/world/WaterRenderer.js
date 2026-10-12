// Water: the open ocean, raised lakes and streams, waterfalls, and the seabed.
//
// - The ocean is one sheet at SEA_Y out to the horizon. Its shader hides itself
//   inside island cells using a per-cell mask texture. Level-0 water cells are
//   drawn by the ocean too, so sea-level lakes merge into the sea seamlessly.
// - Water cells above sea level are subdivided hex patches, merged per chunk.
//   Each chunk also owns the waterfalls that spill from its cells, the foam
//   where they land, and a mist emitter at each base.
// - The seabed is opaque, on the WORLD layer, so it lands in the depth pre-pass
//   and gives the water its depth fade.
//
// Edits rebuild only the chunks within two cells of the change, from cached
// per-cell patches.

import * as THREE from 'three';
import { BASIN_DEPTH, CHUNK_SIZE, HEX_APOTHEM, HEX_W, SEA_Y, WATER_DROP } from '../core/constants.js';
import { DIRS, hexToWorld, hexesInRadius, key as hexKey, worldToHex, chunkKey } from '../core/hex.js';
import { LAYERS, U } from '../render/shared.js';
import { springValue } from '../fx/spring.js';
import { rimY, cellSurfaceY } from './World.js';
import { OceanMask, MASK_OCEAN, MASK_SIZE, MASK_RADIUS } from './water/mask.js';
import {
  SurfaceContext,
  buildCellSurface,
  mergeSurfaces,
  buildSurfaceGeometry,
  buildProxyGeometry,
  buildOceanGeometry, OCEAN_STEP,
  buildOceanProxyGeometry,
} from './water/surfaces.js';
import { findSpills, buildWaterfalls } from './water/waterfalls.js';
import { Seabed } from './water/seabed.js';
import { createWaterMaterials, waterUniforms } from './water/shaders.js';
import { clamp01 } from '../core/math.js';

const RISE_TIME = 0.6; // Seconds for a new water cell to fill and settle.
const RISE_SPRING = { stiffness: 14, damping: 9 };
const SEABED_INTERVAL = 0.3; // Minimum seconds between seabed refreshes.

// Transparent draw order: water goes before default-order effects (particles,
// blueprint ghosts), so mist and previews draw over it.
const ORDER = { ocean: -40, surface: -30, curtain: -20, pads: -10 };

const PROXY_MAT = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
const EMPTY = new THREE.BufferGeometry();

function waterMesh(material, order, name) {
  const m = new THREE.Mesh(EMPTY, material);
  m.name = name;
  m.layers.set(LAYERS.WATER);
  m.renderOrder = order;
  m.visible = false;
  return m;
}

// Swap a mesh's geometry, disposing the old one. Hides the mesh when empty.
function setGeometry(mesh, geo) {
  if (mesh.geometry !== EMPTY) mesh.geometry.dispose();
  mesh.geometry = geo ?? EMPTY;
  mesh.visible = !!geo;
}

function proxyMesh(geometry) {
  const m = new THREE.Mesh(geometry, PROXY_MAT);
  m.layers.set(LAYERS.WATER);
  m.userData.water = true;
  return m;
}

export class WaterRenderer {
  constructor(scene, world, particles) {
    this.scene = scene;
    this.world = world;
    this.particles = particles;

    this.group = new THREE.Group();
    this.group.name = 'water';
    scene.add(this.group);

    this.mask = new OceanMask();
    this.materials = createWaterMaterials(this.mask.texture);

    this.ocean = waterMesh(this.materials.ocean, ORDER.ocean, 'ocean');
    setGeometry(this.ocean, buildOceanGeometry());
    this.ocean.frustumCulled = false;
    this.group.add(this.ocean);

    this.seabed = new Seabed();
    this.group.add(this.seabed.mesh, this.seabed.floor);

    // Raycast stand-in for the ocean, never rendered. Geometry is in world space.
    this.oceanProxy = proxyMesh(buildOceanProxyGeometry());
    this.oceanProxy.userData.ocean = true;

    this.chunkCells = new Map(); // chunk key → Set of raised water cell keys.
    this.chunks = new Map(); // chunk key → { surface, curtain, pads, proxy, spills }.
    this.patches = new Map(); // cell key → cached surface patch.
    this.anims = new Map(); // cell key → rising-water animation.
    this.risingOcean = new Set(); // Level-0 cells the ocean must not cover yet.
    this.emitters = new Map(); // edge key → { handle, x, y, z, owner }.

    this.dirtyChunks = new Set();
    this.seabedDirty = false;
    this.seabedClock = SEABED_INTERVAL;
    this.targets = null;

    // Audio proximity data, rebuilt lazily after edits.
    this.proxDirty = true;
    this.oceanDist = new Uint8Array(MASK_SIZE * MASK_SIZE);
    this.lakeSources = [];
    this.fallSources = [];

    world.on('cell', (e, opts) => this._onCell(e, opts));
    world.on('reset', () => this._rebuildAll());
    this._rebuildAll();
  }

  // ---- Public API ------------------------------------------------------------

  update(dt, camera) {
    waterUniforms.uHasDepth.value = U.uDepthTex.value ? 1 : 0;

    // Keep the ocean's fine core under the camera, in whole grid steps.
    const { x, z } = camera.position;
    this.ocean.position.set(Math.round(x / OCEAN_STEP) * OCEAN_STEP, 0, Math.round(z / OCEAN_STEP) * OCEAN_STEP);

    for (const [k, a] of this.anims) {
      a.t += dt;
      if (a.t >= RISE_TIME) this._endRise(k);
      else a.mesh.position.y = a.from * (1 - springValue(a.t, RISE_SPRING));
    }

    this.seabedClock += dt;
    if (this.seabedDirty && this.seabedClock >= SEABED_INTERVAL) {
      this.seabed.setCells(this.world);
      this.seabedDirty = false;
      this.seabedClock = 0;
    }
    this.seabed.update(dt);

    this._flush();
  }

  // True while a new water surface is rising into place.
  get isAnimating() {
    return this.anims.size > 0;
  }

  getRaycastTargets() {
    if (!this.targets) {
      this.targets = [this.oceanProxy];
      for (const c of this.chunks.values()) this.targets.push(c.proxy);
    }
    return this.targets;
  }

  // Loudness factors (0..1) for ambient audio at `position`.
  proximity(position) {
    if (this.proxDirty) this._rebuildProximity();
    const { x, y, z } = position;

    // Open ocean: hex steps to the nearest ocean cell, plus height above it.
    const h = worldToHex(x, z);
    const i = this.mask.index(h.q, h.r);
    const steps = i < 0 ? 0 : this.oceanDist[i];
    const horiz = steps === 0 ? 0 : (steps - 0.5) * HEX_W;
    let water = Math.exp(-Math.hypot(horiz, Math.max(0, y - SEA_Y)) / 16);

    for (const s of this.lakeSources) {
      const dx = x - s.x;
      const dz = z - s.z;
      if (dx * dx + dz * dz > 3600) continue;
      const dh = Math.max(0, Math.sqrt(dx * dx + dz * dz) - HEX_APOTHEM);
      water = Math.max(water, 0.85 * Math.exp(-Math.hypot(dh, y - s.y) / 12));
    }

    let quiet = 1;
    for (const s of this.fallSources) {
      const dx = x - s.x;
      const dz = z - s.z;
      if (dx * dx + dz * dz > 2500) continue;
      const dh = Math.max(0, Math.sqrt(dx * dx + dz * dz) - 1);
      const dv = y > s.top ? y - s.top : y < s.bottom ? s.bottom - y : 0;
      quiet *= 1 - s.weight * Math.exp(-Math.hypot(dh, dv) / 9);
    }

    return { water: clamp01(water), waterfall: clamp01(1 - quiet) };
  }

  // Every spilling edge, with emitter position, heights, and drop.
  get spills() {
    const out = [];
    for (const c of this.chunks.values()) out.push(...c.spills);
    return out;
  }

  // ---- World events ----------------------------------------------------------

  _onCell({ q, r, key, cell, prev }, opts) {
    if (this.anims.has(key)) this._endRise(key, false);

    const wasWater = prev?.type === 'water';
    const isWater = cell?.type === 'water';
    const rise = isWater && opts?.animate && !(wasWater && prev.h === cell.h);
    if (wasWater) this.chunkCells.get(chunkKey(q, r))?.delete(key);
    if (isWater && cell.h > 0) {
      const ck = chunkKey(q, r);
      if (!this.chunkCells.has(ck)) this.chunkCells.set(ck, new Set());
      this.chunkCells.get(ck).add(key);
    }
    if (rise && cell.h === 0) this.risingOcean.add(key);

    this.mask.update(this.world, q, r, this.risingOcean);
    if (rise) this._startRise(cell, prev);

    // Edges, corners, shore distances, and tint blends reach two cells out.
    for (const n of hexesInRadius(q, r, 2)) {
      this.patches.delete(hexKey(n.q, n.r));
      this.dirtyChunks.add(chunkKey(n.q, n.r));
    }
    this.proxDirty = true;
    if (!prev !== !cell) this.seabedDirty = true;
  }

  _rebuildAll() {
    for (const k of [...this.anims.keys()]) this._endRise(k, false);
    this.risingOcean.clear();
    this.patches.clear();

    this.chunkCells.clear();
    for (const [k, c] of this.world.cells) {
      if (c.type !== 'water' || c.h === 0) continue;
      const ck = chunkKey(c.q, c.r);
      if (!this.chunkCells.has(ck)) this.chunkCells.set(ck, new Set());
      this.chunkCells.get(ck).add(k);
    }

    this.mask.rebuild(this.world, this.risingOcean);
    for (const ck of this.chunks.keys()) this.dirtyChunks.add(ck);
    for (const ck of this.chunkCells.keys()) this.dirtyChunks.add(ck);
    this.proxDirty = true;

    this.seabed.setCells(this.world, true);
    this.seabedDirty = false;
    this.seabedClock = 0;

    this._flush();
  }

  // ---- Rising water ----------------------------------------------------------

  _startRise(cell, prev) {
    const k = hexKey(cell.q, cell.r);
    const y = this.world.waterY(cell.q, cell.r);
    // Rise from the basin floor, or from the old surface when the level changed.
    let from = -(BASIN_DEPTH - WATER_DROP);
    if (prev?.type === 'water') from = Math.max(-1.5, Math.min(1.5, cellSurfaceY(prev) - y));

    const mesh = waterMesh(this.materials.lake, ORDER.surface, `water-rise-${k}`);
    setGeometry(mesh, buildSurfaceGeometry([cell], new SurfaceContext(this.world, this.mask)));
    mesh.position.y = from;
    this.group.add(mesh);
    this.anims.set(k, { q: cell.q, r: cell.r, t: 0, from, mesh });

    const c = hexToWorld(cell.q, cell.r);
    this.particles.splash(new THREE.Vector3(c.x, y, c.z));
  }

  // Finish (or cancel) a rise and hand the cell back to its chunk.
  _endRise(k, settle = true) {
    const a = this.anims.get(k);
    if (!a) return;
    this.anims.delete(k);
    this.group.remove(a.mesh);
    setGeometry(a.mesh, null);
    if (this.risingOcean.delete(k) && settle) this.mask.update(this.world, a.q, a.r, this.risingOcean);
    this.dirtyChunks.add(chunkKey(a.q, a.r));
  }

  // ---- Rebuilds --------------------------------------------------------------

  _flush() {
    if (!this.dirtyChunks.size) return;
    const ctx = new SurfaceContext(this.world, this.mask);
    for (const ck of this.dirtyChunks) this._rebuildChunk(ck, ctx);
    this.dirtyChunks.clear();
    this.proxDirty = true;
  }

  _rebuildChunk(ck, ctx) {
    const visible = [];
    const solid = [];
    for (const k of this.chunkCells.get(ck) ?? []) {
      const c = this.world.getCellByKey(k);
      if (!c || c.type !== 'water' || c.h === 0) continue;
      solid.push(c);
      if (!this.anims.has(k)) visible.push(c);
    }

    let entry = this.chunks.get(ck);
    if (!solid.length) {
      if (entry) this._removeChunk(ck, entry);
      return;
    }
    if (!entry) {
      entry = {
        surface: waterMesh(this.materials.lake, ORDER.surface, `water-${ck}`),
        curtain: waterMesh(this.materials.curtain, ORDER.curtain, `waterfalls-${ck}`),
        pads: waterMesh(this.materials.pads, ORDER.pads, `waterfall-foam-${ck}`),
        proxy: proxyMesh(EMPTY),
        spills: [],
      };
      this.group.add(entry.surface, entry.curtain, entry.pads);
      this.chunks.set(ck, entry);
      this.targets = null;
    }

    const parts = visible.map((c) => {
      const k = hexKey(c.q, c.r);
      let p = this.patches.get(k);
      if (!p) this.patches.set(k, (p = buildCellSurface(c, ctx)));
      return p;
    });
    setGeometry(entry.surface, parts.length ? mergeSurfaces(parts) : null);

    // Cells still rising get their waterfalls once they settle.
    const falls = buildWaterfalls(findSpills(this.world, visible), ctx);
    setGeometry(entry.curtain, falls.curtain);
    setGeometry(entry.pads, falls.pads);
    this._syncEmitters(ck, entry.spills, falls.spills);
    entry.spills = falls.spills;

    if (entry.proxy.geometry !== EMPTY) entry.proxy.geometry.dispose();
    entry.proxy.geometry = buildProxyGeometry(solid, this.world);
  }

  _removeChunk(ck, entry) {
    this.group.remove(entry.surface, entry.curtain, entry.pads);
    setGeometry(entry.surface, null);
    setGeometry(entry.curtain, null);
    setGeometry(entry.pads, null);
    if (entry.proxy.geometry !== EMPTY) entry.proxy.geometry.dispose();
    this._syncEmitters(ck, entry.spills, []);
    this.chunks.delete(ck);
    this.targets = null;
  }

  // One mist emitter per spilling edge, keyed by edge so rebuilds reuse them.
  // The chunk that last placed an emitter owns it, so a waterfall that moves
  // between chunks is never removed by the chunk it left.
  _syncEmitters(ck, before, after) {
    const p = this.particles;
    const live = new Set();
    for (const s of after) {
      live.add(s.key);
      const e = this.emitters.get(s.key);
      const same =
        e &&
        Math.abs(e.x - s.x) + Math.abs(e.y - s.y) + Math.abs(e.z - s.z) < 1e-3 &&
        e.mist.size === s.mist.size &&
        e.mist.rate === s.mist.rate;
      if (same) {
        e.owner = ck;
        continue;
      }
      if (e) p.removeEmitter(e.handle);
      const handle = p.addEmitter('mist', new THREE.Vector3(s.x, s.y, s.z), s.mist);
      this.emitters.set(s.key, { handle, x: s.x, y: s.y, z: s.z, mist: s.mist, owner: ck });
    }
    for (const s of before) {
      if (live.has(s.key)) continue;
      const e = this.emitters.get(s.key);
      if (!e || e.owner !== ck) continue;
      p.removeEmitter(e.handle);
      this.emitters.delete(s.key);
    }
  }

  _rebuildProximity() {
    this.proxDirty = false;

    // Hex steps from every mask cell to the nearest open ocean.
    const dist = this.oceanDist;
    const flags = this.mask.flags;
    dist.fill(255);
    const queue = new Int32Array(dist.length);
    let head = 0;
    let tail = 0;
    for (let i = 0; i < flags.length; i++) {
      if (flags[i] !== MASK_OCEAN) continue;
      dist[i] = 0;
      queue[tail++] = i;
    }
    while (head < tail) {
      const i = queue[head++];
      const d = dist[i];
      if (d >= 254) continue;
      const q = (i % MASK_SIZE) - MASK_RADIUS;
      const r = Math.floor(i / MASK_SIZE) - MASK_RADIUS;
      for (const [dq, dr] of DIRS) {
        const j = this.mask.index(q + dq, r + dr);
        if (j < 0 || dist[j] <= d + 1) continue;
        dist[j] = d + 1;
        queue[tail++] = j;
      }
    }

    this.lakeSources = [];
    for (const keys of this.chunkCells.values()) {
      for (const k of keys) {
        const c = this.world.getCellByKey(k);
        if (!c) continue;
        const p = hexToWorld(c.q, c.r);
        this.lakeSources.push({ x: p.x, z: p.z, y: this.world.waterY(c.q, c.r) });
      }
    }

    this.fallSources = this.spills.map((s) => ({
      x: s.x,
      z: s.z,
      top: s.top,
      bottom: s.bottom,
      weight: Math.min(1, 0.35 + s.drop / 3),
    }));
  }
}

