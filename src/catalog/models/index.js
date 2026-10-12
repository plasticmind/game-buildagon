// Model registry. buildModel(itemId, variant, seed) returns a fresh THREE.Object3D
// whose origin is the placement point (base at y = 0). See catalog.js for the
// orientation conventions of each placement type.
//
// Builders may set these on the returned object's userData:
//   topY          Height of the top surface other pieces stack on (walls, floors).
//   animate       (object, time, dt) => void, called every frame (windmill, boat).
//   lightOffset   THREE.Vector3, local position of the night light (lanterns, fires).
//   emitters      [{ type: 'smoke' | 'sparks', offset: THREE.Vector3 }] particle sources.

import * as THREE from 'three';
import { mulberry32 } from '../../core/random.js';
import { builders as nature } from './nature.js';
import { builders as structures } from './structures.js';
import { builders as props } from './props.js';
import { builders as tiles } from './tiles.js';

const BUILDERS = { ...tiles, ...nature, ...structures, ...props };

export function hasModel(itemId) {
  return itemId in BUILDERS;
}

export function buildModel(itemId, variant = 0, seed = 1) {
  const fn = BUILDERS[itemId];
  const rng = mulberry32(seed);
  const obj = fn ? fn(variant, rng) : placeholder();
  obj.userData.itemId = itemId;
  return obj;
}

function placeholder() {
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), new THREE.MeshToonMaterial({ color: '#ff77aa' }));
  m.position.y = 0.4;
  m.castShadow = true;
  const g = new THREE.Group();
  g.add(m);
  g.userData.topY = 0.8;
  return g;
}
