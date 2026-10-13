// Furniture models: tables, chairs, beds, bookshelves, rugs, lamps, fireplaces,
// vases, and potted plants for house interiors. Furniture is freeform: base at
// y = 0, front facing local +Z, and a flat back that stands against a wall.
// Sizes suit one-story rooms: 2.4-unit walls and a door about 1.9 tall. Indoor
// plants and flowers don't sway, so their leaves are static double-sided parts.

import * as THREE from 'three';
import { PALETTE, STORY_H } from '../../core/constants.js';
import { cyl, cone, ico, octa, lathe, hexPrism, paint, tr, jitter, assemble, shade, mix, blk, beam, rod } from './util.js';
import { paintFaces, clean, strip, blade, ramp } from './nature.js';

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const GAP = 0.008; // Seam between blocks, patches, and planks.
const _q = new THREE.Quaternion();
const _d = new THREE.Vector3();

// Rotate a part built around +Y so it follows `dir`, then move it to `at`.
function mount(g, at, dir) {
  g.applyQuaternion(_q.setFromUnitVectors(UP, _d.copy(dir).normalize()));
  g.translate(at.x, at.y, at.z);
  return g;
}

// Flames in a child group named 'flame' that flicker every frame (fires, candles).
// Each set is { at, glow }: glow parts built around their base point `at`, which
// stays put while the flames stretch.
function addFlames(root, sets, phase) {
  const flame = new THREE.Group();
  flame.name = 'flame';
  for (const { at, glow } of sets) {
    const part = assemble({ glow }, { castShadow: false });
    part.position.copy(at);
    flame.add(part);
  }
  root.add(flame);
  root.userData.animate = (obj, time) => {
    const f = (obj.userData.flame ??= obj.getObjectByName('flame'));
    if (!f) return;
    const t = time + phase;
    f.children.forEach((m, i) => {
      const k = i * 1.7;
      const s = 1 + 0.12 * Math.sin(t * 9.1 + k) + 0.07 * Math.sin(t * 15.3 + k * 2);
      m.scale.set(1 - 0.05 * Math.sin(t * 7.3 + k), s, 1 - 0.05 * Math.cos(t * 6.1 + k));
    });
  };
}

// Running-bond blocks that fill a box over a recessed mortar core. `box` is
// [x0, x1, y0, y1, z0, z1]; each block mixes between the two colors.
function masonry(solid, [x0, x1, y0, y1, z0, z1], { course, unit, colors, mortar, rough = 0 }, rng) {
  solid.push(paint(blk(x0 + GAP, x1 - GAP, y0, y1, z0 + GAP, z1 - GAP), mortar));
  const rows = Math.max(1, Math.round((y1 - y0) / course));
  const ch = (y1 - y0) / rows;
  for (let row = 0; row < rows; row++) {
    const ya = y0 + row * ch;
    let x = x0 - (row % 2 ? unit / 2 : rng() * unit * 0.3);
    while (x < x1 - 1e-3) {
      const next = x + unit * (0.85 + rng() * 0.3);
      const xa = Math.max(x0, x);
      const xb = Math.min(x1, next);
      if (xb - xa > 0.03) {
        let g = blk(xa + GAP / 2, xb - GAP / 2, ya + GAP / 2, ya + ch - GAP / 2, z0, z1);
        if (rough) g = jitter(g, rough, rng);
        solid.push(paint(g, mix(colors[0], colors[1], rng()), 0.04, rng));
      }
      x = next;
    }
  }
}

// A grid of fabric patches on a horizontal surface; color(i, j) picks each one.
function patches(solid, [x0, x1, y0, y1, z0, z1], nx, nz, color, rng) {
  const w = (x1 - x0) / nx;
  const d = (z1 - z0) / nz;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const g = blk(x0 + i * w, x0 + (i + 1) * w, y0, y1, z0 + j * d, z0 + (j + 1) * d);
      solid.push(paint(g, color(i, j), 0.03, rng));
    }
  }
}

// ---- Table ----

const TABLE_H = 0.74;

// Four tapered square legs joined by an apron under a w × d top.
function tableBase(solid, w, d, color, rng) {
  const lx = w / 2 - 0.1;
  const lz = d / 2 - 0.1;
  const top = TABLE_H - 0.05;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      solid.push(paint(tr(cyl(0.052, 0.04, top, 4), { x: sx * lx, z: sz * lz, ry: Math.PI / 4 }), color, 0.03, rng));
    }
  }
  const apron = shade(color, 0.03);
  for (const sz of [-1, 1]) solid.push(paint(blk(-lx, lx, top - 0.11, top, sz * lz - 0.02, sz * lz + 0.02), apron, 0.03, rng));
  for (const sx of [-1, 1]) solid.push(paint(blk(sx * lx - 0.02, sx * lx + 0.02, top - 0.11, top, -lz, lz), apron, 0.03, rng));
}

function table(variant, rng) {
  const solid = [];
  if (variant === 1) {
    // Round top on a turned pedestal with four splayed feet.
    const wood = PALETTE.woodLight;
    solid.push(paint(tr(cyl(0.5, 0.48, 0.05, 12), { y: TABLE_H - 0.05 }), wood, 0.03, rng));
    solid.push(paint(tr(cyl(0.2, 0.2, 0.04, 8), { y: TABLE_H - 0.09 }), shade(wood, -0.08), 0.03, rng));
    const post = clean(lathe([[0.07, 0.05], [0.055, 0.2], [0.085, 0.32], [0.05, 0.45], [0.045, 0.6], [0.07, TABLE_H - 0.09]], 8));
    solid.push(paint(post, PALETTE.wood, 0.03, rng));
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + Math.PI / 4;
      solid.push(paint(beam([0, 0.1, 0], [Math.cos(a) * 0.36, 0.04, Math.sin(a) * 0.36], 0.07, 0.06), PALETTE.wood, 0.03, rng));
    }
    return assemble({ solid });
  }

  const w = 1.2;
  const d = 0.76;
  tableBase(solid, w, d, PALETTE.woodDark, rng);
  if (variant === 0) {
    // Three planks with dark seams between them.
    solid.push(paint(blk(-w / 2 + 0.01, w / 2 - 0.01, TABLE_H - 0.045, TABLE_H - 0.01, -d / 2 + 0.01, d / 2 - 0.01), shade(PALETTE.wood, -0.15)));
    for (let i = 0; i < 3; i++) {
      const za = -d / 2 + (i * d) / 3;
      const g = blk(-w / 2, w / 2 - rng() * 0.01, TABLE_H - 0.05, TABLE_H, za + GAP / 2, za + d / 3 - GAP / 2);
      solid.push(paint(g, mix(PALETTE.wood, PALETTE.woodLight, 0.3 + rng() * 0.4), 0.03, rng));
    }
    return assemble({ solid });
  }

  // Tablecloth: a gingham cloth over the oak table, hanging down each side.
  const red = PALETTE.fabricRed;
  const white = PALETTE.flowerWhite;
  const gingham = (i, j) => [white, mix(red, white, 0.5), red][(i % 2) + (j % 2)];
  solid.push(paint(blk(-w / 2, w / 2, TABLE_H - 0.05, TABLE_H, -d / 2, d / 2), PALETTE.wood));
  const cw = w / 2 + 0.06;
  const cd = d / 2 + 0.06;
  const nx = 10;
  const nz = 7;
  patches(solid, [-cw, cw, TABLE_H, TABLE_H + 0.012, -cd, cd], nx, nz, gingham, rng);
  const drop = TABLE_H - 0.2;
  const t = 0.012;
  for (const sz of [-1, 1]) {
    const z0 = sz > 0 ? cd - t : -cd;
    patches(solid, [-cw, cw, drop, TABLE_H, z0, z0 + t], nx, 1, (i) => gingham(i, 1), rng);
  }
  for (const sx of [-1, 1]) {
    const x0 = sx > 0 ? cw - t : -cw;
    patches(solid, [x0, x0 + t, drop, TABLE_H, -cd + t, cd - t], 1, nz, (i, j) => gingham(1, j), rng);
  }
  return assemble({ solid });
}

// ---- Chair ----

const SEAT_H = 0.45;

function chair(variant, rng) {
  const solid = [];
  if (variant === 2) {
    // Round stool with splayed legs and a ring of rungs.
    solid.push(paint(tr(cyl(0.19, 0.18, 0.05, 10), { y: 0.55 }), PALETTE.woodLight, 0.03, rng));
    const feet = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + Math.PI / 4;
      const foot = [Math.cos(a) * 0.21, 0, Math.sin(a) * 0.21];
      solid.push(paint(rod([Math.cos(a) * 0.12, 0.56, Math.sin(a) * 0.12], foot, 0.022, 5), PALETTE.wood, 0.03, rng));
      feet.push([Math.cos(a) * 0.18, 0.2, Math.sin(a) * 0.18]);
    }
    for (let i = 0; i < 4; i++) solid.push(paint(rod(feet[i], feet[(i + 1) % 4], 0.012, 4), PALETTE.wood, 0.03, rng));
    return assemble({ solid });
  }

  const painted = variant === 1;
  const frame = painted ? mix(PALETTE.pineGreen, PALETTE.plaster, 0.35) : PALETTE.wood;
  const seat = painted ? mix(PALETTE.pineGreen, PALETTE.plaster, 0.5) : PALETTE.woodLight;
  const w = 0.23; // Half the seat width.
  const d = 0.22; // Half the seat depth.
  const top = 0.98;
  // The back legs lean back a little as they rise into the back posts.
  const backZ = (y) => -d + 0.035 - (y / top) * 0.07;
  for (const sx of [-1, 1]) {
    const x = sx * (w - 0.03);
    solid.push(paint(blk(x - 0.025, x + 0.025, 0, SEAT_H - 0.04, d - 0.06, d - 0.01), frame, 0.03, rng));
    solid.push(paint(beam([x, 0, backZ(0)], [x, top, backZ(top)], 0.05, 0.05), frame, 0.03, rng));
    solid.push(paint(blk(x - 0.015, x + 0.015, 0.14, 0.17, backZ(0.15), d - 0.035), frame, 0.03, rng));
  }
  solid.push(paint(blk(-w + 0.03, w - 0.03, 0.2, 0.23, d - 0.05, d - 0.02), frame, 0.03, rng));
  solid.push(paint(blk(-w, w, SEAT_H - 0.045, SEAT_H, -d, d), seat, 0.03, rng));

  const x = w - 0.03;
  if (painted) {
    // Spindle back with a wide top rail and a red cushion.
    solid.push(paint(beam([-x, top - 0.06, backZ(top - 0.06)], [x, top - 0.06, backZ(top - 0.06)], 0.035, 0.1), frame, 0.03, rng));
    for (const sx of [-0.5, 0, 0.5]) {
      const xs = sx * x;
      solid.push(paint(rod([xs, SEAT_H, backZ(SEAT_H)], [xs, top - 0.1, backZ(top - 0.1)], 0.014, 5), frame, 0.03, rng));
    }
    const cushion = jitter(blk(-w + 0.025, w - 0.025, SEAT_H, SEAT_H + 0.05, -d + 0.03, d - 0.02), 0.008, rng);
    solid.push(paint(cushion, PALETTE.fabricRed, 0.03, rng));
  } else {
    // Ladder back: three slats between the posts.
    for (const y of [0.62, 0.76, 0.9]) solid.push(paint(beam([-x, y, backZ(y)], [x, y, backZ(y)], 0.028, 0.07), frame, 0.03, rng));
  }
  return assemble({ solid });
}

// ---- Armchair ----

const ARMCHAIR = [
  { fabric: mix(PALETTE.fabricRed, PALETTE.blossom, 0.35), pillow: PALETTE.plaster },
  { fabric: PALETTE.fabricBlue, pillow: PALETTE.flowerYellow },
  { fabric: mix(PALETTE.moss, PALETTE.pineGreen, 0.35), pillow: PALETTE.blossom },
];

function armchair(variant, rng) {
  const { fabric, pillow } = ARMCHAIR[variant];
  const dark = shade(fabric, -0.07);
  const solid = [];
  const soft = (g, c) => solid.push(paint(jitter(g, 0.008, rng), c, 0.03, rng));
  const W = 0.46; // Half width.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) solid.push(paint(tr(cyl(0.035, 0.028, 0.09, 6), { x: sx * (W - 0.07), z: sz * 0.34 }), PALETTE.woodDark, 0.03, rng));
  }
  soft(blk(-W, W, 0.09, 0.34, -0.42, 0.4), dark);
  soft(blk(-W + 0.13, W - 0.13, 0.34, 0.47, -0.26, 0.42), fabric);
  // Arms with rolled tops.
  for (const sx of [-1, 1]) {
    const x0 = sx > 0 ? W - 0.13 : -W;
    soft(blk(x0, x0 + 0.13, 0.34, 0.62, -0.42, 0.4), fabric);
    solid.push(paint(rod([sx * (W - 0.065), 0.62, -0.42], [sx * (W - 0.065), 0.62, 0.43], 0.072, 7), fabric, 0.02, rng));
  }
  // A tall back with a rolled top, and a cushion leaning against it.
  soft(blk(-W, W, 0.34, 0.95, -0.42, -0.26), dark);
  solid.push(paint(rod([-W, 0.95, -0.34], [W, 0.95, -0.34], 0.085, 7), fabric, 0.02, rng));
  soft(tr(blk(-W + 0.13, W - 0.13, 0, 0.44, -0.06, 0.06), { rx: -0.18, y: 0.47, z: -0.19 }), fabric);
  // A throw pillow in one corner.
  const side = rng() < 0.5 ? -1 : 1;
  soft(tr(blk(-0.12, 0.12, -0.12, 0.12, -0.045, 0.045), { rz: side * 0.45, rx: -0.35, x: side * (W - 0.25), y: 0.63, z: -0.1 }), pillow);
  return assemble({ solid });
}

// ---- Bed ----

const QUILT_PATCHES = [PALETTE.fabricRed, PALETTE.fabricBlue, PALETTE.flowerYellow, PALETTE.blossom, mix(PALETTE.leafLight, PALETTE.pineGreen, 0.3)];

// A bed frame on the ground at y0: corner posts, head- and footboard, side rails,
// a mattress, a quilt, and pillows. The head is at -Z. `head` and `foot` are post
// heights; the boards stop a little below them unless headTop or footTop says.
function bedTier(solid, W, y0, rng, { wood, head, foot, headTop = head - 0.08, footTop = foot - 0.06, knobs = true, quilt, pillows }) {
  const L0 = -0.95;
  const L1 = 0.92;
  const knob = shade(wood, 0.06);
  for (const [z, h] of [[L0 + 0.035, head], [L1 - 0.035, foot]]) {
    for (const sx of [-1, 1]) {
      const x = sx * (W - 0.035);
      solid.push(paint(blk(x - 0.035, x + 0.035, y0, y0 + h, z - 0.035, z + 0.035), wood, 0.03, rng));
      if (knobs) solid.push(paint(tr(octa(0.045), { x, y: y0 + h + 0.02, z, sy: 0.8 }), knob));
    }
  }
  const board = shade(wood, 0.04);
  solid.push(paint(blk(-W + 0.07, W - 0.07, y0 + 0.3, y0 + headTop, L0 + 0.015, L0 + 0.055), board, 0.03, rng));
  solid.push(paint(blk(-W + 0.07, W - 0.07, y0 + 0.3, y0 + footTop, L1 - 0.055, L1 - 0.015), board, 0.03, rng));
  for (const sx of [-1, 1]) solid.push(paint(blk(sx * W - 0.03, sx * W + 0.0, y0 + 0.2, y0 + 0.34, L0 + 0.07, L1 - 0.07), wood, 0.03, rng));
  solid.push(paint(blk(-W + 0.04, W - 0.04, y0 + 0.26, y0 + 0.3, L0 + 0.07, L1 - 0.07), shade(wood, -0.1)));

  // Mattress, and the sheet folded back over the top of the quilt.
  const mx = W - 0.045;
  const m0 = L0 + 0.07;
  const m1 = L1 - 0.07;
  const top = y0 + 0.46;
  solid.push(paint(jitter(blk(-mx, mx, y0 + 0.3, top, m0, m1), 0.004, rng), PALETTE.plaster, 0.02, rng));
  const q0 = m0 + 0.55;
  solid.push(paint(blk(-mx - 0.012, mx + 0.012, top, top + 0.03, q0 - 0.12, q0 + 0.02), PALETTE.flowerWhite, 0.02, rng));
  // Quilt: patches on top, hanging down both sides and the foot.
  const nx = Math.round((2 * mx) / 0.2);
  const nz = 5;
  patches(solid, [-mx - 0.012, mx + 0.012, top, top + 0.025, q0, m1 + 0.012], nx, nz, quilt, rng);
  for (const sx of [-1, 1]) {
    const x = sx * (mx + 0.012);
    patches(solid, [Math.min(x, x - sx * 0.012), Math.max(x, x - sx * 0.012), y0 + 0.31, top, q0, m1 + 0.012], 1, nz, (i, j) => quilt(sx < 0 ? 0 : nx - 1, j), rng);
  }
  patches(solid, [-mx, mx, y0 + 0.31, top, m1, m1 + 0.012], nx, 1, (i) => quilt(i, nz - 1), rng);

  // Pillows lean a little on the headboard.
  const pw = (2 * mx - 0.06) / pillows / 2;
  for (let i = 0; i < pillows; i++) {
    const cx = -mx + 0.03 + pw * (2 * i + 1);
    const g = jitter(blk(-pw + 0.02, pw - 0.02, 0, 0.11, -0.15, 0.15), 0.01, rng);
    solid.push(paint(tr(g, { rx: 0.25, x: cx, y: top + 0.01, z: m0 + 0.2 }), PALETTE.flowerWhite, 0.02, rng));
  }
}

function bed(variant, rng) {
  const solid = [];
  if (variant === 2) {
    // Bunk beds: two single beds on tall posts, with a ladder and a guard rail.
    const W = 0.5;
    const wood = PALETTE.woodLight;
    const pick = (list) => (i, j) => list[(i * 3 + j * 2) % list.length];
    // The lower tier's posts rise to carry the upper tier.
    bedTier(solid, W, 0, rng, { wood, head: 1.0, foot: 1.0, headTop: 0.86, footTop: 0.56, knobs: false, quilt: pick([PALETTE.fabricRed, PALETTE.flowerYellow, PALETTE.blossom]), pillows: 1 });
    bedTier(solid, W, 1.0, rng, { wood, head: 0.68, foot: 0.58, quilt: pick([PALETTE.fabricBlue, PALETTE.flowerWhite, mix(PALETTE.leafLight, PALETTE.pineGreen, 0.3)]), pillows: 1 });
    // Guard rails on the upper bunk: full length on one side, short on the ladder side.
    const rail = shade(wood, -0.06);
    solid.push(paint(blk(-W - 0.005, -W + 0.03, 1.48, 1.54, -0.88, 0.85), rail, 0.03, rng));
    solid.push(paint(blk(W - 0.03, W + 0.005, 1.48, 1.54, -0.88, 0.22), rail, 0.03, rng));
    solid.push(paint(blk(W - 0.03, W + 0.005, 1.2, 1.48, 0.17, 0.22), rail, 0.03, rng));
    // Ladder on the outside of the frame near the foot.
    const lx = W + 0.04;
    for (const z of [0.32, 0.72]) solid.push(paint(blk(lx - 0.025, lx + 0.025, 0, 1.62, z - 0.025, z + 0.025), wood, 0.03, rng));
    for (const y of [0.28, 0.56, 0.84, 1.12, 1.4]) solid.push(paint(rod([lx, y, 0.32], [lx, y, 0.72], 0.02, 5), rail, 0.03, rng));
    return assemble({ solid });
  }

  const double = variant === 1;
  if (double) {
    // Blue quilt with cream stripes.
    const quilt = (i, j) => (j % 2 ? PALETTE.flowerWhite : PALETTE.fabricBlue);
    bedTier(solid, 0.74, 0, rng, { wood: PALETTE.woodDark, head: 1.08, foot: 0.58, quilt, pillows: 2 });
  } else {
    // Patchwork quilt in random squares.
    const colors = Array.from({ length: 40 }, () => QUILT_PATCHES[Math.floor(rng() * QUILT_PATCHES.length)]);
    bedTier(solid, 0.5, 0, rng, { wood: PALETTE.wood, head: 1.0, foot: 0.6, quilt: (i, j) => colors[(i * 5 + j) % colors.length], pillows: 1 });
  }
  return assemble({ solid });
}

// ---- Bookshelf ----

const BOOKS = [
  PALETTE.fabricRed,
  PALETTE.fabricBlue,
  mix(PALETTE.pineGreen, PALETTE.plaster, 0.15),
  shade(PALETTE.flowerYellow, -0.12),
  PALETTE.woodDark,
  PALETTE.roofRed,
  shade(PALETTE.flowerPurple, -0.08),
  PALETTE.plaster,
  PALETTE.roofSlate,
];

// Fill a shelf from x0 to x1 with upright books, a gap now and then, and
// sometimes a short stack lying flat.
function books(solid, x0, x1, y, space, z1, rng) {
  let x = x0 + rng() * 0.04;
  let stacked = false;
  while (x < x1 - 0.03) {
    const r = rng();
    if (r < 0.06) {
      x += 0.05 + rng() * 0.06;
      continue;
    }
    if (r < 0.12 && !stacked && x1 - x > 0.26) {
      // A short stack of books lying flat.
      stacked = true;
      let sy = y;
      const n = 2 + Math.floor(rng() * 3);
      for (let i = 0; i < n; i++) {
        const t = 0.035 + rng() * 0.02;
        const len = 0.18 + rng() * 0.05;
        const g = tr(blk(-len / 2, len / 2, 0, t, -0.09, 0.09), { x: x + 0.12 + (rng() - 0.5) * 0.02, y: sy, z: z1 - 0.11, ry: (rng() - 0.5) * 0.3 });
        solid.push(paint(g, BOOKS[Math.floor(rng() * BOOKS.length)], 0.04, rng));
        sy += t;
      }
      x += 0.26;
      continue;
    }
    const w = 0.035 + rng() * 0.035;
    if (x + w > x1) break;
    const h = space * (0.62 + rng() * 0.28);
    const depth = 0.17 + rng() * 0.06;
    const color = BOOKS[Math.floor(rng() * BOOKS.length)];
    solid.push(paint(blk(x, x + w, y, y + h, z1 - depth, z1 - 0.01), color, 0.04, rng));
    // A pale band across the spine on some books.
    if (rng() < 0.4) solid.push(paint(blk(x + 0.004, x + w - 0.004, y + h * 0.7, y + h * 0.78, z1 - 0.012, z1 - 0.004), shade(color, 0.25)));
    x += w + 0.004;
  }
}

function bookshelf(variant, rng) {
  const wood = [PALETTE.wood, shade(PALETTE.woodDark, -0.03), mix(PALETTE.fabricBlue, PALETTE.plaster, 0.3)][variant];
  const solid = [];
  const W = 0.48;
  const z0 = -0.17;
  const z1 = 0.17;
  const H = 1.72;
  solid.push(paint(blk(-W + 0.02, W - 0.02, 0, H, z0, z0 + 0.03), shade(wood, -0.14), 0.03, rng));
  for (const sx of [-1, 1]) solid.push(paint(blk(sx > 0 ? W - 0.04 : -W, sx > 0 ? W : -W + 0.04, 0, H, z0, z1), wood, 0.03, rng));
  solid.push(paint(blk(-W + 0.04, W - 0.04, 0, 0.09, z0, z1 - 0.02), shade(wood, -0.06), 0.03, rng));
  solid.push(paint(blk(-W - 0.03, W + 0.03, H, H + 0.05, z0, z1 + 0.03), shade(wood, 0.04), 0.03, rng));
  const shelves = [0.09, 0.5, 0.91, 1.32];
  shelves.forEach((y, i) => {
    if (i > 0) solid.push(paint(blk(-W + 0.04, W - 0.04, y - 0.035, y, z0 + 0.03, z1), wood, 0.03, rng));
    const ceiling = (shelves[i + 1] ?? H) - (shelves[i + 1] ? 0.035 : 0);
    books(solid, -W + 0.045, W - 0.045, y, ceiling - y, z1, rng);
  });
  return assemble({ solid });
}

// ---- Rug ----

const RUG_H = 0.022; // Thin enough to read as cloth, thick enough to clear a floor.

function rug(variant, rng) {
  const solid = [];
  if (variant === 0) {
    // Braided oval: rings of color in one flat disc.
    const ringColors = [PALETTE.fabricRed, PALETTE.plaster, PALETTE.fabricBlue, mix(PALETTE.flowerYellow, PALETTE.woodLight, 0.4), PALETTE.fabricRed, PALETTE.plaster];
    const radii = [0, 0.16, 0.3, 0.44, 0.58, 0.72, 0.86];
    const pts = radii.map((r) => [r, RUG_H]);
    pts.push([0.86, 0]);
    let g = clean(lathe(pts.reverse(), 20));
    g = paintFaces(g, (c) => {
      const r = Math.hypot(c.x, c.z);
      if (c.y < RUG_H * 0.9) return shade(ringColors[ringColors.length - 1], -0.08);
      const i = radii.findIndex((x) => x > r) - 1;
      return ringColors[Math.max(0, Math.min(ringColors.length - 1, i))];
    }, 0.03, rng);
    solid.push(tr(g, { sz: 0.66 }));
    return assemble({ solid });
  }
  if (variant === 1) {
    // Striped runner with fringed ends.
    const stripes = [PALETTE.fabricBlue, PALETTE.plaster, PALETTE.fabricRed, PALETTE.plaster, PALETTE.flowerYellow, PALETTE.plaster, PALETTE.fabricRed, PALETTE.plaster, PALETTE.fabricBlue];
    const L = 0.85;
    const D = 0.55;
    const w = (2 * L) / stripes.length;
    stripes.forEach((c, i) => solid.push(paint(blk(-L + i * w, -L + (i + 1) * w, 0, RUG_H, -D, D), c, 0.03, rng)));
    for (const sx of [-1, 1]) {
      for (let k = 0; k < 11; k++) {
        const z = -D + 0.05 + (k / 10) * (2 * D - 0.1);
        solid.push(paint(blk(sx > 0 ? L : -L - 0.07, sx > 0 ? L + 0.07 : -L, 0, 0.01, z - 0.012, z + 0.012), PALETTE.flowerWhite));
      }
    }
    return assemble({ solid });
  }
  // Hexagonal rug with a border and a center medallion.
  solid.push(paint(hexPrism(1.0, RUG_H - 0.004), shade(PALETTE.roofSlate, -0.05), 0.03, rng));
  solid.push(paint(hexPrism(0.86, RUG_H), mix(PALETTE.plaster, PALETTE.flowerYellow, 0.3), 0.03, rng));
  solid.push(paint(hexPrism(0.62, RUG_H + 0.002), PALETTE.fabricBlue, 0.03, rng));
  solid.push(paint(tr(hexPrism(0.3, RUG_H + 0.004), { ry: Math.PI / 6 }), PALETTE.flowerYellow, 0.03, rng));
  return assemble({ solid });
}

// ---- Lamp ----

const SHADE_GLOW = '#ffe6b0';
const BRASS = mix(PALETTE.metal, PALETTE.leafGold, 0.55);

function lamp(variant, rng) {
  const solid = [];
  const glow = [];
  let light;
  if (variant === 0) {
    // Floor lamp: weighted base, a tall pole, and a wide shade.
    solid.push(paint(cyl(0.17, 0.19, 0.04, 8), PALETTE.metal, 0.03, rng));
    solid.push(paint(tr(cyl(0.022, 0.022, 1.28, 6), { y: 0.04 }), BRASS, 0.03, rng));
    glow.push([tr(cyl(0.13, 0.22, 0.27, 8), { y: 1.25 }), SHADE_GLOW]);
    solid.push(paint(tr(octa(0.03), { y: 1.55 }), BRASS));
    light = V(0, 1.36, 0);
  } else if (variant === 1) {
    // Table lamp: a round ceramic base under a small shade.
    const base = [PALETTE.fabricBlue, mix(PALETTE.pineGreen, PALETTE.plaster, 0.4), PALETTE.blossomDeep][Math.floor(rng() * 3)];
    solid.push(paint(clean(lathe([[0, 0], [0.07, 0], [0.095, 0.06], [0.09, 0.14], [0.05, 0.21], [0.03, 0.23], [0, 0.23]], 8)), base, 0.03, rng));
    solid.push(paint(tr(cyl(0.012, 0.012, 0.08, 5), { y: 0.22 }), BRASS));
    glow.push([tr(cyl(0.085, 0.14, 0.16, 8), { y: 0.26 }), SHADE_GLOW]);
    light = V(0, 0.33, 0);
  } else {
    // Three candles on a brass dish.
    solid.push(paint(cyl(0.15, 0.13, 0.025, 10), BRASS, 0.03, rng));
    const flames = [];
    [[0, 0.2, -0.02], [-0.07, 0.14, 0.05], [0.075, 0.11, 0.04]].forEach(([x, h, z]) => {
      solid.push(paint(tr(cyl(0.026, 0.028, h, 7), { x, y: 0.025, z }), PALETTE.flowerWhite, 0.02, rng));
      solid.push(paint(tr(cyl(0.004, 0.004, 0.02, 3), { x, y: 0.025 + h, z }), PALETTE.metal));
      flames.push({ at: V(x, 0.03 + h, z), glow: [[tr(octa(0.018), { y: 0.03, sy: 1.9 }), PALETTE.lanternGlow]] });
    });
    const root = assemble({ solid });
    addFlames(root, flames, rng() * 10);
    root.userData.lightOffset = V(0, 0.3, 0);
    return root;
  }
  const obj = assemble({ solid, glow });
  obj.userData.lightOffset = light;
  return obj;
}

// ---- Fireplace ----

const HEARTH = [
  // Stone: rough fieldstone.
  { colors: [PALETTE.stoneLight, PALETTE.stoneMid], mortar: shade(PALETTE.stoneMid, -0.2), course: 0.17, unit: 0.26, rough: 0.012, mantel: PALETTE.woodDark },
  // Brick: neat red courses.
  { colors: [PALETTE.brick, shade(PALETTE.brick, -0.08)], mortar: mix(PALETTE.plaster, PALETTE.stoneMid, 0.4), course: 0.09, unit: 0.22, rough: 0, mantel: PALETTE.wood },
  // Plaster: smooth and cream, with a stone surround.
  { plaster: true, mantel: PALETTE.wood },
];

function fireplace(variant, rng) {
  const s = HEARTH[variant];
  const solid = [];
  const OW = 0.68; // Half the body width.
  const OX = 0.36; // Half the opening width.
  const base = 0.08; // Hearth slab height.
  const OY = base + 0.7; // Top of the opening.
  const z0 = -0.26;
  const z1 = 0.2;
  const mantelY = 1.0;
  const topY = STORY_H - 0.02; // Walls stand on the floor, so this meets the ceiling.
  const soot = shade(PALETTE.rockDark, -0.32);

  solid.push(paint(blk(-0.84, 0.84, 0, base, z0, 0.56), s.plaster ? PALETTE.stoneMid : mix(s.colors[1], PALETTE.rockDark, 0.3), 0.03, rng));
  const body = (box, opts) => {
    if (s.plaster) solid.push(paint(blk(...box), PALETTE.plaster, 0.02, rng));
    else masonry(solid, box, { ...s, ...opts }, rng);
  };
  body([-OW, -OX, base, mantelY, z0, z1]);
  body([OX, OW, base, mantelY, z0, z1]);
  body([-OX, OX, OY, mantelY, z0, z1]);
  body([-0.5, 0.5, mantelY + 0.08, topY, z0, z1 - 0.1]);
  if (s.plaster) {
    // Stone surround framing the opening.
    const stone = (g) => solid.push(paint(g, mix(PALETTE.stoneLight, PALETTE.stoneMid, rng()), 0.04, rng));
    stone(blk(-OX - 0.1, -OX, base, OY + 0.1, z1, z1 + 0.03));
    stone(blk(OX, OX + 0.1, base, OY + 0.1, z1, z1 + 0.03));
    stone(blk(-OX - 0.1, OX + 0.1, OY, OY + 0.1, z1, z1 + 0.035));
  }
  // Sooty firebox lining.
  solid.push(paint(blk(-OX, OX, base, OY, z0, z0 + 0.12), soot, 0.05, rng));
  for (const sx of [-1, 1]) solid.push(paint(blk(sx > 0 ? OX - 0.02 : -OX, sx > 0 ? OX : -OX + 0.02, base, OY, z0, z1 - 0.02), soot, 0.05, rng));
  solid.push(paint(blk(-OX, OX, OY - 0.02, OY, z0, z1 - 0.02), soot, 0.05, rng));
  solid.push(paint(blk(-OX, OX, base, base + 0.012, z0, z1), shade(soot, 0.08), 0.05, rng));

  // Mantel shelf on two corbels, with candles and a small jar.
  solid.push(paint(blk(-0.8, 0.8, mantelY, mantelY + 0.08, z0, z1 + 0.13), s.mantel, 0.03, rng));
  for (const sx of [-1, 1]) solid.push(paint(blk(sx * 0.58 - 0.05, sx * 0.58 + 0.05, mantelY - 0.1, mantelY, z1, z1 + 0.09), s.mantel, 0.03, rng));
  const shelf = mantelY + 0.08;
  for (const x of [-0.6, -0.5]) {
    solid.push(paint(tr(cyl(0.03, 0.035, 0.03, 6), { x, y: shelf, z: 0.17 }), BRASS));
    solid.push(paint(tr(cyl(0.02, 0.02, x === -0.6 ? 0.16 : 0.12, 6), { x, y: shelf + 0.03, z: 0.17 }), PALETTE.flowerWhite));
  }
  solid.push(paint(clean(lathe([[0, 0], [0.05, 0], [0.065, 0.06], [0.04, 0.12], [0.045, 0.14], [0, 0.14]], 7)), PALETTE.fabricBlue, 0.03, rng).translate(0.52, shelf, 0.15));

  // Andirons and crossed logs.
  for (const sx of [-1, 1]) solid.push(paint(blk(sx * 0.2 - 0.02, sx * 0.2 + 0.02, base, base + 0.12, -0.12, 0.08), PALETTE.metal));
  solid.push(paint(rod([-0.26, base + 0.11, -0.04], [0.26, base + 0.13, 0.02], 0.05, 6), PALETTE.trunk, 0.05, rng));
  solid.push(paint(rod([-0.2, base + 0.17, 0.06], [0.22, base + 0.19, -0.1], 0.045, 6), PALETTE.trunkDark, 0.05, rng));
  for (let i = 0; i < 5; i++) {
    const g = tr(octa(0.035), { x: (rng() - 0.5) * 0.4, y: base + 0.02, z: -0.05 + rng() * 0.12, sy: 0.6 });
    solid.push(paint(g, shade(PALETTE.trunkDark, -0.25), 0.05, rng));
  }
  const root = assemble({ solid });

  const outer = PALETTE.flowerOrange;
  const inner = PALETTE.flowerYellow;
  const glow = [
    [cone(0.16, 0.36, 5), outer],
    [tr(cone(0.09, 0.48, 5), { ry: 0.6 }), inner],
    [tr(cone(0.07, 0.24, 4), { x: -0.15, z: 0.03, rz: 0.2 }), outer],
    [tr(cone(0.07, 0.26, 4), { x: 0.15, z: -0.02, rz: -0.2 }), outer],
  ];
  addFlames(root, [{ at: V(0, base + 0.1, -0.02), glow }], rng() * 10);
  // The light sits in front of the opening so it falls into the room.
  root.userData.lightOffset = V(0, 0.45, 0.45);
  return root;
}

// ---- Flower vase ----

const VASES = [PALETTE.fabricBlue, mix(PALETTE.pineBlue, PALETTE.plaster, 0.45), PALETTE.plaster];
const STEM = PALETTE.leafDeep;
const LEAVES = [new THREE.Color(PALETTE.leafDeep), new THREE.Color(PALETTE.leafGreen)];

function flowerVase(variant, rng) {
  const solid = [];
  const double = [];
  const neck = 0.245;
  solid.push(paint(clean(lathe([[0, 0], [0.05, 0], [0.075, 0.05], [0.08, 0.11], [0.05, 0.19], [0.034, 0.22], [0.045, neck]], 8)), VASES[variant], 0.04, rng));
  solid.push(paint(tr(cyl(0.04, 0.04, 0.01, 8), { y: neck - 0.02 }), shade(STEM, -0.1)));

  const tulips = [PALETTE.flowerRed, PALETTE.flowerPink, PALETTE.flowerYellow];
  const n = variant === 2 ? 9 : 6 + Math.floor(rng() * 2);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rng() * 0.5;
    const spread = 0.05 + rng() * 0.07;
    const h = 0.18 + rng() * 0.14;
    const base = V(Math.cos(a) * 0.012, neck - 0.02, Math.sin(a) * 0.012);
    const tip = V(Math.cos(a) * spread, neck + h, Math.sin(a) * spread);
    solid.push(paint(rod(base.toArray(), tip.toArray(), 0.006, 3), STEM));
    const dir = tip.clone().sub(base);
    if (variant === 0) {
      const cup = clean(lathe([[0, 0], [0.026, 0.018], [0.03, 0.045], [0.022, 0.065]], 6));
      solid.push(paint(mount(cup, tip, dir), tulips[i % tulips.length], 0.05, rng));
    } else if (variant === 1) {
      const petals = tr(octa(0.034), { sy: 0.28 });
      solid.push(paint(mount(petals, tip, dir), PALETTE.flowerWhite, 0.03, rng));
      solid.push(paint(mount(tr(octa(0.013), { y: 0.007 }), tip, dir), PALETTE.flowerYellow));
    } else {
      // Lavender: a spike of buds along the top of the stem.
      for (let j = 0; j < 3; j++) {
        const p = base.clone().lerp(tip, 0.78 + j * 0.11);
        solid.push(paint(tr(octa(0.016 - j * 0.002), { x: p.x, y: p.y, z: p.z, sy: 1.7 }), shade(PALETTE.flowerPurple, -0.04 + j * 0.04), 0.04, rng));
      }
    }
  }
  // A few leaves spilling over the rim.
  for (let i = 0; i < 3; i++) {
    const lh = 0.12 + rng() * 0.04;
    let g = blade(0.04, lh, lh * 0.5, 2);
    g = paintFaces(g, (c) => ramp(LEAVES, c.y / lh), 0.05, rng);
    double.push(tr(g, { rz: -0.6 - rng() * 0.3, ry: (i / 3) * TAU + rng(), y: neck - 0.03 }));
  }
  return assemble({ solid, double });
}

// ---- Potted plant ----

const TERRACOTTA = mix(PALETTE.brick, PALETTE.woodLight, 0.25);

// A terracotta pot with a rim and soil, scaled by s. Returns the soil height.
function pot(solid, s, rng) {
  const g = clean(lathe([[0, 0], [0.11, 0], [0.14, 0.22], [0.165, 0.22], [0.165, 0.28], [0.142, 0.28]], 9));
  solid.push(paint(tr(g, { s }), TERRACOTTA, 0.04, rng));
  solid.push(paint(tr(cyl(0.142, 0.142, 0.024, 9), { y: 0.25 * s, s }), shade(PALETTE.trunkDark, -0.12), 0.05, rng));
  return 0.274 * s;
}

// A broad leaf from `at` heading out along the horizontal angle a.
function leaf(at, a, len, width, rise, rng) {
  const out = V(Math.cos(a), 0, Math.sin(a));
  const side = V(-Math.sin(a), 0, Math.cos(a));
  const spine = [];
  const widths = [0, width * 0.85, width, width * 0.7, 0];
  for (let i = 0; i < widths.length; i++) {
    const t = i / (widths.length - 1);
    spine.push(at.clone().addScaledVector(out, len * t).add(V(0, rise * t - len * 0.45 * t * t, 0)));
  }
  const color = mix(PALETTE.leafDeep, PALETTE.pineGreen, rng() * 0.5);
  return paintFaces(strip(spine, widths, side), () => color, 0.05, rng);
}

function pottedPlant(variant, rng) {
  const solid = [];
  const double = [];
  if (variant === 0) {
    // Fern: arching fronds from the pot.
    const soil = pot(solid, 1, rng);
    const n = 9;
    for (let i = 0; i < n; i++) {
      const lh = 0.3 + rng() * 0.12;
      let g = blade(0.075, lh, lh * (0.5 + rng() * 0.3), 4);
      g = paintFaces(g, (c) => ramp(LEAVES, c.y / lh), 0.05, rng);
      double.push(tr(g, { rz: -0.15 - rng() * 0.4, ry: (i / n) * TAU + rng() * 0.4, y: soil - 0.01 }));
    }
  } else if (variant === 1) {
    // Cactus with two arms and a pink flower.
    const soil = pot(solid, 0.8, rng);
    const green = mix(PALETTE.pineGreen, PALETTE.leafGreen, 0.35);
    const part = (g) => solid.push(paint(g, green, 0.04, rng));
    part(tr(cyl(0.07, 0.08, 0.4, 8), { y: soil - 0.01 }));
    part(tr(ico(0.07, 0), { y: soil + 0.39, sy: 0.7 }));
    for (const [sx, y, h] of [[-1, 0.15, 0.16], [1, 0.24, 0.12]]) {
      const x = sx * 0.13;
      part(rod([0, soil + y, 0], [x, soil + y, 0], 0.035, 6));
      part(tr(cyl(0.035, 0.035, h, 6), { x, y: soil + y }));
      part(tr(ico(0.035, 0), { x, y: soil + y + h, sy: 0.8 }));
    }
    solid.push(paint(tr(octa(0.04), { y: soil + 0.44, sy: 0.6 }), PALETTE.flowerPink, 0.04, rng));
    solid.push(paint(tr(octa(0.016), { y: soil + 0.46 }), PALETTE.flowerYellow));
  } else {
    // Tall leafy houseplant on a woody stem.
    const soil = pot(solid, 1.3, rng);
    const top = soil + 0.85;
    solid.push(paint(rod([0, soil - 0.02, 0], [0.03, top, -0.02], 0.022, 5), PALETTE.trunk, 0.04, rng));
    const n = 11;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const at = V(0.03 * t, soil + 0.25 + t * 0.62, -0.02 * t);
      double.push(leaf(at, i * 2.4 + rng() * 0.4, 0.24 + (1 - t) * 0.08, 0.085, 0.12, rng));
    }
  }
  return assemble({ solid, double });
}

// ---- Registry ----

// Clamp a variant index into range so a bad save never throws.
const withVariants = (fn, n) => (variant, rng) => fn(Math.min(n - 1, Math.max(0, variant | 0)), rng);

export const builders = {
  table: withVariants(table, 3),
  chair: withVariants(chair, 3),
  armchair: withVariants(armchair, 3),
  bed: withVariants(bed, 3),
  bookshelf: withVariants(bookshelf, 3),
  rug: withVariants(rug, 3),
  lamp: withVariants(lamp, 3),
  fireplace: withVariants(fireplace, 3),
  flower_vase: withVariants(flowerVase, 3),
  potted_plant: withVariants(pottedPlant, 3),
};
