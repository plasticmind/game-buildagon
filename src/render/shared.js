// Uniforms shared by every custom shader. Import `U` and pass the same objects
// into your ShaderMaterial or onBeforeCompile so one write updates everything.

import * as THREE from 'three';

export const MAX_GUSTS = 8;

export const U = {
  uTime: { value: 0 }, // Seconds since start.
  uWindDir: { value: new THREE.Vector2(1, 0.35).normalize() }, // X/Z direction.
  uWindStrength: { value: 1 }, // 0 = calm, 1 = breezy, 2 = gusty.
  // Local wind impulses from placement. x, z = world position, y = start time,
  // w = strength. Inactive slots have y = -1000.
  uGusts: { value: Array.from({ length: MAX_GUSTS }, () => new THREE.Vector4(0, -1000, 0, 0)) },
  uNight: { value: 0 }, // 0 = full day, 1 = full night. Drives emissive glow.
  uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() }, // Toward the sun.
  uSunColor: { value: new THREE.Color(1, 1, 1) },
  uFogColor: { value: new THREE.Color('#cfe3ee') },
  // Scene depth (opaque WORLD layer only) for water depth fade and foam.
  uDepthTex: { value: null },
  // Drawing-buffer size in pixels. Sample uDepthTex at gl_FragCoord.xy / uResolution;
  // the depth texture itself is half this size.
  uResolution: { value: new THREE.Vector2(1, 1) },
  uCameraNear: { value: 0.1 },
  uCameraFar: { value: 800 },
};

// Object layers. The water depth pre-pass renders only DEPTH.
// Raycasters default to layer 0 only; enable WATER explicitly to hit water.
export const LAYERS = {
  WORLD: 0, // Opaque terrain, objects, structures.
  WATER: 1, // Water surfaces and waterfalls (transparent, read uDepthTex).
  FX: 2, // Grass, particles, sky, and other things excluded from the depth pre-pass.
  GHOST: 3, // Blueprint previews and highlights.
  // Also set on WORLD meshes that can touch water (terrain, seabed, objects in
  // water). Only this layer goes into the water depth pre-pass.
  DEPTH: 4,
};

let gustIndex = 0;

// Push a radial wind impulse that makes nearby grass and leaves rustle.
export function addGust(x, z, strength = 1) {
  const g = U.uGusts.value[gustIndex];
  g.set(x, U.uTime.value, z, strength);
  gustIndex = (gustIndex + 1) % MAX_GUSTS;
}
