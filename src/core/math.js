// Small numeric helpers shared across modules.

export function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// Hermite smoothstep. Unlike THREE.MathUtils.smoothstep, reversed edges
// (e0 > e1) work too, and give a falling curve.
export function smoothstep(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}
