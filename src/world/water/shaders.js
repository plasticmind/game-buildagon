// Water shaders: the ocean and raised water surfaces share one program (the
// ocean adds the OCEAN define), plus waterfall curtains and landing foam.
//
// Every material reads the shared uniforms in `U`, so the sky and pipeline
// drive time, sun, night, fog, and the scene depth from one place.

import * as THREE from 'three';
import { HEX_SIZE, HEX_APOTHEM } from '../../core/constants.js';
import { cornerOffset, edgeAngle, DIRS } from '../../core/hex.js';
import { U } from '../../render/shared.js';
import { MASK_RADIUS, MASK_SIZE } from './mask.js';

// Local uniforms shared by every water material.
export const waterUniforms = {
  uHasDepth: { value: 0 }, // 1 once U.uDepthTex holds a texture.
};

const f = (v) => Number(v).toFixed(6);
const vec2s = (list) => list.map(([x, y]) => `vec2(${f(x)}, ${f(y)})`).join(', ');

// ---- Waves ------------------------------------------------------------------

// Directional swell in world space. Directions are offsets from the prevailing
// breeze. The last layer is too fine for the ocean grid, so it only shapes normals.
const BREEZE = Math.atan2(0.35, 1);
const WAVES = [
  { angle: 0.0, length: 9.0, amp: 0.026, phase: 0.0 },
  { angle: 0.62, length: 5.4, amp: 0.017, phase: 1.7 },
  { angle: -0.78, length: 3.5, amp: 0.011, phase: 3.1 },
  { angle: 1.9, length: 2.3, amp: 0.006, phase: 4.4 },
].map((w) => {
  const a = BREEZE + w.angle;
  const k = (2 * Math.PI) / w.length;
  return { ...w, dx: Math.cos(a), dz: Math.sin(a), k, omega: Math.sqrt(9.8 * k) * 0.55 };
});
const DISPLACED_WAVES = 3;

// The displaced swell height at (x, z), matching wWaveHeight in the shaders,
// so things floating on the water ride the same waves.
export function waveHeight(x, z, time, wind = 1) {
  const reach = 1 - THREE.MathUtils.smoothstep(Math.hypot(x, z), 170, 320);
  const amp = reach * Math.min(1.4, Math.max(0.5, 0.6 + 0.4 * wind));
  let h = 0;
  for (let i = 0; i < DISPLACED_WAVES; i++) {
    const w = WAVES[i];
    h += w.amp * Math.sin((x * w.dx + z * w.dz) * w.k - time * w.omega + w.phase);
  }
  return h * amp;
}

const phaseOf = (w) => `dot(p, vec2(${f(w.dx)}, ${f(w.dz)})) * ${f(w.k)} - uTime * ${f(w.omega)} + ${f(w.phase)}`;

const WAVE_PARS = /* glsl */ `
uniform float uTime;
uniform float uWindStrength;

// Swell fades out far from the island, and grows a little with the wind.
float wWaveAmp(vec2 p) {
  float reach = 1.0 - smoothstep(170.0, 320.0, length(p));
  return reach * clamp(0.6 + 0.4 * uWindStrength, 0.5, 1.4);
}

// Height of the swell, for vertex displacement.
float wWaveHeight(vec2 p) {
  float h = 0.0;
${WAVES.slice(0, DISPLACED_WAVES)
  .map((w) => `  h += ${f(w.amp)} * sin(${phaseOf(w)});`)
  .join('\n')}
  return h * wWaveAmp(p);
}

// Height and slope (dh/dx, dh/dz) of every wave layer, for shading.
vec3 wWave(vec2 p) {
  vec3 s = vec3(0.0);
  float ph;
${WAVES.map(
  (w) => `  ph = ${phaseOf(w)};
  s += vec3(${f(w.amp)} * sin(ph), ${f(w.amp * w.k)} * cos(ph) * vec2(${f(w.dx)}, ${f(w.dz)}));`,
).join('\n')}
  return s * wWaveAmp(p);
}
`;

// ---- Noise and light ----------------------------------------------------------

const NOISE_PARS = /* glsl */ `
float wHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float wHash3(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

float wNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 t = fract(p);
  vec2 u = t * t * (3.0 - 2.0 * t);
  float a = wHash(i);
  float b = wHash(i + vec2(1.0, 0.0));
  float c = wHash(i + vec2(0.0, 1.0));
  float d = wHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Value noise with its analytic derivatives: (value, d/dx, d/dy).
vec3 wNoiseD(vec2 p) {
  vec2 i = floor(p);
  vec2 t = fract(p);
  vec2 u = t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
  vec2 du = 30.0 * t * t * (t * (t - 2.0) + 1.0);
  float a = wHash(i);
  float b = wHash(i + vec2(1.0, 0.0));
  float c = wHash(i + vec2(0.0, 1.0));
  float d = wHash(i + vec2(1.0, 1.0));
  float k1 = b - a;
  float k2 = c - a;
  float k4 = a - b - c + d;
  return vec3(a + k1 * u.x + k2 * u.y + k4 * u.x * u.y, du * vec2(k1 + k4 * u.y, k2 + k4 * u.x));
}

float wNoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 t = fract(p);
  vec3 u = t * t * (3.0 - 2.0 * t);
  float a = wHash3(i);
  float b = wHash3(i + vec3(1.0, 0.0, 0.0));
  float c = wHash3(i + vec3(0.0, 1.0, 0.0));
  float d = wHash3(i + vec3(1.0, 1.0, 0.0));
  float e = wHash3(i + vec3(0.0, 0.0, 1.0));
  float g = wHash3(i + vec3(1.0, 0.0, 1.0));
  float h = wHash3(i + vec3(0.0, 1.0, 1.0));
  float k = wHash3(i + vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y), mix(mix(e, g, u.x), mix(h, k, u.x), u.y), u.z);
}
`;

const LIGHT_PARS = /* glsl */ `
uniform float uNight;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uFogColor;

// Water isn't lit by scene lights; borrow a little of the sun's color instead.
vec3 wDayLight() {
  return mix(vec3(1.0), clamp(uSunColor, 0.0, 1.5), 0.3);
}

// Moonlit shift toward deep, cool blue.
vec3 wNight(vec3 c) {
  return mix(c, c * vec3(0.30, 0.38, 0.60) + vec3(0.010, 0.025, 0.060), uNight);
}
`;

// ---- Ocean mask lookups --------------------------------------------------------

const corners = Array.from({ length: 6 }, (_, i) => {
  const o = cornerOffset(i);
  return [o.x, o.z];
});
const normals = Array.from({ length: 6 }, (_, i) => [Math.cos(edgeAngle(i)), Math.sin(edgeAngle(i))]);

const MASK_PARS = /* glsl */ `
uniform sampler2D uMask;

const float W_HEX = ${f(HEX_SIZE)};
const float W_APOTHEM = ${f(HEX_APOTHEM)};
const int W_MASK_R = ${MASK_RADIUS};
const int W_MASK_N = ${MASK_SIZE};
const float W_LAND_TUCK = 0.08;
const ivec2 W_DIRS[6] = ivec2[6](${DIRS.map(([q, r]) => `ivec2(${q}, ${r})`).join(', ')});
const vec2 W_CORNER_A[6] = vec2[6](${vec2s(corners)});
const vec2 W_CORNER_B[6] = vec2[6](${vec2s(corners.map((_, i) => corners[(i + 1) % 6]))});
const vec2 W_EDGE_N[6] = vec2[6](${vec2s(normals)});

vec2 wAxial(vec2 p) {
  return vec2(0.5773503 * p.x - p.y / 3.0, (2.0 / 3.0) * p.y) / W_HEX;
}

ivec2 wHexRound(vec2 a) {
  vec3 c = vec3(a.x, a.y, -a.x - a.y);
  vec3 rc = floor(c + 0.5);
  vec3 d = abs(rc - c);
  if (d.x > d.y && d.x > d.z) rc.x = -rc.y - rc.z;
  else if (d.y > d.z) rc.y = -rc.x - rc.z;
  return ivec2(rc.xy);
}

vec2 wHexCenter(ivec2 c) {
  return vec2(W_HEX * 1.7320508 * (float(c.x) + float(c.y) * 0.5), W_HEX * 1.5 * float(c.y));
}

// 0 = ocean, ~0.5 = raised water, 1 = land. Outside the mask is open ocean.
float wMaskFlag(ivec2 c) {
  ivec2 t = c + ivec2(W_MASK_R);
  if (t.x < 0 || t.y < 0 || t.x >= W_MASK_N || t.y >= W_MASK_N) return 0.0;
  return texelFetch(uMask, t, 0).a;
}

vec3 wMaskRGB(ivec2 c) {
  ivec2 t = clamp(c + ivec2(W_MASK_R), ivec2(0), ivec2(W_MASK_N - 1));
  return texelFetch(uMask, t, 0).rgb;
}

// Tint blended across the triangle of cell centers around p.
vec3 wMaskTint(vec2 p) {
  vec2 a = wAxial(p);
  vec2 b = floor(a);
  vec2 u = a - b;
  ivec2 c = ivec2(b);
  if (u.x + u.y < 1.0) {
    return wMaskRGB(c) * (1.0 - u.x - u.y) + wMaskRGB(c + ivec2(1, 0)) * u.x + wMaskRGB(c + ivec2(0, 1)) * u.y;
  }
  return wMaskRGB(c + ivec2(1, 1)) * (u.x + u.y - 1.0) + wMaskRGB(c + ivec2(1, 0)) * (1.0 - u.y) +
    wMaskRGB(c + ivec2(0, 1)) * (1.0 - u.x);
}
`;

// ---- Water surfaces ---------------------------------------------------------------

const SURFACE_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
${WAVE_PARS}

varying vec3 vWorldPos;
varying float vViewDepth;
#ifndef OCEAN
attribute vec3 aTint;
attribute vec4 aFlow;
varying vec3 vTint;
varying vec4 vFlow;
#endif

void main() {
  vec3 transformed = position;
  vec4 worldBase = modelMatrix * vec4(position, 1.0);
  transformed.y += wWaveHeight(worldBase.xz);
  vec4 worldPos = modelMatrix * vec4(transformed, 1.0);
  vWorldPos = worldPos.xyz;
  vec4 mvPosition = viewMatrix * worldPos;
  vViewDepth = -mvPosition.z;
#ifndef OCEAN
  vTint = aTint;
  vFlow = aFlow;
#endif
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}
`;

const SURFACE_FRAG = /* glsl */ `
#include <common>
#include <packing>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
${WAVE_PARS}
${NOISE_PARS}
${LIGHT_PARS}

uniform sampler2D uDepthTex;
uniform vec2 uResolution;
uniform float uCameraNear;
uniform float uCameraFar;
uniform float uHasDepth;

varying vec3 vWorldPos;
varying float vViewDepth;
#ifdef OCEAN
${MASK_PARS}
#else
varying vec3 vTint;
varying vec4 vFlow;
#endif

// Fine ripples that catch the light.
vec2 wRipple(vec2 p) {
  vec3 a = wNoiseD(p * 1.1 + vec2(uTime * 0.31, uTime * 0.19));
  vec3 b = wNoiseD(p * 2.3 + vec2(-uTime * 0.26, uTime * 0.37));
  return a.yz * 0.055 + b.yz * 0.05;
}

// Soft foam line along the shore plus pulses drifting out from it.
// d is the distance to the shore (or a depth stand-in for it).
float wShoreFoam(vec2 p, float d) {
  float wob = (wNoise(p * 1.6 + vec2(uTime * 0.13, -uTime * 0.09)) - 0.5) * 0.10 +
    sin(uTime * 1.2 + p.x * 0.8 + p.y * 0.6) * 0.02;
  float dd = d + wob;
  float aa = fwidth(dd) + 0.008;
  float line = 1.0 - smoothstep(0.11 - aa, 0.17 + aa, dd);
  float ph = fract(uTime * 0.2 + wNoise(p * 0.3) * 0.6);
  float bandPos = 0.18 + ph * 0.45;
  float band = 1.0 - smoothstep(0.02, 0.05 + aa, abs(dd - bandPos));
  band *= (1.0 - ph) * smoothstep(0.3, 0.55, wNoise(p * 0.7 + vec2(0.0, uTime * 0.05)));
  return clamp(max(line, band * 0.8), 0.0, 1.0);
}

void main() {
  #include <logdepthbuf_fragment>
  vec3 P = vWorldPos;
  vec2 p = P.xz;
  vec3 toCam = cameraPosition - P;
  float camDist = max(length(toCam), 1e-4);
  vec3 V = toCam / camDist;

  vec3 tint;
  float shore;
#ifdef OCEAN
  // Hide the ocean inside island cells. It reaches a little into land so it
  // meets the cliff wall, but stops exactly at the edge of raised water.
  ivec2 cell = wHexRound(wAxial(p));
  vec2 local = p - wHexCenter(cell);
  float own = wMaskFlag(cell);
  shore = 1.0;
  if (own > 0.25) {
    float inside = W_APOTHEM - max(abs(dot(local, W_EDGE_N[0])), max(abs(dot(local, W_EDGE_N[1])), abs(dot(local, W_EDGE_N[2]))));
    if (inside > (own > 0.75 ? W_LAND_TUCK : 0.0)) discard;
    shore = 0.0;
  }
  for (int i = 0; i < 6; i++) {
    if (W_APOTHEM - dot(local, W_EDGE_N[i]) < 1.0 && wMaskFlag(cell + W_DIRS[i]) > 0.25) {
      vec2 a = W_CORNER_A[i];
      vec2 ab = W_CORNER_B[i] - a;
      float h = clamp(dot(local - a, ab) / dot(ab, ab), 0.0, 1.0);
      shore = min(shore, length(local - a - ab * h));
    }
  }
  tint = wMaskTint(p);
#else
  tint = vTint;
  shore = vFlow.w;
#endif

  // Swell plus ripples, with ripples fading out in the distance.
  float nearFade = 1.0 - smoothstep(30.0, 110.0, camDist);
  vec3 wv = wWave(p);
  // Ripples cost several noise lookups, so skip them where they'd fade to nothing.
  vec2 rip = nearFade > 0.0 ? wRipple(p) * nearFade : vec2(0.0);
  vec3 N = normalize(vec3(-(wv.y + rip.x), 1.0, -(wv.z + rip.y)));

  // Water under this pixel: vertical depth for color and foam, path length
  // through the water for opacity.
  float depthV = 1.4;
  float path = 2.0;
  if (uHasDepth > 0.5) {
    vec2 suv = gl_FragCoord.xy / uResolution;
    float sceneZ = -perspectiveDepthToViewZ(texture2D(uDepthTex, suv).r, uCameraNear, uCameraFar);
    float ratio = sceneZ / max(vViewDepth, 1e-3);
    vec3 scenePos = cameraPosition - toCam * ratio;
    depthV = max(P.y - scenePos.y, 0.0);
    path = max(camDist * (ratio - 1.0), 0.0);
  }

  // Clear pastel shallows, richer blue in the deep.
  vec3 light = wDayLight();
  vec3 shallow = mix(tint, vec3(0.80, 0.98, 0.95), 0.42);
  vec3 deep = tint * vec3(0.30, 0.52, 0.82);
  vec3 col = mix(shallow, deep, 1.0 - exp(-depthV * 0.8)) * light;
  float alpha = mix(0.3, 0.93, 1.0 - exp(-path * 0.55));

#ifndef OCEAN
  // Streaks sliding toward a waterfall lip.
  if (vFlow.z > 0.01) {
    vec2 fd = normalize(vFlow.xy + vec2(1e-5));
    vec2 fp = vec2(dot(p, vec2(-fd.y, fd.x)), dot(p, fd));
    float s = wNoise(vec2(fp.x * 3.0, fp.y * 0.7 - uTime * 1.3));
    float streak = smoothstep(0.6, 0.85, s) * vFlow.z;
    col = mix(col, vec3(0.95, 1.0, 1.0) * light, streak * 0.35);
    alpha = max(alpha, streak * 0.6);
  }
#endif

  col = wNight(col);

  // Sky reflection at grazing angles.
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  vec3 sky = mix(uFogColor, vec3(1.0), 0.12 * (1.0 - uNight));
  col = mix(col, sky, fres * 0.7);
  alpha = mix(alpha, 1.0, fres * 0.8);

  // Shore foam. Its widest band ends near 0.7 even with the wobble, so open
  // water skips the noise entirely.
  float foamDist = min(shore, depthV * 2.0);
  float foam = foamDist < 0.8 ? wShoreFoam(p, foamDist) : 0.0;
  vec3 foamCol = wNight(mix(vec3(1.0, 0.985, 0.95), shallow, 0.18) * light);
  col = mix(col, foamCol, foam);
  alpha = mix(alpha, 0.96, foam);

  // Sun glint, allowed past 1.0 so bloom picks it up.
  vec3 L = normalize(uSunDir);
  vec3 H = normalize(L + V);
  float nh = max(dot(N, H), 0.0);
  float glint = pow(nh, 280.0) * 1.8 + smoothstep(0.9975, 0.9995, nh) * 0.8 * nearFade;
  glint *= smoothstep(-0.02, 0.15, L.y) * mix(1.0, 0.35, uNight) * (1.0 - foam);
  col += uSunColor * glint;
  alpha = clamp(alpha + glint, 0.0, 1.0);

  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

// ---- Waterfalls ---------------------------------------------------------------------

const CURTAIN_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
${WAVE_PARS}

attribute vec2 aLip;
attribute vec3 aFall;
attribute vec3 aTint;
varying vec2 vLip;
varying vec3 vFall;
varying vec3 vTint;

void main() {
  // The top row rides the same swell as the surface it pours from.
  vec3 transformed = position;
  vec4 worldBase = modelMatrix * vec4(position, 1.0);
  transformed.y += wWaveHeight(worldBase.xz) * aFall.z;
  vLip = aLip;
  vFall = aFall;
  vTint = aTint;
  vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}
`;

const CURTAIN_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
${NOISE_PARS}
${LIGHT_PARS}
uniform float uTime;

varying vec2 vLip;
varying vec3 vFall;
varying vec3 vTint;

void main() {
  #include <logdepthbuf_fragment>
  float fall = max(vFall.x, 0.0);
  float drop = max(vFall.y, 0.05);

  // Streaks scroll faster further down, like the water is picking up speed.
  float s = sqrt(fall) * 2.2 - uTime * 1.6;
  vec3 sp = vec3(vLip * 3.2, s);
  float n = wNoise3(sp) * 0.62 + wNoise3(sp * vec3(2.2, 2.2, 1.7) + 11.7) * 0.38;
  float streak = smoothstep(0.5, 0.78, n);
  float lip = 1.0 - smoothstep(0.0, 0.3, fall);
  float base = smoothstep(max(drop * 0.4, drop - 1.4), drop + 0.05, fall);

  vec3 body = mix(vTint, vec3(0.86, 0.98, 1.0), 0.4);
  vec3 col = mix(body, vec3(1.0, 0.995, 0.98), clamp(streak * 0.55 + base * 0.75, 0.0, 1.0));
  // A glassy roll of light over the lip.
  col += vec3(0.10, 0.12, 0.12) * lip * (0.6 + 0.4 * sin(uTime * 2.2 + dot(vLip, vec2(1.3, 0.7))));
  col = wNight(col * wDayLight());

  float alpha = mix(0.62, 0.9, streak);
  alpha = mix(alpha, 0.95, base);
  alpha = mix(alpha, 0.5, lip);

  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

const PAD_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
${WAVE_PARS}

attribute vec2 aPad;
attribute vec3 aTint;
varying vec2 vPad;
varying vec3 vTint;
varying vec2 vPos;

void main() {
  vec3 transformed = position;
  vec4 worldBase = modelMatrix * vec4(position, 1.0);
  transformed.y += wWaveHeight(worldBase.xz) * aPad.y;
  vPad = aPad;
  vTint = aTint;
  vPos = worldBase.xz;
  vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}
`;

const PAD_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
${NOISE_PARS}
${LIGHT_PARS}
uniform float uTime;

varying vec2 vPad;
varying vec3 vTint;
varying vec2 vPos;

void main() {
  #include <logdepthbuf_fragment>
  // Churning whitewater where the curtain lands, with rings rolling outward.
  float r = abs(vPad.x);
  float edge = 1.0 - smoothstep(0.4, 1.0, r);
  float churn = wNoise(vPos * 2.6 + vec2(uTime * 0.9, -uTime * 0.7)) * 0.55 +
    wNoise(vPos * 5.3 - vec2(uTime * 1.3, uTime * 0.4)) * 0.45;
  float rings = 0.5 + 0.5 * sin(r * 10.0 - uTime * 4.5);
  float foam = smoothstep(0.35, 0.62, churn * 0.7 + rings * 0.22 + (1.0 - r) * 0.38) * edge;
  vec3 col = wNight(mix(vec3(1.0, 0.99, 0.96), vTint, 0.12) * wDayLight());

  gl_FragColor = vec4(col, foam * 0.92);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

// ---- Materials ----------------------------------------------------------------------

function sharedUniforms() {
  return {
    // Fog uniforms by reference, so anything the pipeline adds comes along.
    ...THREE.UniformsLib.fog,
    uTime: U.uTime,
    uWindStrength: U.uWindStrength,
    uNight: U.uNight,
    uSunDir: U.uSunDir,
    uSunColor: U.uSunColor,
    uFogColor: U.uFogColor,
    uDepthTex: U.uDepthTex,
    uResolution: U.uResolution,
    uCameraNear: U.uCameraNear,
    uCameraFar: U.uCameraFar,
    uHasDepth: waterUniforms.uHasDepth,
  };
}

function waterMaterial(name, opts) {
  return new THREE.ShaderMaterial({
    name,
    transparent: true,
    depthWrite: false,
    fog: true,
    ...opts,
  });
}

export function createWaterMaterials(maskTexture) {
  return {
    ocean: waterMaterial('WaterOcean', {
      defines: { OCEAN: '' },
      uniforms: { ...sharedUniforms(), uMask: { value: maskTexture } },
      vertexShader: SURFACE_VERT,
      fragmentShader: SURFACE_FRAG,
    }),
    lake: waterMaterial('WaterSurface', {
      uniforms: sharedUniforms(),
      vertexShader: SURFACE_VERT,
      fragmentShader: SURFACE_FRAG,
    }),
    curtain: waterMaterial('WaterfallCurtain', {
      uniforms: sharedUniforms(),
      vertexShader: CURTAIN_VERT,
      fragmentShader: CURTAIN_FRAG,
      side: THREE.DoubleSide,
    }),
    pads: waterMaterial('WaterfallFoam', {
      uniforms: sharedUniforms(),
      vertexShader: PAD_VERT,
      fragmentShader: PAD_FRAG,
      side: THREE.DoubleSide,
    }),
  };
}

// Exposed for tests and debugging.
