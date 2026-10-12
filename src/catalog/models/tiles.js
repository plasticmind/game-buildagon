// Terrain preview tiles: one level tall hex columns used for build menu thumbnails
// and blueprint ghosts. Each returns a THREE.Object3D with its base at y = 0 and
// userData.topY = LEVEL_H.

import * as THREE from 'three';
import { HEX_SIZE, HEX_APOTHEM, LEVEL_H, TERRAIN, GRASSY_TYPES, PALETTE } from '../../core/constants.js';
import { range, pick } from '../../core/random.js';
import { sway, tr, cyl, ico, hexPrism, lathe, shade, mix } from './util.js';
import { build, paintFaces, ramp, blade, clean, trisGeo } from './nature.js';

const TAU = Math.PI * 2;
const LIP_H = 0.1; // Grassy lip band at the top of grass and meadow sides.
const WATER_DIP = 0.14; // How far the water face sits below the rim.
const MEADOW_DOTS = [PALETTE.flowerWhite, PALETTE.flowerYellow, PALETTE.flowerPink, PALETTE.flowerPurple];

const variantOf = (type, variant) => {
  const list = TERRAIN[type].variants;
  return list[Math.max(0, Math.min(list.length - 1, Math.floor(variant) || 0))];
};

// Hex corner k (pointy-top, matching CylinderGeometry with 6 segments).
const corner = (k, r) => new THREE.Vector3(r * Math.sin((k * TAU) / 6), 0, r * Math.cos((k * TAU) / 6));

// Random point inside the hex, kept `margin` away from the rim.
function pointInHex(rng, margin) {
  const r = HEX_APOTHEM - margin;
  for (;;) {
    const x = range(rng, -r, r);
    const z = range(rng, -r, r);
    // Inside a pointy-top hex of apothem r: every edge normal sits at 60k + 30 degrees.
    let inside = true;
    for (let k = 0; k < 6; k++) {
      const a = ((k + 0.5) * TAU) / 6;
      if (x * Math.sin(a) + z * Math.cos(a) > r) inside = false;
    }
    if (inside) return { x, z };
  }
}

// Little triangles of turf hanging from the lip down each side wall.
function drips(top, rng) {
  const pos = [];
  const y0 = LEVEL_H - LIP_H;
  const out = new THREE.Vector3();
  for (let k = 0; k < 6; k++) {
    const c0 = corner(k, HEX_SIZE);
    const c1 = corner(k + 1, HEX_SIZE);
    out.addVectors(c0, c1).normalize();
    const n = 3;
    for (let i = 0; i < n; i++) {
      const s = (i + range(rng, 0.25, 0.75)) / n;
      const w = range(rng, 0.06, 0.1);
      const pa = c0.clone().lerp(c1, Math.max(0, s - w)).addScaledVector(out, 0.004);
      const pb = c0.clone().lerp(c1, Math.min(1, s + w)).addScaledVector(out, 0.004);
      const pc = c0.clone().lerp(c1, s).addScaledVector(out, 0.004);
      // Winding pa → pc → pb faces outward.
      pos.push(pa.x, y0 + 0.001, pa.z, pc.x, y0 - range(rng, 0.05, 0.1), pc.z, pb.x, y0 + 0.001, pb.z);
    }
  }
  return paintFaces(trisGeo(pos), () => top, 0, rng);
}

// Short blade tufts scattered over the top so the thumbnail reads as grass.
function tufts(bladeColor, rng, out) {
  const list = [new THREE.Color(shade(bladeColor, -0.06)), new THREE.Color(bladeColor), new THREE.Color(shade(bladeColor, 0.08))];
  const count = Math.floor(range(rng, 8, 13));
  for (let i = 0; i < count; i++) {
    const p = pointInHex(rng, 0.3);
    const blades = Math.floor(range(rng, 4, 7));
    for (let j = 0; j < blades; j++) {
      const h = range(rng, 0.22, 0.36);
      let g = blade(range(rng, 0.07, 0.1), h, h * range(rng, 0.2, 0.5), 2);
      g = paintFaces(g, (c) => ramp(list, c.y / h), 0.04, rng);
      tr(g, { rz: -range(rng, 0.15, 0.5), ry: rng() * TAU, x: p.x, y: LEVEL_H - 0.01, z: p.z });
      out.push(sway(g, (x, y) => Math.max(0, Math.min(1, (y - LEVEL_H) / 0.36))));
    }
  }
}

// Tiny flower dots on short stems for meadow tiles.
function flowerDots(rng, out) {
  const count = Math.floor(range(rng, 5, 9));
  for (let i = 0; i < count; i++) {
    const p = pointInHex(rng, 0.3);
    const h = range(rng, 0.16, 0.28);
    const stem = paintFaces(tr(cyl(0.012, 0.012, h, 3, true), { x: p.x, y: LEVEL_H - 0.01, z: p.z }), () => PALETTE.leafDeep, 0, rng);
    out.push(sway(stem, (x, y) => Math.max(0, Math.min(1, (y - LEVEL_H) / h))));
    const head = paintFaces(ico(0.065, 0), () => pick(rng, MEADOW_DOTS), 0.04, rng);
    out.push(sway(tr(head, { x: p.x, y: LEVEL_H + h, z: p.z, sy: 0.7 }), 1));
  }
}

function landTile(type) {
  return (variant, rng) => {
    const v = variantOf(type, variant);
    const top = new THREE.Color(v.top);
    const side = new THREE.Color(v.side);
    const solid = [];
    const foliage = [];
    if (GRASSY_TYPES.has(type)) {
      // Side-colored body, then a thin top-colored lip with turf drips.
      const body = hexPrism(HEX_SIZE, LEVEL_H - LIP_H);
      solid.push(paintFaces(body, (c, n) => (n.y > 0.5 ? top : side), 0, rng));
      solid.push(paintFaces(tr(hexPrism(HEX_SIZE, LIP_H), { y: LEVEL_H - LIP_H }), () => top, 0, rng));
      solid.push(drips(top, rng));
      tufts(v.blade, rng, foliage);
      if (type === 'meadow') flowerDots(rng, foliage);
    } else {
      solid.push(paintFaces(hexPrism(HEX_SIZE, LEVEL_H), (c, n) => (n.y > 0.5 ? top : side), 0, rng));
    }
    const obj = build({ solid, foliage });
    obj.userData.topY = LEVEL_H;
    return obj;
  };
}

// Water tile: a sandy basin hex whose top is a lower, water-tinted face with a
// pale shore ring.
function waterTile(variant, rng) {
  const v = variantOf('water', variant);
  const R = HEX_SIZE;
  const wy = LEVEL_H - WATER_DIP;
  const sand = new THREE.Color(v.top);
  const bank = new THREE.Color(shade(v.top, -0.06));
  const side = new THREE.Color(v.side);
  const water = new THREE.Color(v.tint);
  const foam = new THREE.Color(mix(v.tint, PALETTE.flowerWhite, 0.4));
  const g = clean(lathe([[0, 0], [R, 0], [R, LEVEL_H], [R * 0.88, LEVEL_H], [R * 0.82, wy], [R * 0.7, wy], [0, wy]], 6));
  const painted = paintFaces(
    g,
    (c, n) => {
      const r = Math.hypot(c.x, c.z);
      if (n.y < -0.5) return side; // Bottom.
      if (n.y < 0.3 && c.x * n.x + c.z * n.z > 0) return side; // Outer walls.
      if (c.y > LEVEL_H - 0.001) return sand; // Rim.
      if (c.y > wy + 0.001) return bank; // Inner bank.
      return r > R * 0.5 ? foam : water;
    },
    0,
    rng,
  );
  const obj = build({ solid: [painted] });
  obj.userData.topY = LEVEL_H;
  return obj;
}

export const builders = {
  tile_grass: landTile('grass'),
  tile_meadow: landTile('meadow'),
  tile_sand: landTile('sand'),
  tile_dirt: landTile('dirt'),
  tile_stone: landTile('stone'),
  tile_snow: landTile('snow'),
  tile_water: waterTile,
};
