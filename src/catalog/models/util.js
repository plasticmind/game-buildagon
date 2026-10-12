// Geometry toolkit for procedural low-poly models.
//
// Pattern: build parts with the primitive helpers, color them with paint(), mark
// swaying parts with sway(), then call assemble() to merge everything into at most
// one mesh per shared material. Each placed object then costs 1–3 draw calls.
//
//   const trunk = paint(cyl(0.12, 0.18, 1.4, 6), PALETTE.trunk);
//   const crown = sway(paint(jitter(ico(0.9, 1), 0.12, rng), PALETTE.leafGreen), 1);
//   return assemble({ solid: [trunk], foliage: [tr(crown, { y: 1.8 })] });

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MATS, glowMaterial } from '../../render/materials.js';
import { LAYERS } from '../../render/shared.js';

const _c = new THREE.Color();

// Strip to position + normal, non-indexed, so every part merges cleanly.
export function prep(geo) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'color' && name !== 'aSway') {
      g.deleteAttribute(name);
    }
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}

// Color every vertex. `color` is any THREE.Color input (hex string or number).
// Pass `vary` (0–1) and an rng to randomize lightness per face for a hand-made look.
export function paint(geo, color, vary = 0, rng = Math.random) {
  const g = prep(geo);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  _c.set(color);
  for (let i = 0; i < n; i += 3) {
    const k = vary ? 1 + (rng() - 0.5) * 2 * vary : 1;
    for (let j = 0; j < 3 && i + j < n; j++) {
      arr[(i + j) * 3] = _c.r * k;
      arr[(i + j) * 3 + 1] = _c.g * k;
      arr[(i + j) * 3 + 2] = _c.b * k;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

// Color by a function of the vertex position: fn(x, y, z) → color input.
export function paintBy(geo, fn) {
  const g = prep(geo);
  const p = g.attributes.position;
  const arr = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    _c.set(fn(p.getX(i), p.getY(i), p.getZ(i)));
    arr[i * 3] = _c.r;
    arr[i * 3 + 1] = _c.g;
    arr[i * 3 + 2] = _c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

// Set the per-vertex sway weight. `w` is a number or fn(x, y, z) → 0..1.
// Weight 0 stays rooted; 1 sways fully. Call after the part is positioned
// relative to the model origin (or use a function of local y before tr()).
export function sway(geo, w = 1) {
  const g = prep(geo);
  const p = g.attributes.position;
  const arr = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    arr[i] = typeof w === 'function' ? w(p.getX(i), p.getY(i), p.getZ(i)) : w;
  }
  g.setAttribute('aSway', new THREE.BufferAttribute(arr, 1));
  return g;
}

// Transform in place: translate, rotate (radians, XYZ order), and scale.
export function tr(geo, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s, sx = 1, sy = 1, sz = 1 } = {}) {
  if (s !== undefined) sx = sy = sz = s;
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  );
  geo.applyMatrix4(m);
  return geo;
}

// Displace vertices by up to `amount` along each axis. Vertices that share a
// position move together, so jittered solids stay watertight.
export function jitter(geo, amount, rng = Math.random, { y = 1 } = {}) {
  const g = prep(geo);
  const p = g.attributes.position;
  const offsets = new Map();
  for (let i = 0; i < p.count; i++) {
    // Rounded integers, so -0.0000 and 0.0000 share a key and seams stay closed.
    const k = `${Math.round(p.getX(i) * 1e4)}|${Math.round(p.getY(i) * 1e4)}|${Math.round(p.getZ(i) * 1e4)}`;
    let o = offsets.get(k);
    if (!o) {
      o = [(rng() - 0.5) * 2 * amount, (rng() - 0.5) * 2 * amount * y, (rng() - 0.5) * 2 * amount];
      offsets.set(k, o);
    }
    p.setXYZ(i, p.getX(i) + o[0], p.getY(i) + o[1], p.getZ(i) + o[2]);
  }
  p.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

// ---- Primitives (all return prepped, uncolored geometry) ----

export const box = (w, h, d) => prep(new THREE.BoxGeometry(w, h, d));
// Box with its base at y = 0.
export const boxUp = (w, h, d) => tr(box(w, h, d), { y: h / 2 });
export const cyl = (rTop, rBottom, h, seg = 7, open = false) =>
  tr(prep(new THREE.CylinderGeometry(rTop, rBottom, h, seg, 1, open)), { y: h / 2 });
export const cone = (r, h, seg = 7) => tr(prep(new THREE.ConeGeometry(r, h, seg)), { y: h / 2 });
export const ico = (r, detail = 0) => prep(new THREE.IcosahedronGeometry(r, detail));
export const dodeca = (r, detail = 0) => prep(new THREE.DodecahedronGeometry(r, detail));
export const octa = (r, detail = 0) => prep(new THREE.OctahedronGeometry(r, detail));
export const sphere = (r, w = 7, h = 5) => prep(new THREE.SphereGeometry(r, w, h));
export const torus = (r, tube, rs = 5, ts = 10, arc = Math.PI * 2) =>
  prep(new THREE.TorusGeometry(r, tube, rs, ts, arc));
// Flat-topped plane in X/Z, centered, at y = 0.
export const plane = (w, d) => tr(prep(new THREE.PlaneGeometry(w, d)), { rx: -Math.PI / 2 });

// Pointy-top hexagonal prism (matches the world grid), base at y = 0.
export function hexPrism(radius, h) {
  // CylinderGeometry with 6 segments already puts corners at 90°, 30°, -30°, …
  // in the X/Z plane, which matches core/hex.js.
  return tr(prep(new THREE.CylinderGeometry(radius, radius, h, 6, 1)), { y: h / 2 });
}

// Hexagonal pyramid (pointy-top footprint), base at y = 0.
export function hexPyramid(radius, h) {
  return tr(prep(new THREE.ConeGeometry(radius, h, 6)), { y: h / 2 });
}

// Lathe from a list of [radius, y] points, base at the first point.
export function lathe(points, seg = 8) {
  return prep(new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), seg));
}

// Extrude a 2D outline ([x, y] points) by `depth` along +Z, centered on Z.
export function extrude(points, depth) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  return tr(prep(g), { z: -depth / 2 });
}

// ---- Construction helpers (structures and props) ----

// Box from min/max bounds.
export function blk(x0, x1, y0, y1, z0, z1) {
  return tr(box(x1 - x0, y1 - y0, z1 - z0), { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2 });
}

const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);

// Place geometry built along `axis` so it runs from point a to point b ([x, y, z]).
function orient(g, a, b, axis) {
  const pa = new THREE.Vector3(...a);
  const pb = new THREE.Vector3(...b);
  const dir = pb.clone().sub(pa).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(axis, dir);
  g.applyMatrix4(new THREE.Matrix4().compose(pa.add(pb).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
  return g;
}

// Box of width w (local Z) and height h (local Y) from a to b.
export const beam = (a, b, w, h = w) => orient(box(dist(a, b), h, w), a, b, X_AXIS);

// Cylinder of radius r from a to b. Pass open = true for ropes and thin rails.
export const rod = (a, b, r, seg = 5, open = false) =>
  orient(tr(cyl(r, r, dist(a, b), seg, open), { y: -dist(a, b) / 2 }), a, b, Y_AXIS);

// Extrude an X/Y outline (a wall face) by depth, centered on z.
export const face = (points, depth, z = 0) => tr(extrude(points, depth), { z });

// ---- Merge and assemble ----

function ensureAttrs(g) {
  const n = g.attributes.position.count;
  if (!g.attributes.color) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  if (!g.attributes.aSway) g.setAttribute('aSway', new THREE.BufferAttribute(new Float32Array(n), 1));
  return g;
}

export function merge(geos) {
  const list = geos.filter(Boolean).map((g) => ensureAttrs(prep(g)));
  if (!list.length) return null;
  const m = mergeGeometries(list, false);
  m.computeBoundingBox();
  m.computeBoundingSphere();
  return m;
}

// Build the final model. Parts:
//   solid:   static, vertex-colored geometry (MATS.static).
//   double:  static, double-sided thin geometry (MATS.staticDouble).
//   foliage: swaying geometry, uses `aSway` (MATS.foliage, shadow sways too).
//   glow:    [[geometry, colorHex], …] parts that light up at night.
// Returns a THREE.Group with userData.parts listing the meshes.
export function assemble({ solid = [], double = [], foliage = [], glow = [] } = {}, { castShadow = true } = {}) {
  const group = new THREE.Group();
  const add = (geo, mat, opts = {}) => {
    if (!geo) return null;
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = castShadow && opts.cast !== false;
    m.receiveShadow = true;
    m.layers.set(LAYERS.WORLD);
    if (opts.depth) m.customDepthMaterial = opts.depth;
    group.add(m);
    return m;
  };
  add(merge(solid), MATS.static);
  add(merge(double), MATS.staticDouble);
  add(merge(foliage), MATS.foliage, { depth: MATS.foliageDepth });
  const byColor = new Map();
  for (const [geo, color] of glow) {
    if (!byColor.has(color)) byColor.set(color, []);
    byColor.get(color).push(geo);
  }
  for (const [color, geos] of byColor) add(merge(geos), glowMaterial(color), { cast: false });
  return group;
}

// Invisible cap that keeps water out of a hollow model, such as a boat hull.
// It writes depth but no color, after every opaque mesh, so the transparent
// water behind it fails the depth test. Ghosts, highlights, raycasts, shadows,
// and the water depth pre-pass all skip it (check userData.waterMask).
const WATER_MASK_MAT = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide, fog: false });

export function waterMask(geo) {
  const m = new THREE.Mesh(geo, WATER_MASK_MAT);
  m.name = 'waterMask';
  m.userData.waterMask = true;
  m.renderOrder = 1;
  m.castShadow = false;
  m.receiveShadow = false;
  m.raycast = () => {};
  m.layers.set(LAYERS.WORLD);
  return m;
}

// Lighten (amount > 0) or darken (amount < 0) a color. Returns a hex string.
export function shade(color, amount) {
  const c = new THREE.Color(color);
  const hsl = {};
  c.getHSL(hsl, THREE.SRGBColorSpace);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + amount)), THREE.SRGBColorSpace);
  return `#${c.getHexString()}`;
}

// Mix two colors. Returns a hex string.
export function mix(a, b, t) {
  return `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`;
}
