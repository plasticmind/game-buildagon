// Procedural low-poly creature models. Each builder returns a THREE.Group that
// faces local +Z with its origin where the animal meets the ground, the water
// line, or its perch. Moving parts are named child groups, listed per builder.
//
// Parts that are hidden at rest (flight wings) start with visible = false.

import * as THREE from 'three';
import { PALETTE } from '../core/constants.js';
import { sphere, cyl, cone, box, extrude, rod, paint, paintBy, tr, assemble, shade, mix } from '../catalog/models/util.js';

const EYE = '#2e2a2c';
const SHINE = '#ffffff';

// Ellipsoid: a sphere of radius r stretched by (sx, sy, sz) and moved to (x, y, z).
function ell(r, sx, sy, sz, x = 0, y = 0, z = 0, w = 9, h = 6) {
  return tr(sphere(r, w, h), { sx, sy, sz, x, y, z });
}

// Flat shape in the X/Z plane (x outward, z forward), `t` thick, at height y.
function flat(points, t = 0.008, y = 0) {
  return tr(extrude(points, t), { rx: Math.PI / 2, y });
}

const mirror = (points) => points.map(([x, z]) => [-x, z]);

function group(name, x = 0, y = 0, z = 0, ...children) {
  const g = new THREE.Group();
  g.name = name;
  g.position.set(x, y, z);
  for (const c of children) g.add(c);
  return g;
}

const solid = (parts) => assemble({ solid: parts });
const thin = (parts) => assemble({ double: parts });

// A pair of eyes with a tiny highlight, looking along +Z.
function eyes(out, { x, y, z, r, spread = 1 }) {
  for (const s of [-1, 1]) {
    out.push(paint(sphere(r, 6, 4), EYE));
    tr(out[out.length - 1], { x: s * x, y, z });
    out.push(paint(tr(sphere(r * 0.32, 4, 3), { x: s * (x - r * 0.2 * spread), y: y + r * 0.45, z: z + r * 0.7 }), SHINE));
  }
}

// ---- Frog ------------------------------------------------------------------------
// Parts: 'legs' (hind legs, pivot at the hips), 'throat' (croak sac).

export const FROG_SKINS = [
  { skin: '#7cc46a', belly: '#e8efb8', spot: '#5aa65a' },
  { skin: '#98b85c', belly: '#ece6b4', spot: '#6f8f43' },
  { skin: '#a8d477', belly: '#f4f0c8', spot: '#7cb35a' },
  { skin: '#7fb8b0', belly: '#e6f0dc', spot: '#5d9890' },
];

export function frogModel(rng, look = FROG_SKINS[0]) {
  const { skin, belly, spot } = look;
  const body = [];
  body.push(paint(ell(0.1, 1.05, 0.62, 1.2, 0, 0.075, -0.01), skin, 0.04, rng));
  body.push(paint(ell(0.09, 0.95, 0.5, 1.1, 0, 0.052, 0.012), belly, 0.03, rng));
  body.push(paint(ell(0.085, 1.15, 0.62, 0.95, 0, 0.1, 0.085), skin, 0.04, rng));
  body.push(paint(ell(0.075, 1.1, 0.35, 0.8, 0, 0.078, 0.1), belly, 0.03, rng));
  for (const s of [-1, 1]) {
    body.push(paint(tr(sphere(0.036, 7, 5), { x: s * 0.055, y: 0.138, z: 0.092 }), skin));
    body.push(paint(tr(rod([s * 0.06, 0.06, 0.1], [s * 0.085, 0.006, 0.125], 0.016, 5), {}), skin, 0.03, rng));
    body.push(paint(ell(0.026, 1.3, 0.3, 1.3, s * 0.088, 0.006, 0.135), belly));
  }
  eyes(body, { x: 0.062, y: 0.148, z: 0.108, r: 0.021 });
  for (let i = 0; i < 5; i++) {
    const a = rng() * Math.PI * 2;
    const d = 0.03 + rng() * 0.05;
    body.push(paint(ell(0.017, 1, 0.4, 1, Math.cos(a) * d, 0.132 - d * 0.25, -0.01 + Math.sin(a) * d * 0.8, 5, 3), spot));
  }
  const legs = [];
  for (const s of [-1, 1]) {
    legs.push(paint(tr(ell(0.05, 0.75, 0.8, 1.5, 0, 0, 0, 7, 5), { ry: s * 0.35, x: s * 0.095, y: -0.008, z: 0.02 }), skin, 0.04, rng));
    legs.push(paint(tr(ell(0.034, 1.3, 0.28, 2.0, 0, 0, 0, 6, 4), { ry: -s * 0.45, x: s * 0.12, y: -0.05, z: 0.06 }), belly, 0.03, rng));
  }
  const root = new THREE.Group();
  root.add(solid(body));
  root.add(group('legs', 0, 0.058, -0.06, solid(legs)));
  root.add(group('throat', 0, 0.062, 0.13, solid([paint(ell(0.05, 1, 0.75, 0.9), mix(belly, '#ffffff', 0.25))])));
  root.getObjectByName('throat').scale.setScalar(0.4);
  return root;
}

// ---- Waterfowl ---------------------------------------------------------------------
// Parts: 'body' (tips forward to dabble, pivot at the water line), 'head'
// (pivot at the neck), 'wingL' and 'wingR' (flight wings, pivot at the shoulder).

function wingShape(span, chord) {
  return [
    [0, chord * 0.5],
    [span * 0.4, chord * 0.62],
    [span * 0.9, chord * 0.2],
    [span, -chord * 0.1],
    [span * 0.62, -chord * 0.45],
    [span * 0.2, -chord * 0.5],
    [0, -chord * 0.4],
  ];
}

function flightWings(root, { span, chord, color, tip, x, y, z }) {
  for (const s of [-1, 1]) {
    const pts = wingShape(span, chord);
    const parts = [paint(flat(s > 0 ? pts : mirror(pts), 0.016), color, 0.04)];
    if (tip) {
      const tipPts = [
        [span * 0.55, chord * 0.42],
        [span * 0.9, chord * 0.2],
        [span, -chord * 0.1],
        [span * 0.62, -chord * 0.45],
        [span * 0.55, -chord * 0.44],
      ];
      parts.push(paint(flat(s > 0 ? tipPts : mirror(tipPts), 0.02, 0.002), tip));
    }
    const w = group(s > 0 ? 'wingR' : 'wingL', s * x, y, z, thin(parts));
    w.visible = false;
    root.add(w);
  }
}

const DUCK_LOOKS = {
  drake: { body: '#d6d1c8', back: '#b9b2a8', breast: '#b9806a', head: '#4f9d78', ring: '#fbf7ef', bill: '#f2cf6b', wing: '#a39a8f', spec: '#6f8fd0', tail: '#4a4648' },
  hen: { body: '#c4a17c', back: '#a8835f', breast: '#c9a882', head: '#b8956f', ring: null, bill: '#e8a35c', wing: '#9a7a5c', spec: '#6f8fd0', tail: '#8d6748' },
};

export function duckModel(rng, kind = 'drake') {
  const L = DUCK_LOOKS[kind];
  const b = [];
  b.push(paint(ell(0.16, 0.82, 0.62, 1.3, 0, 0.045, 0), L.body, 0.04, rng));
  b.push(paint(ell(0.13, 0.8, 0.5, 1.15, 0, 0.09, -0.04), L.back, 0.04, rng));
  b.push(paint(ell(0.1, 0.95, 0.85, 0.8, 0, 0.07, 0.13), L.breast, 0.04, rng));
  for (const s of [-1, 1]) {
    b.push(paint(ell(0.1, 0.32, 0.5, 1.35, s * 0.1, 0.1, -0.06), L.wing, 0.04, rng));
    b.push(paint(ell(0.04, 0.3, 0.35, 1.2, s * 0.128, 0.1, -0.05), L.spec));
  }
  b.push(paint(tr(cone(0.065, 0.15, 6), { rx: -Math.PI / 2 - 0.55, y: 0.09, z: -0.17 }), L.tail, 0.04, rng));
  if (kind === 'drake') b.push(paint(tr(cone(0.02, 0.05, 5), { rx: -0.6, y: 0.17, z: -0.24 }), L.tail));
  const h = [];
  h.push(paint(tr(cyl(0.042, 0.05, 0.1, 7), { rx: 0.25 }), L.head, 0.04, rng));
  h.push(paint(ell(0.066, 0.9, 0.95, 1.1, 0, 0.12, 0.035), L.head, 0.04, rng));
  h.push(paint(ell(0.035, 0.85, 0.32, 1.25, 0, 0.1, 0.11), L.bill, 0.03, rng));
  if (L.ring) h.push(paint(tr(cyl(0.05, 0.052, 0.018, 9), { y: 0.03, rx: 0.25 }), L.ring));
  eyes(h, { x: 0.05, y: 0.135, z: 0.06, r: 0.012 });
  const root = new THREE.Group();
  const body = group('body', 0, 0, 0, solid(b), group('head', 0, 0.12, 0.14, solid(h)));
  root.add(body);
  flightWings(body, { span: 0.34, chord: 0.16, color: L.wing, tip: shade(L.wing, -0.12), x: 0.08, y: 0.13, z: -0.02 });
  return root;
}

export function ducklingModel(rng) {
  const b = [];
  b.push(paint(ell(0.07, 0.85, 0.72, 1.15, 0, 0.032, 0), '#ffe07a', 0.05, rng));
  b.push(paint(ell(0.055, 0.8, 0.45, 1, 0, 0.06, -0.02), '#e2c070', 0.05, rng));
  b.push(paint(ell(0.046, 1, 0.95, 1, 0, 0.095, 0.05), '#ffe58f', 0.05, rng));
  b.push(paint(ell(0.018, 0.9, 0.35, 1.3, 0, 0.088, 0.093), '#f0a75c'));
  eyes(b, { x: 0.03, y: 0.104, z: 0.078, r: 0.009 });
  const root = new THREE.Group();
  root.add(group('body', 0, 0, 0, solid(b)));
  return root;
}

export function swanModel(rng) {
  const white = PALETTE.flowerWhite;
  const shadeW = '#ebe6dc';
  const b = [];
  b.push(paint(ell(0.26, 0.78, 0.52, 1.32, 0, 0.06, 0), white, 0.03, rng));
  for (const s of [-1, 1]) b.push(paint(tr(ell(0.17, 0.42, 0.55, 1.25, 0, 0, 0), { rz: s * 0.35, x: s * 0.1, y: 0.16, z: -0.07 }), shadeW, 0.03, rng));
  b.push(paint(tr(cone(0.09, 0.2, 6), { rx: -Math.PI / 2 - 0.7, y: 0.14, z: -0.3 }), shadeW, 0.03, rng));
  const h = [];
  const neck = [
    [0, 0, 0],
    [0, 0.14, 0.04],
    [0, 0.27, 0.0],
    [0, 0.38, 0.03],
    [0, 0.44, 0.09],
  ];
  for (let i = 0; i < neck.length - 1; i++) h.push(paint(rod(neck[i], neck[i + 1], 0.04 - i * 0.004, 7), white, 0.02, rng));
  h.push(paint(ell(0.05, 0.85, 0.8, 1.35, 0, 0.45, 0.12), white, 0.02, rng));
  h.push(paint(ell(0.03, 0.75, 0.38, 1.7, 0, 0.435, 0.19), '#f0a75c'));
  h.push(paint(ell(0.022, 0.9, 0.6, 0.9, 0, 0.445, 0.155), '#4a4648'));
  eyes(h, { x: 0.035, y: 0.465, z: 0.14, r: 0.01 });
  const root = new THREE.Group();
  const body = group('body', 0, 0, 0, solid(b), group('head', 0, 0.12, 0.24, solid(h)));
  root.add(body);
  flightWings(body, { span: 0.7, chord: 0.3, color: white, tip: shadeW, x: 0.12, y: 0.2, z: -0.04 });
  return root;
}

// ---- Fish --------------------------------------------------------------------------
// Parts: 'tail' (pivot at the tail root).

export const KOI_LOOKS = [
  { base: '#fbf7ef', patch: '#f2727a', fin: '#fbf7ef' },
  { base: '#f2cf6b', patch: '#ffe58f', fin: '#fff2c4' },
  { base: '#f29a5c', patch: '#fbf7ef', fin: '#ffd0a8' },
  { base: '#4a4648', patch: '#f0a75c', fin: '#f3eadb' },
  { base: '#fbf7ef', patch: '#f0a75c', fin: '#fbf7ef' },
];
export const SILVER = { base: '#c4d0dc', patch: '#8fa3b8', fin: '#d8e2ea', back: true };

export function fishModel(rng, look = KOI_LOOKS[0], size = 1) {
  const seed = rng() * 10;
  const patch = new THREE.Color(look.patch);
  const base = new THREE.Color(look.base);
  const torso = paintBy(ell(0.08, 0.62, 0.7, 2.6, 0, 0, 0, 10, 7), (x, y, z) => {
    // Silver fish shade darker along the back; koi get soft blotches.
    if (look.back) return y > 0.01 ? patch : base;
    const n = Math.sin(z * 19 + seed) * Math.cos(x * 23 + seed * 1.7) + Math.sin(z * 7 - seed) * 0.6;
    return n > 0.35 ? patch : base;
  });
  const head = [torso];
  eyes(head, { x: 0.036, y: 0.014, z: 0.15, r: 0.01 });
  const fins = [tr(paint(flat([[0, 0.09], [0.035, 0.0], [0, -0.07]], 0.01), look.fin), { rz: Math.PI / 2, y: 0.045 })];
  for (const s of [-1, 1]) {
    const fin = [[0, 0.02], [s * 0.07, -0.03], [s * 0.02, -0.05]];
    fins.push(paint(tr(flat(fin, 0.006), { rz: s * 0.4, x: s * 0.035, y: -0.02, z: 0.08 }), look.fin));
  }
  const tail = tr(extrude([[0, 0.015], [0.14, 0.075], [0.105, 0], [0.14, -0.065], [0, -0.015]], 0.008), { ry: Math.PI / 2 });
  const root = new THREE.Group();
  root.add(solid(head), thin(fins), group('tail', 0, 0, -0.19, thin([paint(tail, look.fin, 0.03, rng)])));
  root.scale.setScalar(size);
  return root;
}

// ---- Butterfly ---------------------------------------------------------------------
// Parts: 'wingL', 'wingR' (pivot along the body).

export const BUTTERFLY_LOOKS = [
  { fore: '#f0a75c', hind: '#f29a5c', spot: '#fff2c4' },
  { fore: '#86a8d8', hind: '#7aa2d8', spot: '#e4f0f8' },
  { fore: '#fff0a8', hind: '#ffe07a', spot: '#ffffff' },
  { fore: '#f7a8c8', hind: '#ee93ae', spot: '#fbf7ef' },
  { fore: '#b79be8', hind: '#a58bd8', spot: '#f3eadb' },
  { fore: '#fbf7ef', hind: '#f3eadb', spot: '#b4b7bf' },
];

export function butterflyModel(rng, look = BUTTERFLY_LOOKS[0]) {
  const dark = '#4a4648';
  const body = [];
  body.push(paint(tr(cyl(0.011, 0.014, 0.1, 5), { rx: Math.PI / 2, z: -0.05 }), dark));
  body.push(paint(tr(sphere(0.017, 5, 4), { z: 0.055 }), dark));
  for (const s of [-1, 1]) body.push(paint(rod([s * 0.006, 0.006, 0.06], [s * 0.03, 0.04, 0.1], 0.003, 3), dark));
  const fore = [[0, 0.035], [0.06, 0.085], [0.13, 0.078], [0.142, 0.03], [0.07, 0.0], [0.0, 0.0]];
  const hind = [[0, 0.005], [0.07, -0.005], [0.1, -0.05], [0.06, -0.088], [0.02, -0.062], [0, -0.02]];
  const spot = [[0.09, 0.065], [0.125, 0.06], [0.125, 0.038], [0.095, 0.04]];
  const root = new THREE.Group();
  root.add(solid(body));
  for (const s of [-1, 1]) {
    const m = (p) => (s > 0 ? p : mirror(p));
    const parts = [
      paint(flat(m(fore), 0.004), look.fore, 0.04, rng),
      paint(flat(m(hind), 0.004, -0.001), look.hind, 0.04, rng),
      paint(flat(m(spot), 0.004, 0.003), look.spot),
    ];
    root.add(group(s > 0 ? 'wingR' : 'wingL', 0, 0.004, 0, thin(parts)));
  }
  root.scale.setScalar(1.3);
  return root;
}

// ---- Birds -------------------------------------------------------------------------
// Parts: 'body', 'head' (pivot at the neck), 'wingL', 'wingR', and for gulls 'legs'.

export const SONGBIRD_LOOKS = [
  { back: '#7aa2d8', breast: '#f0a75c', wing: '#5f86c0', head: '#7aa2d8' },
  { back: '#8d7a6a', breast: '#e9876a', wing: '#76655a', head: '#6f6056' },
  { back: '#ffe07a', breast: '#fff0a8', wing: '#5b5f6a', head: '#ffe07a' },
  { back: '#e0675b', breast: '#ec7f70', wing: '#c85a50', head: '#e0675b' },
  { back: '#a3a6ae', breast: '#f3eadb', wing: '#80848d', head: '#4a4648' },
];

export function songbirdModel(rng, look = SONGBIRD_LOOKS[0]) {
  const b = [];
  b.push(paint(ell(0.055, 0.9, 0.85, 1.25, 0, 0.06, 0), look.back, 0.04, rng));
  b.push(paint(ell(0.048, 0.95, 0.9, 0.9, 0, 0.05, 0.025), look.breast, 0.04, rng));
  for (const s of [-1, 1]) b.push(paint(ell(0.04, 0.35, 0.6, 1.35, s * 0.04, 0.068, -0.02), look.wing, 0.04, rng));
  b.push(paint(tr(box(0.045, 0.01, 0.075), { rx: 0.35, y: 0.06, z: -0.085 }), look.wing));
  for (const s of [-1, 1]) b.push(paint(rod([s * 0.016, 0.022, 0.0], [s * 0.016, 0.0, 0.012], 0.005, 3), '#8d6748'));
  const h = [];
  h.push(paint(ell(0.04, 1, 0.95, 1.05, 0, 0.022, 0.012), look.head, 0.04, rng));
  h.push(paint(tr(cone(0.011, 0.032, 5), { rx: Math.PI / 2, y: 0.018, z: 0.042 }), '#f2cf6b'));
  eyes(h, { x: 0.028, y: 0.03, z: 0.036, r: 0.007 });
  const root = new THREE.Group();
  const body = group('body', 0, 0, 0, solid(b), group('head', 0, 0.095, 0.035, solid(h)));
  root.add(body);
  flightWings(body, { span: 0.14, chord: 0.07, color: look.wing, x: 0.03, y: 0.08, z: 0 });
  return root;
}

export function gullModel(rng) {
  const white = '#fbf9f4';
  const grey = '#b9bdc6';
  const b = [];
  b.push(paint(ell(0.11, 0.82, 0.78, 1.6, 0, 0.2, 0), white, 0.03, rng));
  for (const s of [-1, 1]) {
    b.push(paint(tr(ell(0.09, 0.4, 0.45, 1.9, 0, 0, 0), { rz: s * 0.3, x: s * 0.06, y: 0.25, z: -0.06 }), grey, 0.03, rng));
    b.push(paint(ell(0.035, 0.4, 0.4, 1.6, s * 0.045, 0.255, -0.24), '#4a4648'));
  }
  b.push(paint(tr(cone(0.05, 0.12, 6), { rx: -Math.PI / 2 - 0.15, y: 0.21, z: -0.19 }), white));
  const h = [];
  h.push(paint(ell(0.06, 0.9, 0.95, 1.15, 0, 0.03, 0.03), white, 0.03, rng));
  h.push(paint(ell(0.018, 0.75, 0.7, 2.6, 0, 0.018, 0.1), '#ffe07a'));
  h.push(paint(ell(0.008, 1, 1, 1, 0, 0.008, 0.12, 4, 3), '#ec6f64'));
  eyes(h, { x: 0.042, y: 0.045, z: 0.06, r: 0.009 });
  const legs = [];
  for (const s of [-1, 1]) {
    legs.push(paint(rod([s * 0.035, 0.13, 0.0], [s * 0.035, 0.0, 0.015], 0.009, 4), '#f0a75c'));
    legs.push(paint(ell(0.022, 1, 0.25, 1.4, s * 0.035, 0.004, 0.03, 5, 3), '#f0a75c'));
  }
  const root = new THREE.Group();
  const body = group('body', 0, 0, 0, solid(b), group('head', 0, 0.28, 0.16, solid(h)));
  root.add(body, group('legs', 0, 0, 0, solid(legs)));
  flightWings(body, { span: 0.62, chord: 0.2, color: grey, tip: '#4a4648', x: 0.06, y: 0.26, z: 0 });
  return root;
}

// ---- Rabbit ------------------------------------------------------------------------
// Parts: 'body' (pivot at the hind feet), 'head' (pivot at the neck), 'ears'.

export const RABBIT_LOOKS = [
  { fur: '#c49a72', belly: '#f3eadb', ear: '#f2b8a8' },
  { fur: '#b4aea8', belly: '#ece8e2', ear: '#f2b8a8' },
  { fur: '#f6f1e8', belly: '#ffffff', ear: '#f7a8c8' },
  { fur: '#a8825e', belly: '#e8d8c0', ear: '#e9a898' },
];

export function rabbitModel(rng, look = RABBIT_LOOKS[0]) {
  const b = [];
  b.push(paint(ell(0.11, 0.85, 0.8, 1.15, 0, 0.11, 0.04), look.fur, 0.04, rng));
  for (const s of [-1, 1]) {
    b.push(paint(ell(0.07, 0.8, 0.95, 1.1, s * 0.06, 0.075, -0.01), look.fur, 0.04, rng));
    b.push(paint(ell(0.03, 0.7, 0.35, 1.9, s * 0.065, 0.012, 0.03), look.fur, 0.03, rng));
    b.push(paint(ell(0.022, 0.9, 0.8, 1, s * 0.035, 0.02, 0.15), look.belly));
  }
  b.push(paint(ell(0.07, 0.9, 0.9, 0.8, 0, 0.1, 0.12), look.belly, 0.03, rng));
  b.push(paint(sphere(0.035, 6, 4), '#ffffff'));
  tr(b[b.length - 1], { y: 0.14, z: -0.08 });
  const h = [];
  h.push(paint(ell(0.07, 0.85, 0.82, 1.05, 0, 0.03, 0.04), look.fur, 0.04, rng));
  h.push(paint(ell(0.03, 1.2, 0.8, 0.8, 0, 0.012, 0.09), look.belly));
  h.push(paint(ell(0.012, 1.2, 0.8, 0.8, 0, 0.026, 0.11, 5, 3), '#ec8f9a'));
  eyes(h, { x: 0.045, y: 0.05, z: 0.075, r: 0.012 });
  const e = [];
  for (const s of [-1, 1]) {
    e.push(paint(tr(ell(0.03, 0.62, 3, 0.36, 0, 0, 0, 7, 5), { rz: -s * 0.18, rx: -0.25, x: s * 0.03, y: 0.08 }), look.fur, 0.03, rng));
    e.push(paint(tr(ell(0.02, 0.55, 3, 0.25, 0, 0, 0, 6, 4), { rz: -s * 0.18, rx: -0.25, x: s * 0.03, y: 0.08, z: 0.008 }), look.ear));
  }
  const root = new THREE.Group();
  const head = group('head', 0, 0.17, 0.12, solid(h), group('ears', 0, 0.05, 0.02, solid(e)));
  root.add(group('body', 0, 0, -0.05, group('torso', 0, 0, 0.05, solid(b), head)));
  return root;
}

// ---- Cat ---------------------------------------------------------------------------
// Parts: 'body' (pivot at the hips), 'front' and 'hind' (legs), 'head', 'tail'.

export const CAT_LOOKS = [
  { fur: '#f0a75c', stripe: '#d9844a', chest: '#fbf0e0', eye: '#9cc46a' },
  { fur: '#a3a6ae', stripe: '#8a8d96', chest: '#ece8e2', eye: '#f2cf6b' },
  { fur: '#4a4648', stripe: '#4a4648', chest: '#f3eadb', eye: '#a6dc7c' },
  { fur: '#f6f1e8', stripe: '#f0a75c', chest: '#ffffff', eye: '#86a8d8', patches: true },
  { fur: '#c9a682', stripe: '#a8825e', chest: '#f3eadb', eye: '#9cc46a' },
];

export function catModel(rng, look = CAT_LOOKS[0]) {
  const fur = new THREE.Color(look.fur);
  const stripe = new THREE.Color(look.stripe);
  const pattern = (x, y, z) => {
    if (look.patches) return Math.sin(z * 9 + x * 6) > 0.4 ? stripe : fur;
    return Math.sin(z * 42) > 0.55 && y > 0.04 ? stripe : fur;
  };
  const torso = [];
  torso.push(paintBy(ell(0.105, 0.82, 0.82, 1.75, 0, 0.06, 0.15, 10, 7), pattern));
  torso.push(paint(ell(0.075, 0.85, 0.8, 0.8, 0, 0.05, 0.28), look.chest, 0.03, rng));
  const legs = (name, zs) => {
    const out = [];
    for (const s of [-1, 1]) {
      out.push(paint(tr(cyl(0.027, 0.031, 0.17, 6), { x: s * 0.05, y: -0.17 }), look.fur, 0.03, rng));
      out.push(paint(ell(0.028, 1, 0.55, 1.3, s * 0.05, -0.165, 0.012, 6, 4), look.chest));
    }
    return group(name, 0, 0.02, zs, solid(out));
  };
  const h = [];
  h.push(paintBy(ell(0.082, 1.08, 0.92, 0.95, 0, 0.055, 0.035), pattern));
  h.push(paint(ell(0.04, 1.15, 0.75, 0.8, 0, 0.03, 0.095), look.chest));
  h.push(paint(ell(0.012, 1.2, 0.8, 0.7, 0, 0.045, 0.125, 5, 3), '#ec8f9a'));
  for (const s of [-1, 1]) {
    h.push(paint(tr(cone(0.032, 0.07, 4), { rz: -s * 0.35, x: s * 0.048, y: 0.115, z: 0.03 }), look.fur, 0.03, rng));
    h.push(paint(ell(0.016, 0.9, 1.1, 0.6, s * 0.032, 0.07, 0.105, 6, 4), look.eye));
    h.push(paint(ell(0.007, 0.5, 1.2, 0.5, s * 0.033, 0.07, 0.115, 4, 3), '#2e2a2c'));
  }
  const tailPts = [
    [0, 0, 0],
    [0, 0.07, -0.09],
    [0, 0.18, -0.13],
    [0, 0.27, -0.1],
  ];
  const t = [];
  for (let i = 0; i < tailPts.length - 1; i++) t.push(paint(rod(tailPts[i], tailPts[i + 1], 0.022 - i * 0.002, 5), i === 2 && look.patches ? look.stripe : look.fur));
  const root = new THREE.Group();
  const body = group(
    'body', 0, 0.15, -0.12,
    solid(torso),
    legs('front', 0.25),
    legs('hind', 0.03),
    group('head', 0, 0.09, 0.32, solid(h)),
    group('tail', 0, 0.06, -0.03, solid(t)),
  );
  root.add(body);
  return root;
}
