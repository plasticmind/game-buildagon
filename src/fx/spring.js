// Squash-and-stretch spring curves for the placement "pop".

// Damped spring from 0 to 1 that overshoots, for t in seconds.
export function springValue(t, { stiffness = 18, damping = 7.5 } = {}) {
  if (t <= 0) return 0;
  const w = stiffness;
  const env = Math.exp(-damping * t);
  return 1 - env * Math.cos(w * t);
}

// Scale factors for a pop at time t (seconds). Returns { xz, y }.
// Volume stays roughly constant: when y stretches, xz squashes.
// Settles to { xz: 1, y: 1 } after about `duration` seconds.
export function popScale(t, duration = 0.55) {
  if (t >= duration) return { xz: 1, y: 1, done: true };
  const s = springValue(t);
  // Growth from small, then wobble around 1.
  const grow = Math.min(1, s);
  const wobble = s - 1; // Negative while growing, oscillates afterwards.
  const y = Math.max(0.001, s + wobble * 0.6);
  const xz = Math.max(0.001, grow * (1 - wobble * 0.45));
  return { xz, y, done: false };
}

// Shrink-out curve for removal: 1 → 0 with a small anticipation bump.
export function shrinkScale(t, duration = 0.28) {
  if (t >= duration) return { s: 0, done: true };
  const k = t / duration;
  const bump = Math.sin(Math.min(1, k * 2.2) * Math.PI) * 0.12;
  return { s: Math.max(0, (1 - k * k) + bump * (1 - k)), done: false };
}
