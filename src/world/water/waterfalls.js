// Waterfall curtains and the foam pads where they land.
//
// A water cell spills over every EDGE_SPILL edge. Each curtain hangs from the
// water surface along that edge, curves outward at the lip, then falls to the
// lower surface. Columns along the edge reuse the surface patch's edge points,
// so the curtain's top row sits exactly on the water it pours from.
//
// Curtain ends:
//   convex    the next edge of the same cell also spills: miter outward
//   concave   a same-level water neighbor spills into the same lower cell:
//             miter toward that cell's center, so both curtains share a column
//   wall      anything else: run the end into the neighbor's wall

import * as THREE from 'three';
import { SEA_Y } from '../../core/constants.js';
import { hexToWorld, cornerOffset, edgeKey, DIRS } from '../../core/hex.js';
import { SUBDIV, EDGE_SPILL, EDGE_JOIN } from './surfaces.js';
import { EDGE_NORMALS } from '../../core/hex.js';
import { waterTint } from './mask.js';

const SIN60 = Math.sqrt(3) / 2;
const COT60 = 0.5 / SIN60;
const LIP_OUT = 0.32; // How far the curtain bows out at full fall.
const LIP_EASE = 0.6; // Smaller is a sharper lip.
const TUCK_WATER = 0.16; // How far a curtain dips under the water it lands in.
const TUCK_LAND = 0.05;
const PAD_IN = 0.3; // Foam pad extent behind and past the curtain base.
const PAD_OUT = 0.65;
const PAD_LIFT = 0.035;

// Fall distances of curtain rows. Shared by every curtain, so mitered columns of
// neighboring curtains line up row by row even when their drops differ.
const ROWS = (() => {
  const out = [0];
  let f = 0;
  let s = 0.03;
  while (f < 12) {
    f += s;
    out.push(f);
    s = Math.min(s * 1.5, 0.45);
  }
  return out;
})();

// Outward bow of the curtain after falling `f`.
export function lipOffset(f) {
  return LIP_OUT * Math.sqrt(f / (f + LIP_EASE));
}

// Every spilling edge of the given water cells.
export function findSpills(world, cells) {
  const out = [];
  for (const cell of cells) {
    if (cell.type !== 'water' || cell.h === 0) continue;
    for (let i = 0; i < 6; i++) {
      const nq = cell.q + DIRS[i][0];
      const nr = cell.r + DIRS[i][1];
      const n = world.getCell(nq, nr);
      if (n && n.h >= cell.h) continue;
      out.push({
        cell,
        i,
        key: edgeKey(cell.q, cell.r, i),
        top: world.waterY(cell.q, cell.r),
        bottom: n ? world.surfaceY(nq, nr) : SEA_Y,
        intoWater: !n || n.type === 'water',
        lower: { q: nq, r: nr },
      });
    }
  }
  return out;
}

// Column layout for one curtain: each column hangs from `base` and bows out
// along `dir` scaled by lipOffset(f). `lip` is the point that seeds its noise.
function curtainColumns(spill, g) {
  const { i } = spill;
  const n = EDGE_NORMALS[i];
  const k0 = g.corners[i];
  const k1 = g.corners[(i + 1) % 6];
  const cols = [];
  for (let j = 0; j <= SUBDIV; j++) {
    const t = j / SUBDIV;
    const bx = k0.x + (k1.x - k0.x) * t;
    const bz = k0.z + (k1.z - k0.z) * t;
    cols.push({ bx, bz, dx: n.x, dz: n.z });
  }
  const lower = hexToWorld(spill.lower.q, spill.lower.r);
  endColumn(cols[0], g, i, (i + 5) % 6, i, k1, lower);
  endColumn(cols[SUBDIV], g, i, (i + 1) % 6, (i + 1) % 6, k0, lower);
  return cols;
}

// Shape one end of a curtain. `side` is the adjacent edge of the same cell,
// `corner` the corner index at this end, `other` the far corner of the edge.
function endColumn(col, g, i, side, corner, other, lower) {
  const kind = g.kinds[side];
  const p = g.raw[corner];
  if (kind === EDGE_SPILL) {
    const o = cornerOffset(corner, 1);
    col.dx = o.x / SIN60;
    col.dz = o.z / SIN60;
  } else if (kind === EDGE_JOIN) {
    const dx = lower.x - p.x;
    const dz = lower.z - p.z;
    const len = Math.hypot(dx, dz);
    col.dx = dx / len / SIN60;
    col.dz = dz / len / SIN60;
  } else {
    const ex = col.bx - other.x;
    const ez = col.bz - other.z;
    const len = Math.hypot(ex, ez);
    col.dx = EDGE_NORMALS[i].x + (ex / len) * COT60;
    col.dz = EDGE_NORMALS[i].z + (ez / len) * COT60;
  }
}

// Build merged curtain and pad geometry plus per-spill metadata for emitters
// and audio. Returns { curtain, pads, spills }; geometries are null when empty.
export function buildWaterfalls(spills, ctx) {
  const cPos = [];
  const cLip = [];
  const cFall = [];
  const cTint = [];
  const cIndex = [];
  const pPos = [];
  const pPad = [];
  const pTint = [];
  const pIndex = [];
  const meta = [];

  for (const spill of spills) {
    const g = ctx.info(spill.cell);
    const cols = curtainColumns(spill, g);
    const drop = spill.top - spill.bottom;
    const tint = waterTint(spill.cell.variant);
    const tuck = spill.intoWater ? TUCK_WATER : TUCK_LAND;

    const fs = ROWS.filter((f) => f < drop - 0.04);
    fs.push(drop + tuck);
    const nc = cols.length;

    // Curtain.
    const base = cPos.length / 3;
    for (const f of fs) {
      const o = lipOffset(f);
      const wave = f >= 0.35 ? 0 : 1 - smooth(f / 0.35);
      for (const c of cols) {
        cPos.push(c.bx + c.dx * o, spill.top - f, c.bz + c.dz * o);
        cLip.push(c.bx, c.bz);
        cFall.push(f, drop, wave);
        cTint.push(tint.r, tint.g, tint.b);
      }
    }
    for (let r = 0; r < fs.length - 1; r++) {
      for (let j = 0; j < nc - 1; j++) {
        const a = base + r * nc + j;
        const b = a + 1;
        const c = a + nc;
        const d = c + 1;
        cIndex.push(a, c, b, b, c, d);
      }
    }

    // Foam pad on the lower surface, three rows across the landing line.
    const oBase = lipOffset(drop);
    const padBase = pPos.length / 3;
    const padY = spill.bottom + PAD_LIFT;
    const across = [
      [-1, oBase - PAD_IN],
      [0, oBase],
      [1, oBase + PAD_OUT],
    ];
    for (const [s, off] of across) {
      for (const c of cols) {
        pPos.push(c.bx + c.dx * off, padY, c.bz + c.dz * off);
        pPad.push(s, spill.intoWater ? 1 : 0);
        pTint.push(tint.r, tint.g, tint.b);
      }
    }
    for (let r = 0; r < 2; r++) {
      for (let j = 0; j < nc - 1; j++) {
        const a = padBase + r * nc + j;
        const b = a + 1;
        const c = a + nc;
        const d = c + 1;
        pIndex.push(a, b, c, b, d, c);
      }
    }

    const mid = cols[SUBDIV >> 1];
    meta.push({
      key: spill.key,
      x: mid.bx + mid.dx * oBase,
      y: spill.bottom + 0.15,
      z: mid.bz + mid.dz * oBase,
      top: spill.top,
      bottom: spill.bottom,
      drop,
      // Small drops get a light spray; tall falls get a fuller cloud.
      mist: { radius: 1, size: Math.min(1, 0.32 + drop * 0.22), rate: Math.min(9, 1.5 + drop * 2.8) },
    });
  }

  return {
    curtain: cIndex.length
      ? makeGeometry(cPos, cIndex, { aLip: [cLip, 2], aFall: [cFall, 3], aTint: [cTint, 3] })
      : null,
    pads: pIndex.length ? makeGeometry(pPos, pIndex, { aPad: [pPad, 2], aTint: [pTint, 3] }) : null,
    spills: meta,
  };
}

function makeGeometry(pos, index, attrs) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  for (const [name, [data, size]] of Object.entries(attrs)) {
    geo.setAttribute(name, new THREE.Float32BufferAttribute(data, size));
  }
  geo.setIndex(index);
  geo.computeBoundingSphere();
  return geo;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}
