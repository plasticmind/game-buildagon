// Seeded randomness and smooth 2D noise.

// Returns a function that yields floats in [0, 1). Same seed, same sequence.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed() {
  return (Math.random() * 0xffffffff) >>> 0;
}

export const range = (rng, min, max) => min + (max - min) * rng();
export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

// Value noise with smooth interpolation. Output is in [0, 1].
export function createNoise2D(seed = 1) {
  const perm = new Uint8Array(512);
  const rng = mulberry32(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) vals[i] = rng();

  const fade = (t) => t * t * (3 - 2 * t);
  const lerp = (a, b, t) => a + (b - a) * t;
  const v = (x, y) => vals[perm[(x & 255) + perm[y & 255]]];

  return function noise(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const tx = fade(x - xi);
    const ty = fade(y - yi);
    return lerp(lerp(v(xi, yi), v(xi + 1, yi), tx), lerp(v(xi, yi + 1), v(xi + 1, yi + 1), tx), ty);
  };
}

// Fractal sum of value noise. Output is roughly in [0, 1].
export function fbm(noise, x, y, octaves = 4) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise(x * freq, y * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}
