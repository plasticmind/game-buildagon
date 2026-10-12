// Wing poses and flight paths shared by ducks, swans, songbirds, and gulls.

import { lerp } from './Creature.js';

// Spread (open 0..1) and flap (radians, tips up when positive) a pair of
// flight wings. Folded wings shrink away into the body's painted wings.
export function poseWings(wingL, wingR, open, flap) {
  const s = Math.max(0.001, open);
  if (wingR) {
    wingR.visible = open > 0.02;
    wingR.scale.setScalar(s);
    wingR.rotation.z = flap;
  }
  if (wingL) {
    wingL.visible = open > 0.02;
    wingL.scale.setScalar(s);
    wingL.rotation.z = -flap;
  }
}

// A flight from `a` to `b` ({x, y, z}). Descending flights flatten out near the
// end like a glide in to land; `lift` adds an arc for short hops between perches.
export function flightPoint(a, b, s, out, { lift = 0, landing = true } = {}) {
  out.x = lerp(a.x, b.x, s);
  out.z = lerp(a.z, b.z, s);
  const k = landing && a.y > b.y ? 1 - (1 - s) ** 1.7 : s;
  out.y = lerp(a.y, b.y, k) + Math.sin(Math.PI * s) * lift;
  return out;
}

// A point `dist` away along a random direction (or `dir`), `up` higher.
export function farPoint(from, dist, up, dir = Math.random() * Math.PI * 2) {
  return { x: from.x + Math.sin(dir) * dist, y: from.y + up, z: from.z + Math.cos(dir) * dist };
}
