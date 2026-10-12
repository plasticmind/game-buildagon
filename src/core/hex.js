// Pointy-top hex math in axial coordinates (q, r). The ground plane is X/Z, with Y up.
//
// Angles in this module are measured in the X/Z plane from +X toward +Z.
// Corner i sits at angle (60i - 30)°. Edge i sits between corner i and corner i+1,
// its midpoint at angle 60i°, and it faces neighbor DIRS[i].
// Corner i is shared by this cell, neighbor(i - 1), and neighbor(i).

import { HEX_SIZE, HEX_APOTHEM, WORLD_RADIUS, CHUNK_SIZE } from './constants.js';

const SQRT3 = Math.sqrt(3);
const DEG = Math.PI / 180;

export const DIRS = [
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [0, -1],
  [1, -1],
];

export function key(q, r) {
  return `${q},${r}`;
}

// Key of the CHUNK_SIZE × CHUNK_SIZE axial block that holds cell (q, r).
export function chunkKey(q, r) {
  return `${Math.floor(q / CHUNK_SIZE)},${Math.floor(r / CHUNK_SIZE)}`;
}

export function parseKey(k) {
  const i = k.indexOf(',');
  return [Number(k.slice(0, i)), Number(k.slice(i + 1))];
}

export function hexToWorld(q, r, out = { x: 0, z: 0 }) {
  out.x = HEX_SIZE * SQRT3 * (q + r / 2);
  out.z = HEX_SIZE * 1.5 * r;
  return out;
}

export function hexRound(fq, fr) {
  const fs = -fq - fr;
  let q = Math.round(fq);
  let r = Math.round(fr);
  const s = Math.round(fs);
  const dq = Math.abs(q - fq);
  const dr = Math.abs(r - fr);
  const ds = Math.abs(s - fs);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  // Normalize -0 so keys stay stable.
  return { q: q + 0, r: r + 0 };
}

// Fractional axial coordinates of world point (x, z).
export function worldToAxial(x, z) {
  return { q: ((SQRT3 / 3) * x - (1 / 3) * z) / HEX_SIZE, r: ((2 / 3) * z) / HEX_SIZE };
}

export function worldToHex(x, z) {
  const a = worldToAxial(x, z);
  return hexRound(a.q, a.r);
}

export function cornerAngle(i) {
  return (60 * i - 30) * DEG;
}

export function edgeAngle(i) {
  return 60 * i * DEG;
}

// Offset from the cell center to corner i.
export function cornerOffset(i, radius = HEX_SIZE) {
  const a = cornerAngle(i);
  return { x: Math.cos(a) * radius, z: Math.sin(a) * radius };
}

// Offset from the cell center to the midpoint of edge i.
export function edgeMidOffset(i, radius = HEX_APOTHEM) {
  const a = edgeAngle(i);
  return { x: Math.cos(a) * radius, z: Math.sin(a) * radius };
}

// Outward unit normal of edge i, in X/Z.
export const EDGE_NORMALS = DIRS.map((_, i) => ({ x: Math.cos(i * 60 * DEG), z: Math.sin(i * 60 * DEG) }));

export function mod6(i) {
  return ((i % 6) + 6) % 6;
}

export function neighbor(q, r, i) {
  const d = DIRS[mod6(i)];
  return { q: q + d[0], r: r + d[1] };
}

export function hexDistance(q1, r1, q2 = 0, r2 = 0) {
  const dq = q1 - q2;
  const dr = r1 - r2;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

export function inWorld(q, r) {
  return hexDistance(q, r) <= WORLD_RADIUS;
}

export function hexesInRadius(q, r, radius) {
  const out = [];
  for (let dq = -radius; dq <= radius; dq++) {
    const r1 = Math.max(-radius, -dq - radius);
    const r2 = Math.min(radius, -dq + radius);
    for (let dr = r1; dr <= r2; dr++) out.push({ q: q + dq, r: r + dr });
  }
  return out;
}

// Index of the edge of cell (q, r) nearest to world point (x, z).
export function nearestEdge(q, r, x, z) {
  const c = hexToWorld(q, r);
  const a = Math.atan2(z - c.z, x - c.x);
  return mod6(Math.round(a / (60 * DEG)));
}

// three.js rotation.y that turns local +X to point along X/Z-plane angle `a`.
export function angleToRotY(a) {
  return -a;
}

// Canonical keys for shared corners and edges. Built from rounded world positions,
// so every cell that shares a corner or edge computes the same key.
export function pointKey(x, z) {
  return `${Math.round(x * 100)}:${Math.round(z * 100)}`;
}

export function cornerKey(q, r, i) {
  const c = hexToWorld(q, r);
  const o = cornerOffset(i);
  return pointKey(c.x + o.x, c.z + o.z);
}

export function edgeKey(q, r, i) {
  const c = hexToWorld(q, r);
  const o = edgeMidOffset(i);
  return pointKey(c.x + o.x, c.z + o.z);
}

// Deterministic hash of a world position, in [0, 1). Use it to jitter shared vertices
// identically from every cell that owns them.
export function hash2(x, z, seed = 0) {
  const ix = Math.round(x * 100);
  const iz = Math.round(z * 100);
  let h = (ix * 374761393 + iz * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
