// Modular structure models: walls, fences, floors, ceilings, roofs, and bridges.
//
// Edge items span local X from -1 to +1 (the two hex corners), with local +Z facing
// the cell interior and -Z facing outside. Every wall and fence ends in a
// hexagonal post centered on the hex corner. A hexagon looks the same after a 60°
// turn, so the posts of the two or three walls that meet at a corner line up
// exactly and close the joint whatever the neighbor is.
//
// Cell items are centered on the hex, with local +X pointing at an edge midpoint
// and the corners at 30°, 90°, … in the X/Z plane (the same as hexPrism).

import * as THREE from 'three';
import { HEX_SIZE, STORY_H, PALETTE } from '../../core/constants.js';
import { cornerOffset } from '../../core/hex.js';
import {
  box,
  cyl,
  cone,
  ico,
  octa,
  sphere,
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

const DEG = Math.PI / 180;
const HALF = HEX_SIZE / 2; // Half an edge: corners sit at x = ±HALF.
const WALL_T = 0.22; // Wall thickness.
const POST_R = 0.26; // Corner post radius (center to corner of its hexagon).
const PANEL_END = HALF - 0.2; // Wall panels end inside the corner posts.

// ---- Geometry helpers ----

// Extrude an outline drawn in the X/Z plane (a floor) from y0 up to y1.
function slab(points, y0, y1) {
  return tr(extrude(points, y1 - y0), { rx: Math.PI / 2, y: (y0 + y1) / 2 });
}

// Points along a circular arc, angles in radians.
function arc(cx, cy, r, a0, a1, steps) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

// Hexagonal post centered on x, base at y0. Matches every other corner post.
function hexPost(x, y0, y1, r = POST_R) {
  return tr(hexPrism(r, y1 - y0), { x, y: y0 });
}

// Pointy-top hexagon outline in the X/Z plane.
function hexOutline(r) {
  return Array.from({ length: 6 }, (_, i) => {
    const o = cornerOffset(i, r);
    return [o.x, o.z];
  });
}

// Clip a convex X/Z polygon to the hex of radius r (Sutherland-Hodgman).
function clipToHex(poly, r = HEX_SIZE) {
  const ap = r * Math.cos(30 * DEG);
  let p = poly;
  for (let k = 0; k < 6 && p.length >= 3; k++) {
    const nx = Math.cos(60 * k * DEG);
    const nz = Math.sin(60 * k * DEG);
    const out = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[i];
      const b = p[(i + 1) % p.length];
      const da = a[0] * nx + a[1] * nz - ap;
      const db = b[0] * nx + b[1] * nz - ap;
      if (da <= 0) out.push(a);
      if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
        const t = da / (da - db);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    p = out;
  }
  return p.length >= 3 && polyArea(p) > 0.003 ? p : null;
}

function polyArea(p) {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
}

const rect = (x0, z0, x1, z1) => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
];

// Span [x0, x1] minus the cut intervals.
function freeSpans(x0, x1, cuts) {
  const spans = [];
  let x = x0;
  for (const [a, b] of [...cuts].sort((p, q) => p[0] - q[0])) {
    if (a > x + 1e-4) spans.push([x, Math.min(a, x1)]);
    x = Math.max(x, b);
  }
  if (x1 > x + 1e-4) spans.push([x, x1]);
  return spans;
}

// Split [y0, y1] into rows close to `size` tall, breaking at every `breaks` height.
function makeRows(y0, y1, breaks, size) {
  const ys = [y0, y1, ...breaks.filter((y) => y > y0 + 1e-4 && y < y1 - 1e-4)].sort((a, b) => a - b);
  const rows = [];
  for (let i = 0; i < ys.length - 1; i++) {
    const n = Math.max(1, Math.round((ys[i + 1] - ys[i]) / size));
    for (let k = 0; k < n; k++) rows.push([ys[i] + ((ys[i + 1] - ys[i]) * k) / n, ys[i] + ((ys[i + 1] - ys[i]) * (k + 1)) / n]);
  }
  return rows;
}

// Call fn(xa, xb, ya, yb, row) for every solid piece of a wall face between x0
// and x1, split into rows and skipping rectangular holes.
function panelPieces(rows, x0, x1, holes, fn) {
  rows.forEach(([ya, yb], row) => {
    const ys = [ya, yb];
    for (const h of holes) for (const y of [h.y0, h.y1]) if (y > ya + 1e-4 && y < yb - 1e-4) ys.push(y);
    ys.sort((a, b) => a - b);
    for (let k = 0; k < ys.length - 1; k++) {
      const sa = ys[k];
      const sb = ys[k + 1];
      const cuts = holes.filter((h) => h.y0 < sb - 1e-4 && h.y1 > sa + 1e-4).map((h) => [h.x0, h.x1]);
      for (const [xa, xb] of freeSpans(x0, x1, cuts)) fn(xa, xb, sa, sb, row);
    }
  });
}

// ---- Walls ----

const WALL_STYLES = [
  // Plaster: cream walls, wood trim, stone base course.
  { face: PALETTE.plaster, trim: PALETTE.wood, frame: PALETTE.wood, door: PALETTE.woodDark, shutter: PALETTE.fabricBlue },
  // Timber: plaster infill between dark beams.
  { face: PALETTE.plaster, trim: '#6f5241', frame: '#6f5241', door: PALETTE.wood, shutter: mix(PALETTE.pineGreen, PALETTE.plaster, 0.2) },
  // Stone: stacked courses.
  { face: PALETTE.stoneMid, trim: PALETTE.stoneLight, frame: PALETTE.woodDark, door: PALETTE.wood, box: PALETTE.woodDark },
  // Brick: warm brick with light stone bands.
  { face: PALETTE.brick, trim: PALETTE.stoneLight, frame: PALETTE.flowerWhite, door: PALETTE.woodDark, box: PALETTE.wood },
];

// Opening sizes, shared by the body (holes) and the frames.
const WIN = { x0: -0.4, x1: 0.4, y0: 0.95, y1: 1.85 };
const DOOR_R = 0.42; // Door half-width and arch radius.
const DOOR_SPRING = 1.45; // Where the door arch starts.
const DOOR = { x0: -DOOR_R, x1: DOOR_R, y0: 0, y1: DOOR_SPRING + DOOR_R + 0.08 };

// Wall body for each style. Pushes geometry into parts.solid.
function wallBody(style, holes, parts, rng) {
  const s = WALL_STYLES[style];
  const solid = parts.solid;
  const piece = (rows, t, color, vary = 0.03) =>
    panelPieces(rows, -PANEL_END, PANEL_END, holes, (xa, xb, ya, yb) =>
      solid.push(paint(blk(xa, xb, ya, yb, -t / 2, t / 2), color, vary, rng)),
    );
  const breaks = holes.flatMap((h) => [h.y0, h.y1]);

  if (style === 0) {
    // Plaster over a stone base course, capped with a wood plate.
    piece([[0, 0.32]], 0.3, PALETTE.stoneMid, 0.05);
    piece([[0.32, STORY_H - 0.14]], WALL_T, s.face, 0.015);
    piece([[STORY_H - 0.14, STORY_H]], 0.27, s.trim);
  } else if (style === 1) {
    // Half-timbered: plaster infill, then dark beams proud of both faces.
    piece([[0, 0.2]], 0.28, PALETTE.stoneMid, 0.05);
    piece([[0.2, STORY_H]], 0.2, s.face, 0.015);
    piece([[0.2, 0.34]], 0.26, s.trim);
    piece([[STORY_H - 0.16, STORY_H]], 0.26, s.trim);
    const hole = holes[0];
    const studX = hole ? hole.x1 + 0.1 : 0.42;
    for (const sx of [-1, 1]) {
      solid.push(paint(blk(sx * studX - 0.05, sx * studX + 0.05, 0.34, STORY_H - 0.16, -0.13, 0.13), s.trim, 0.04, rng));
      // Brace in the outer bay, leaning toward the corner post.
      const xa = sx * (studX + 0.04);
      const xb = sx * (PANEL_END - 0.04);
      solid.push(paint(beam([xa, 0.38, 0], [xb, STORY_H - 0.2, 0], 0.26, 0.09), s.trim, 0.04, rng));
    }
    if (!hole) {
      solid.push(paint(blk(-studX, studX, 1.2, 1.3, -0.13, 0.13), s.trim, 0.04, rng));
      solid.push(paint(beam([-studX + 0.03, 0.38, 0], [studX - 0.03, 1.18, 0], 0.255, 0.08), s.trim, 0.04, rng));
      solid.push(paint(beam([studX - 0.03, 0.38, 0], [-studX + 0.03, 1.18, 0], 0.25, 0.08), s.trim, 0.04, rng));
    } else if (hole.y0 > 0.5) {
      // Rail under the window.
      solid.push(paint(blk(-studX, studX, hole.y0 - 0.1, hole.y0, -0.13, 0.13), s.trim, 0.04, rng));
    }
  } else if (style === 2) {
    // Stacked stone: a mortar core with blocks proud of both faces.
    piece([[0, STORY_H - 0.12]], 0.2, shade(PALETTE.stoneMid, -0.1), 0.02);
    const rows = makeRows(0, STORY_H - 0.12, breaks, 0.36);
    panelPieces(rows, -PANEL_END, PANEL_END, holes, (xa, xb, ya, yb, row) => {
      let x = xa;
      let w = row % 2 ? 0.22 + rng() * 0.12 : 0.36 + rng() * 0.18;
      while (x < xb - 0.05) {
        let x2 = Math.min(xb, x + w);
        if (xb - x2 < 0.18) x2 = xb;
        const t = 0.24 + rng() * 0.03;
        const c = mix(PALETTE.stoneLight, PALETTE.stoneMid, rng());
        solid.push(paint(jitter(blk(x + 0.018, x2 - 0.018, ya + 0.018, yb - 0.018, -t / 2, t / 2), 0.012, rng), c, 0.04, rng));
        x = x2;
        w = 0.32 + rng() * 0.26;
      }
    });
    piece([[STORY_H - 0.12, STORY_H]], 0.28, PALETTE.stoneLight, 0.04);
  } else {
    // Brick courses with two light stone bands and a dark plinth.
    piece([[0, 0.3]], 0.27, shade(PALETTE.brick, -0.1), 0.04);
    const rows = makeRows(0.3, STORY_H - 0.14, [], 0.18);
    const tones = [PALETTE.brick, shade(PALETTE.brick, -0.035), shade(PALETTE.brick, 0.025)];
    panelPieces(rows, -PANEL_END, PANEL_END, holes, (xa, xb, ya, yb, row) => {
      const band = row === 3 || row === 8;
      const t = band ? 0.25 : WALL_T;
      const c = band ? PALETTE.stoneLight : tones[row % 3];
      solid.push(paint(blk(xa, xb, ya, yb, -t / 2, t / 2), c, 0.03, rng));
    });
    piece([[STORY_H - 0.14, STORY_H]], 0.28, PALETTE.stoneLight, 0.04);
  }
  cornerPosts(style, solid);
}

// Corner posts. Neighboring walls draw identical posts at a shared corner, so
// posts are painted flat (no per-face noise to flicker). Each style also gets its
// own radius and top height, so mixed styles never share a coplanar face.
function cornerPosts(style, solid) {
  const r = POST_R + style * 0.006;
  const top = STORY_H + style * 0.003;
  const band = (x, y, h, color, grow) => solid.push(paint(tr(cyl(r + grow, r + grow, h, 6, true), { x, y }), color));
  for (const sx of [-1, 1]) {
    const x = sx * HALF;
    if (style === 2) {
      // Stone quoins: open bands proud of the post.
      solid.push(paint(hexPost(x, 0, top, r), mix(PALETTE.stoneLight, PALETTE.stoneMid, 0.6)));
      for (let k = 0; k < 3; k++) band(x, (STORY_H * k) / 3, STORY_H / 6, mix(PALETTE.stoneLight, PALETTE.stoneMid, 0.15), 0.035);
    } else if (style === 3) {
      solid.push(paint(hexPost(x, 0, top, r), shade(PALETTE.brick, -0.04)));
      band(x, 0, 0.3, shade(PALETTE.brick, -0.12), 0.03);
      band(x, STORY_H - 0.14, 0.14, PALETTE.stoneLight, 0.035);
    } else {
      solid.push(paint(hexPost(x, 0, top, r), WALL_STYLES[style].trim));
    }
  }
}

function wallPlain(variant, rng) {
  const parts = { solid: [] };
  wallBody(variant, [], parts, rng);
  return wallFinish(assemble(parts));
}

function wallWindow(variant, rng) {
  const s = WALL_STYLES[variant];
  const parts = { solid: [], foliage: [], glow: [] };
  wallBody(variant, [WIN], parts, rng);
  const { solid } = parts;
  const masonry = variant >= 2;
  const f = (g) => solid.push(paint(g, s.frame, 0.04, rng));

  // Frame, mullions, and sill.
  // Frame pieces overlap the opening a little, so none is coplanar with the cut wall.
  f(blk(WIN.x0 - 0.07, WIN.x0 + 0.02, WIN.y0, WIN.y1, -0.14, 0.14));
  f(blk(WIN.x1 - 0.02, WIN.x1 + 0.07, WIN.y0, WIN.y1, -0.14, 0.14));
  f(blk(-0.025, 0.025, WIN.y0, WIN.y1, -0.05, 0.05));
  f(blk(WIN.x0, WIN.x1, 1.375, 1.425, -0.05, 0.05));
  if (masonry) {
    solid.push(paint(blk(WIN.x0 - 0.15, WIN.x1 + 0.15, WIN.y1 - 0.02, WIN.y1 + 0.16, -0.145, 0.145), PALETTE.stoneLight, 0.04, rng));
    solid.push(paint(blk(WIN.x0 - 0.12, WIN.x1 + 0.12, WIN.y0 - 0.08, WIN.y0 + 0.015, -0.2, 0.17), PALETTE.stoneLight, 0.04, rng));
  } else {
    f(blk(WIN.x0 - 0.07, WIN.x1 + 0.07, WIN.y1 - 0.02, WIN.y1 + 0.08, -0.14, 0.14));
    f(blk(WIN.x0 - 0.11, WIN.x1 + 0.11, WIN.y0 - 0.07, WIN.y0 + 0.015, -0.2, 0.17));
  }
  parts.glow.push([blk(WIN.x0, WIN.x1, WIN.y0, WIN.y1, -0.015, 0.015), PALETTE.windowGlow]);

  if (!masonry) {
    // Shutters on the outside face, each with two battens.
    for (const sx of [-1, 1]) {
      const xa = sx * (WIN.x1 + 0.1);
      const xb = sx * (WIN.x1 + 0.34);
      const [x0, x1] = sx > 0 ? [xa, xb] : [xb, xa];
      solid.push(paint(blk(x0, x1, WIN.y0 + 0.02, WIN.y1 - 0.02, -0.18, -0.14), s.shutter, 0.03, rng));
      for (const y of [WIN.y0 + 0.18, WIN.y1 - 0.2]) {
        solid.push(paint(blk(x0 + 0.02, x1 - 0.02, y, y + 0.06, -0.2, -0.17), shade(s.shutter, -0.08), 0.02, rng));
      }
    }
  } else {
    // Flower box under the sill.
    solid.push(paint(blk(-0.44, 0.44, WIN.y0 - 0.25, WIN.y0 - 0.09, -0.4, -0.17), s.box, 0.05, rng));
    solid.push(paint(blk(-0.41, 0.41, WIN.y0 - 0.1, WIN.y0 - 0.08, -0.37, -0.2), PALETTE.trunkDark, 0, rng));
    const blooms = [PALETTE.flowerRed, PALETTE.flowerYellow, PALETTE.flowerPink, PALETTE.flowerWhite, PALETTE.flowerPurple];
    for (let i = 0; i < 6; i++) {
      const x = -0.35 + i * 0.14 + (rng() - 0.5) * 0.04;
      const leaf = tr(octa(0.08), { x, y: WIN.y0 - 0.04, z: -0.29 + (rng() - 0.5) * 0.06, sy: 0.8 });
      parts.foliage.push(sway(paint(leaf, PALETTE.leafGreen, 0.06, rng), 0.25));
      const bloom = tr(octa(0.055), { x: x + 0.02, y: WIN.y0 + 0.03 + rng() * 0.04, z: -0.3 });
      parts.foliage.push(sway(paint(bloom, blooms[Math.floor(rng() * blooms.length)], 0.05, rng), 0.4));
    }
  }
  return wallFinish(assemble(parts));
}

function wallDoor(variant, rng) {
  const s = WALL_STYLES[variant];
  const parts = { solid: [], glow: [] };
  wallBody(variant, [DOOR], parts, rng);
  const { solid } = parts;
  const masonry = variant >= 2;
  const r = DOOR_R;
  const top = DOOR.y1 - DOOR_SPRING;

  // Fill above the arch, in the wall's own color.
  const fill = [[-r, 0], [r, 0], [r, top], [-r, top], ...arc(0, 0, r, Math.PI, 0, 8).slice(1, -1).reverse()];
  const fillT = variant === 1 ? 0.2 : variant === 2 ? 0.22 : WALL_T;
  solid.push(paint(tr(face(fill.reverse(), fillT), { y: DOOR_SPRING }), s.face, 0.02, rng));

  // Arched frame: two jambs and a ring.
  const ring = [...arc(0, 0, r + 0.1, 0, Math.PI, 8), ...arc(0, 0, r - 0.02, Math.PI, 0, 8)];
  const frameColor = masonry ? PALETTE.stoneLight : s.frame;
  solid.push(paint(tr(face(ring, 0.28), { y: DOOR_SPRING }), frameColor, 0.05, rng));
  for (const sx of [-1, 1]) {
    const [x0, x1] = sx < 0 ? [-r - 0.1, -r + 0.02] : [r - 0.02, r + 0.1];
    solid.push(paint(blk(x0, x1, 0, DOOR_SPRING, -0.14, 0.14), frameColor, 0.04, rng));
  }
  if (masonry) solid.push(paint(blk(-0.07, 0.07, DOOR_SPRING + r - 0.02, DOOR_SPRING + r + 0.14, -0.15, 0.15), PALETTE.stoneLight, 0, rng));

  // Door: vertical planks clipped to the arch, set back from the outside face.
  const planks = 6;
  for (let i = 0; i < planks; i++) {
    const xa = -r + (2 * r * i) / planks;
    const xb = -r + (2 * r * (i + 1)) / planks;
    const t0 = Math.acos(xb / r);
    const t1 = Math.acos(xa / r);
    const outline = [[xa, -DOOR_SPRING + 0.02], [xb, -DOOR_SPRING + 0.02], ...arc(0, 0, r, t0, t1, 2)];
    const c = i % 2 ? s.door : shade(s.door, 0.05);
    solid.push(paint(tr(face(outline, 0.07, 0.04), { y: DOOR_SPRING }), c, 0.03, rng));
  }
  // Iron straps and a ring handle.
  for (const y of [0.35, 1.2]) solid.push(paint(blk(-r + 0.04, 0.12, y, y + 0.06, -0.015, 0.005), PALETTE.metal, 0, rng));
  solid.push(paint(blk(0.24, 0.3, 0.9, 0.98, -0.05, 0.12), PALETTE.metal, 0, rng));

  // Step outside.
  solid.push(paint(blk(-r - 0.16, r + 0.16, 0, 0.1, -0.5, -0.1), PALETTE.stoneLight, 0.05, rng));

  // Little lamp on a bracket beside the door.
  const lx = 0.66;
  const lz = -0.34;
  solid.push(paint(blk(lx - 0.05, lx + 0.05, 1.7, 1.9, -0.18, -0.1), PALETTE.metal, 0, rng));
  solid.push(paint(blk(lx - 0.02, lx + 0.02, 1.83, 1.87, lz, -0.16), PALETTE.metal, 0, rng));
  solid.push(paint(blk(lx - 0.008, lx + 0.008, 1.73, 1.85, lz - 0.008, lz + 0.008), PALETTE.metal, 0, rng));
  solid.push(paint(tr(hexPyramid(0.09, 0.08), { x: lx, y: 1.66, z: lz }), PALETTE.metal, 0, rng));
  solid.push(paint(tr(hexPrism(0.075, 0.025), { x: lx, y: 1.5, z: lz }), PALETTE.metal, 0, rng));
  parts.glow.push([tr(hexPrism(0.06, 0.14), { x: lx, y: 1.525, z: lz }), PALETTE.lanternGlow]);
  return wallFinish(assemble(parts));
}

function wallFinish(obj) {
  obj.userData.topY = STORY_H;
  return obj;
}

// ---- Fences ----

const FENCE_H = 0.9;

// Cylinder lying along X, centered on the origin.
function log(len, r, seg = 6) {
  return tr(tr(cyl(r, r * 0.92, len, seg), { y: -len / 2 }), { rz: Math.PI / 2 });
}

function fence(variant, rng) {
  const solid = [];
  if (variant === 0) {
    // Picket: white pickets with a scalloped top on two rails.
    const white = PALETTE.flowerWhite;
    for (const sx of [-1, 1]) {
      solid.push(paint(hexPost(sx * HALF, 0, FENCE_H - 0.1, 0.1), white));
      solid.push(paint(tr(hexPyramid(0.13, 0.1), { x: sx * HALF, y: FENCE_H - 0.1 }), shade(white, -0.06)));
    }
    for (const y of [0.22, 0.6]) solid.push(paint(blk(-HALF, HALF, y, y + 0.08, -0.035, 0.035), shade(white, -0.04), 0.03, rng));
    const n = 8;
    for (let i = 0; i < n; i++) {
      const x = -0.77 + (1.54 * i) / (n - 1);
      const h = 0.62 + 0.1 * Math.cos((x / 0.8) * (Math.PI / 2));
      solid.push(paint(blk(x - 0.055, x + 0.055, 0.04, h, -0.085, -0.045), white, 0.04, rng));
      solid.push(paint(tr(cone(0.078, 0.09, 4), { ry: Math.PI / 4, x, y: h, z: -0.065, sz: 0.27 }), white, 0.04, rng));
    }
  } else if (variant === 1) {
    // Rustic: split-rail logs between rough posts.
    for (const sx of [-1, 1]) {
      solid.push(paint(hexPost(sx * HALF, 0, FENCE_H - 0.05, 0.11), PALETTE.trunkDark));
      solid.push(paint(tr(hexPyramid(0.12, 0.05), { x: sx * HALF, y: FENCE_H - 0.05 }), PALETTE.trunk));
    }
    for (const y of [0.36, 0.7]) {
      const tilt = (rng() - 0.5) * 0.06;
      const rail = jitter(log(HEX_SIZE, 0.06, 6), 0.01, rng);
      solid.push(paint(tr(rail, { y: y + tilt * 0.3, rz: tilt, z: (rng() - 0.5) * 0.03 }), PALETTE.trunk, 0.06, rng));
    }
  } else {
    // Stone: a low dry-stone wall with capped pillars.
    solid.push(paint(blk(-PANEL_END, PANEL_END, 0, 0.72, -0.12, 0.12), shade(PALETTE.stoneMid, -0.12), 0, rng));
    const rows = [[0, 0.27], [0.27, 0.51], [0.51, 0.72]];
    rows.forEach(([ya, yb], row) => {
      let x = -PANEL_END - 0.05;
      while (x < PANEL_END - 0.05) {
        const x2 = Math.min(PANEL_END, x + 0.26 + rng() * 0.2);
        const t = 0.34 - row * 0.03;
        const g = jitter(blk(x + 0.02, x2 - 0.02, ya + 0.02, yb - 0.01, -t / 2, t / 2), 0.025, rng);
        solid.push(paint(g, mix(PALETTE.stoneLight, PALETTE.rockDark, rng() * 0.8), 0.05, rng));
        x = x2;
      }
    });
    for (let i = 0; i < 4; i++) {
      const x0 = -PANEL_END + (2 * PANEL_END * i) / 4;
      const g = jitter(blk(x0 + 0.01, x0 + (2 * PANEL_END) / 4 - 0.01, 0.72, 0.82, -0.2, 0.2), 0.02, rng);
      solid.push(paint(g, PALETTE.stoneLight, 0.05, rng));
    }
    for (const sx of [-1, 1]) {
      solid.push(paint(hexPost(sx * HALF, 0, FENCE_H - 0.07, 0.21), mix(PALETTE.stoneLight, PALETTE.stoneMid, 0.5)));
      solid.push(paint(hexPost(sx * HALF, FENCE_H - 0.07, FENCE_H, 0.25), PALETTE.stoneLight));
    }
  }
  const obj = assemble({ solid });
  obj.userData.topY = FENCE_H;
  return obj;
}

// ---- Floors and ceilings ----

const FLOOR_T = 0.18;
const WOODS = [PALETTE.woodLight, mix(PALETTE.woodLight, PALETTE.plaster, 0.35), PALETTE.woodDark];

// Planks along local X from y0 to y1, staggered, clipped to the hex.
function plankLayer(color, y0, y1, solid, rng) {
  const w = 0.3;
  const n = Math.ceil((2 * HEX_SIZE) / w);
  const z0 = -(n * w) / 2;
  for (let i = 0; i < n; i++) {
    const za = z0 + i * w + 0.012;
    const zb = za + w - 0.024;
    const cut = (rng() - 0.5) * 2.4;
    for (const [xa, xb] of [[-HEX_SIZE, cut - 0.012], [cut + 0.012, HEX_SIZE]]) {
      const p = clipToHex(rect(xa, za, xb, zb));
      if (!p) continue;
      const c = mix(color, shade(color, -0.08), rng());
      solid.push(paint(slab(p, y0, y1 - rng() * 0.008), c, 0.025, rng));
    }
  }
}

function floorWood(variant, rng) {
  const color = WOODS[variant];
  const solid = [paint(hexPrism(HEX_SIZE, 0.12), shade(color, -0.14), 0.03, rng)];
  plankLayer(color, 0.12, FLOOR_T, solid, rng);
  const obj = assemble({ solid });
  obj.userData.topY = FLOOR_T;
  return obj;
}

function floorStone(variant, rng) {
  const base = [shade(PALETTE.stoneMid, -0.12), shade(PALETTE.roofSlate, -0.15), shade(PALETTE.sandstone, -0.14)][variant];
  const solid = [paint(hexPrism(HEX_SIZE, 0.13), base, 0.03, rng)];
  const gap = 0.022;
  const add = (poly, color, uneven) => {
    const p = clipToHex(poly);
    if (p) solid.push(paint(slab(p, 0.13, FLOOR_T - rng() * uneven), color, 0.04, rng));
  };
  if (variant === 2) {
    // Sandstone: small hexagonal flags.
    const r = 0.46;
    const w = Math.sqrt(3) * r;
    for (let q = -5; q <= 5; q++) {
      for (let s = -4; s <= 4; s++) {
        const cx = w * (q + s / 2);
        const cz = 1.5 * r * s;
        if (Math.hypot(cx, cz) > HEX_SIZE + r) continue;
        const poly = hexOutline(r - gap).map(([x, z]) => [x + cx, z + cz]);
        add(poly, mix(PALETTE.sandstone, shade(PALETTE.sandstone, 0.07), rng()), 0.006);
      }
    }
  } else {
    // Cobble and slate: running-bond rectangles.
    const [tw, th, colorA, colorB, uneven] =
      variant === 0
        ? [0.5, 0.4, PALETTE.stoneLight, PALETTE.stoneMid, 0.018]
        : [0.82, 0.6, mix(PALETTE.roofSlate, PALETTE.stoneMid, 0.25), mix(PALETTE.roofSlate, PALETTE.stoneLight, 0.4), 0.007];
    const rows = Math.ceil((2 * HEX_SIZE) / th);
    for (let row = 0; row < rows; row++) {
      const za = -(rows * th) / 2 + row * th;
      let x = -HEX_SIZE - (row % 2 ? tw / 2 : rng() * 0.2);
      while (x < HEX_SIZE) {
        const xb = x + tw * (0.8 + rng() * 0.4);
        add(rect(x + gap, za + gap, xb - gap, za + th - gap), mix(colorA, colorB, rng()), uneven);
        x = xb;
      }
    }
  }
  const obj = assemble({ solid });
  obj.userData.topY = FLOOR_T;
  return obj;
}

// Ceiling: a planked slab on the wall tops, with beams hanging into the room.
function ceilingWood(variant, rng) {
  const color = WOODS[variant];
  const t = 0.16;
  const solid = [paint(hexPrism(HEX_SIZE, 0.1), shade(color, -0.12), 0.03, rng)];
  plankLayer(color, 0.1, t, solid, rng);
  const beamColor = shade(color, -0.16);
  for (const z of [-0.9, 0, 0.9]) solid.push(paint(blk(-1.6, 1.6, -0.15, 0, z - 0.08, z + 0.08), beamColor, 0.04, rng));
  for (const x of [-0.85, 0.85]) solid.push(paint(blk(x - 0.07, x + 0.07, -0.08, 0, -1.25, 1.25), beamColor, 0.04, rng));
  const obj = assemble({ solid });
  obj.userData.topY = t;
  return obj;
}

// ---- Roofs ----

const ROOF_H = 1.8;
const ROOF_R = HEX_SIZE * 1.15;
const ROOF_STYLES = [
  { color: PALETTE.roofRed, bands: 5, lip: 0.07, drop: 0.07, hips: true, chimney: PALETTE.brick },
  { color: PALETTE.roofSlate, bands: 6, lip: 0.05, drop: 0.05, hips: true, chimney: PALETTE.stoneMid },
  { color: PALETTE.roofThatch, bands: 4, lip: 0.12, drop: 0.13, thatch: true },
  { color: PALETTE.roofMoss, bands: 4, lip: 0.08, drop: 0.08, moss: true },
];

// Height of the roof surface above local (x, z).
function roofSurfaceY(x, z) {
  let m = 0;
  for (let k = 0; k < 6; k++) m = Math.max(m, x * Math.cos(60 * k * DEG) + z * Math.sin(60 * k * DEG));
  return ROOF_H * (1 - m / (ROOF_R * Math.cos(30 * DEG)));
}

function roofHex(variant, rng) {
  const st = ROOF_STYLES[variant];
  const H = ROOF_H;
  const R = ROOF_R;
  const rAt = (y) => R * (1 - y / H);
  const parts = { solid: [], foliage: [] };
  const { solid } = parts;
  const yTop = H * 0.8;

  // Overlapping bands, each with a lip over the one below.
  for (let k = 0; k < st.bands; k++) {
    const ya = (yTop * k) / st.bands;
    const yb = (yTop * (k + 1)) / st.bands;
    const drop = k ? st.drop : 0;
    let g = tr(cyl(rAt(yb), rAt(ya) + (k ? st.lip : 0), yb - ya + drop, 6), { y: ya - drop });
    if (st.thatch) g = jitter(g, 0.025, rng, { y: k ? 1 : 0 });
    solid.push(paint(g, k % 2 ? st.color : shade(st.color, 0.04), 0.035, rng));
  }
  const capC = shade(st.color, -0.08);
  solid.push(paint(tr(hexPyramid(rAt(yTop) + st.lip, H - yTop + st.drop), { y: yTop - st.drop }), capC, 0.03, rng));

  if (st.hips) {
    // Ridge caps down the six hips.
    for (let i = 0; i < 6; i++) {
      const a = (60 * i - 30) * DEG;
      const n = new THREE.Vector3(H * Math.cos(a), R, H * Math.sin(a)).normalize().multiplyScalar(0.05);
      const e = [R * Math.cos(a) + n.x, n.y + 0.02, R * Math.sin(a) + n.z];
      solid.push(paint(beam(e, [n.x, H + n.y - 0.05, n.z], 0.11, 0.08), shade(st.color, -0.12), 0.03, rng));
    }
  }

  let chimneyTop = null;
  if (st.chimney && rng() < 0.65) {
    const k = Math.floor(rng() * 6);
    const a = 60 * k * DEG;
    const side = (rng() - 0.5) * 0.6;
    const cx = Math.cos(a) * 0.95 - Math.sin(a) * side;
    const cz = Math.sin(a) * 0.95 + Math.cos(a) * side;
    const top = roofSurfaceY(cx, cz) + 0.7;
    solid.push(paint(tr(box(0.3, top - 0.4, 0.3), { x: cx, y: (top + 0.4) / 2, z: cz, ry: -a }), st.chimney, 0.05, rng));
    solid.push(paint(tr(box(0.38, 0.07, 0.38), { x: cx, y: top + 0.035, z: cz, ry: -a }), shade(st.chimney, -0.1), 0.03, rng));
    chimneyTop = new THREE.Vector3(cx, top + 0.15, cz);
  }

  if (variant === 0) {
    solid.push(paint(tr(sphere(0.11, 6, 4), { y: H + 0.04 }), capC, 0.03, rng));
  } else if (variant === 1) {
    solid.push(paint(tr(cone(0.05, 0.42, 5), { y: H - 0.04 }), PALETTE.metal, 0, rng));
    solid.push(paint(tr(sphere(0.07, 6, 4), { y: H + 0.08 }), PALETTE.metal, 0, rng));
  } else if (st.thatch) {
    // Bound topknot.
    solid.push(paint(tr(cyl(0.14, 0.24, 0.2, 6), { y: H - 0.12 }), shade(st.color, -0.14), 0.04, rng));
    solid.push(paint(tr(jitter(ico(0.15, 0), 0.03, rng), { y: H + 0.12 }), shade(st.color, -0.06), 0.05, rng));
  } else {
    // Moss clumps and a few tiny flowers on the slopes.
    for (let i = 0; i < 7; i++) {
      const a = rng() * Math.PI * 2;
      const d = 0.6 + rng() * 1.2;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      const clump = tr(jitter(ico(0.2, 0), 0.04, rng), { x, y: roofSurfaceY(x, z) + 0.03, z, sy: 0.45 });
      parts.foliage.push(sway(paint(clump, i % 2 ? PALETTE.moss : PALETTE.leafDeep, 0.06, rng), 0.12));
      if (i % 2) {
        const bloom = tr(ico(0.05, 0), { x: x * 1.02, y: roofSurfaceY(x, z) + 0.12, z: z * 1.02 });
        parts.foliage.push(sway(paint(bloom, i % 4 === 1 ? PALETTE.flowerYellow : PALETTE.flowerWhite, 0.04, rng), 0.3));
      }
    }
    solid.push(paint(tr(jitter(ico(0.17, 0), 0.03, rng), { y: H }), PALETTE.leafDeep, 0.05, rng));
  }

  const obj = assemble(parts);
  obj.userData.topY = H;
  if (chimneyTop) obj.userData.emitters = [{ type: 'smoke', offset: chimneyTop }];
  return obj;
}

// Tall witch-hat roof with a flared eave, a finial, and a pennant.
function roofCone(variant, rng) {
  const color = [PALETTE.roofBlue, PALETTE.roofRed, PALETTE.roofSlate][variant];
  const flag = [PALETTE.fabricRed, PALETTE.flowerYellow, PALETTE.plaster][variant];
  const H = 2.8;
  const prof = [[2.45, 0], [2.28, 0.15], [1.98, 0.42], [1.55, 0.86], [1.1, 1.36], [0.68, 1.9], [0.32, 2.4], [0, H]];
  const seg = 12;
  const solid = [paint(lathe([[0, 0], prof[0]], seg), shade(color, -0.22), 0, rng)];
  for (let k = 0; k < prof.length - 1; k++) {
    const c = k === 0 ? shade(color, -0.1) : k % 2 ? color : shade(color, 0.04);
    solid.push(paint(lathe([prof[k], prof[k + 1]], seg), c, 0.03, rng));
  }
  const gold = PALETTE.leafGold;
  solid.push(paint(tr(cyl(0.09, 0.15, 0.14, 6), { y: H - 0.1 }), gold, 0.03, rng));
  solid.push(paint(tr(sphere(0.09, 6, 4), { y: H + 0.1 }), gold, 0.03, rng));
  solid.push(paint(tr(cone(0.03, 0.42, 5), { y: H + 0.12 }), PALETTE.metal, 0, rng));
  solid.push(paint(tr(face([[0, 0], [0.34, -0.07], [0, -0.15]], 0.02), { y: H + 0.5 }), flag, 0.03, rng));
  const obj = assemble({ solid });
  obj.userData.topY = H;
  return obj;
}

// ---- Bridges ----

const SPAN = 2; // Bridges span local X from -SPAN to +SPAN, past the edge midpoints.
const deckY = (x) => 0.5 * Math.cos((Math.PI * Math.max(-SPAN, Math.min(SPAN, x))) / (2 * SPAN));
const LACQUER = mix(PALETTE.roofRed, PALETTE.flowerRed, 0.5);

// Side profile between two offsets from the deck curve, in the X/Y plane.
function deckBand(top, bottom, x0 = -SPAN, x1 = SPAN, steps = 8) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const x = x0 + ((x1 - x0) * i) / steps;
    pts.push([x, deckY(x) + bottom]);
  }
  for (let i = steps; i >= 0; i--) {
    const x = x0 + ((x1 - x0) * i) / steps;
    pts.push([x, deckY(x) + top]);
  }
  return pts;
}

function bridgeArch(variant, rng) {
  const solid = [];
  const postXs = [-1.85, -0.92, 0, 0.92, 1.85];
  if (variant === 1) {
    // Stone: a solid arch over the water, paved on top, with low parapets.
    const outline = [];
    for (let i = 0; i <= 8; i++) {
      const x = -SPAN + (2 * SPAN * i) / 8;
      outline.push([x, deckY(x)]);
    }
    outline.push([SPAN, -0.75]);
    const ax = 1.35;
    const ay = 0.62;
    for (let i = 0; i <= 8; i++) {
      const t = (Math.PI * i) / 8;
      outline.push([ax * Math.cos(t), -0.75 + ay * Math.sin(t)]);
    }
    outline.push([-SPAN, -0.75]);
    solid.push(paint(face(outline, 1.2), PALETTE.stoneMid, 0.04, rng));
    // Voussoirs, slightly proud of both faces.
    for (let i = 0; i < 7; i++) {
      const t0 = (Math.PI * i) / 7;
      const t1 = (Math.PI * (i + 1)) / 7;
      const ring = [];
      for (const t of [t0, (t0 + t1) / 2, t1]) ring.push([(ax + 0.17) * Math.cos(t), -0.75 + (ay + 0.17) * Math.sin(t)]);
      for (const t of [t1, (t0 + t1) / 2, t0]) ring.push([ax * Math.cos(t), -0.75 + ay * Math.sin(t)]);
      solid.push(paint(face(ring, 1.26), i % 2 ? PALETTE.stoneLight : mix(PALETTE.stoneLight, PALETTE.stoneMid, 0.4), 0.04, rng));
    }
    // Paving slabs along the deck.
    const slabs = 8;
    for (let i = 0; i < slabs; i++) {
      const xa = -SPAN + (2 * SPAN * i) / slabs + 0.02;
      const xb = -SPAN + (2 * SPAN * (i + 1)) / slabs - 0.02;
      const c = mix(PALETTE.stoneLight, PALETTE.sandstone, rng() * 0.4);
      solid.push(paint(beam([xa, deckY(xa) + 0.01, 0], [xb, deckY(xb) + 0.01, 0], 1.0, 0.06), c, 0.04, rng));
    }
    // Parapets with pillars.
    for (const z of [-0.52, 0.52]) {
      solid.push(paint(face(deckBand(0.4, -0.02), 0.16, z), mix(PALETTE.stoneLight, PALETTE.stoneMid, 0.3), 0.04, rng));
      for (const x of [-1.9, 0, 1.9]) {
        const y = deckY(x);
        solid.push(paint(blk(x - 0.12, x + 0.12, y - 0.05, y + 0.5, z - 0.12, z + 0.12), PALETTE.stoneLight, 0.04, rng));
        solid.push(paint(blk(x - 0.15, x + 0.15, y + 0.5, y + 0.57, z - 0.15, z + 0.15), shade(PALETTE.stoneLight, -0.05), 0.03, rng));
      }
    }
  } else {
    // Oak or red lacquer: plank deck on two arched stringers, with railings.
    const red = variant === 2;
    const deck = red ? PALETTE.woodDark : PALETTE.wood;
    const frame = red ? LACQUER : PALETTE.woodDark;
    const planks = 15;
    for (let i = 0; i < planks; i++) {
      const x = -SPAN + ((i + 0.5) * 2 * SPAN) / planks;
      const slope = Math.atan(-0.5 * (Math.PI / (2 * SPAN)) * Math.sin((Math.PI * x) / (2 * SPAN)));
      const g = tr(box(0.25, 0.08, 1.3 + (rng() - 0.5) * 0.06), { x, y: deckY(x) - 0.04, rz: slope });
      solid.push(paint(g, mix(deck, shade(deck, -0.06), rng()), 0.03, rng));
    }
    for (const z of [-0.55, 0.55]) solid.push(paint(face(deckBand(-0.07, -0.32), 0.12, z), frame, 0.03, rng));
    for (const z of [-0.62, 0.62]) {
      for (const x of postXs) {
        const y = deckY(x);
        solid.push(paint(blk(x - 0.05, x + 0.05, y - 0.12, y + 0.6, z - 0.05, z + 0.05), frame, 0.04, rng));
        if (red) {
          // Giboshi caps.
          solid.push(paint(tr(octa(0.075), { x, y: y + 0.66, z, sy: 0.85 }), PALETTE.leafGold, 0.03, rng));
          solid.push(paint(tr(cone(0.03, 0.09, 4), { x, y: y + 0.7, z }), PALETTE.leafGold, 0, rng));
        }
      }
      for (let i = 0; i < postXs.length - 1; i++) {
        const xa = postXs[i];
        const xb = postXs[i + 1];
        solid.push(paint(beam([xa, deckY(xa) + 0.56, z], [xb, deckY(xb) + 0.56, z], 0.08, 0.07), frame, 0.03, rng));
        solid.push(paint(beam([xa, deckY(xa) + 0.28, z], [xb, deckY(xb) + 0.28, z], 0.05, 0.05), frame, 0.03, rng));
      }
    }
  }
  const obj = assemble({ solid });
  obj.userData.topY = deckY(0);
  return obj;
}

// Flat plank walkway on posts that reach down into the water.
function walkway(variant, rng) {
  const solid = [];
  const top = 0.12;
  const t = 0.06;
  const rope = variant === 1;
  const worn = variant === 2;
  const wood = worn ? mix(PALETTE.wood, PALETTE.stoneMid, 0.5) : rope ? PALETTE.wood : PALETTE.woodLight;
  const post = worn ? mix(PALETTE.woodDark, PALETTE.stoneMid, 0.35) : PALETTE.woodDark;

  const planks = 16;
  for (let i = 0; i < planks; i++) {
    if (worn && i > 0 && i < planks - 1 && rng() < 0.1) continue;
    const xa = -SPAN + (2 * SPAN * i) / planks + 0.015;
    const xb = -SPAN + (2 * SPAN * (i + 1)) / planks - 0.015;
    const half = 0.55 + (rng() - 0.5) * (worn ? 0.12 : 0.04);
    const shift = (rng() - 0.5) * (worn ? 0.08 : 0.03);
    let g = blk(xa, xb, top - t, top, -half + shift, half + shift);
    if (worn && rng() < 0.25) g = tr(tr(g, { x: -(xa + xb) / 2 }), { rz: (rng() - 0.5) * 0.08, x: (xa + xb) / 2 });
    solid.push(paint(g, mix(wood, shade(wood, -0.08), rng()), 0.03, rng));
  }
  for (const z of [-0.4, 0.4]) solid.push(paint(blk(-SPAN, SPAN, top - t - 0.08, top - t, z - 0.06, z + 0.06), post, 0.03, rng));

  const supportZ = rope ? 0.6 : 0.47;
  const postTop = rope ? 0.78 : top - t - 0.08;
  for (const x of [-1.1, 1.1]) {
    solid.push(paint(blk(x - 0.08, x + 0.08, top - t - 0.16, top - t - 0.08, -supportZ - 0.08, supportZ + 0.08), post, 0.03, rng));
    for (const z of [-supportZ, supportZ]) {
      solid.push(paint(tr(cyl(0.075, 0.085, postTop + 1.5, 7), { x, y: -1.5, z }), post, 0.05, rng));
      if (worn) solid.push(paint(tr(cyl(0.095, 0.1, 0.16, 7), { x, y: -0.42, z }), PALETTE.moss, 0.06, rng));
    }
  }

  if (rope) {
    // Short end posts on the banks, then sagging rope rails.
    const railXs = [-1.92, -1.1, 1.1, 1.92];
    for (const z of [-supportZ, supportZ]) {
      for (const x of [-1.92, 1.92]) solid.push(paint(tr(cyl(0.065, 0.075, 1.0, 7), { x, y: -0.22, z }), post, 0.05, rng));
      for (const x of railXs) solid.push(paint(tr(cyl(0.085, 0.085, 0.05, 7), { x, y: postTop - 0.02, z }), shade(post, -0.08), 0, rng));
      for (const y of [postTop - 0.06, postTop - 0.36]) {
        for (let i = 0; i < railXs.length - 1; i++) {
          const xa = railXs[i];
          const xb = railXs[i + 1];
          const sag = Math.min(0.16, (xb - xa) * 0.06);
          const steps = 4;
          for (let k = 0; k < steps; k++) {
            const u0 = k / steps;
            const u1 = (k + 1) / steps;
            const p0 = [xa + (xb - xa) * u0, y - sag * 4 * u0 * (1 - u0), z];
            const p1 = [xa + (xb - xa) * u1, y - sag * 4 * u1 * (1 - u1), z];
            solid.push(paint(rod(p0, p1, 0.02, 4, true), PALETTE.roofThatch, 0.03, rng));
          }
        }
      }
    }
  }
  const obj = assemble({ solid });
  obj.userData.topY = top;
  return obj;
}

// ---- Registry ----

// Clamp a variant index into range so a bad save never throws.
const withVariants = (fn, n) => (variant, rng) => fn(Math.min(n - 1, Math.max(0, variant | 0)), rng);

export const builders = {
  wall_plain: withVariants(wallPlain, 4),
  wall_window: withVariants(wallWindow, 4),
  wall_door: withVariants(wallDoor, 4),
  fence: withVariants(fence, 3),
  floor_wood: withVariants(floorWood, 3),
  floor_stone: withVariants(floorStone, 3),
  ceiling_wood: withVariants(ceilingWood, 3),
  roof_hex: withVariants(roofHex, 4),
  roof_cone: withVariants(roofCone, 3),
  bridge_arch: withVariants(bridgeArch, 3),
  walkway: withVariants(walkway, 3),
};
