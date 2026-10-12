// Navigation inside a water body, shared by everything that swims.
//
// A body (from habitats.js) has `keys` (cell keys), `centers` (cell centers),
// `y` (surface height), `floorY`, and `obstacles` ([{ x, z, r }] boats,
// stepping stones, walkways).

import { HEX_APOTHEM } from '../core/constants.js';

// Is (x, z) open water at least `margin` from the banks and obstacles?
export function swimOk(ctx, body, x, z, margin) {
  if (!ctx.inBody(body, x, z, margin)) return false;
  for (const o of body.obstacles) if ((x - o.x) ** 2 + (z - o.z) ** 2 < (o.r + margin * 0.6) ** 2) return false;
  return true;
}

export function swimPathOk(ctx, body, x0, z0, x1, z1, margin) {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.3));
  for (let i = 1; i <= n; i++) {
    if (!swimOk(ctx, body, x0 + ((x1 - x0) * i) / n, z0 + ((z1 - z0) * i) / n, margin)) return false;
  }
  return true;
}

// A random reachable point in the body, or null. With `from`, the straight
// path there must stay in open water and the point within `maxDist`.
export function pickSwimPoint(ctx, body, margin, from = null, maxDist = Infinity) {
  for (let i = 0; i < 16; i++) {
    const c = body.centers[Math.floor(Math.random() * body.centers.length)];
    const a = Math.random() * Math.PI * 2;
    const d = Math.sqrt(Math.random()) * Math.max(0, HEX_APOTHEM - margin);
    const x = c.x + Math.cos(a) * d;
    const z = c.z + Math.sin(a) * d;
    if (from && Math.hypot(x - from.x, z - from.z) > maxDist) continue;
    if (!swimOk(ctx, body, x, z, margin)) continue;
    if (from && !swimPathOk(ctx, body, from.x, from.z, x, z, margin)) continue;
    return { x, z };
  }
  return null;
}

// The open-water point nearest to (x, z), searching outward from the cells.
export function nearestSwimPoint(ctx, body, x, z, margin) {
  let best = null;
  let bestD = Infinity;
  for (const c of body.centers) {
    for (const t of [1, 0.75, 0.5, 0.25, 0]) {
      const px = c.x + (x - c.x) * t;
      const pz = c.z + (z - c.z) * t;
      const dx = px - c.x;
      const dz = pz - c.z;
      if (dx * dx + dz * dz > HEX_APOTHEM * HEX_APOTHEM) continue;
      if (!swimOk(ctx, body, px, pz, margin)) continue;
      const d = (px - x) ** 2 + (pz - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = { x: px, z: pz };
      }
      break;
    }
  }
  return best;
}
