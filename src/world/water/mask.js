// Ocean mask: one texel per axial cell around the island.
//
// RGB holds the water tint for that cell (sRGB bytes, so the GPU decodes them to
// linear). A tells the ocean shader how to treat the cell:
//   MASK_OCEAN  the ocean shows here (empty cells and settled level-0 water)
//   MASK_WATER  a water cell above sea level, or a level-0 cell that is still
//               rising: hide the ocean exactly at the hex edge
//   MASK_LAND   land: hide the ocean, but let it tuck a little past the edge so
//               it meets the cliff wall without a gap
//
// Land texels carry the average tint of their watery neighbors, so tint blends
// sampled across a shoreline never pick up a stray color.

import * as THREE from 'three';
import { TERRAIN, WORLD_RADIUS } from '../../core/constants.js';
import { DIRS, key as hexKey, worldToAxial } from '../../core/hex.js';

export const MASK_RADIUS = WORLD_RADIUS + 10;
export const MASK_SIZE = MASK_RADIUS * 2 + 1;
export const MASK_OCEAN = 0;
export const MASK_WATER = 128;
export const MASK_LAND = 255;


// Linear-space tints per water variant.
const TINTS = TERRAIN.water.variants.map((v) => new THREE.Color(v.tint));

export function waterTint(variant) {
  return TINTS[variant] ?? TINTS[0];
}

// The open ocean uses the Lake tint.
export const OCEAN_TINT = TINTS[0];

function linearToSrgbByte(v) {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(c * 255)));
}

export class OceanMask {
  constructor() {
    const n = MASK_SIZE * MASK_SIZE;
    this.flags = new Uint8Array(n);
    this.tints = new Float32Array(n * 3);
    this.data = new Uint8Array(n * 4);
    const tex = new THREE.DataTexture(this.data, MASK_SIZE, MASK_SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    this.texture = tex;
    this.clear();
  }

  // Flat array index for cell (q, r), or -1 outside the mask.
  index(q, r) {
    const x = q + MASK_RADIUS;
    const y = r + MASK_RADIUS;
    if (x < 0 || y < 0 || x >= MASK_SIZE || y >= MASK_SIZE) return -1;
    return y * MASK_SIZE + x;
  }

  clear() {
    for (let i = 0; i < this.flags.length; i++) this._write(i, MASK_OCEAN, OCEAN_TINT.r, OCEAN_TINT.g, OCEAN_TINT.b);
    this.texture.needsUpdate = true;
  }

  // Recompute every texel from the world. `hidden` holds keys of level-0 water
  // cells that are still rising, which the ocean must not cover yet.
  rebuild(world, hidden) {
    this.clear();
    const seen = new Set();
    for (const c of world.cells.values()) {
      for (let i = -1; i < 6; i++) {
        const q = i < 0 ? c.q : c.q + DIRS[i][0];
        const r = i < 0 ? c.r : c.r + DIRS[i][1];
        const k = hexKey(q, r);
        if (seen.has(k)) continue;
        seen.add(k);
        this._compute(world, q, r, hidden);
      }
    }
    this.texture.needsUpdate = true;
  }

  // Recompute the texel for (q, r) and its neighbors after a cell change.
  update(world, q, r, hidden) {
    this._compute(world, q, r, hidden);
    for (const [dq, dr] of DIRS) this._compute(world, q + dq, r + dr, hidden);
    this.texture.needsUpdate = true;
  }

  flagAt(q, r) {
    const i = this.index(q, r);
    return i < 0 ? MASK_OCEAN : this.flags[i];
  }

  // Linear tint at world (x, z), interpolated across the triangle of cell
  // centers around the point. The ocean shader does the same on the GPU.
  tintAt(x, z, out = new THREE.Color()) {
    const { q: fq, r: fr } = worldToAxial(x, z);
    const q0 = Math.floor(fq);
    const r0 = Math.floor(fr);
    const u = fq - q0;
    const v = fr - r0;
    out.setRGB(0, 0, 0);
    if (u + v < 1) {
      this._accum(q0, r0, 1 - u - v, out);
      this._accum(q0 + 1, r0, u, out);
      this._accum(q0, r0 + 1, v, out);
    } else {
      this._accum(q0 + 1, r0 + 1, u + v - 1, out);
      this._accum(q0 + 1, r0, 1 - v, out);
      this._accum(q0, r0 + 1, 1 - u, out);
    }
    return out;
  }

  _accum(q, r, w, out) {
    const cq = Math.max(-MASK_RADIUS, Math.min(MASK_RADIUS, q));
    const cr = Math.max(-MASK_RADIUS, Math.min(MASK_RADIUS, r));
    const i = this.index(cq, cr) * 3;
    out.r += this.tints[i] * w;
    out.g += this.tints[i + 1] * w;
    out.b += this.tints[i + 2] * w;
  }

  _compute(world, q, r, hidden) {
    const i = this.index(q, r);
    if (i < 0) return;
    const cell = world.getCell(q, r);
    let flag = MASK_OCEAN;
    if (cell && cell.type === 'water') {
      flag = cell.h === 0 && !hidden?.has(hexKey(q, r)) ? MASK_OCEAN : MASK_WATER;
    } else if (cell) {
      flag = MASK_LAND;
    }
    const own = ownTint(cell);
    if (own) {
      this._write(i, flag, own.r, own.g, own.b);
      return;
    }
    // Land: borrow the average tint of the water around it.
    let sr = 0;
    let sg = 0;
    let sb = 0;
    let n = 0;
    for (const [dq, dr] of DIRS) {
      const t = ownTint(world.getCell(q + dq, r + dr));
      if (!t) continue;
      sr += t.r;
      sg += t.g;
      sb += t.b;
      n++;
    }
    if (n) this._write(i, flag, sr / n, sg / n, sb / n);
    else this._write(i, flag, OCEAN_TINT.r, OCEAN_TINT.g, OCEAN_TINT.b);
  }

  _write(i, flag, r, g, b) {
    this.flags[i] = flag;
    this.tints[i * 3] = r;
    this.tints[i * 3 + 1] = g;
    this.tints[i * 3 + 2] = b;
    const o = i * 4;
    this.data[o] = linearToSrgbByte(r);
    this.data[o + 1] = linearToSrgbByte(g);
    this.data[o + 2] = linearToSrgbByte(b);
    this.data[o + 3] = flag;
  }
}

// Tint a cell contributes as water: its variant tint, the ocean tint when it's
// empty, or null for land.
function ownTint(cell) {
  if (!cell) return OCEAN_TINT;
  if (cell.type === 'water') return waterTint(cell.variant);
  return null;
}
