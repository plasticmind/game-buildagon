// Nature model builders: trees, shrubs, flowers, plants, rocks, and water plants.
//
// Each builder is (variant, rng) => THREE.Object3D with the origin at the placement
// point and the base at y = 0. Swaying parts carry an `aSway` weight that is 0 at
// the roots and rises toward the tips. Each leaf blob gets one weight so it moves
// as a unit instead of tearing apart, and trunks bend a little below their crowns.

import * as THREE from 'three';
import { PALETTE, TERRAIN } from '../../core/constants.js';
import { range, pick } from '../../core/random.js';
import { prep, sway, tr, jitter, cyl, cone, ico, dodeca, octa, torus, box, boxUp, lathe, extrude, assemble, shade, mix } from './util.js';
import { clamp01 } from '../../core/math.js';

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const randInt = (rng, a, b) => a + Math.floor(rng() * (b - a + 1));
const variantOf = (variant, count) => Math.max(0, Math.min(count - 1, Math.floor(variant) || 0));
// Turn color inputs into THREE.Color stops for ramp().
const stops = (...colors) => colors.map((c) => new THREE.Color(c));
const color = (c) => new THREE.Color(c);

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _e = new THREE.Vector3();
const _f = new THREE.Vector3();
const _cen = new THREE.Vector3();
const _n = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _col = new THREE.Color();
const _ramp = new THREE.Color();

// ---- Geometry helpers (tiles.js uses these too) ----

// Sample a list of THREE.Color stops at t (0..1). Returns a reused color.
export function ramp(list, t) {
  if (list.length === 1) return _ramp.copy(list[0]);
  const x = clamp01(t) * (list.length - 1);
  const i = Math.min(Math.floor(x), list.length - 2);
  return _ramp.copy(list[i]).lerp(list[i + 1], x - i);
}

// Color each triangle with fn(centroid, faceNormal) → color input. Both vectors are
// reused between calls. `vary` randomizes lightness per face, like util.paint().
export function paintFaces(geo, fn, vary = 0, rng = Math.random) {
  const g = prep(geo);
  const p = g.attributes.position;
  const arr = new Float32Array(p.count * 3);
  for (let i = 0; i + 2 < p.count; i += 3) {
    _a.fromBufferAttribute(p, i);
    _b.fromBufferAttribute(p, i + 1);
    _c.fromBufferAttribute(p, i + 2);
    _cen.copy(_a).add(_b).add(_c).multiplyScalar(1 / 3);
    _n.crossVectors(_e.subVectors(_c, _b), _f.subVectors(_a, _b)).normalize();
    _col.set(fn(_cen, _n));
    const k = vary ? 1 + (rng() - 0.5) * 2 * vary : 1;
    for (let j = 0; j < 3; j++) {
      arr[(i + j) * 3] = _col.r * k;
      arr[(i + j) * 3 + 1] = _col.g * k;
      arr[(i + j) * 3 + 2] = _col.b * k;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

// Drop zero-area triangles (lathe poles produce them).
export function clean(geo) {
  const g = prep(geo);
  const p = g.attributes.position;
  const keep = [];
  for (let i = 0; i + 2 < p.count; i += 3) {
    _a.fromBufferAttribute(p, i);
    _b.fromBufferAttribute(p, i + 1);
    _c.fromBufferAttribute(p, i + 2);
    _e.subVectors(_c, _b).cross(_f.subVectors(_a, _b));
    if (_e.lengthSq() > 1e-18) keep.push(i);
  }
  if (keep.length * 3 === p.count) return g;
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(g.attributes)) {
    const size = attr.itemSize;
    const arr = new Float32Array(keep.length * 3 * size);
    keep.forEach((start, k) => {
      for (let j = 0; j < 3 * size; j++) arr[k * 3 * size + j] = attr.array[start * size + j];
    });
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  return out;
}

// Geometry from a flat list of triangle positions.
export function trisGeo(pos) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// A ribbon along `spine` (Vector3 list). `widths` are half-widths per point, and
// `side` is the width direction (one Vector3, or one per point). A zero width
// closes the ribbon to a point. Thin parts like this belong in `foliage` or
// `double`, which render both sides.
export function strip(spine, widths, side) {
  const pos = [];
  const sideAt = (i) => (Array.isArray(side) ? side[i] : side);
  const push = (v) => pos.push(v.x, v.y, v.z);
  for (let i = 0; i < spine.length - 1; i++) {
    const a0 = spine[i].clone().addScaledVector(sideAt(i), -widths[i]);
    const a1 = spine[i].clone().addScaledVector(sideAt(i), widths[i]);
    const b0 = spine[i + 1].clone().addScaledVector(sideAt(i + 1), -widths[i + 1]);
    const b1 = spine[i + 1].clone().addScaledVector(sideAt(i + 1), widths[i + 1]);
    if (widths[i] > 1e-6) {
      push(a0);
      push(a1);
      push(b1);
    }
    if (widths[i + 1] > 1e-6) {
      push(a0);
      push(b1);
      push(b0);
    }
  }
  return trisGeo(pos);
}

// A tapered grass blade from the origin up to height h, w wide at the root. It
// curves toward +X by `bend` at the tip, so rotate it with ry to aim the curve.
export function blade(w, h, bend = 0, segs = 3) {
  const spine = [];
  const widths = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    spine.push(V(bend * t * t, h * t * (1 - 0.15 * (bend / h) ** 2 * t), 0));
    widths.push((w / 2) * (1 - t) ** 0.85);
  }
  return strip(spine, widths, V(0, 0, 1));
}

// Assemble with per-face normals. three r186's MeshToonMaterial has no
// `flatShading` option, so the faceted look has to come from the geometry: on
// non-indexed geometry, computeVertexNormals() gives each triangle its own normal.
export function build({ solid = [], double = [], foliage = [], glow = [] }) {
  for (const g of [...solid, ...double, ...foliage]) g.computeVertexNormals();
  return assemble({ solid, double, foliage, glow });
}

// Rotate a part built around +Y so it follows `dir`, then move it to `at`.
function mount(g, at, dir) {
  g.applyQuaternion(_q.setFromUnitVectors(UP, _dir.copy(dir).normalize()));
  g.translate(at.x, at.y, at.z);
  return g;
}

// Cylinder from point a (radius r0) to point b (radius r1).
function limb(a, b, r0, r1, seg = 6, { hseg = 1, open = false } = {}) {
  const len = Math.max(1e-4, a.distanceTo(b));
  const g = prep(new THREE.CylinderGeometry(r1, r0, len, seg, hseg, open));
  g.translate(0, len / 2, 0);
  return mount(g, a, _e.subVectors(b, a));
}

// Sway weight that rises from 0 at y0 to `max` at y0 + h.
function swayUp(g, y0, h, max = 1, pow = 1.3) {
  return sway(g, (x, y) => max * clamp01((y - y0) / h) ** pow);
}

// Random points in a disk, kept `gap` apart where possible. The first point sits
// near the center when `centerFirst` is set.
function scatter(rng, n, radius, gap, { centerFirst = false } = {}) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    let best = null;
    for (let tries = 0; tries < 24; tries++) {
      const rr = (i === 0 && centerFirst ? 0.25 : 1) * radius * Math.sqrt(rng());
      const a = rng() * TAU;
      const p = V(Math.cos(a) * rr, 0, Math.sin(a) * rr);
      if (pts.every((q) => q.distanceTo(p) >= gap)) {
        best = p;
        break;
      }
      best = best || p;
    }
    pts.push(best);
  }
  return pts;
}

// ---- Shared colors ----

const BARK = stops(PALETTE.trunkDark, PALETTE.trunk, PALETTE.trunk);
const STEM = color(PALETTE.leafDeep);
const LEAVES = stops(PALETTE.leafDeep, PALETTE.leafGreen);
const SNOW = color(TERRAIN.snow.variants[0].top);
const SOIL = color(shade(mix(PALETTE.trunkDark, PALETTE.woodDark, 0.5), -0.06));

function paintBark(g, rng, top = 1.4) {
  return paintFaces(g, (c) => ramp(BARK, c.y / top), 0.07, rng);
}

// ---- Leaf blobs ----

// A jittered low-poly leaf blob centered at c, shaded darker underneath.
function leafBlob(c, r, sy, rng, list, { detail = 1, wob = 0.14, vary = 0.06, speckle = null } = {}) {
  let g = jitter(ico(r, detail), r * wob, rng);
  g = paintFaces(
    g,
    (p) => {
      if (speckle && rng() < speckle.p) return pick(rng, speckle.colors);
      return ramp(list, (p.y + r) / (2 * r) + range(rng, -0.08, 0.08));
    },
    vary,
    rng,
  );
  return tr(g, { x: c.x, y: c.y, z: c.z, sy, ry: rng() * TAU });
}

const _ray = new THREE.Ray();
const _hit = new THREE.Vector3();

// Distance from `origin` along `dir` to the farthest crossing of geometry g.
function surfaceAlong(g, origin, dir) {
  _ray.set(origin, dir);
  const p = g.attributes.position;
  let best = -1;
  for (let i = 0; i + 2 < p.count; i += 3) {
    _a.fromBufferAttribute(p, i);
    _b.fromBufferAttribute(p, i + 1);
    _c.fromBufferAttribute(p, i + 2);
    if (_ray.intersectTriangle(_a, _b, _c, false, _hit)) best = Math.max(best, _hit.distanceTo(origin));
  }
  return best;
}

// Small dots (berries, blossoms) seated on the real surface of blob geometry g,
// half sunk in. `minUp` limits how far down the blob they go; `flat` squashes
// them along the surface normal.
function blobDots(b, g, n, rng, colors, size, w, out, { minUp = -0.1, flat = 1, shape = ico } = {}) {
  for (let i = 0; i < n; i++) {
    const u = range(rng, minUp, 1);
    const s = Math.sqrt(1 - u * u);
    const a = rng() * TAU;
    const dir = V(Math.cos(a) * s, u * b.sy, Math.sin(a) * s).normalize();
    const d = surfaceAlong(g, b.c, dir);
    if (d <= 0) continue;
    const dot = paintFaces(tr(shape(size * range(rng, 0.8, 1.2), 0), { sy: flat, ry: rng() * TAU }), () => pick(rng, colors), 0.05, rng);
    out.push(sway(mount(dot, b.c.clone().addScaledVector(dir, d), dir), w));
  }
}

// ---- Round tree ----

const ROUND_LEAVES = [
  stops(PALETTE.leafDeep, PALETTE.leafGreen, PALETTE.leafLight),
  null,
  stops(PALETTE.blossomDeep, PALETTE.blossom, mix(PALETTE.blossom, PALETTE.flowerWhite, 0.35)),
];
const AUTUMN = [PALETTE.leafAutumn, PALETTE.leafRust, PALETTE.leafGold];

function treeRound(variant, rng) {
  const v = variantOf(variant, 3);
  const foliage = [];
  const H = range(rng, 3.6, 4.4);
  const crownR = range(rng, 1.1, 1.3);
  const crownSy = range(rng, 0.84, 0.94);
  const cy = H - crownR * crownSy;
  const lx = range(rng, -0.16, 0.16);
  const lz = range(rng, -0.16, 0.16);
  const wAt = (y) => 0.85 * clamp01(y / H) ** 1.6;
  const trunkAt = (y) => V((lx * y) / cy, y, (lz * y) / cy);

  // Crown: one main blob and 1–3 smaller side blobs.
  const blobs = [{ c: V(lx, cy, lz), r: crownR, sy: crownSy }];
  const extra = randInt(rng, 1, 3);
  const a0 = rng() * TAU;
  for (let i = 0; i < extra; i++) {
    const a = a0 + (i / extra) * TAU + range(rng, -0.4, 0.4);
    const d = crownR * range(rng, 0.55, 0.72);
    blobs.push({
      c: V(lx + Math.cos(a) * d, cy + crownR * range(rng, -0.6, -0.05), lz + Math.sin(a) * d),
      r: crownR * range(rng, 0.52, 0.68),
      sy: range(rng, 0.82, 0.95),
    });
  }

  // Trunk, root flare, and a branch or two reaching into the lowest side blobs.
  const wood = [limb(V(), trunkAt(cy), 0.24, 0.13, 6), tr(cyl(0.22, 0.34, 0.3, 6), { ry: rng() * TAU })];
  const sides = blobs.slice(1).sort((p, q) => p.c.y - q.c.y);
  const branches = Math.min(sides.length, randInt(rng, 1, 2));
  for (let i = 0; i < branches; i++) {
    const from = trunkAt(cy - crownR * crownSy * range(rng, 0.75, 1.0));
    wood.push(limb(from, from.clone().lerp(sides[i].c, 0.8), 0.075, 0.04, 5));
  }
  for (const g of wood) foliage.push(sway(paintBark(g, rng), (x, y) => wAt(y)));

  const white = stops(PALETTE.flowerWhite, PALETTE.flowerWhite, PALETTE.blossomDeep);
  for (const b of blobs) {
    let list = ROUND_LEAVES[v];
    let speckle = null;
    if (v === 1) {
      const base = pick(rng, AUTUMN);
      list = stops(shade(base, -0.1), base, shade(base, 0.07));
      speckle = { p: 0.14, colors: stops(...AUTUMN) };
    }
    const w = wAt(b.c.y);
    const g = leafBlob(b.c, b.r, b.sy, rng, list, { speckle });
    foliage.push(sway(g, w));
    if (v === 2) blobDots(b, g, randInt(rng, 4, 7), rng, white, 0.085, w, foliage, { minUp: -0.3, flat: 0.6 });
  }
  return build({ foliage });
}

// ---- Pine tree ----

const PINE = [PALETTE.pineGreen, PALETTE.pineBlue, mix(PALETTE.pineGreen, PALETTE.pineBlue, 0.3)];

function treePine(variant, rng) {
  const v = variantOf(variant, 3);
  const foliage = [];
  const H = range(rng, 4.2, 5.8);
  const tiers = randInt(rng, 3, 5);
  const bare = range(rng, 0.5, 0.8);
  const rBase = range(rng, 1.1, 1.35);
  const gap = (H - bare) / (tiers + 0.9);
  const th = gap * 1.9;
  const wAt = (y) => 0.75 * clamp01(y / H) ** 1.5;
  const base = PINE[v];
  const list = stops(shade(base, -0.07), base, shade(base, 0.06));
  const under = color(shade(base, -0.1));
  const snowy = v === 2;

  const trunk = [limb(V(), V(0, bare + gap * 1.4, 0), 0.19, 0.1, 6), tr(cyl(0.17, 0.27, 0.22, 6), { ry: rng() * TAU })];
  for (const g of trunk) foliage.push(sway(paintBark(g, rng), (x, y) => wAt(y)));

  for (let i = 0; i < tiers; i++) {
    const r = rBase * (1 - 0.62 * (i / Math.max(1, tiers - 1))) * range(rng, 0.94, 1.06);
    let g = clean(lathe([[0.1, th * 0.18], [r, 0], [r * 0.56, th * 0.45], [0, th]], 9));
    g = jitter(g, 0.06, rng, { y: 1.5 });
    g = paintFaces(
      g,
      (c, n) => {
        if (snowy && n.y > 0.1 && (c.y > th * 0.3 || rng() < 0.25)) return SNOW;
        if (n.y < -0.2) return under;
        return ramp(list, c.y / th);
      },
      0.05,
      rng,
    );
    tr(g, { y: bare + i * gap, ry: rng() * TAU });
    foliage.push(sway(g, (x, y) => wAt(y)));
  }
  return build({ foliage });
}

// ---- Birch tree ----

// Birch trunk: white bark with thin rings of dark horizontal marks.
function birchTrunk(a, b, r0, r1, rng) {
  const len = a.distanceTo(b);
  const seg = 6;
  // Alternate tall plain rings with thin mark rings.
  const m = Math.max(3, Math.round(len / 0.5));
  const markH = Array.from({ length: m }, () => range(rng, 0.05, 0.08));
  const weights = Array.from({ length: m + 1 }, () => range(rng, 0.6, 1.4));
  const free = len - markH.reduce((s, h) => s + h, 0);
  const wsum = weights.reduce((s, w) => s + w, 0);
  const Y = [0];
  for (let i = 0; i <= m; i++) {
    Y.push(Y[Y.length - 1] + (weights[i] / wsum) * free);
    if (i < m) Y.push(Y[Y.length - 1] + markH[i]);
  }
  const hseg = 2 * m + 1;
  const g = prep(new THREE.CylinderGeometry(r1, r0, len, seg, hseg));
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, Y[Math.round(((p.getY(i) + len / 2) / len) * hseg)]);

  // Each mark ring gets one or two short dark dashes.
  const dark = new Set();
  for (let j = 0; j < m; j++) {
    const ring = 2 * j + 1;
    const dashes = rng() < 0.3 ? 2 : 1;
    for (let d = 0; d < dashes; d++) {
      const s0 = randInt(rng, 0, seg - 1);
      const width = randInt(rng, 1, 3);
      for (let s = 0; s < width; s++) dark.add(ring * 16 + ((s0 + s) % seg));
    }
  }
  const bark = color(PALETTE.birchBark);
  const mark = color(PALETTE.birchMark);
  const foot = color(mix(PALETTE.birchBark, PALETTE.birchMark, 0.45));
  const painted = paintFaces(
    g,
    (c, n) => {
      if (Math.abs(n.y) > 0.9) return bark;
      let ring = 0;
      while (ring < hseg - 1 && c.y > Y[ring + 1]) ring++;
      if (ring === 0) return foot;
      const s = Math.floor((((Math.atan2(c.x, c.z) / TAU) % 1) + 1) % 1 * seg);
      return dark.has(ring * 16 + s) ? mark : bark;
    },
    0.03,
    rng,
  );
  return mount(painted, a, _e.subVectors(b, a));
}

const BIRCH_LEAVES = [
  stops(PALETTE.leafGreen, PALETTE.leafLight, mix(PALETTE.leafLight, PALETTE.flowerYellow, 0.3)),
  stops(PALETTE.leafAutumn, PALETTE.leafGold, mix(PALETTE.leafGold, PALETTE.flowerWhite, 0.3)),
];

function treeBirch(variant, rng) {
  const v = variantOf(variant, 2);
  const foliage = [];
  const H = range(rng, 4.0, 5.0);
  const wAt = (y) => 0.9 * clamp01(y / H) ** 1.6;
  const twig = stops(mix(PALETTE.birchMark, PALETTE.trunk, 0.5));

  const stems = [{ base: V(), top: V(range(rng, -0.22, 0.22), H - 0.55, range(rng, -0.22, 0.22)), r0: 0.13, clusters: 5 }];
  if (rng() < 0.4) {
    // A second, thinner trunk leaning away from the first.
    const a = rng() * TAU;
    stems[0].base = V(-Math.cos(a) * 0.06, 0, -Math.sin(a) * 0.06);
    stems.push({
      base: V(Math.cos(a) * 0.12, 0, Math.sin(a) * 0.12),
      top: V(Math.cos(a) * 0.6, H * range(rng, 0.62, 0.74), Math.sin(a) * 0.6),
      r0: 0.09,
      clusters: 2,
    });
  }

  for (const s of stems) {
    foliage.push(sway(birchTrunk(s.base, s.top, s.r0, 0.045, rng), (x, y) => wAt(y)));
    const at = (t) => s.base.clone().lerp(s.top, t);
    const blobs = [{ c: s.top.clone().add(V(0, 0.12, 0)), r: range(rng, 0.4, 0.5), sy: 0.9 }];
    for (let k = 0; k < s.clusters; k++) {
      const t = range(rng, 0.42, 0.92);
      const a = (k / s.clusters) * TAU + range(rng, -0.5, 0.5);
      const d = range(rng, 0.4, 0.8) * (1.2 - t * 0.5);
      const p = at(t);
      const b = {
        c: V(p.x + Math.cos(a) * d, p.y + range(rng, 0, 0.25), p.z + Math.sin(a) * d),
        r: range(rng, 0.4, 0.56) * (1.1 - 0.3 * t),
        sy: range(rng, 0.8, 0.92),
      };
      blobs.push(b);
      if (d > 0.3) {
        const g = limb(at(t - 0.08), b.c.clone().lerp(p, 0.25), 0.035, 0.02, 4);
        foliage.push(sway(paintFaces(g, () => twig[0], 0.05, rng), (x, y) => wAt(y)));
      }
    }
    for (const b of blobs) foliage.push(sway(leafBlob(b.c, b.r, b.sy, rng, BIRCH_LEAVES[v]), wAt(b.c.y)));
  }
  return build({ foliage });
}

// ---- Willow tree ----

const WILLOW = [
  {
    crown: stops(PALETTE.leafDeep, PALETTE.leafGreen, PALETTE.leafLight),
    strand: stops(PALETTE.leafGreen, PALETTE.leafLight, mix(PALETTE.leafLight, PALETTE.flowerYellow, 0.2)),
  },
  {
    crown: stops(
      mix(PALETTE.pineBlue, PALETTE.leafGreen, 0.5),
      mix(PALETTE.leafLight, PALETTE.pineBlue, 0.35),
      mix(PALETTE.leafLight, PALETTE.flowerWhite, 0.45),
    ),
    strand: stops(
      mix(PALETTE.leafLight, PALETTE.pineBlue, 0.4),
      mix(PALETTE.leafLight, PALETTE.flowerWhite, 0.4),
      mix(PALETTE.leafLight, PALETTE.flowerWhite, 0.65),
    ),
  },
];

function treeWillow(variant, rng) {
  const v = variantOf(variant, 2);
  const colors = WILLOW[v];
  const foliage = [];
  const H = range(rng, 3.8, 4.3);
  const crownR = range(rng, 1.35, 1.55);
  const crownSy = 0.62;
  const cy = H - 0.85;
  const cx = range(rng, -0.12, 0.12);
  const cz = range(rng, -0.12, 0.12);
  const wc = 0.45;
  const wAt = (y) => wc * clamp01(y / cy) ** 2;

  // Short thick trunk that forks into 2–3 limbs under the crown.
  const fork = V(cx * 0.5, range(rng, 1.3, 1.7), cz * 0.5);
  const wood = [limb(V(), fork, 0.3, 0.21, 7), tr(cyl(0.27, 0.4, 0.3, 7), { ry: rng() * TAU })];
  const limbs = randInt(rng, 2, 3);
  const la = rng() * TAU;
  for (let i = 0; i < limbs; i++) {
    const a = la + (i / limbs) * TAU + range(rng, -0.3, 0.3);
    const d = range(rng, 0.35, 0.6);
    wood.push(limb(fork, V(cx + Math.cos(a) * d, cy - 0.1, cz + Math.sin(a) * d), 0.17, 0.09, 6));
  }
  for (const g of wood) foliage.push(sway(paintBark(g, rng, 2), (x, y) => wAt(y)));

  // Broad, flattened crown with a couple of bumps on top.
  foliage.push(sway(leafBlob(V(cx, cy, cz), crownR, crownSy, rng, colors.crown, { wob: 0.1 }), wc));
  const bumps = randInt(rng, 2, 3);
  const ba = rng() * TAU;
  for (let i = 0; i < bumps; i++) {
    const a = ba + (i / bumps) * TAU + range(rng, -0.4, 0.4);
    const d = crownR * range(rng, 0.25, 0.5);
    const r = range(rng, 0.55, 0.75);
    const c = V(cx + Math.cos(a) * d, cy + 0.2, cz + Math.sin(a) * d);
    foliage.push(sway(leafBlob(c, r, 0.68, rng, colors.crown), wc + 0.05));
  }

  // Hanging strands: an outer curtain and a shorter inner ring.
  const strands = [];
  const outer = randInt(rng, 22, 28);
  for (let k = 0; k < outer; k++) {
    strands.push({
      a: ((k + range(rng, 0, 0.6)) / outer) * TAU,
      r: crownR * range(rng, 0.8, 0.94),
      y0: cy + range(rng, -0.15, 0.12),
      y1: range(rng, 0.6, 1.3),
      out: range(rng, 0.12, 0.28),
      w: range(rng, 0.11, 0.16),
    });
  }
  for (let k = 0; k < Math.round(outer / 2); k++) {
    strands.push({
      a: rng() * TAU,
      r: crownR * range(rng, 0.45, 0.65),
      y0: cy - range(rng, 0.2, 0.35),
      y1: range(rng, 1.3, 2.0),
      out: range(rng, 0.05, 0.15),
      w: range(rng, 0.1, 0.14),
    });
  }
  for (const s of strands) {
    const spine = [];
    const widths = [];
    const segs = 4;
    for (let j = 0; j <= segs; j++) {
      const t = j / segs;
      const rr = s.r + s.out * Math.sin(Math.min(1, t * 1.8) * (Math.PI / 2));
      spine.push(V(cx + Math.cos(s.a) * rr, s.y0 - (s.y0 - s.y1) * t ** 1.1, cz + Math.sin(s.a) * rr));
      widths.push(j === segs ? 0 : s.w * (1 - 0.5 * t) * range(rng, 0.85, 1.15));
    }
    const drop = s.y0 - s.y1;
    let g = strip(spine, widths, V(-Math.sin(s.a), 0, Math.cos(s.a)));
    g = paintFaces(g, (c) => ramp(colors.strand, (s.y0 - c.y) / drop), 0.07, rng);
    foliage.push(sway(g, (x, y) => wc + (1.4 - wc) * clamp01((s.y0 - y) / drop) ** 1.4));
  }
  return build({ foliage });
}

// ---- Bush ----

const BUSH = [
  stops(PALETTE.leafDeep, PALETTE.leafGreen, PALETTE.leafLight),
  stops(shade(PALETTE.leafDeep, -0.05), PALETTE.leafDeep, PALETTE.leafGreen),
  stops(PALETTE.leafDeep, PALETTE.leafGreen, PALETTE.leafLight),
];
const BERRIES = stops(shade(PALETTE.flowerRed, -0.1), PALETTE.flowerRed);
const BUSH_FLOWERS = stops(PALETTE.flowerPink, PALETTE.flowerWhite, PALETTE.blossom);

function bush(variant, rng) {
  const v = variantOf(variant, 3);
  const foliage = [];
  const r0 = range(rng, 0.46, 0.56);
  const blobs = [{ c: V(0, r0 * 0.85, 0), r: r0, sy: 0.95 }];
  const n = randInt(rng, 2, 3);
  const a0 = rng() * TAU;
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * TAU + range(rng, -0.35, 0.35);
    const r = range(rng, 0.28, 0.4);
    const d = range(rng, 0.32, 0.46);
    blobs.push({ c: V(Math.cos(a) * d, r * range(rng, 0.7, 0.9), Math.sin(a) * d), r, sy: 0.9 });
  }
  if (rng() < 0.5) {
    const r = range(rng, 0.26, 0.32);
    blobs.push({ c: V(range(rng, -0.12, 0.12), r0 * 1.45, range(rng, -0.12, 0.12)), r, sy: 0.9 });
  }
  for (const b of blobs) {
    const w = 0.2 + 0.3 * clamp01(b.c.y / 1.0);
    const g = leafBlob(b.c, b.r, b.sy, rng, BUSH[v]);
    foliage.push(sway(g, w));
    // Octahedra keep the dot count high on a small triangle budget.
    const dots = Math.round(b.r * range(rng, 9, 11));
    if (v === 1) blobDots(b, g, dots, rng, BERRIES, 0.06, w, foliage, { minUp: -0.35, shape: octa });
    if (v === 2) blobDots(b, g, dots, rng, BUSH_FLOWERS, 0.08, w, foliage, { minUp: -0.2, flat: 0.5, shape: octa });
  }
  return build({ foliage });
}

// ---- Stump and logs ----

const RINGS = stops(PALETTE.wood, PALETTE.woodLight, mix(PALETTE.woodLight, PALETTE.wood, 0.55), PALETTE.woodLight);
const BARK_RIM = color(PALETTE.trunkDark);
const MOSS = stops(shade(PALETTE.moss, -0.06), PALETTE.moss, shade(PALETTE.moss, 0.06));

// End-grain color for a point `d` (0 at the center, 1 at the bark) on a cut face.
function endGrain(d) {
  if (d > 0.86) return BARK_RIM;
  return RINGS[Math.min(RINGS.length - 1, Math.floor(d / 0.24))];
}

function stump(rng) {
  const solid = [];
  const r = range(rng, 0.36, 0.44);
  const h = range(rng, 0.42, 0.6);
  const top = h + 0.02;
  let g = lathe(
    [
      [0, 0], [r * 1.25, 0], [r * 1.05, 0.12], [r, h * 0.6], [r * 0.98, h],
      [r * 0.86, top], [r * 0.62, top], [r * 0.38, top], [r * 0.16, top], [0, top],
    ],
    9,
  );
  g = jitter(clean(g), 0.02, rng, { y: 0.4 });
  g = paintFaces(
    g,
    (c, n) => {
      if (n.y > 0.8 && c.y > h) return endGrain(Math.hypot(c.x, c.z) / r);
      return ramp(BARK, c.y / h);
    },
    0.06,
    rng,
  );
  solid.push(tr(g, { ry: rng() * TAU }));

  // Roots spreading into the ground.
  const roots = randInt(rng, 3, 4);
  const a0 = rng() * TAU;
  for (let i = 0; i < roots; i++) {
    const a = a0 + (i / roots) * TAU + range(rng, -0.3, 0.3);
    const reach = r + range(rng, 0.16, 0.24);
    const from = V(Math.cos(a) * r * 0.8, 0.16, Math.sin(a) * r * 0.8);
    const to = V(Math.cos(a) * reach, -0.03, Math.sin(a) * reach);
    solid.push(paintBark(limb(from, to, 0.13, 0.06, 5), rng, h));
  }
  const parts = { solid, glow: [] };
  if (rng() < 0.5) {
    const a = rng() * TAU;
    mushroom(Math.cos(a) * (r + 0.12), Math.sin(a) * (r + 0.12), range(rng, 0.12, 0.18), 'brown', rng, parts);
  }
  return parts;
}

function log(rng, mossy) {
  const solid = [];
  const L = range(rng, 1.6, 1.95);
  const r = range(rng, 0.22, 0.28);
  const cy = r * 0.85;
  let g = lathe(
    [
      [0, 0], [r * 0.38, 0], [r * 0.62, 0], [r * 0.9, 0], [r, 0.04], [r * 1.03, L * 0.5],
      [r, L - 0.04], [r * 0.9, L], [r * 0.62, L], [r * 0.38, L], [0, L],
    ],
    8,
  );
  g = jitter(clean(g), 0.02, rng);
  tr(g, { rz: Math.PI / 2, rx: rng() * TAU });
  g.translate(L / 2, cy, 0);
  const phase = rng() * TAU;
  g = paintFaces(
    g,
    (c, n) => {
      if (Math.abs(n.x) > 0.75) return endGrain(Math.hypot(c.y - cy, c.z) / r);
      if (mossy && n.y > 0.3 && Math.sin(c.x * 3.2 + phase) > -0.35) return ramp(MOSS, n.y);
      return ramp(BARK, (c.y / (2 * r)) * 1.4);
    },
    0.06,
    rng,
  );
  solid.push(g);

  // A broken branch stub on top.
  const bx = range(rng, -L * 0.25, L * 0.25);
  const stubFrom = V(bx, cy + r * 0.5, range(rng, -0.05, 0.05));
  const stubTo = stubFrom.clone().add(V(range(rng, -0.12, 0.12), r * 0.7 + 0.12, range(rng, -0.12, 0.12)));
  solid.push(paintBark(limb(stubFrom, stubTo, 0.075, 0.05, 5), rng, 0.4));

  const parts = { solid, glow: [] };
  if (mossy) {
    // Moss lumps along the top and a tiny mushroom near one end.
    const lumps = randInt(rng, 2, 3);
    for (let i = 0; i < lumps; i++) {
      const mr = range(rng, 0.12, 0.18);
      const x = range(rng, -L * 0.4, L * 0.4);
      const m = paintFaces(jitter(ico(mr, 1), mr * 0.15, rng), () => pick(rng, MOSS), 0.05, rng);
      solid.push(tr(m, { x, y: cy + r * 0.9, z: range(rng, -0.06, 0.06), sy: 0.45, ry: rng() * TAU }));
    }
    const side = rng() < 0.5 ? -1 : 1;
    mushroom(side * L * range(rng, 0.25, 0.4), r * 0.95, range(rng, 0.12, 0.16), 'red', rng, parts, cy * 0.6);
  }
  return parts;
}

function stumpLog(variant, rng) {
  const v = variantOf(variant, 3);
  const parts = v === 0 ? stump(rng) : log(rng, v === 2);
  return build(parts);
}

// ---- Mushrooms ----

const MUSH = {
  red: { cap: PALETTE.mushroomRed, dome: 0.75, width: 0.5, stem: PALETTE.flowerWhite },
  brown: { cap: PALETTE.mushroomCap, dome: 0.5, width: 0.62, stem: mix(PALETTE.flowerWhite, PALETTE.woodLight, 0.3) },
  glow: { cap: PALETTE.mushroomGlow, dome: 0.95, width: 0.42, stem: mix(PALETTE.flowerWhite, PALETTE.mushroomGlow, 0.3) },
};
const GILLS = {
  red: color(mix(PALETTE.flowerWhite, PALETTE.woodLight, 0.35)),
  brown: color(mix(PALETTE.woodLight, PALETTE.flowerWhite, 0.4)),
  glow: color(mix(PALETTE.mushroomGlow, PALETTE.pineBlue, 0.55)),
};
const DOTS = color(PALETTE.flowerWhite);

// One mushroom standing at (x, y0, z), h tall. Pushes into parts.solid and parts.glow.
function mushroom(x, z, h, kind, rng, parts, y0 = 0) {
  const k = MUSH[kind];
  const sr = h * range(rng, 0.1, 0.13);
  const cr = h * k.width * range(rng, 0.9, 1.1);
  const ch = cr * k.dome;
  const base = V(x, y0, z);
  const top = V(x + range(rng, -0.15, 0.15) * h, y0 + h - ch * 0.65, z + range(rng, -0.15, 0.15) * h);
  const stem = paintFaces(limb(base, top, sr * 1.2, sr * 0.85, 6), () => k.stem, 0.04, rng);
  parts.solid.push(stem);

  // The cap sits so the stem top hides inside the dome.
  const dir = top.clone().sub(base).normalize();
  const at = top.clone().addScaledVector(dir, -ch * 0.35);
  // Brown caps are paler at the rim; the others brighten toward the top.
  const edge = kind === 'brown' ? 0.08 : -0.05;
  const capList = stops(shade(k.cap, edge), k.cap, shade(k.cap, -edge));
  const under = paintFaces(clean(lathe([[sr * 0.8, ch * 0.22], [cr, 0]], 8)), () => GILLS[kind], 0.04, rng);
  parts.solid.push(mount(under, at, dir));
  let dome = clean(lathe([[cr, 0], [cr * 0.86, ch * 0.5], [cr * 0.5, ch * 0.88], [0, ch]], 8));
  dome = jitter(dome, cr * 0.04, rng);
  if (kind === 'glow') {
    parts.glow.push([mount(dome, at, dir), PALETTE.mushroomGlow]);
    return;
  }
  parts.solid.push(mount(paintFaces(dome, (c) => ramp(capList, c.y / ch), 0.05, rng), at, dir));

  if (kind === 'red') {
    const dots = Math.max(2, Math.min(6, Math.round(cr / 0.035)));
    for (let i = 0; i < dots; i++) {
      const phi = range(rng, 0.2, 1.15);
      const th = rng() * TAU;
      const nrm = V(Math.sin(phi) * Math.sin(th), Math.cos(phi), Math.sin(phi) * Math.cos(th));
      const spot = V(nrm.x * cr * 0.93, nrm.y * ch * 0.95, nrm.z * cr * 0.93);
      const d = paintFaces(tr(octa(cr * range(rng, 0.11, 0.16), 0), { sy: 0.45 }), () => DOTS, 0, rng);
      parts.solid.push(mount(mount(d, spot, nrm), at, dir));
    }
  }
}

function mushrooms(variant, rng) {
  const v = variantOf(variant, 3);
  const kind = ['red', 'brown', 'glow'][v];
  const parts = { solid: [], glow: [] };
  const spots = scatter(rng, randInt(rng, 3, 6), 0.34, 0.13, { centerFirst: true });
  spots.forEach((p, i) => {
    const h = i === 0 ? range(rng, 0.34, 0.45) : range(rng, 0.14, 0.3);
    mushroom(p.x, p.z, h, kind, rng, parts);
  });
  return build(parts);
}

// ---- Flowers ----

// Stem tip for a flower of height h rooted at base, leaning a little.
function stemTip(base, h, rng, lean = 0.12) {
  const a = rng() * TAU;
  const l = range(rng, 0, lean) * h;
  return V(base.x + Math.cos(a) * l, base.y + h, base.z + Math.sin(a) * l);
}

function addStem(out, base, top, r, c, rng) {
  const g = paintFaces(limb(base, top, r, r * 0.8, 3, { open: true }), () => c, 0.05, rng);
  out.push(swayUp(g, base.y, top.y - base.y));
}

function addLeaves(out, base, n, rng, { w = 0.06, h = 0.18, tilt = 0.5, list = LEAVES, max = 0.5 } = {}) {
  for (let i = 0; i < n; i++) {
    const lh = h * range(rng, 0.8, 1.2);
    let g = blade(w * range(rng, 0.8, 1.2), lh, lh * range(rng, 0.15, 0.4), 2);
    g = paintFaces(g, (c) => ramp(list, c.y / lh), 0.05, rng);
    tr(g, { rz: -range(rng, 0.1, tilt), ry: rng() * TAU, x: base.x, y: base.y, z: base.z });
    out.push(swayUp(g, base.y, lh, max));
  }
}

function tulip(out, base, rng, petal, size = 1) {
  const h = range(rng, 0.28, 0.42) * size;
  const top = stemTip(base, h, rng);
  addStem(out, base, top, 0.012, STEM, rng);
  const head = lathe([[0.012, -0.01], [0.058, 0.05], [0.042, 0.115]], 6);
  // Raise every other rim vertex into a petal tip.
  const p = head.attributes.position;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) < 0.1) continue;
    const k = Math.round(Math.atan2(p.getX(i), p.getZ(i)) / (TAU / 6));
    if (((k % 2) + 2) % 2 === 0) p.setY(i, 0.15);
  }
  const list = stops(shade(petal, -0.08), petal, shade(petal, 0.05));
  const hs = 1.2 * size;
  const g = paintFaces(tr(head, { s: hs, ry: rng() * TAU }), (c) => ramp(list, c.y / (0.14 * hs)), 0.04, rng);
  out.push(sway(mount(g, top, top.clone().sub(base)), 1));
  addLeaves(out, base, 2, rng, { w: 0.07, h: h * 0.6, tilt: 0.45 });
}

function daisy(out, base, rng, petal, size = 1) {
  const h = range(rng, 0.26, 0.4) * size;
  const top = stemTip(base, h, rng);
  addStem(out, base, top, 0.01, STEM, rng);
  const n = 8;
  const L = range(rng, 0.09, 0.11) * size;
  const w = L * 0.34;
  const pos = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * TAU + range(rng, -0.12, 0.12);
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const v0 = [dx * 0.012, 0.004, dz * 0.012];
    const v1 = [dx * L * 0.45 - dz * w * 0.5, 0.008, dz * L * 0.45 + dx * w * 0.5];
    const v2 = [dx * L, -0.006, dz * L];
    const v3 = [dx * L * 0.45 + dz * w * 0.5, 0.008, dz * L * 0.45 - dx * w * 0.5];
    pos.push(...v0, ...v1, ...v2, ...v0, ...v2, ...v3);
  }
  const dir = top.clone().sub(base).normalize().add(V(range(rng, -0.35, 0.35), 0, range(rng, -0.35, 0.35)));
  const petals = paintFaces(trisGeo(pos), () => petal, 0.05, rng);
  out.push(sway(mount(petals, top, dir), 1));
  const center = paintFaces(tr(cone(0.032 * size, 0.026 * size, 5), { y: 0.002 }), () => PALETTE.flowerYellow, 0.04, rng);
  out.push(sway(mount(center, top, dir), 1));
  addLeaves(out, base, 2, rng, { w: 0.055, h: h * 0.45, tilt: 0.9 });
}

// A round bloom on a stem: used in flower beds.
function bloom(out, base, rng, petal, size = 1) {
  const h = range(rng, 0.24, 0.36) * size;
  const top = stemTip(base, h, rng);
  addStem(out, base, top, 0.01, STEM, rng);
  const g = paintFaces(jitter(ico(0.045 * size, 0), 0.008, rng), () => petal, 0.06, rng);
  out.push(sway(tr(g, { x: top.x, y: top.y + 0.02, z: top.z, sy: 0.8 }), 1));
  addLeaves(out, base, 1, rng, { w: 0.05, h: h * 0.5 });
}

const LAVENDER = stops(shade(PALETTE.flowerPurple, -0.08), PALETTE.flowerPurple, mix(PALETTE.flowerPurple, PALETTE.blossom, 0.25));
const LAVENDER_LEAVES = stops(mix(PALETTE.leafDeep, PALETTE.rock, 0.35), mix(PALETTE.leafLight, PALETTE.rock, 0.4));

function lavenderClump(out, base, rng, stems) {
  addLeaves(out, base, randInt(rng, 4, 5), rng, { w: 0.035, h: 0.16, tilt: 0.9, list: LAVENDER_LEAVES, max: 0.4 });
  for (let i = 0; i < stems; i++) {
    const h = range(rng, 0.38, 0.55);
    const a = rng() * TAU;
    const l = range(rng, 0.12, 0.3) * h;
    const root = V(base.x + range(rng, -0.04, 0.04), 0, base.z + range(rng, -0.04, 0.04));
    const top = V(root.x + Math.cos(a) * l, h, root.z + Math.sin(a) * l);
    addStem(out, root, top, 0.008, LAVENDER_LEAVES[0], rng);
    // A spike of buds along the top third.
    for (let j = 0; j < 3; j++) {
      const t = 0.72 + j * 0.11;
      const p = root.clone().lerp(top, t);
      const s = 0.028 * (1 - j * 0.15);
      const g = paintFaces(octa(s, 0), () => ramp(LAVENDER, j / 2 + range(rng, -0.2, 0.2)), 0.05, rng);
      tr(g, { x: p.x, y: p.y, z: p.z, sy: 1.6, ry: rng() * TAU });
      out.push(sway(g, t ** 1.3));
    }
  }
}

function poppy(out, base, rng, petal) {
  const h = range(rng, 0.32, 0.48);
  const top = stemTip(base, h, rng, 0.18);
  addStem(out, base, top, 0.009, STEM, rng);
  const list = stops(shade(petal, -0.12), petal, shade(petal, 0.04));
  let head = lathe([[0.014, 0], [0.075, 0.026], [0.1, 0.07]], 6);
  head = paintFaces(tr(head, { ry: rng() * TAU }), (c) => ramp(list, c.y / 0.07), 0.05, rng);
  const dir = top.clone().sub(base);
  out.push(sway(mount(head, top, dir), 1));
  const eye = paintFaces(octa(0.027, 0), () => shade(PALETTE.birchMark, -0.08), 0, rng);
  out.push(sway(mount(tr(eye, { y: 0.018, sy: 0.7 }), top, dir), 1));
  addLeaves(out, base, 1, rng, { w: 0.05, h: h * 0.4, tilt: 0.8 });
}

function poppyBud(out, base, rng) {
  const h = range(rng, 0.25, 0.35);
  const top = stemTip(base, h, rng, 0.3);
  addStem(out, base, top, 0.008, STEM, rng);
  const g = paintFaces(ico(0.028, 0), () => PALETTE.leafGreen, 0.05, rng);
  out.push(sway(tr(g, { x: top.x, y: top.y - 0.02, z: top.z, sy: 1.4, rz: 0.6 }), 1));
}

const TULIP_COLORS = [PALETTE.flowerRed, PALETTE.flowerPink, PALETTE.flowerYellow, PALETTE.flowerOrange, PALETTE.flowerWhite];
const DAISY_COLORS = [PALETTE.flowerWhite, PALETTE.flowerWhite, PALETTE.flowerWhite, mix(PALETTE.flowerWhite, PALETTE.flowerPink, 0.4)];

function flowers(variant, rng) {
  const v = variantOf(variant, 4);
  const foliage = [];
  if (v === 2) {
    // Lavender grows in a few mounded clumps.
    const clumps = randInt(rng, 2, 3);
    for (const p of scatter(rng, clumps, 0.55, 0.35)) lavenderClump(foliage, p, rng, randInt(rng, 4, 5));
    return build({ foliage });
  }
  const counts = [[7, 11], [9, 13], null, [7, 11]][v];
  const spots = scatter(rng, randInt(rng, counts[0], counts[1]), 0.68, 0.14);
  const tulipSet = [pick(rng, TULIP_COLORS), pick(rng, TULIP_COLORS)];
  spots.forEach((p, i) => {
    if (v === 0) tulip(foliage, p, rng, pick(rng, tulipSet));
    if (v === 1) daisy(foliage, p, rng, pick(rng, DAISY_COLORS));
    if (v === 3) {
      if (i < 2 && rng() < 0.6) poppyBud(foliage, p, rng);
      else poppy(foliage, p, rng, rng() < 0.75 ? PALETTE.flowerRed : PALETTE.flowerOrange);
    }
  });
  return build({ foliage });
}

// ---- Moonflowers ----

// The mushroom fairy's gift: pale trumpet blooms that glow after dark.
const MOON_PETALS = ['#dce9ff', '#ffd6e8'];
const MOON_EYE = '#fff1b8';
const MOON_LEAVES = stops(PALETTE.leafDeep, mix(PALETTE.leafGreen, PALETTE.pineBlue, 0.25));

// A five-pointed star cupped around a throat, two-sided so it reads from below.
function moonBloom(R) {
  const pos = [];
  const throat = [0, -R * 0.4, 0];
  const rim = [];
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * TAU;
    const r = k % 2 === 0 ? R : R * 0.6;
    rim.push([Math.cos(a) * r, k % 2 === 0 ? R * 0.12 : 0, Math.sin(a) * r]);
  }
  for (let k = 0; k < 10; k++) {
    const a = rim[k];
    const b = rim[(k + 1) % 10];
    pos.push(...throat, ...b, ...a, ...throat, ...a, ...b);
  }
  return trisGeo(pos);
}

function moonflower(variant, rng) {
  const v = variantOf(variant, 2);
  const solid = [];
  const foliage = [];
  const glow = [];
  const spots = scatter(rng, randInt(rng, 3, 5), 0.24, 0.12, { centerFirst: true });
  spots.forEach((p, i) => {
    // Tall enough to bloom above the grass.
    const h = i === 0 ? range(rng, 0.5, 0.6) : range(rng, 0.32, 0.46);
    const top = stemTip(p, h, rng, 0.2);
    solid.push(paintFaces(limb(p, top, 0.012, 0.009, 4), () => STEM, 0.05, rng));
    // Blooms face up and a little outward, like they're looking for the moon.
    const dir = V(top.x - p.x, 0, top.z - p.z).multiplyScalar(2.2).add(V(range(rng, -0.2, 0.2), 1, range(rng, -0.2, 0.2)));
    const R = range(rng, 0.085, 0.105) * (i === 0 ? 1.15 : 1);
    glow.push([mount(tr(moonBloom(R), { ry: rng() * TAU }), top, dir), MOON_PETALS[v]]);
    glow.push([mount(tr(octa(R * 0.22, 0), { y: -R * 0.12, sy: 0.7 }), top, dir), MOON_EYE]);
    addLeaves(foliage, p, 2, rng, { w: 0.09, h: 0.2, tilt: 0.9, list: MOON_LEAVES, max: 0.35 });
  });
  // A closed bud or two, waiting for tomorrow night.
  for (const p of scatter(rng, randInt(rng, 1, 2), 0.3, 0.1)) {
    const top = stemTip(p, range(rng, 0.24, 0.34), rng, 0.25);
    solid.push(paintFaces(limb(p, top, 0.01, 0.008, 4), () => STEM, 0.05, rng));
    solid.push(paintFaces(tr(octa(0.025, 0), { x: top.x, y: top.y + 0.02, z: top.z, sy: 1.8 }), () => mix(PALETTE.leafGreen, MOON_PETALS[v], 0.35), 0.04, rng));
  }
  const model = build({ solid, foliage, glow });
  model.userData.lightOffset = V(0, 0.5, 0);
  return model;
}

// ---- Flower bed ----

const BED_COLORS = [
  PALETTE.flowerRed,
  PALETTE.flowerPink,
  PALETTE.flowerYellow,
  PALETTE.flowerPurple,
  PALETTE.flowerOrange,
  PALETTE.flowerWhite,
];

function flowerBed(variant, rng) {
  const v = variantOf(variant, 2);
  const solid = [];
  const foliage = [];
  const L = 1.6;
  const D = 0.8;
  const soilY = 0.28;

  if (v === 0) {
    // Two planks per side with darker corner posts.
    const woods = [color(PALETTE.wood), color(PALETTE.woodLight)];
    const plank = (w, d, x, y, z, c) => solid.push(paintFaces(tr(boxUp(w, 0.16, d), { x, y, z }), () => c, 0.04, rng));
    for (const s of [-1, 1]) {
      plank(L - 0.04, 0.08, 0, 0, s * (D / 2 - 0.04), woods[0]);
      plank(L - 0.04, 0.08, 0, 0.16, s * (D / 2 - 0.04), woods[1]);
      plank(0.08, D - 0.16, s * (L / 2 - 0.04), 0, 0, woods[1]);
      plank(0.08, D - 0.16, s * (L / 2 - 0.04), 0.16, 0, woods[0]);
    }
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const post = tr(boxUp(0.12, 0.38, 0.12), { x: sx * (L / 2 - 0.05), z: sz * (D / 2 - 0.05) });
        solid.push(paintFaces(post, () => PALETTE.woodDark, 0.04, rng));
      }
    }
  } else {
    // Rough stone blocks around the rim.
    const stones = stops(PALETTE.stoneLight, PALETTE.stoneMid, mix(PALETTE.stoneLight, PALETTE.rock, 0.5));
    const block = (w, d, x, z) => {
      const g = jitter(box(w, range(rng, 0.31, 0.35), d), 0.012, rng);
      solid.push(paintFaces(tr(g, { x, y: 0.16, z }), () => pick(rng, stones), 0.04, rng));
    };
    for (const s of [-1, 1]) {
      for (let i = 0; i < 5; i++) block(L / 5 - 0.02, 0.13, -L / 2 + (i + 0.5) * (L / 5), s * (D / 2 - 0.065));
      for (let i = 0; i < 2; i++) block(0.13, (D - 0.26) / 2 - 0.02, s * (L / 2 - 0.065), -D / 2 + 0.13 + (i + 0.5) * ((D - 0.26) / 2));
    }
  }
  solid.push(paintFaces(boxUp(L - 0.1, soilY, D - 0.1), () => SOIL, 0.05, rng));

  // Two rows of mixed flowers with a few leafy tufts between them.
  const palette = [pick(rng, BED_COLORS), pick(rng, BED_COLORS), pick(rng, BED_COLORS)];
  const kinds = [tulip, daisy, bloom];
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 5; col++) {
      const base = V(-0.56 + col * 0.28 + range(rng, -0.04, 0.04), soilY, (row ? 0.15 : -0.15) + range(rng, -0.04, 0.04));
      const kind = kinds[(row * 5 + col + randInt(rng, 0, 2)) % 3];
      kind(foliage, base, rng, kind === daisy ? PALETTE.flowerWhite : pick(rng, palette), 0.85);
    }
  }
  const tufts = randInt(rng, 3, 4);
  for (let i = 0; i < tufts; i++) {
    const r = range(rng, 0.09, 0.12);
    const g = paintFaces(jitter(ico(r, 0), r * 0.15, rng), () => ramp(LEAVES, rng()), 0.05, rng);
    tr(g, { x: range(rng, -0.6, 0.6), y: soilY + r * 0.5, z: range(rng, -0.2, 0.2), sy: 0.8 });
    foliage.push(sway(g, 0.25));
  }
  return build({ solid, foliage });
}

// ---- Tall grass ----

const GRASS = [
  stops(PALETTE.leafDeep, PALETTE.leafGreen, PALETTE.leafLight),
  stops(mix(PALETTE.reed, PALETTE.leafGold, 0.4), PALETTE.leafGold, mix(PALETTE.leafGold, PALETTE.flowerWhite, 0.35)),
  stops(
    mix(PALETTE.reed, PALETTE.rock, 0.35),
    mix(PALETTE.leafLight, PALETTE.rock, 0.35),
    mix(PALETTE.leafLight, PALETTE.flowerWhite, 0.4),
  ),
];
const PLUME = stops(
  mix(PALETTE.flowerWhite, PALETTE.woodLight, 0.45),
  mix(PALETTE.flowerWhite, PALETTE.woodLight, 0.2),
  PALETTE.flowerWhite,
);

function tallGrass(variant, rng) {
  const v = variantOf(variant, 3);
  const foliage = [];
  const n = randInt(rng, 14, 20);
  for (let i = 0; i < n; i++) {
    const a = rng() * TAU;
    const rr = Math.sqrt(rng()) * 0.18;
    const h = v === 2 ? range(rng, 0.65, 0.95) : range(rng, 0.8, 1.2);
    let g = blade(range(rng, 0.06, 0.09), h, h * range(rng, 0.15, 0.45), 3);
    g = paintFaces(g, (c) => ramp(GRASS[v], c.y / h), 0.05, rng);
    tr(g, { rz: -range(rng, 0.05, 0.3), ry: -a, x: Math.cos(a) * rr, z: Math.sin(a) * rr });
    foliage.push(sway(g, (x, y) => clamp01(y / h) ** 1.5));
  }
  if (v === 2) {
    // Fluffy pampas plumes on tall stems.
    const plumes = randInt(rng, 3, 5);
    for (let i = 0; i < plumes; i++) {
      const a = rng() * TAU;
      const base = V(Math.cos(a) * 0.08, 0, Math.sin(a) * 0.08);
      const h = range(rng, 0.95, 1.15);
      const top = V(base.x + Math.cos(a) * range(rng, 0.08, 0.25), h, base.z + Math.sin(a) * range(rng, 0.08, 0.25));
      addStem(foliage, base, top, 0.012, GRASS[2][0], rng);
      const pr = range(rng, 0.08, 0.1);
      let g = jitter(ico(pr, 1), pr * 0.12, rng);
      g = paintFaces(tr(g, { sy: 2.4 }), (c) => ramp(PLUME, (c.y + pr * 2.4) / (pr * 4.8)), 0.05, rng);
      tr(g, { y: pr * 1.6 });
      foliage.push(sway(mount(g, top, top.clone().sub(base)), 1));
    }
  }
  return build({ foliage });
}

// ---- Ferns ----

const FERN = [
  stops(PALETTE.leafDeep, PALETTE.leafGreen, PALETTE.leafLight),
  stops(mix(PALETTE.leafDeep, PALETTE.leafRust, 0.45), mix(PALETTE.leafAutumn, PALETTE.leafRust, 0.3), PALETTE.leafGold),
];

function ferns(variant, rng) {
  const v = variantOf(variant, 2);
  const foliage = [];
  const n = randInt(rng, 7, 10);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + range(rng, -0.25, 0.25);
    const L = range(rng, 0.65, 0.85);
    const segs = 7;
    const phi0 = range(rng, 1.25, 1.45);
    const phi1 = -range(rng, 0.1, 0.45);
    const dir = V(Math.cos(a), 0, Math.sin(a));
    const side = V(-Math.sin(a), 0, Math.cos(a));
    // Walk the midrib: it rises steeply, then arches over and droops.
    const spine = [dir.clone().multiplyScalar(0.04).setY(0.03)];
    for (let s = 1; s <= segs; s++) {
      const phi = phi0 + (phi1 - phi0) * ((s - 0.5) / segs);
      const step = L / segs;
      spine.push(spine[s - 1].clone().addScaledVector(dir, Math.cos(phi) * step).addScaledVector(UP, Math.sin(phi) * step));
    }
    const reach = Math.hypot(spine[segs].x, spine[segs].z);
    // Leaflets: a broad, forward-pointing leaf on each side of every segment
    // except the bare stalk.
    const pos = [];
    const maxLeaf = range(rng, 0.11, 0.14);
    for (let s = 1; s < segs; s++) {
      const t = (s + 0.5) / segs;
      const len = maxLeaf * Math.sin(Math.PI * Math.min(0.95, t)) ** 0.7;
      const p = spine[s];
      const q = spine[s + 1];
      for (const sd of [-1, 1]) {
        const tip = p.clone().lerp(q, 0.85).addScaledVector(side, sd * len).addScaledVector(UP, len * 0.2);
        const back = p.clone().lerp(q, 0.25).addScaledVector(side, sd * len * 0.55).addScaledVector(UP, len * 0.1);
        pos.push(p.x, p.y, p.z, q.x, q.y, q.z, tip.x, tip.y, tip.z);
        pos.push(p.x, p.y, p.z, tip.x, tip.y, tip.z, back.x, back.y, back.z);
      }
    }
    const rib = strip(spine, spine.map((_, s) => (s === segs ? 0 : 0.012)), side);
    for (const g0 of [trisGeo(pos), rib]) {
      const g = paintFaces(g0, (c) => ramp(FERN[v], Math.hypot(c.x, c.z) / reach), 0.07, rng);
      foliage.push(sway(g, (x, y, z) => 0.95 * clamp01(Math.hypot(x, z) / reach) ** 1.3));
    }
  }
  // A curled fiddlehead or two in the middle.
  const curls = randInt(rng, 0, 2);
  for (let i = 0; i < curls; i++) {
    const a = rng() * TAU;
    const base = V(Math.cos(a) * 0.05, 0, Math.sin(a) * 0.05);
    const h = range(rng, 0.14, 0.2);
    addStem(foliage, base, V(base.x, h, base.z), 0.01, FERN[v][1], rng);
    const g = paintFaces(torus(0.035, 0.013, 3, 6, Math.PI * 1.6), () => FERN[v][2], 0.05, rng);
    tr(g, { x: base.x, y: h + 0.03, z: base.z, ry: rng() * TAU });
    foliage.push(sway(g, 0.3));
  }
  return build({ foliage });
}

// ---- Rocks ----

const ROCK = {
  grey: stops(PALETTE.rockDark, PALETTE.rock, mix(PALETTE.rock, PALETTE.stoneLight, 0.5)),
  sand: [color(shade(PALETTE.sandstone, -0.05)), color(PALETTE.sandstone), color(shade(PALETTE.sandstone, 0.04))],
};

// Paint a rock by kind: 0 grey, 1 mossy, 2 sandstone.
function paintRock(g, kind, rng) {
  const phase = rng() * 10;
  return paintFaces(
    g,
    (c, n) => {
      if (kind === 1 && (n.y > 0.55 || (n.y > 0.25 && rng() < 0.45))) return ramp(MOSS, n.y + range(rng, -0.2, 0.2));
      if (kind === 2) {
        const band = ((Math.floor(c.y / 0.15 + phase) % 2) + 2) % 2;
        return ROCK.sand[n.y > 0.7 ? 2 : band];
      }
      return ramp(ROCK.grey, n.y * 0.5 + 0.5);
    },
    0.05,
    rng,
  );
}

// A jittered, flattened rock of radius r. A `sink` fraction of its height sits
// below y = 0, and anything below `floor` is flattened into a base.
function rockGeo(r, rng, { sink = 0.2, floor = -0.12, sy = 0.78, detail = 1 } = {}) {
  let g = detail === 1 && rng() < 0.5 ? dodeca(r, 0) : ico(r, detail);
  g = jitter(g, r * 0.16, rng);
  tr(g, { sx: range(rng, 1.0, 1.2), sy: sy * range(rng, 0.9, 1.1), sz: range(rng, 0.85, 1.0), ry: rng() * TAU });
  g.computeBoundingBox();
  const { min, max } = g.boundingBox;
  g.translate(0, -min.y - (max.y - min.y) * sink, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) < floor) p.setY(i, floor);
  g.computeVertexNormals();
  return g;
}

function rockBoulder(variant, rng) {
  const kind = variantOf(variant, 3);
  const solid = [paintRock(rockGeo(range(rng, 0.82, 1.0), rng, { floor: -0.15 }), kind, rng)];
  if (rng() < 0.5) {
    const r = range(rng, 0.18, 0.26);
    const a = rng() * TAU;
    solid.push(paintRock(tr(rockGeo(r, rng, { detail: 0 }), { x: Math.cos(a) * 1.0, z: Math.sin(a) * 1.0 }), kind, rng));
  }
  return build({ solid });
}

function rockCluster(variant, rng) {
  const kind = variantOf(variant, 3);
  const solid = [];
  const big = range(rng, 0.42, 0.55);
  solid.push(paintRock(rockGeo(big, rng), kind, rng));
  const n = randInt(rng, 2, 5);
  const a0 = rng() * TAU;
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * TAU + range(rng, -0.3, 0.3);
    const r = range(rng, 0.18, 0.36);
    const d = big * 0.85 + r * 0.75;
    const g = rockGeo(r, rng, { detail: r > 0.28 ? 1 : 0 });
    solid.push(paintRock(tr(g, { x: Math.cos(a) * d, z: Math.sin(a) * d }), kind, rng));
  }
  return build({ solid });
}

const STEP = [
  { top: PALETTE.stoneLight, side: PALETTE.stoneMid },
  { top: shade(PALETTE.sandstone, 0.04), side: shade(PALETTE.sandstone, -0.06) },
];

function steppingStones(variant, rng) {
  const v = variantOf(variant, 2);
  const solid = [];
  const n = randInt(rng, 4, 6);
  const arcR = range(rng, 2.2, 3.2);
  const span = 2.0 / arcR;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const th = -span / 2 + (span * i) / (n - 1) + range(rng, -0.03, 0.03);
    pts.push(V(arcR * Math.sin(th), 0, arcR * (1 - Math.cos(th))));
  }
  const mz = pts.reduce((s, p) => s + p.z, 0) / n;
  const top = color(STEP[v].top);
  const side = color(STEP[v].side);
  for (const p of pts) {
    const r = range(rng, 0.22, 0.32);
    const h = 0.24;
    let g = jitter(cyl(r, r * 1.08, h, 7), 0.03, rng, { y: 0.4 });
    g = paintFaces(g, (c, n2) => (n2.y > 0.7 ? top : side), 0.05, rng);
    tr(g, { x: p.x, y: range(rng, 0.08, 0.14) - h, z: p.z - mz, sx: range(rng, 0.85, 1.15), sz: range(rng, 0.85, 1.15), ry: rng() * TAU });
    solid.push(g);
  }
  return build({ solid });
}

const SPIRE = [
  stops(PALETTE.rock, mix(PALETTE.rock, PALETTE.rockDark, 0.6), mix(PALETTE.rock, PALETTE.stoneLight, 0.5)),
  stops(PALETTE.sandstone, mix(PALETTE.sandstone, PALETTE.leafRust, 0.18), mix(PALETTE.sandstone, PALETTE.flowerWhite, 0.25)),
];

function rockSpire(variant, rng) {
  const v = variantOf(variant, 2);
  const solid = [];
  const H = range(rng, 2.6, 3.4);
  const layers = randInt(rng, 4, 6);
  const weights = Array.from({ length: layers }, (_, i) => range(rng, 0.8, 1.2) * (i === layers - 1 ? 0.6 : 1));
  const wsum = weights.reduce((s, w) => s + w, 0);
  const r0 = range(rng, 0.62, 0.78);
  let r = r0;
  let y = -0.12;
  let ox = 0;
  let oz = 0;
  const offset = randInt(rng, 0, 2);
  for (let i = 0; i < layers; i++) {
    const h = (weights[i] / wsum) * (H + 0.12);
    const last = i === layers - 1;
    const rTop = r * (last ? range(rng, 0.45, 0.6) : range(rng, 0.8, 0.92));
    let g = prep(new THREE.CylinderGeometry(rTop, r, h, randInt(rng, 6, 7), 1));
    g.translate(0, h / 2, 0);
    g = jitter(g, 0.045, rng, { y: 0.4 });
    const base = SPIRE[v][(i + offset) % 3];
    const lit = color(base).offsetHSL(0, 0, 0.04);
    const cap = v === 0 && last;
    g = paintFaces(g, (c, n) => (cap && n.y > 0.6 ? ramp(MOSS, rng()) : n.y > 0.7 ? lit : base), 0.05, rng);
    tr(g, { x: ox, y, z: oz, ry: rng() * TAU, rx: range(rng, -0.04, 0.04), rz: range(rng, -0.04, 0.04) });
    solid.push(g);
    y += h * 0.97;
    ox += range(rng, -0.06, 0.06);
    oz += range(rng, -0.06, 0.06);
    r = rTop * range(rng, 0.95, 1.12);
  }
  // Rubble at the foot.
  const rubble = randInt(rng, 2, 3);
  const a0 = rng() * TAU;
  for (let i = 0; i < rubble; i++) {
    const a = a0 + (i / rubble) * TAU + range(rng, -0.4, 0.4);
    const rr = range(rng, 0.14, 0.26);
    const g = rockGeo(rr, rng, { detail: 0 });
    solid.push(paintRock(tr(g, { x: Math.cos(a) * (r0 + rr * 0.6), z: Math.sin(a) * (r0 + rr * 0.6) }), v === 0 ? 0 : 2, rng));
  }
  return build({ solid });
}

// ---- Lily pads ----

// Outer and inner petal colors per variant; Plain has no blooms.
const LILY_BLOOMS = [
  null,
  [PALETTE.flowerPink, mix(PALETTE.flowerPink, PALETTE.flowerWhite, 0.4)],
  [PALETTE.flowerWhite, mix(PALETTE.flowerWhite, PALETTE.blossom, 0.3)],
];

// Round pad with a wedge-shaped notch, lying flat and centered on the origin.
function padGeo(r, rng) {
  const notch = range(rng, 0.35, 0.55);
  const pts = [[0, 0]];
  const segs = 11;
  for (let i = 0; i <= segs; i++) {
    const a = notch / 2 + (i / segs) * (TAU - notch);
    const rr = r * range(rng, 0.96, 1.02);
    pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
  }
  return tr(extrude(pts, 0.025), { rx: -Math.PI / 2 });
}

// Water-lily bloom: two layers of pointed petals around a yellow center.
function lilyBloom(rng, outerColor, innerColor) {
  const layer = (n, L, w, elev, rot) => {
    const pos = [];
    for (let k = 0; k < n; k++) {
      const a = rot + (k / n) * TAU + range(rng, -0.08, 0.08);
      const d = V(Math.cos(a) * Math.cos(elev), Math.sin(elev), Math.sin(a) * Math.cos(elev));
      const s = V(-Math.sin(a), 0, Math.cos(a));
      const b = d.clone().multiplyScalar(0.01);
      const tip = d.clone().multiplyScalar(L);
      const ml = d.clone().multiplyScalar(L * 0.5).addScaledVector(s, w / 2).add(V(0, 0.01, 0));
      const mr = d.clone().multiplyScalar(L * 0.5).addScaledVector(s, -w / 2).add(V(0, 0.01, 0));
      pos.push(b.x, b.y, b.z, ml.x, ml.y, ml.z, tip.x, tip.y, tip.z, b.x, b.y, b.z, tip.x, tip.y, tip.z, mr.x, mr.y, mr.z);
    }
    return trisGeo(pos);
  };
  return [
    paintFaces(layer(8, 0.19, 0.09, 0.45, 0), () => outerColor, 0.05, rng),
    paintFaces(layer(6, 0.14, 0.08, 0.95, Math.PI / 6), () => innerColor, 0.05, rng),
    paintFaces(cone(0.038, 0.045, 5), () => PALETTE.flowerYellow, 0.04, rng),
  ];
}

function lilyPads(variant, rng) {
  const v = variantOf(variant, 3);
  const foliage = [];
  const n = randInt(rng, 3, 6);
  const pads = [];
  for (let i = 0; i < n; i++) {
    const r = range(rng, 0.18, 0.36);
    let spot = null;
    for (let tries = 0; tries < 30 && !spot; tries++) {
      const a = rng() * TAU;
      const d = i === 0 ? range(rng, 0, 0.15) : range(rng, 0.2, 0.65);
      const p = V(Math.cos(a) * d, 0, Math.sin(a) * d);
      if (pads.every((q) => q.p.distanceTo(p) > q.r + r - 0.04)) spot = p;
    }
    if (spot) pads.push({ p: spot, r });
  }
  const lily = color(PALETTE.lily);
  pads.forEach(({ p, r }, i) => {
    const tint = rng() < 0.25 ? color(mix(PALETTE.lily, PALETTE.leafGold, 0.2)) : lily.clone().offsetHSL(0, 0, range(rng, -0.04, 0.04));
    const edge = tint.clone().offsetHSL(0, 0, -0.08);
    let g = paintFaces(padGeo(r, rng), (c, nrm) => (nrm.y > 0.5 ? tint : edge), 0.04, rng);
    tr(g, { x: p.x, y: 0.02 + i * 0.002, z: p.z, ry: rng() * TAU });
    foliage.push(sway(g, 0.12));
  });
  if (LILY_BLOOMS[v] && pads.length) {
    const blooms = pads.length >= 4 ? 2 : 1;
    for (let i = 0; i < blooms; i++) {
      const { p, r } = pads[i];
      const at = { x: p.x + range(rng, -0.3, 0.3) * r, y: 0.035, z: p.z + range(rng, -0.3, 0.3) * r, ry: rng() * TAU };
      for (const g of lilyBloom(rng, ...LILY_BLOOMS[v])) foliage.push(sway(tr(g, at), 0.18));
    }
  }
  return build({ foliage });
}

// ---- Reeds ----

const REED = stops(shade(PALETTE.reed, -0.08), PALETTE.reed, mix(PALETTE.reed, PALETTE.leafLight, 0.4));
const RUSH = stops(mix(PALETTE.reed, PALETTE.pineGreen, 0.6), mix(PALETTE.reed, PALETTE.pineGreen, 0.3), PALETTE.reed);
const CATTAIL = stops(shade(PALETTE.cattail, -0.06), PALETTE.cattail);
const REED_PLUME = stops(mix(PALETTE.woodLight, PALETTE.reed, 0.3), PALETTE.woodLight, mix(PALETTE.woodLight, PALETTE.flowerWhite, 0.4));
const RUSH_TUFT = color(mix(PALETTE.cattail, PALETTE.woodLight, 0.3));

function reeds(variant, rng) {
  const v = variantOf(variant, 3);
  const foliage = [];
  const H = range(rng, 1.8, 2.2);
  const swayH = (g) => sway(g, (x, y) => clamp01(y / H) ** 1.5);
  const root = (spread) => {
    const a = rng() * TAU;
    const d = Math.sqrt(rng()) * spread;
    return V(Math.cos(a) * d, 0, Math.sin(a) * d);
  };
  const stalkTo = (base, h, lean) => {
    const a = Math.atan2(base.z, base.x) + range(rng, -0.6, 0.6);
    const l = range(rng, 0.02, lean) * h;
    return V(base.x + Math.cos(a) * l, h, base.z + Math.sin(a) * l);
  };

  // Long leaf blades for cattails and reeds.
  if (v !== 2) {
    const blades = v === 0 ? randInt(rng, 6, 9) : randInt(rng, 5, 7);
    for (let i = 0; i < blades; i++) {
      const b = root(0.18);
      const h = H * range(rng, 0.65, 0.92);
      let g = blade(range(rng, 0.06, 0.09), h, h * range(rng, 0.12, 0.35), 3);
      g = paintFaces(g, (c) => ramp(REED, c.y / h), 0.05, rng);
      tr(g, { rz: -range(rng, 0.02, 0.2), ry: rng() * TAU, x: b.x, z: b.z });
      foliage.push(swayH(g));
    }
  }

  if (v === 0) {
    // Cattails: stalks with brown heads and a thin spike.
    const stalks = randInt(rng, 3, 5);
    for (let i = 0; i < stalks; i++) {
      const b = root(0.15);
      const top = stalkTo(b, i === 0 ? H : H * range(rng, 0.82, 0.97), 0.12);
      const at = (t) => b.clone().lerp(top, t);
      foliage.push(swayH(paintFaces(limb(b, top, 0.018, 0.012, 4, { open: true }), () => REED[0], 0.05, rng)));
      const head = paintFaces(limb(at(0.8), at(0.93), 0.05, 0.048, 6), () => ramp(CATTAIL, rng()), 0.05, rng);
      foliage.push(swayH(head));
    }
  } else if (v === 1) {
    // Reeds: thin stalks topped with drooping, feathery seed heads.
    const stalks = randInt(rng, 5, 7);
    for (let i = 0; i < stalks; i++) {
      const b = root(0.18);
      const top = stalkTo(b, i === 0 ? H : H * range(rng, 0.85, 0.98), 0.2);
      foliage.push(swayH(paintFaces(limb(b, top, 0.014, 0.01, 3, { open: true }), () => REED[1], 0.05, rng)));
      const pr = range(rng, 0.055, 0.07);
      let g = jitter(ico(pr, 0), pr * 0.15, rng);
      g = paintFaces(tr(g, { sy: 2.6 }), (c) => ramp(REED_PLUME, (c.y + pr * 2.6) / (pr * 5.2)), 0.05, rng);
      tr(g, { y: pr * 1.8 });
      const droop = top.clone().sub(b).normalize().add(V(range(rng, -0.4, 0.4), 0, range(rng, -0.4, 0.4)));
      foliage.push(swayH(mount(g, top.clone().add(V(0, -pr * 3, 0)), droop)));
    }
  } else {
    // Rushes: many straight round stems, some with a small brown tuft.
    const stems = randInt(rng, 14, 20);
    for (let i = 0; i < stems; i++) {
      const b = root(0.24);
      const h = i === 0 ? H : H * range(rng, 0.7, 0.98);
      const top = stalkTo(b, h, 0.18);
      foliage.push(swayH(paintFaces(limb(b, top, 0.018, 0.008, 3, { open: true }), (c) => ramp(RUSH, c.y / H), 0.05, rng)));
      if (rng() < 0.5) {
        const p = b.clone().lerp(top, range(rng, 0.78, 0.86));
        for (let j = 0; j < 2; j++) {
          const g = paintFaces(octa(range(rng, 0.022, 0.032), 0), () => RUSH_TUFT, 0.06, rng);
          tr(g, { x: p.x + range(rng, 0.01, 0.035), y: p.y + j * 0.035, z: p.z + range(rng, -0.02, 0.02), sy: 1.4 });
          foliage.push(swayH(g));
        }
      }
    }
  }
  return build({ foliage });
}

export const builders = {
  tree_round: treeRound,
  tree_pine: treePine,
  tree_birch: treeBirch,
  tree_willow: treeWillow,
  bush,
  stump_log: stumpLog,
  flowers,
  flower_bed: flowerBed,
  tall_grass: tallGrass,
  ferns,
  mushrooms,
  moonflower,
  rock_boulder: rockBoulder,
  rock_cluster: rockCluster,
  stepping_stones: steppingStones,
  rock_spire: rockSpire,
  lily_pads: lilyPads,
  reeds,
};
