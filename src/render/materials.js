// Shared cel-shaded materials. Models use vertex colors on a handful of shared
// materials, so each placed object costs one or two draw calls.

import * as THREE from 'three';
import { applyWind, getWindDepthMaterial } from './wind.js';
import { U } from './shared.js';

// Soft four-band toon ramp. Index by dot(N, L) * 0.5 + 0.5.
function makeGradientMap() {
  const tones = [0.42, 0.58, 0.82, 1.0];
  const data = new Uint8Array(tones.length * 4);
  tones.forEach((t, i) => {
    const v = Math.round(t * 255);
    data.set([v, v, v, 255], i * 4);
  });
  const tex = new THREE.DataTexture(data, tones.length, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

export const gradientMap = makeGradientMap();

// Create a toon material. Pass vertexColors: true when geometry carries `color`.
export function toon({
  color = 0xffffff,
  vertexColors = true,
  flatShading = true,
  transparent = false,
  opacity = 1,
  side = THREE.FrontSide,
  emissive = 0x000000,
  emissiveIntensity = 1,
} = {}) {
  const m = new THREE.MeshToonMaterial({
    color,
    vertexColors,
    transparent,
    opacity,
    side,
    emissive,
    emissiveIntensity,
    gradientMap,
  });
  // MeshToonMaterial doesn't declare flatShading, but the renderer honors it.
  m.flatShading = flatShading;
  return m;
}

// Night glow: a flat color that brightens past 1.0 at night so bloom catches it.
// `dayLevel` is the brightness multiplier at noon, `nightLevel` at midnight.
const glowCache = new Map();
export function glowMaterial(color = '#ffd38a', { dayLevel = 0.95, nightLevel = 3.2 } = {}) {
  const k = `${color}|${dayLevel}|${nightLevel}`;
  if (glowCache.has(k)) return glowCache.get(k);
  const m = new THREE.MeshBasicMaterial({ color });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = U.uNight;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>\n diffuseColor.rgb *= mix(${dayLevel.toFixed(3)}, ${nightLevel.toFixed(3)}, uNight);`,
      );
  };
  m.customProgramCacheKey = () => `glow:${k}`;
  glowCache.set(k, m);
  return m;
}

// Wind settings for foliage geometry that carries an `aSway` attribute.
export const FOLIAGE_WIND = { useSwayAttribute: true, amp: 0.22, flutter: 0.6 };

// Shared material set. Every model builder should use these.
export const MATS = {
  // Vertex-colored, static (rocks, wood, structures, trunks).
  static: toon(),
  // Vertex-colored, sways by the `aSway` attribute (leaves, flowers, reeds).
  foliage: applyWind(toon({ side: THREE.DoubleSide }), FOLIAGE_WIND),
  // Shadow caster for foliage meshes: mesh.customDepthMaterial = MATS.foliageDepth.
  foliageDepth: getWindDepthMaterial(FOLIAGE_WIND),
  // Vertex-colored, double-sided static (thin planks, sails, cloth).
  staticDouble: toon({ side: THREE.DoubleSide }),
};
