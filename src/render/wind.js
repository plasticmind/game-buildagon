// Wind vertex displacement for grass, leaves, and other foliage.
//
// applyWind(material, opts) patches a built-in material (MeshToonMaterial,
// MeshLambertMaterial, MeshDepthMaterial, …) so its vertices sway in world space.
// It works with plain meshes and InstancedMesh.
//
// Sway weight per vertex (0 = rooted, 1 = full sway):
//   useSwayAttribute: true  → read the float attribute `aSway` from the geometry.
//   otherwise               → clamp(position.y / swayHeight, 0, 1)², in local space.
//
// Shadow casters: assign mesh.customDepthMaterial = getWindDepthMaterial(sameOpts)
// so the shadow sways with the mesh.

import * as THREE from 'three';
import { U, MAX_GUSTS } from './shared.js';

const WIND_PARS = /* glsl */ `
uniform float uTime;
uniform vec2 uWindDir;
uniform float uWindStrength;
uniform vec4 uGusts[${MAX_GUSTS}];
uniform float uWindAmp;
uniform float uWindFlutter;
uniform float uSwayHeight;
#ifdef USE_SWAY_ATTR
attribute float aSway;
#endif

vec3 windDisplace(vec3 wp, float w) {
  if (w <= 0.0) return vec3(0.0);
  float t = uTime;
  vec2 d = uWindDir;
  float along = dot(wp.xz, d);
  // Slow travelling gust bands, then faster ripples on top.
  float band = 0.55 + 0.45 * sin(along * 0.045 - t * 0.55);
  float phase = along * 0.42 - t * 1.7;
  float wave = sin(phase) * 0.6 + sin(phase * 2.17 + wp.x * 0.61) * 0.25 + sin(t * 0.9 + wp.z * 0.37) * 0.15;
  vec2 off = d * (0.25 + 0.55 * (wave * 0.5 + 0.5)) * band * uWindStrength;
  off += vec2(sin(t * 5.3 + wp.x * 3.1 + wp.y * 1.7), cos(t * 4.6 + wp.z * 2.9)) * 0.12 * uWindFlutter * (0.4 + uWindStrength * 0.6);

  // Radial rustle rings from placement impulses.
  for (int i = 0; i < ${MAX_GUSTS}; i++) {
    vec4 g = uGusts[i];
    float age = t - g.y;
    if (age < 0.0 || age > 2.4) continue;
    vec2 to = wp.xz - vec2(g.x, g.z);
    float dist = length(to) + 1e-4;
    float front = age * 7.0;
    float ring = exp(-pow((dist - front) * 0.8, 2.0)) * exp(-age * 1.6);
    float near = exp(-dist * 0.12);
    float shake = sin(age * 26.0 + dist * 2.0);
    off += (to / dist) * ring * near * g.w * (0.9 + 0.6 * shake);
  }
  // Keep blade length roughly constant by dipping as it bends.
  return vec3(off.x, -dot(off, off) * 0.35, off.y) * w * uWindAmp;
}
`;

const WIND_PROJECT = /* glsl */ `
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
  mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
#endif
vec4 windWorld = modelMatrix * mvPosition;
#ifdef USE_SWAY_ATTR
  float windW = aSway;
#else
  float windW = clamp( position.y / uSwayHeight, 0.0, 1.0 );
  windW *= windW;
#endif
vec3 windOff = windDisplace( windWorld.xyz, windW );
mvPosition = modelViewMatrix * mvPosition;
mvPosition.xyz += ( viewMatrix * vec4( windOff, 0.0 ) ).xyz;
gl_Position = projectionMatrix * mvPosition;
`;

const DEFAULTS = { amp: 0.25, flutter: 0.5, swayHeight: 1, useSwayAttribute: false };

export function applyWind(material, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const prev = material.onBeforeCompile;
  material.defines = { ...(material.defines || {}), USE_WIND: '' };
  if (o.useSwayAttribute) material.defines.USE_SWAY_ATTR = '';
  material.userData.wind = o;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer);
    shader.uniforms.uTime = U.uTime;
    shader.uniforms.uWindDir = U.uWindDir;
    shader.uniforms.uWindStrength = U.uWindStrength;
    shader.uniforms.uGusts = U.uGusts;
    shader.uniforms.uWindAmp = { value: o.amp };
    shader.uniforms.uWindFlutter = { value: o.flutter };
    shader.uniforms.uSwayHeight = { value: o.swayHeight };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${WIND_PARS}`)
      .replace('#include <project_vertex>', WIND_PROJECT);
  };
  const prevKey = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () =>
    `wind:${o.useSwayAttribute ? 1 : 0}|${prevKey ? prevKey() : ''}`;
  material.needsUpdate = true;
  return material;
}

const depthCache = new Map();

// Depth material for shadow casting that sways like the visible mesh.
export function getWindDepthMaterial(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const k = JSON.stringify(o);
  if (!depthCache.has(k)) {
    const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    depthCache.set(k, applyWind(m, o));
  }
  return depthCache.get(k);
}
