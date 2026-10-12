// Prop models: lanterns, campfires, benches, barrels, wells, signposts, windmills,
// rowboats, and footbridges. Props are freeform items: base at y = 0, front
// facing local +Z. Animated parts (sails, flames, the bobbing hull) live in their
// own child groups so the placement transform on the root never changes.

import * as THREE from 'three';
import { PALETTE, TERRAIN } from '../../core/constants.js';
import {
  box,
  cyl,
  cone,
  ico,
  octa,
  dodeca,
  hexPrism,
  hexPyramid,
  lathe,
  extrude,
  paint,
  sway,
  jitter,
  tr,
  assemble,
  shade,
  mix,
  blk,
  beam,
  rod,
  face,
} from './util.js';

const TAU = Math.PI * 2;

// ---- Lantern ----

function hangingLamp(x, y, z, solid, glow) {
  // Lamp hangs with its top at y.
  solid.push(paint(tr(hexPyramid(0.15, 0.12), { x, y: y - 0.12, z }), PALETTE.metal));
  solid.push(paint(tr(hexPrism(0.12, 0.03), { x, y: y - 0.15, z }), PALETTE.metal));
  glow.push([tr(hexPrism(0.095, 0.22), { x, y: y - 0.37, z }), PALETTE.lanternGlow]);
  solid.push(paint(tr(hexPrism(0.12, 0.03), { x, y: y - 0.4, z }), PALETTE.metal));
  solid.push(paint(tr(cone(0.04, 0.06, 6), { x, y: y - 0.44, z, rx: Math.PI }), PALETTE.metal));
  return new THREE.Vector3(x, y - 0.26, z);
}

function lantern(variant, rng) {
  const solid = [];
  const glow = [];
  const foliage = [];
  let light;
  if (variant === 0) {
    // Wooden post with an iron arm and a hanging lamp.
    solid.push(paint(jitter(hexPrism(0.2, 0.14), 0.02, rng, { y: 0 }), PALETTE.stoneMid, 0.05, rng));
    solid.push(paint(tr(cyl(0.055, 0.07, 1.72, 6), { y: 0.1 }), PALETTE.trunkDark, 0.04, rng));
    solid.push(paint(tr(hexPyramid(0.09, 0.1), { y: 1.82 }), PALETTE.metal));
    solid.push(paint(beam([-0.02, 1.7, 0], [0.46, 1.7, 0], 0.05, 0.05), PALETTE.metal));
    solid.push(paint(beam([0.02, 1.42, 0], [0.26, 1.68, 0], 0.035, 0.035), PALETTE.metal));
    solid.push(paint(tr(octa(0.035), { x: 0.47, y: 1.7 }), PALETTE.metal));
    solid.push(paint(blk(0.39, 0.41, 1.56, 1.68, -0.01, 0.01), PALETTE.metal));
    light = hangingLamp(0.4, 1.58, 0, solid, glow);
  } else if (variant === 1) {
    // Stone tōrō: base, shaft, platform, fire box, wide cap, and a finial.
    const stone = (g, t = 0.5) => solid.push(paint(g, mix(PALETTE.stoneLight, PALETTE.stoneMid, t), 0.04, rng));
    stone(hexPrism(0.34, 0.12), 0.7);
    stone(tr(hexPrism(0.25, 0.08), { y: 0.12 }), 0.4);
    stone(tr(cyl(0.1, 0.13, 0.4, 6), { y: 0.2 }), 0.3);
    stone(tr(cyl(0.26, 0.14, 0.12, 6), { y: 0.6 }), 0.5);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + Math.PI / 6;
      stone(blk(-0.03, 0.03, 0.72, 0.94, -0.03, 0.03).translate(Math.cos(a) * 0.17, 0, Math.sin(a) * 0.17), 0.2);
    }
    glow.push([tr(hexPrism(0.14, 0.22), { y: 0.72 }), PALETTE.lanternGlow]);
    stone(tr(cyl(0.12, 0.4, 0.15, 6), { y: 0.94 }), 0.6);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + Math.PI / 2;
      stone(tr(octa(0.05), { x: Math.cos(a) * 0.38, y: 1.0, z: Math.sin(a) * 0.38, sy: 1.4 }), 0.6);
    }
    stone(tr(cyl(0.05, 0.07, 0.06, 6), { y: 1.09 }), 0.3);
    stone(tr(ico(0.07, 0), { y: 1.2 }), 0.2);
    stone(tr(cone(0.035, 0.08, 5), { y: 1.24 }), 0.2);
    if (rng() < 0.6) {
      const a = rng() * TAU;
      const moss = tr(jitter(ico(0.1, 0), 0.02, rng), { x: Math.cos(a) * 0.22, y: 1.0, z: Math.sin(a) * 0.22, sy: 0.4 });
      foliage.push(sway(paint(moss, PALETTE.moss, 0.06, rng), 0.05));
    }
    light = new THREE.Vector3(0, 0.83, 0);
  } else {
    // String lights: two posts with a sagging string of bulbs between them.
    const half = 1.1;
    const topY = 2.05;
    for (const x of [-half, half]) {
      solid.push(paint(tr(jitter(dodeca(0.14), 0.02, rng), { x, y: 0.05, sy: 0.6 }), PALETTE.stoneMid, 0.05, rng));
      solid.push(paint(tr(cyl(0.05, 0.06, topY + 0.05, 6), { x }), PALETTE.trunk, 0.04, rng));
      solid.push(paint(tr(hexPyramid(0.08, 0.08), { x, y: topY + 0.05 }), PALETTE.trunkDark));
    }
    const n = 10;
    const sag = 0.38;
    const at = (u) => [-half + 2 * half * u, topY - 0.06 - sag * 4 * u * (1 - u), 0];
    for (let i = 0; i < n; i++) solid.push(paint(rod(at(i / n), at((i + 1) / n), 0.012, 3, true), PALETTE.metal));
    for (let i = 1; i < n; i++) {
      const [x, y] = at(i / n);
      solid.push(paint(tr(cyl(0.025, 0.025, 0.04, 5), { x, y: y - 0.05 }), PALETTE.metal));
      glow.push([tr(octa(0.055), { x, y: y - 0.1, sy: 1.3 }), i % 2 ? PALETTE.lanternGlow : PALETTE.flowerOrange]);
    }
    light = new THREE.Vector3(0, topY - sag - 0.1, 0);
  }
  const obj = assemble({ solid, foliage, glow });
  obj.userData.lightOffset = light;
  return obj;
}

// ---- Campfire ----

function campfire(variant, rng) {
  const solid = [];
  solid.push(paint(cyl(0.42, 0.46, 0.04, 8), shade(PALETTE.rockDark, -0.28), 0.05, rng));
  if (variant === 0) {
    // Ring of stones.
    const n = 9;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rng() * 0.2;
      const s = 0.12 + rng() * 0.04;
      const g = tr(jitter(dodeca(s), s * 0.18, rng), { x: Math.cos(a) * 0.55, y: s * 0.55, z: Math.sin(a) * 0.55, sy: 0.75, ry: rng() * TAU });
      solid.push(paint(g, mix(PALETTE.rock, PALETTE.rockDark, rng()), 0.05, rng));
    }
  } else {
    // Ring of log seats, lying around the fire.
    const n = 5;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rng() * 0.3;
      const len = 0.62 + rng() * 0.15;
      const r = 0.1 + rng() * 0.02;
      const cx = Math.cos(a) * 0.82;
      const cz = Math.sin(a) * 0.82;
      const tx = -Math.sin(a) * (len / 2);
      const tz = Math.cos(a) * (len / 2);
      solid.push(paint(rod([cx - tx, r, cz - tz], [cx + tx, r, cz + tz], r, 7), PALETTE.trunk, 0.05, rng));
      for (const k of [-1, 1]) {
        const e = [cx + tx * k * 1.005, r, cz + tz * k * 1.005];
        const e2 = [cx + tx * k * 1.03, r, cz + tz * k * 1.03];
        solid.push(paint(rod(e, e2, r * 0.85, 7), PALETTE.woodLight, 0.03, rng));
      }
    }
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + rng() * 0.4;
      solid.push(paint(tr(jitter(dodeca(0.08), 0.015, rng), { x: Math.cos(a) * 0.45, y: 0.04, z: Math.sin(a) * 0.45, sy: 0.6 }), PALETTE.rockDark, 0.05, rng));
    }
  }
  // Teepee of logs.
  const logs = 4;
  const spin = rng() * TAU;
  for (let i = 0; i < logs; i++) {
    const a = spin + (i / logs) * TAU;
    const foot = [Math.cos(a) * 0.32, 0.03, Math.sin(a) * 0.32];
    const tip = [Math.cos(a + 0.4) * 0.05, 0.46, Math.sin(a + 0.4) * 0.05];
    solid.push(paint(rod(foot, tip, 0.045, 6), i % 2 ? PALETTE.trunk : PALETTE.trunkDark, 0.05, rng));
  }
  for (let i = 0; i < 5; i++) {
    const a = rng() * TAU;
    solid.push(paint(tr(octa(0.05), { x: Math.cos(a) * 0.15, y: 0.05, z: Math.sin(a) * 0.15 }), shade(PALETTE.trunkDark, -0.25), 0.05, rng));
  }
  const root = assemble({ solid });

  // Flame: layered cones in a child group that flickers.
  const outer = PALETTE.flowerOrange;
  const inner = PALETTE.flowerYellow;
  const glow = [
    [tr(cone(0.24, 0.5, 5), { y: 0.05 }), outer],
    [tr(cone(0.13, 0.7, 5), { y: 0.05, ry: 0.6 }), inner],
  ];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + 0.3;
    glow.push([tr(cone(0.08, 0.32, 4), { x: Math.cos(a) * 0.16, y: 0.06, z: Math.sin(a) * 0.16, rz: -Math.cos(a) * 0.25, rx: Math.sin(a) * 0.25 }), outer]);
  }
  const flame = assemble({ glow }, { castShadow: false });
  flame.name = 'flame';
  root.add(flame);

  const phase = rng() * 10;
  root.userData.animate = (obj, time) => {
    const f = (obj.userData.flame ??= obj.getObjectByName('flame'));
    if (!f) return;
    const t = time + phase;
    f.children.forEach((m, i) => {
      const k = i * 1.7;
      const s = 1 + 0.12 * Math.sin(t * 9.1 + k) + 0.07 * Math.sin(t * 15.3 + k * 2);
      m.scale.set(1 - 0.05 * Math.sin(t * 7.3 + k), s, 1 - 0.05 * Math.cos(t * 6.1 + k));
      m.rotation.y = 0.25 * Math.sin(t * 2.3 + k);
    });
  };
  root.userData.lightOffset = new THREE.Vector3(0, 0.6, 0);
  root.userData.emitters = [
    { type: 'smoke', offset: new THREE.Vector3(0, 0.9, 0) },
    { type: 'sparks', offset: new THREE.Vector3(0, 0.5, 0) },
  ];
  return root;
}

// ---- Bench ----

function bench(variant, rng) {
  const solid = [];
  const foliage = [];
  const W = 0.8; // Half width.
  if (variant === 1) {
    // Stone slab on two blocks.
    for (const sx of [-1, 1]) {
      const g = jitter(blk(sx * 0.55 - 0.16, sx * 0.55 + 0.16, 0, 0.36, -0.2, 0.2), 0.02, rng);
      solid.push(paint(g, mix(PALETTE.stoneMid, PALETTE.rockDark, rng() * 0.5), 0.05, rng));
    }
    solid.push(paint(jitter(blk(-W, W, 0.36, 0.48, -0.26, 0.26), 0.015, rng), PALETTE.stoneLight, 0.04, rng));
    if (rng() < 0.6) {
      const x = (rng() < 0.5 ? -1 : 1) * 0.55;
      foliage.push(sway(paint(tr(jitter(ico(0.12, 0), 0.03, rng), { x, y: 0.05, z: 0.2, sy: 0.6 }), PALETTE.moss, 0.06, rng), 0.3));
    }
  } else {
    const painted = variant === 2;
    const slat = painted ? [PALETTE.fabricBlue, mix(PALETTE.leafLight, PALETTE.pineGreen, 0.4), PALETTE.flowerPink][Math.floor(rng() * 3)] : PALETTE.wood;
    const frame = painted ? PALETTE.metal : PALETTE.woodDark;
    // Seat slats.
    for (let i = 0; i < 3; i++) {
      const z = -0.16 + i * 0.16;
      solid.push(paint(blk(-W, W, 0.42, 0.47, z - 0.065, z + 0.065), mix(slat, shade(slat, -0.05), rng()), 0.03, rng));
    }
    // Back slats, leaning back a little.
    for (let i = 0; i < 2; i++) {
      const y = 0.64 + i * 0.17;
      solid.push(paint(tr(blk(-W, W, y - 0.06, y + 0.06, -0.025, 0.025), { z: -0.26 - (y - 0.45) * 0.15, rx: -0.15 }), slat, 0.03, rng));
    }
    for (const sx of [-1, 1]) {
      const x = sx * (W - 0.12);
      const t = painted ? 0.035 : 0.05;
      solid.push(paint(blk(x - t, x + t, 0, 0.42, 0.13, 0.13 + 2 * t), frame, 0.03, rng));
      solid.push(paint(beam([x, 0, -0.22], [x, 0.94, -0.3], 2 * t, 2 * t), frame, 0.03, rng));
      solid.push(paint(blk(x - t, x + t, 0.36, 0.42, -0.24, 0.2), frame, 0.03, rng));
      // Armrest.
      solid.push(paint(blk(x - 0.045, x + 0.045, 0.62, 0.66, -0.26, 0.22), painted ? frame : PALETTE.wood, 0.03, rng));
      solid.push(paint(blk(x - t * 0.8, x + t * 0.8, 0.42, 0.62, 0.15, 0.15 + 1.6 * t), frame, 0.03, rng));
      if (painted) solid.push(paint(tr(octa(0.045), { x, y: 0.64, z: 0.24 }), frame));
    }
  }
  return assemble({ solid, foliage });
}

// ---- Barrels, crates, and sacks ----

function barrelGeo(h, r) {
  return lathe(
    [
      [0, 0],
      [r * 0.82, 0],
      [r * 0.95, h * 0.22],
      [r, h * 0.5],
      [r * 0.95, h * 0.78],
      [r * 0.82, h],
      [r * 0.72, h - 0.02],
      [0, h - 0.02],
    ],
    9,
  );
}

function barrel(h, r, rng) {
  const parts = [paint(barrelGeo(h, r), mix(PALETTE.wood, PALETTE.woodLight, rng() * 0.5), 0.04, rng)];
  for (const [y, rr] of [[0.12, 0.92], [0.82, 0.92]]) {
    parts.push(paint(tr(cyl(r * rr + 0.012, r * rr + 0.012, h * 0.07, 9, true), { y: h * y - h * 0.035 }), PALETTE.metal));
  }
  return parts;
}

function crate(s, rng) {
  const c = mix(PALETTE.woodLight, PALETTE.wood, rng() * 0.6);
  const d = shade(c, -0.1);
  const parts = [paint(blk(-s / 2, s / 2, 0.01, s - 0.01, -s / 2, s / 2), c, 0.04, rng)];
  for (const y of [0, s - 0.07]) parts.push(paint(blk(-s / 2 - 0.012, s / 2 + 0.012, y, y + 0.07, -s / 2 - 0.012, s / 2 + 0.012), d, 0.03, rng));
  for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    parts.push(paint(blk(x * s / 2 - 0.035, x * s / 2 + 0.035, 0.07, s - 0.07, z * s / 2 - 0.035, z * s / 2 + 0.035), d, 0.03, rng));
  }
  return parts;
}

function sack(rng) {
  const c = mix(PALETTE.sandstone, PALETTE.woodLight, rng() * 0.6);
  const body = tr(jitter(ico(0.26, 1), 0.035, rng), { y: 0.22, sy: 1.05, sx: 0.95 });
  return [
    paint(body, c, 0.04, rng),
    paint(tr(cyl(0.06, 0.1, 0.1, 6), { y: 0.44 }), shade(c, -0.12), 0.03, rng),
    paint(tr(jitter(ico(0.075, 0), 0.02, rng), { y: 0.56 }), c, 0.04, rng),
  ];
}

// Move every geometry in a list.
const place = (list, opts) => list.map((g) => tr(g, opts));

function barrels(variant, rng) {
  let solid = [];
  if (variant === 0) {
    solid.push(...place(barrel(0.82, 0.32, rng), { x: -0.36, z: -0.1, ry: rng() * TAU }));
    solid.push(...place(barrel(0.74, 0.29, rng), { x: 0.34, z: -0.18, ry: rng() * TAU }));
    // One on its side in front, chocked by a stone.
    const lying = place(place(barrel(0.7, 0.27, rng), { y: -0.35 }), { rz: Math.PI / 2, ry: (rng() - 0.5) * 0.4, x: 0.05, y: 0.27, z: 0.45 });
    solid.push(...lying);
    solid.push(paint(tr(jitter(dodeca(0.07), 0.01, rng), { x: 0.05, y: 0.04, z: 0.75 }), PALETTE.rockDark, 0.05, rng));
  } else if (variant === 1) {
    solid.push(...place(crate(0.5, rng), { x: -0.29, ry: (rng() - 0.5) * 0.2 }));
    solid.push(...place(crate(0.5, rng), { x: 0.29, z: 0.04, ry: (rng() - 0.5) * 0.2 }));
    solid.push(...place(crate(0.44, rng), { x: (rng() - 0.5) * 0.2, y: 0.5, z: 0.02, ry: 0.2 + rng() * 0.4 }));
    solid.push(...place(crate(0.34, rng), { x: 0.5, z: 0.52, ry: rng() * 0.8 }));
  } else {
    solid.push(...place(sack(rng), { x: -0.26, z: 0, ry: rng() * TAU }));
    solid.push(...place(sack(rng), { x: 0.26, z: -0.05, ry: rng() * TAU }));
    solid.push(...place(sack(rng), { x: 0.05, z: 0.4, ry: rng() * TAU, s: 0.85 }));
    // One lying across the top.
    solid.push(...place(place(sack(rng), { y: -0.28 }), { rz: Math.PI / 2 - 0.2, x: 0, y: 0.6, z: -0.03 }));
  }
  solid = solid.filter(Boolean);
  return assemble({ solid });
}

// ---- Well ----

// Rotation that turns local +X along the tangent at angle a around the Y axis.
const tangentRy = (a) => -a - Math.PI / 2;

function well(variant, rng) {
  const solid = [];
  const R = 0.62;
  const wallH = 0.72;
  if (variant === 0) {
    // Two courses of stone blocks and a coping ring.
    for (let course = 0; course < 2; course++) {
      const n = 9;
      for (let i = 0; i < n; i++) {
        const a = ((i + course * 0.5) / n) * TAU;
        const g = jitter(blk(-0.2, 0.2, course * 0.3, course * 0.3 + 0.29, -0.11, 0.11), 0.015, rng);
        solid.push(paint(tr(g, { ry: tangentRy(a), x: Math.cos(a) * R, z: Math.sin(a) * R }), mix(PALETTE.stoneLight, PALETTE.stoneMid, rng()), 0.04, rng));
      }
    }
    solid.push(paint(lathe([[0.48, 0.6], [0.78, 0.6], [0.78, wallH], [0.48, wallH], [0.48, 0.6]], 9), PALETTE.stoneLight, 0.03, rng));
  } else {
    // Wooden staves with two iron hoops.
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const g = blk(-0.165, 0.165, 0, wallH + (i % 3 === 0 ? 0.03 : 0), -0.05, 0.05);
      solid.push(paint(tr(g, { ry: tangentRy(a), x: Math.cos(a) * R, z: Math.sin(a) * R }), mix(PALETTE.wood, PALETTE.woodLight, rng() * 0.6), 0.03, rng));
    }
    for (const y of [0.12, 0.55]) solid.push(paint(tr(cyl(R + 0.07, R + 0.07, 0.06, 12, true), { y, ry: Math.PI / 12 }), PALETTE.metal));
  }
  // Dark water inside.
  solid.push(paint(tr(cyl(0.58, 0.58, 0.02, 9), { y: 0.36 }), shade(TERRAIN.water.variants[0].tint, -0.2)));

  // Posts, axle, and crank.
  const wood = variant === 0 ? PALETTE.woodDark : PALETTE.trunkDark;
  for (const sx of [-1, 1]) solid.push(paint(blk(sx * 0.66 - 0.06, sx * 0.66 + 0.06, 0.1, 1.72, -0.06, 0.06), wood, 0.04, rng));
  solid.push(paint(rod([-0.74, 1.35, 0], [0.74, 1.35, 0], 0.045, 6), PALETTE.wood, 0.03, rng));
  solid.push(paint(rod([-0.14, 1.35, 0], [0.14, 1.35, 0], 0.1, 7), shade(PALETTE.wood, -0.05), 0.03, rng));
  solid.push(paint(blk(0.76, 0.8, 1.15, 1.37, -0.02, 0.02), PALETTE.metal));
  solid.push(paint(blk(0.76, 0.92, 1.15, 1.18, -0.02, 0.02), PALETTE.metal));

  // Gable roof.
  const roofC = variant === 0 ? PALETTE.roofRed : PALETTE.roofThatch;
  const rise = 0.42;
  const run = 0.66;
  const len = Math.hypot(rise, run);
  const tilt = Math.atan2(rise, run);
  for (const sz of [-1, 1]) {
    const g = tr(box(1.86, 0.06, len), { rx: sz * tilt, y: 1.72 + rise / 2 + 0.03, z: (sz * run) / 2 });
    solid.push(paint(g, sz > 0 ? roofC : shade(roofC, -0.04), 0.04, rng));
  }
  solid.push(paint(rod([-0.95, 1.72 + rise + 0.05, 0], [0.95, 1.72 + rise + 0.05, 0], 0.05, 6), shade(roofC, -0.15), 0.03, rng));
  for (const sx of [-1, 1]) {
    const tri = face([[-run + 0.08, 0], [run - 0.08, 0], [0, rise - 0.03]], 0.04);
    solid.push(paint(tr(tri, { ry: Math.PI / 2, x: sx * 0.66, y: 1.72 }), wood, 0.03, rng));
  }

  // Bucket on a rope.
  solid.push(paint(rod([0, 1.3, 0], [0, 0.98, 0], 0.012, 3, true), PALETTE.roofThatch));
  solid.push(paint(tr(cyl(0.12, 0.09, 0.17, 8), { y: 0.8 }), PALETTE.wood, 0.04, rng));
  solid.push(paint(tr(cyl(0.125, 0.125, 0.03, 8, true), { y: 0.92 }), PALETTE.metal));
  solid.push(paint(beam([-0.11, 0.96, 0], [0, 1.0, 0], 0.012, 0.012), PALETTE.metal));
  solid.push(paint(beam([0, 1.0, 0], [0.11, 0.96, 0], 0.012, 0.012), PALETTE.metal));
  return assemble({ solid });
}

// ---- Signpost ----

function signpost(variant, rng) {
  const solid = [];
  const painted = variant === 1;
  const postC = painted ? PALETTE.plaster : PALETTE.woodDark;
  solid.push(paint(tr(jitter(dodeca(0.17), 0.03, rng), { y: 0.02, sy: 0.45 }), PALETTE.stoneMid, 0.05, rng));
  solid.push(paint(blk(-0.05, 0.05, 0, 1.72, -0.05, 0.05), postC, 0.03, rng));
  solid.push(paint(tr(cone(0.085, 0.12, 4), { y: 1.72, ry: Math.PI / 4 }), painted ? PALETTE.roofRed : PALETTE.wood));
  const boardColors = painted ? [PALETTE.fabricRed, PALETTE.fabricBlue, PALETTE.flowerYellow, mix(PALETTE.leafLight, PALETTE.pineGreen, 0.3)] : [PALETTE.woodLight, PALETTE.wood, mix(PALETTE.woodLight, PALETTE.wood, 0.5)];
  const count = 2 + (rng() < 0.6 ? 1 : 0);
  const start = rng() * TAU;
  for (let i = 0; i < count; i++) {
    const y = 1.52 - i * 0.3;
    const flip = i % 2 ? Math.PI : 0;
    const ry = start + flip + (rng() - 0.5) * 1.2 + i * 0.9;
    const w = 0.58 + rng() * 0.1;
    const arrow = [[-0.14, -0.09], [w, -0.09], [w + 0.13, 0], [w, 0.09], [-0.14, 0.09]];
    const color = boardColors[(i + Math.floor(rng() * 4)) % boardColors.length];
    solid.push(paint(tr(face(arrow, 0.04, 0.07), { ry, y }), color, 0.03, rng));
    // Lettering hint: a dark strip through the board.
    solid.push(paint(tr(blk(0.02, w - 0.08, -0.018, 0.018, 0.048, 0.092), { ry, y }), shade(color, -0.35)));
  }
  return assemble({ solid });
}

// ---- Windmill ----

const MILL_STYLES = [
  { body: PALETTE.plaster, trim: PALETTE.wood, cap: PALETTE.wood, sail: PALETTE.flowerWhite, spar: PALETTE.woodDark },
  { body: shade(PALETTE.roofRed, -0.08), trim: PALETTE.flowerWhite, cap: PALETTE.roofSlate, sail: PALETTE.plaster, spar: PALETTE.flowerWhite },
  { body: PALETTE.stoneMid, trim: PALETTE.stoneLight, cap: PALETTE.roofThatch, sail: mix(PALETTE.plaster, PALETTE.woodLight, 0.4), spar: PALETTE.woodDark, stone: true },
];

function windmill(variant, rng) {
  const st = MILL_STYLES[variant];
  const solid = [];
  const glow = [];
  const oct = Math.PI / 8; // Turn octagons so a flat face looks along +Z.
  const y0 = 0.3;
  const H = 3.7;
  const rBot = 1.05;
  const rTop = 0.7;
  const rAt = (y) => rBot + ((rTop - rBot) * (y - y0)) / H;
  const apothem = (y) => rAt(y) * Math.cos(oct);
  const lean = Math.atan(((rBot - rTop) * Math.cos(oct)) / H);

  solid.push(paint(tr(cyl(rBot + 0.15, rBot + 0.22, y0, 8), { ry: oct }), PALETTE.stoneMid, 0.05, rng));
  const bands = 4;
  for (let k = 0; k < bands; k++) {
    const ya = y0 + (H * k) / bands;
    const yb = y0 + (H * (k + 1)) / bands;
    let g = tr(cyl(rAt(yb), rAt(ya), yb - ya, 8), { y: ya, ry: oct });
    if (st.stone) g = jitter(g, 0.02, rng, { y: 0 });
    const c = st.stone ? mix(PALETTE.stoneLight, PALETTE.stoneMid, k % 2 ? 0.9 : 0.4) : k % 2 ? st.body : shade(st.body, 0.03);
    solid.push(paint(g, c, st.stone ? 0.06 : 0.025, rng));
  }
  const top = y0 + H;
  solid.push(paint(tr(cyl(rTop + 0.12, rTop + 0.1, 0.14, 8), { y: top, ry: oct }), st.trim, 0.03, rng));
  // Cap roof.
  const cap = lathe([[0, 0], [0.92, 0], [0.94, 0.16], [0.74, 0.6], [0.4, 0.95], [0, 1.1]], 8);
  solid.push(paint(tr(cap, { y: top + 0.14, ry: oct }), st.cap, 0.04, rng));
  solid.push(paint(tr(ico(0.1, 0), { y: top + 1.28 }), st.trim, 0.03, rng));

  // Door and windows on the front face, leaning with the wall.
  const onFace = (g, y, out = 0.02) => tr(g, { rx: -lean, y, z: apothem(y) + out });
  solid.push(paint(onFace(blk(-0.3, 0.3, -0.48, 0.48, -0.03, 0.03), y0 + 0.47, 0.01), st.trim, 0.03, rng));
  solid.push(paint(onFace(blk(-0.24, 0.24, -0.45, 0.42, -0.03, 0.03), y0 + 0.45, 0.035), PALETTE.woodDark, 0.03, rng));
  for (const [y, w] of [[2.2, 0.17], [3.3, 0.14]]) {
    solid.push(paint(onFace(blk(-w - 0.05, w + 0.05, -w * 1.3 - 0.05, w * 1.3 + 0.05, -0.03, 0.03), y, 0.0), st.trim, 0.03, rng));
    glow.push([onFace(blk(-w, w, -w * 1.3, w * 1.3, -0.03, 0.03), y, 0.02), PALETTE.windowGlow]);
  }
  // Axle from the cap to the hub.
  const hubY = top + 0.5;
  const hubZ = 1.12;
  solid.push(paint(rod([0, hubY, 0.4], [0, hubY, hubZ], 0.08, 6), PALETTE.woodDark, 0.03, rng));
  const root = assemble({ solid, glow });

  // Sails on their own child, spinning around local Z.
  const sails = [paint(tr(cyl(0.16, 0.16, 0.25, 8), { rx: Math.PI / 2, z: -0.05 }), st.spar, 0.03, rng)];
  sails.push(paint(tr(octa(0.1), { z: 0.24 }), st.trim));
  for (let i = 0; i < 4; i++) {
    const rz = (i / 4) * TAU + Math.PI / 4;
    const arm = [
      paint(blk(-0.045, 0.045, 0.1, 2.35, -0.03, 0.06), st.spar, 0.03, rng),
      paint(blk(0.06, 0.62, 0.5, 2.3, 0.075, 0.095), st.sail, 0.03, rng),
    ];
    for (const y of [0.62, 1.12, 1.62, 2.12]) arm.push(paint(blk(-0.03, 0.64, y, y + 0.04, 0.09, 0.12), st.spar, 0.02, rng));
    arm.push(paint(blk(0.6, 0.64, 0.5, 2.3, 0.09, 0.12), st.spar, 0.02, rng));
    sails.push(...arm.map((g) => tr(g, { rz })));
  }
  const rotor = assemble({ solid: sails });
  rotor.name = 'sails';
  rotor.position.set(0, hubY, hubZ);
  root.add(rotor);
  const phase = rng() * TAU;
  const speed = 0.55 + rng() * 0.2;
  root.userData.animate = (obj, time) => {
    const s = (obj.userData.sails ??= obj.getObjectByName('sails'));
    if (s) s.rotation.z = phase - time * speed;
  };
  return root;
}

// ---- Rowboat ----

// Hull stations from stern (-Z) to bow (+Z): [z, half width, keel y, gunwale y].
const HULL = [
  [-1.08, 0.42, -0.1, 0.3],
  [-0.7, 0.53, -0.14, 0.28],
  [-0.2, 0.57, -0.15, 0.27],
  [0.3, 0.53, -0.14, 0.29],
  [0.75, 0.36, -0.1, 0.34],
  [1.12, 0.0, 0.04, 0.46],
];

// Cross-section from port gunwale, under the keel, to starboard gunwale.
function hullSection([z, w, k, g], inset = 0) {
  const wi = Math.max(0, w - inset);
  const ki = k + inset * 1.4;
  return [
    [-wi, g, z],
    [-wi * 0.93, ki + (g - ki) * 0.5, z],
    [-wi * 0.6, ki + 0.03, z],
    [0, ki, z],
    [wi * 0.6, ki + 0.03, z],
    [wi * 0.93, ki + (g - ki) * 0.5, z],
    [wi, g, z],
  ];
}

// Loft one strake (between section points j and j+1) along every station.
function strake(sections, j, inward) {
  const pos = [];
  for (let s = 0; s < sections.length - 1; s++) {
    const a = sections[s][j];
    const b = sections[s][j + 1];
    const c = sections[s + 1][j + 1];
    const d = sections[s + 1][j];
    const quad = inward ? [a, c, b, a, d, c] : [a, b, c, a, c, d];
    for (const p of quad) pos.push(...p);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function boat(variant, rng) {
  const solid = [];
  const hullC = [PALETTE.boat, PALETTE.fabricBlue, PALETTE.fabricRed][variant];
  const inside = mix(PALETTE.woodLight, PALETTE.boat, 0.3);
  const outer = HULL.map((st) => hullSection(st));
  const inner = HULL.map((st) => hullSection(st, 0.05));
  for (let j = 0; j < 6; j++) {
    const top = j === 0 || j === 5;
    const c = variant === 0 ? (j % 2 ? hullC : shade(hullC, -0.05)) : top ? PALETTE.flowerWhite : j === 2 || j === 3 ? shade(hullC, -0.08) : hullC;
    solid.push(paint(strake(outer, j, false), c, 0.03, rng));
    solid.push(paint(strake(inner, j, true), j % 2 ? inside : shade(inside, -0.04), 0.03, rng));
  }
  // Transom across the stern.
  const stern = hullSection(HULL[0]).map(([x, y]) => [x, y]);
  solid.push(paint(face(stern, 0.05, HULL[0][0] + 0.02), variant === 0 ? shade(hullC, -0.06) : hullC, 0.03, rng));
  // Gunwale rails.
  const rail = shade(variant === 0 ? PALETTE.woodDark : PALETTE.wood, -0.02);
  for (const side of [0, 6]) {
    for (let s = 0; s < HULL.length - 1; s++) {
      const a = outer[s][side];
      const b = outer[s + 1][side];
      const lift = (p) => [p[0] * 0.97, p[1] + 0.015, p[2]];
      solid.push(paint(beam(lift(a), lift(b), 0.07, 0.045), rail, 0.03, rng));
    }
  }
  // Seats.
  for (const [z, w] of [[-0.62, 0.45], [0.18, 0.47]]) solid.push(paint(blk(-w, w, 0.14, 0.18, z - 0.1, z + 0.1), PALETTE.wood, 0.03, rng));
  // Oars resting in their locks, blades in the water.
  for (const sx of [-1, 1]) {
    solid.push(paint(blk(sx * 0.55 - 0.025, sx * 0.55 + 0.025, 0.28, 0.36, -0.12, -0.06), PALETTE.metal));
    const handle = [sx * 0.12, 0.34, 0.25];
    const lock = [sx * 0.55, 0.34, -0.09];
    const dir = lock.map((v, i) => v - handle[i]);
    const tip = handle.map((v, i) => v + dir[i] * 2.5 + (i === 1 ? -0.38 : 0));
    solid.push(paint(rod(handle, tip, 0.025, 5), PALETTE.woodLight, 0.03, rng));
    const bladeStart = handle.map((v, i) => v + (tip[i] - v) * 0.78);
    solid.push(paint(beam(bladeStart, tip, 0.13, 0.025), PALETTE.woodLight, 0.03, rng));
  }

  const hull = assemble({ solid });
  hull.name = 'hull';
  const root = new THREE.Group();
  root.add(hull);
  const phase = rng() * TAU;
  root.userData.animate = (obj, time) => {
    const h = (obj.userData.hull ??= obj.getObjectByName('hull'));
    if (!h) return;
    const t = time + phase + obj.position.x * 0.37 + obj.position.z * 0.23;
    h.position.y = 0.035 * Math.sin(t * 1.3);
    h.rotation.z = 0.045 * Math.sin(t * 0.9);
    h.rotation.x = 0.025 * Math.sin(t * 1.1 + 1.3);
  };
  return root;
}

// ---- Footbridge ----

function footbridge(variant, rng) {
  const solid = [];
  const half = 1.3;
  const rise = 0.38;
  const deckY = (x) => rise * Math.cos((Math.PI * x) / (2 * half));
  const birch = variant === 1;
  const plankC = birch ? mix(PALETTE.woodLight, PALETTE.birchBark, 0.35) : PALETTE.wood;
  const frameC = birch ? PALETTE.birchBark : PALETTE.woodDark;

  const n = 11;
  for (let i = 0; i < n; i++) {
    const x = -half + ((i + 0.5) * 2 * half) / n;
    const slope = Math.atan(-rise * (Math.PI / (2 * half)) * Math.sin((Math.PI * x) / (2 * half)));
    solid.push(paint(tr(box(0.21, 0.06, 0.8 + (rng() - 0.5) * 0.05), { x, y: deckY(x) - 0.03, rz: slope }), mix(plankC, shade(plankC, -0.07), rng()), 0.03, rng));
  }
  // Arched stringers whose ends become little feet below the waterline.
  for (const z of [-0.33, 0.33]) {
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const x = -half + (2 * half * i) / 8;
      pts.push([x, deckY(x) - 0.06]);
    }
    pts.push([half, -0.16]);
    for (let i = 8; i >= 0; i--) {
      const x = -half + 0.12 + ((2 * half - 0.24) * i) / 8;
      pts.push([x, deckY(x) - 0.24]);
    }
    pts.push([-half, -0.16]);
    solid.push(paint(face(pts, 0.08, z), birch ? shade(PALETTE.wood, -0.05) : frameC, 0.03, rng));
  }
  // Railings on both sides.
  const posts = [-1.15, 0, 1.15];
  for (const z of [-0.43, 0.43]) {
    for (const x of posts) {
      const y = deckY(x);
      solid.push(paint(blk(x - 0.04, x + 0.04, y - 0.1, y + 0.52, z - 0.04, z + 0.04), frameC, 0.03, rng));
      if (birch) solid.push(paint(blk(x - 0.042, x + 0.042, y + 0.22, y + 0.25, z - 0.042, z + 0.042), PALETTE.birchMark));
    }
    for (let i = 0; i < posts.length - 1; i++) {
      const xa = posts[i];
      const xb = posts[i + 1];
      solid.push(paint(beam([xa, deckY(xa) + 0.5, z], [xb, deckY(xb) + 0.5, z], 0.07, 0.06), frameC, 0.03, rng));
      if (birch) {
        const xm = (xa + xb) / 2 + (rng() - 0.5) * 0.3;
        solid.push(paint(blk(xm - 0.03, xm + 0.03, deckY(xm) + 0.47, deckY(xm) + 0.535, z - 0.04, z + 0.04), PALETTE.birchMark));
      }
    }
  }
  return assemble({ solid });
}

// ---- Registry ----

// Clamp a variant index into range so a bad save never throws.
const withVariants = (fn, n) => (variant, rng) => fn(Math.min(n - 1, Math.max(0, variant | 0)), rng);

export const builders = {
  lantern: withVariants(lantern, 3),
  campfire: withVariants(campfire, 2),
  bench: withVariants(bench, 3),
  barrels: withVariants(barrels, 3),
  well: withVariants(well, 2),
  signpost: withVariants(signpost, 2),
  windmill: withVariants(windmill, 3),
  boat: withVariants(boat, 3),
  footbridge: withVariants(footbridge, 2),
};
