// Height fog with sun in-scattering. Importing this module patches three's fog
// shader chunks for every material compiled afterward, so import it before any
// material is created (pipeline.js does this first).
//
// The base is still `scene.fog` (FogExp2 or Fog): it sets fogColor and the
// distance density. On top of that, fog gets denser toward sea level and thins
// with altitude, and its color brightens and warms toward the sun.
//
// Built-in materials need nothing extra. Custom ShaderMaterials need to:
//   1. Set `fog: true`.
//   2. Build uniforms with THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {…}])
//      (or spread FOG_UNIFORMS from this module next to the fog uniforms).
//      three refreshes fogColor and fogDensity only when they exist in
//      `material.uniforms`, and throws if fog is on but fogColor is missing.
//   3. Include fog_pars_vertex, fog_vertex (after `vec4 mvPosition` is set),
//      fog_pars_fragment, and fog_fragment (after gl_FragColor is written).
// A material without the extra uniforms still compiles; it falls back to plain
// distance fog because unset GLSL uniforms read as zero.

import * as THREE from 'three';
import { SEA_Y } from '../core/constants.js';

// Plain objects, not THREE vectors. UniformsUtils.clone and merge deep-copy
// vectors and colors but keep plain objects by reference, so every material
// that clones these uniforms still reads the live values written here.
const sunDir = { x: 0.4, y: 0.8, z: 0.3 }; // Toward the sun, even below the horizon.
const sunGlow = { x: 0, y: 0, z: 0 }; // In-scatter color times strength, linear RGB.
// x = height where the fog is densest, y = falloff per unit of altitude,
// z = extra density at that height, w = unused.
const height = { x: SEA_Y, y: 0.28, z: 0.012, w: 0 };

export const FOG_UNIFORMS = {
  fogSunDir: { value: sunDir },
  fogSunGlow: { value: sunGlow },
  fogHeight: { value: height },
};

// Point the in-scatter glow at the sun. `color` is a THREE.Color in linear space.
export function setFogSun(dir, color, strength = 1) {
  sunDir.x = dir.x;
  sunDir.y = dir.y;
  sunDir.z = dir.z;
  sunGlow.x = color.r * strength;
  sunGlow.y = color.g * strength;
  sunGlow.z = color.b * strength;
}

// Tune the height fog. `density` is the extra fog density at `baseY`.
export function setHeightFog({ density = height.z, falloff = height.y, baseY = height.x } = {}) {
  height.x = baseY;
  height.y = falloff;
  height.z = density;
}

// Shared GLSL for the in-scatter lobe. The sky dome uses the same curve so the
// horizon and the fogged distance meet without a seam.
export const FOG_GLOW_GLSL = /* glsl */ `
float fogGlowLobe( float s ) {
	s = max( s, 0.0 );
	return 0.3 * s * s + 0.7 * pow( s, 10.0 );
}
`;

const fogParsVertex = /* glsl */ `
#ifdef USE_FOG
	varying float vFogDepth;
	varying vec3 vFogWorld;
#endif
`;

// World position from the view-space position. viewMatrix is rigid, so its
// inverse is the transposed rotation applied after removing the translation.
// This works for every vertex shader that defines mvPosition, with or without
// instancing, and doesn't need `transformed` or `worldPosition`.
const fogVertex = /* glsl */ `
#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
	vFogWorld = transpose( mat3( viewMatrix ) ) * ( mvPosition.xyz - viewMatrix[ 3 ].xyz );
#endif
`;

const fogParsFragment = /* glsl */ `
#ifdef USE_FOG
	uniform vec3 fogColor;
	uniform vec3 fogSunDir;
	uniform vec3 fogSunGlow;
	uniform vec4 fogHeight;
	varying float vFogDepth;
	varying vec3 vFogWorld;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif

	${FOG_GLOW_GLSL}

	// Returns the fog amount (0 to 1) and writes the sun-tinted fog color.
	float heightFogFactor( out vec3 fogTintColor ) {
		vec3 ray = vFogWorld - cameraPosition;
		float dist = length( ray );

		#ifdef FOG_EXP2
			float optical = fogDensity * fogDensity * dist * dist;
		#else
			float optical = - log( max( 1.0 - smoothstep( fogNear, fogFar, dist ), 1e-4 ) );
		#endif

		// Exponential height fog integrated along the ray. Using the lower end
		// as the reference keeps every exp() bounded at any camera height.
		float b = max( fogHeight.y, 1e-3 );
		float h0 = max( cameraPosition.y - fogHeight.x, - 2.0 );
		float h1 = max( vFogWorld.y - fogHeight.x, - 2.0 );
		float k = b * abs( h1 - h0 );
		float avg = exp( - b * min( h0, h1 ) ) * ( k > 1e-3 ? ( 1.0 - exp( - k ) ) / k : 1.0 - 0.5 * k );
		optical += fogHeight.z * avg * dist;

		float sun = dot( ray / max( dist, 1e-4 ), fogSunDir );
		fogTintColor = fogColor + fogSunGlow * fogGlowLobe( sun );
		return 1.0 - exp( - optical );
	}
#endif
`;

const fogFragment = /* glsl */ `
#ifdef USE_FOG
	vec3 fogTintColor;
	float fogFactor = heightFogFactor( fogTintColor );
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogTintColor, fogFactor );
#endif
`;

function patch() {
  if (THREE.ShaderChunk.fog_vertex.includes('vFogWorld')) return;

  THREE.ShaderChunk.fog_pars_vertex = fogParsVertex;
  THREE.ShaderChunk.fog_vertex = fogVertex;
  THREE.ShaderChunk.fog_pars_fragment = fogParsFragment;
  THREE.ShaderChunk.fog_fragment = fogFragment;

  // Materials that merge UniformsLib.fog from now on get the extra uniforms.
  Object.assign(THREE.UniformsLib.fog, FOG_UNIFORMS);

  // ShaderLib merged UniformsLib.fog when three loaded, so add them there too.
  // Built-in materials clone these per material; the values stay shared.
  for (const lib of Object.values(THREE.ShaderLib)) {
    if (lib.uniforms && 'fogColor' in lib.uniforms) Object.assign(lib.uniforms, FOG_UNIFORMS);
  }
}

patch();
