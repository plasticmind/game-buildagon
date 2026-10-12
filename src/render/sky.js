// Day/night cycle: sky dome, sun and moon, stars, clouds, lights, and fog.
//
// Time runs in hours (0-24). The sun rises at 6:00 and sets at 18:00 on a
// tilted path, so mornings and evenings cast long shadows. One DirectionalLight
// is the sun by day and a dim bluish moon by night; it fades through zero at
// the horizon, so the switch never pops.

import * as THREE from 'three';
import { U, LAYERS } from './shared.js';
import { setFogSun, setHeightFog, FOG_GLOW_GLSL } from './fog.js';
import { toon } from './materials.js';
import { smoothstep as smooth } from '../core/math.js';

const SUNRISE = 6;
const SUNSET = 18;
const SUN_TILT = THREE.MathUtils.degToRad(32); // Noon elevation is 90 - 32 = 58 degrees.
const SUN_YAW = THREE.MathUtils.degToRad(40); // Shadows fall diagonally across hex rows.

const DOME_R = 500;
const STAR_R = 470;
const STAR_COUNT = 750;
const CLOUD_COUNT = 18;
const CLOUD_HALF = 300; // Clouds wrap within this distance of the camera.

const SHADOW_HALF = 40; // Orthographic shadow box half-size around the focus.
const LIGHT_DIST = 120;
const MOON_COLOR = new THREE.Color('#a8bcff');
const MOON_I = 0.9;
const SUN_DISC_HDR = 9; // Sun disc brightness, well past the bloom threshold.
const MOON_DISC_HDR = 2.2;

// Keyframed palettes. Colors are sRGB hex; they're converted to linear once.
// glowK scales the sun in-scatter glow in fog and sky. fog is FogExp2 density;
// mist is extra height-fog density at sea level.
const NIGHT = {
  zenith: '#0a1230', mid: '#14204a', horizon: '#27355f', glow: '#000000', glowK: 0,
  hemiSky: '#6277b8', hemiGround: '#2a2c48', hemiI: 1.3,
  sun: '#ffb49a', sunI: 0, cloud: '#1a2242', fog: 0.0044, mist: 0.0121,
};

const KEYS = [
  { t: 0, ...NIGHT },
  { t: 4.5, ...NIGHT },
  { // Pre-dawn: indigo with a mauve horizon.
    t: 5.3, zenith: '#1a2152', mid: '#3c3a78', horizon: '#9a7aa6', glow: '#ff9a8a', glowK: 0.25,
    hemiSky: '#7072a8', hemiGround: '#383248', hemiI: 0.9,
    sun: '#ffb49a', sunI: 1.8, cloud: '#3a3560', fog: 0.0048, mist: 0.0165,
  },
  { // Dawn: peach and pink.
    t: 6.25, zenith: '#87a6d8', mid: '#e2b5c9', horizon: '#ffd0b0', glow: '#ffa070', glowK: 0.9,
    hemiSky: '#d2bcd6', hemiGround: '#957d72', hemiI: 1.05,
    sun: '#ffbf94', sunI: 2.3, cloud: '#b89aac', fog: 0.0046, mist: 0.0198,
  },
  { // Morning: fresh, slightly misty.
    t: 7.75, zenith: '#7ab4e8', mid: '#a8d2f0', horizon: '#e6eff0', glow: '#ffe0bc', glowK: 0.5,
    hemiSky: '#cfe5f7', hemiGround: '#ab9a7e', hemiI: 1.15,
    sun: '#ffe9cc', sunI: 2.4, cloud: '#9fb3c9', fog: 0.0038, mist: 0.0132,
  },
  { // Noon: soft clear blue.
    t: 11.5, zenith: '#68ade9', mid: '#9dcff2', horizon: '#d8edf6', glow: '#fff3dc', glowK: 0.35,
    hemiSky: '#d8ecff', hemiGround: '#b5a386', hemiI: 1.25,
    sun: '#fff7ea', sunI: 2.5, cloud: '#a9bfd4', fog: 0.0034, mist: 0.0060,
  },
  { // Afternoon.
    t: 15.5, zenith: '#6eaae4', mid: '#a2cfee', horizon: '#e3edef', glow: '#ffe6c2', glowK: 0.45,
    hemiSky: '#d6e8fa', hemiGround: '#b3a083', hemiI: 1.2,
    sun: '#fff0d8', sunI: 2.45, cloud: '#a8bad0', fog: 0.0035, mist: 0.0072,
  },
  { // Golden hour.
    t: 17.1, zenith: '#7da2d6', mid: '#dcc4c6', horizon: '#ffdcaa', glow: '#ffb26a', glowK: 1.0,
    hemiSky: '#e6d0bc', hemiGround: '#a98667', hemiI: 1.05,
    sun: '#ffc98c', sunI: 2.6, cloud: '#c8a6a0', fog: 0.0038, mist: 0.0099,
  },
  { // Sunset: orange horizon.
    t: 18, zenith: '#6474b4', mid: '#e8a4a4', horizon: '#ffb47c', glow: '#ff8c52', glowK: 1.2,
    hemiSky: '#d9a9ae', hemiGround: '#7d5f63', hemiI: 0.95,
    sun: '#ffa070', sunI: 2.2, cloud: '#c08890', fog: 0.0042, mist: 0.0116,
  },
  { // Dusk: orange fading into lavender.
    t: 18.75, zenith: '#444c8c', mid: '#a582b4', horizon: '#f2a592', glow: '#e8806c', glowK: 0.6,
    hemiSky: '#9e8cbc', hemiGround: '#4e4560', hemiI: 0.9,
    sun: '#ffa070', sunI: 0, cloud: '#6e5a82', fog: 0.0044, mist: 0.0127,
  },
  { // Twilight.
    t: 19.6, zenith: '#1f2758', mid: '#463f80', horizon: '#8a70a4', glow: '#7a4a78', glowK: 0.25,
    hemiSky: '#6b6fac', hemiGround: '#302c4a', hemiI: 1.1,
    sun: '#ffb49a', sunI: 0, cloud: '#2e2d55', fog: 0.0045, mist: 0.0127,
  },
  { t: 20.6, ...NIGHT },
  { t: 24, ...NIGHT },
];

const COLOR_KEYS = ['zenith', 'mid', 'horizon', 'glow', 'hemiSky', 'hemiGround', 'sun', 'cloud'];
const NUMBER_KEYS = ['glowK', 'hemiI', 'sunI', 'fog', 'mist'];

for (const k of KEYS) for (const c of COLOR_KEYS) k[c] = new THREE.Color(k[c]);

function makePalette() {
  const p = {};
  for (const c of COLOR_KEYS) p[c] = new THREE.Color();
  for (const n of NUMBER_KEYS) p[n] = 0;
  return p;
}

// Smoothstep that also accepts reversed edges.
function lerpPalette(hours, out) {
  let i = 0;
  while (i < KEYS.length - 2 && hours >= KEYS[i + 1].t) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const f = smooth(0, 1, (hours - a.t) / (b.t - a.t));
  for (const c of COLOR_KEYS) out[c].copy(a[c]).lerp(b[c], f);
  for (const n of NUMBER_KEYS) out[n] = a[n] + (b[n] - a[n]) * f;
  return out;
}

// Direction toward the sun. Below the horizon outside 6:00-18:00.
function sunDirection(hours, out) {
  const theta = ((hours - SUNRISE) / (SUNSET - SUNRISE)) * Math.PI;
  const x = Math.cos(theta);
  const s = Math.sin(theta);
  const y = s * Math.cos(SUN_TILT);
  const z = s * Math.sin(SUN_TILT);
  const cy = Math.cos(SUN_YAW);
  const sy = Math.sin(SUN_YAW);
  return out.set(x * cy + z * sy, y, -x * sy + z * cy).normalize();
}

const DOME_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;

const DOME_FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uMid;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunGlow;
uniform vec3 uSunDisc;
uniform vec3 uMoonDir;
uniform vec3 uMoonColor;
varying vec3 vDir;

${FOG_GLOW_GLSL}

void main() {
  vec3 d = normalize( vDir );
  float y = d.y;

  // Three-stop gradient. At and below the horizon it equals the fog color,
  // so fogged terrain melts into the sky.
  float t = sqrt( clamp( y, 0.0, 1.0 ) );
  vec3 col = mix( uHorizon, uMid, smoothstep( 0.0, 0.45, t ) );
  col = mix( col, uZenith, smoothstep( 0.35, 1.0, t ) );

  // Sun glow: the same lobe the fog uses, strongest near the horizon.
  float horizonW = 1.0 - 0.65 * smoothstep( 0.0, 0.7, y );
  col += uSunGlow * fogGlowLobe( dot( d, uSunDir ) ) * horizonW;

  float above = smoothstep( -0.015, 0.01, y );

  // Sun disc and halo. Chord length approximates the angle and stays precise.
  float sa = length( d - uSunDir );
  float disc = 1.0 - smoothstep( 0.032, 0.038, sa );
  float halo = exp( - sa * 14.0 ) * 0.1 + exp( - sa * 45.0 ) * 0.25;
  col += uSunDisc * ( disc + halo ) * above;

  // Moon disc with a little limb shading and a faint halo.
  float ma = length( d - uMoonDir );
  float r = clamp( ma / 0.028, 0.0, 1.0 );
  float mdisc = ( 1.0 - smoothstep( 0.024, 0.028, ma ) ) * ( 0.8 + 0.2 * sqrt( 1.0 - r * r ) );
  float mhalo = exp( - ma * 9.0 ) * 0.07;
  col += uMoonColor * ( mdisc + mhalo ) * above;

  gl_FragColor = vec4( col, 1.0 );
}
`;

const STAR_VERT = /* glsl */ `
attribute float aSize;
attribute float aPhase;
attribute vec3 aColor;
uniform float uTime;
uniform float uVisible;
uniform float uPixelRatio;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4( position, 1.0 );
  gl_Position = projectionMatrix * mv;
  float speed = 1.1 + fract( aPhase * 7.13 ) * 2.6;
  float twinkle = 0.6 + 0.4 * sin( uTime * speed + aPhase * 6.2831 );
  vAlpha = uVisible * twinkle * smoothstep( 0.02, 0.18, normalize( position ).y );
  vColor = aColor;
  gl_PointSize = aSize * uPixelRatio;
}
`;

const STAR_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float a = 1.0 - smoothstep( 0.0, 1.0, dot( p, p ) );
  gl_FragColor = vec4( vColor * a * a * vAlpha, 1.0 );
}
`;

export class Sky {
  constructor(scene, pipeline) {
    this.scene = scene;
    this.pipeline = pipeline;
    this._time = 10;
    this.dayLengthMinutes = 14;
    this.paused = false;

    this.palette = makePalette();
    this.sunDir = new THREE.Vector3();
    this.moonDir = new THREE.Vector3();
    this.lightDir = new THREE.Vector3(0, 1, 0);
    this.golden = 0;

    this._center = new THREE.Vector3();
    this._x = new THREE.Vector3();
    this._y = new THREE.Vector3();
    this._fallbackFocus = new THREE.Vector3();
    this._camPos = new THREE.Vector3();
    this._white = new THREE.Color(1, 1, 1);
    this._starSpin = 0;

    this._buildLights();
    this._buildDome();
    this._buildStars();
    this._buildClouds();

    this._apply(); // Valid lighting before the first update.
  }

  get time() {
    return this._time;
  }

  set time(h) {
    const v = Number(h);
    if (!Number.isFinite(v)) return;
    this._time = ((v % 24) + 24) % 24;
  }

  update(dt, camera, focus) {
    if (!this.paused && this.dayLengthMinutes > 0) {
      this.time = this._time + (dt * 24) / (this.dayLengthMinutes * 60);
    }
    this._apply();

    if (camera) camera.getWorldPosition(this._camPos);
    this._updateStars(dt);
    this._updateClouds(dt);

    let f = focus;
    if (!f && camera) {
      // No focus given: aim 30 units ahead of the camera.
      f = this._fallbackFocus.set(0, 0, -1).applyQuaternion(camera.quaternion).multiplyScalar(30).add(this._camPos);
    }
    this._updateShadowCamera(f ?? this._fallbackFocus);
  }

  // ---- Per-frame state ------------------------------------------------------

  _apply() {
    const p = lerpPalette(this._time, this.palette);
    const sun = sunDirection(this._time, this.sunDir);
    const moon = this.moonDir.copy(sun).negate();

    // 0 = day, 1 = night, smooth through dusk and dawn.
    const night = 1 - smooth(-0.28, 0.1, sun.y);
    U.uNight.value = night;
    // Low sun, morning or evening.
    this.golden = smooth(0.5, 0.12, sun.y) * smooth(-0.1, 0.05, sun.y);

    // Directional light: sun above the horizon, moon below. Both fade to zero
    // at the horizon, so the swap is invisible.
    const light = this.light;
    let intensity;
    if (sun.y >= 0) {
      this.lightDir.copy(sun);
      light.color.copy(p.sun);
      intensity = p.sunI * smooth(0, 0.1, sun.y);
      light.shadow.intensity = THREE.MathUtils.lerp(0.72, 0.6, this.golden);
    } else {
      this.lightDir.copy(moon);
      light.color.copy(MOON_COLOR);
      intensity = MOON_I * smooth(0, 0.12, moon.y);
      light.shadow.intensity = 0.5;
    }
    // Keep the light visible even at zero intensity: hiding it would change the
    // light count and swap every material's program at dawn and dusk.
    light.intensity = intensity;

    const noonI = 2.5;
    U.uSunDir.value.copy(this.lightDir);
    U.uSunColor.value.copy(light.color).multiplyScalar(intensity / noonI);

    this.hemi.color.copy(p.hemiSky);
    this.hemi.groundColor.copy(p.hemiGround);
    this.hemi.intensity = p.hemiI;

    // Fog: horizon color, so the far distance blends into the dome.
    const fog = this.scene.fog;
    if (fog) {
      fog.color.copy(p.horizon);
      if (fog.isFogExp2) fog.density = p.fog;
    }
    U.uFogColor.value.copy(p.horizon);
    setHeightFog({ density: p.mist });
    setFogSun(sun, p.glow, p.glowK);

    // Dome. The glow mirrors the fog's in-scatter color.
    const du = this.domeUniforms;
    du.uSunGlow.value.copy(p.glow).multiplyScalar(p.glowK);
    du.uSunDisc.value.copy(p.sun).multiplyScalar(SUN_DISC_HDR * smooth(-0.06, 0.02, sun.y));
    du.uMoonColor.value.copy(MOON_COLOR).lerp(this._white, 0.55).multiplyScalar(MOON_DISC_HDR * smooth(0.35, 0.8, night));

    // Clouds take a soft ambient fill from the palette.
    this.cloudMaterial.emissive.copy(p.cloud).multiplyScalar(0.25);

    if (this.pipeline?.gradeUniforms) this.pipeline.gradeUniforms.uGolden.value = this.golden * (1 - night);
  }

  _updateShadowCamera(focus) {
    const light = this.light;
    const shadow = light.shadow;

    // Quality settings come from the pipeline.
    const mapSize = this.pipeline?.shadowMapSize ?? 2048;
    if (shadow.mapSize.x !== mapSize) shadow.mapSize.set(mapSize, mapSize);
    const baseRadius = this.pipeline?.shadowRadius ?? 2.5;
    shadow.radius = baseRadius * (1 + 0.6 * this.golden);

    // Normal offset in shadow texels: grazing light needs more to avoid acne
    // on the flat-shaded hex tops.
    const texel = (2 * SHADOW_HALF) / mapSize;
    const elev = Math.max(0, this.lightDir.y);
    shadow.normalBias = Math.max(0.025, texel * THREE.MathUtils.lerp(2.2, 1.0, smooth(0.1, 0.7, elev)));

    // Snap the center to whole shadow texels in light space so shadows don't
    // shimmer as the camera moves. Axes match three's lookAt for the shadow camera.
    const z = this.lightDir;
    const x = this._x.crossVectors(THREE.Object3D.DEFAULT_UP, z).normalize();
    const y = this._y.crossVectors(z, x);
    const cx = focus.dot(x);
    const cy = focus.dot(y);
    const c = this._center
      .copy(focus)
      .addScaledVector(x, Math.round(cx / texel) * texel - cx)
      .addScaledVector(y, Math.round(cy / texel) * texel - cy);

    light.target.position.copy(c);
    light.position.copy(c).addScaledVector(z, LIGHT_DIST);
  }

  // ---- Builders -------------------------------------------------------------

  _buildLights() {
    this.hemi = new THREE.HemisphereLight('#d8ecff', '#b5a386', 1.2);
    this.hemi.position.set(0, 1, 0);

    const light = new THREE.DirectionalLight('#fff7ea', 2.5);
    light.castShadow = true;
    const cam = light.shadow.camera;
    cam.left = -SHADOW_HALF;
    cam.right = SHADOW_HALF;
    cam.top = SHADOW_HALF;
    cam.bottom = -SHADOW_HALF;
    cam.near = 1;
    cam.far = LIGHT_DIST + 140;
    cam.updateProjectionMatrix();
    light.shadow.mapSize.set(2048, 2048);
    light.shadow.bias = -0.00012;
    light.shadow.normalBias = 0.04;
    light.shadow.radius = 2.5;
    light.shadow.intensity = 0.72;
    this.light = light;

    // Lights stay on layer 0.
    this.scene.add(this.hemi, light, light.target);
  }

  _buildDome() {
    const p = this.palette;
    this.domeUniforms = {
      uZenith: { value: p.zenith },
      uMid: { value: p.mid },
      uHorizon: { value: p.horizon },
      uSunDir: { value: this.sunDir },
      uSunGlow: { value: new THREE.Color() },
      uSunDisc: { value: new THREE.Color() },
      uMoonDir: { value: this.moonDir },
      uMoonColor: { value: new THREE.Color() },
    };

    const mat = new THREE.ShaderMaterial({
      name: 'SkyDome',
      uniforms: this.domeUniforms,
      vertexShader: DOME_VERT,
      fragmentShader: DOME_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(DOME_R, 48, 24), mat);
    dome.name = 'SkyDome';
    dome.layers.set(LAYERS.FX);
    dome.frustumCulled = false;
    dome.renderOrder = 1000; // Last among opaques, so terrain occludes it early.
    dome.matrixAutoUpdate = false;
    dome.onBeforeRender = (renderer, scene, camera) => followCamera(dome, camera);
    this.dome = dome;
    this.scene.add(dome);
  }

  _buildStars() {
    const pos = new Float32Array(STAR_COUNT * 3);
    const size = new Float32Array(STAR_COUNT);
    const phase = new Float32Array(STAR_COUNT);
    const color = new Float32Array(STAR_COUNT * 3);
    const tints = [new THREE.Color('#ffffff'), new THREE.Color('#cfdcff'), new THREE.Color('#fff1d0')];
    const v = new THREE.Vector3();
    for (let i = 0; i < STAR_COUNT; i++) {
      // Uniform on the upper hemisphere, a little denser overhead.
      const y = Math.pow(Math.random(), 0.8) * 0.97 + 0.03;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - y * y);
      v.set(Math.cos(a) * r, y, Math.sin(a) * r).multiplyScalar(STAR_R);
      v.toArray(pos, i * 3);
      const bright = Math.random();
      size[i] = 1.2 + Math.pow(bright, 3) * 2.4;
      phase[i] = Math.random();
      const c = tints[i % 3];
      const k = 0.55 + bright * 0.75;
      color[i * 3] = c.r * k;
      color[i * 3 + 1] = c.g * k;
      color[i * 3 + 2] = c.b * k;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(color, 3));

    this.starUniforms = {
      uTime: U.uTime,
      uVisible: { value: 0 },
      uPixelRatio: { value: 1 },
    };
    const mat = new THREE.ShaderMaterial({
      name: 'SkyStars',
      uniforms: this.starUniforms,
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    const stars = new THREE.Points(geo, mat);
    stars.name = 'SkyStars';
    stars.layers.set(LAYERS.FX);
    stars.frustumCulled = false;
    stars.renderOrder = -100;
    stars.matrixAutoUpdate = false;
    stars.onBeforeRender = (renderer, scene, camera) => followCamera(stars, camera, this._starSpin);
    this.stars = stars;
    this.scene.add(stars);
  }

  _updateStars() {
    const night = U.uNight.value;
    this.starUniforms.uVisible.value = smooth(0.55, 0.95, night);
    this.stars.visible = night > 0.5;
    // The sky turns slowly over the night.
    this._starSpin = (this._time / 24) * Math.PI * 2;
    this.starUniforms.uPixelRatio.value = this.pipeline?.renderer?.getPixelRatio() ?? 1;
  }

  _buildClouds() {
    const puffs = [];
    this.clouds = [];
    for (let i = 0; i < CLOUD_COUNT; i++) {
      const cloud = {
        x: (Math.random() * 2 - 1) * CLOUD_HALF,
        z: (Math.random() * 2 - 1) * CLOUD_HALF,
        y: 58 + Math.random() * 28,
        speed: 0.75 + Math.random() * 0.5,
        start: puffs.length,
        count: 0,
      };
      const scale = 1 + Math.random() * 0.9;
      const yaw = Math.random() * Math.PI * 2;
      const n = 4 + Math.floor(Math.random() * 4);
      const q = new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
      for (let j = 0; j < n; j++) {
        const u = n === 1 ? 0 : j / (n - 1) - 0.5; // -0.5..0.5 along the cloud
        const mid = 1 - Math.abs(u) * 1.2; // Bigger puffs in the middle.
        const r = (2.6 + mid * 3.2 + Math.random() * 1.2) * scale;
        const sy = r * 0.62;
        const offset = new THREE.Vector3(
          u * 9 * scale + (Math.random() - 0.5) * 2,
          sy - 1.6 * scale + Math.random() * 0.4, // Bottoms line up; big puffs tower.
          (Math.random() - 0.5) * 4 * scale,
        ).applyQuaternion(q);
        const m = new THREE.Matrix4().compose(
          offset,
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.random() * Math.PI, 0)),
          new THREE.Vector3(r * (1.1 + Math.random() * 0.3), sy, r * (0.95 + Math.random() * 0.3)),
        );
        puffs.push(m);
        cloud.count++;
      }
      this.clouds.push(cloud);
    }

    this.cloudLocal = puffs;
    // Slightly off-white so sunlit tops stay under the bloom threshold.
    this.cloudMaterial = toon({ color: '#e9edf3', vertexColors: false });
    const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), this.cloudMaterial, puffs.length);
    mesh.name = 'SkyClouds';
    mesh.layers.set(LAYERS.FX);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.cloudMesh = mesh;
    this.cloudDrift = new THREE.Vector2();
    this._cloudMatrix = new THREE.Matrix4();
    this.scene.add(mesh);
    this._updateClouds(0);
  }

  _updateClouds(dt) {
    const wind = U.uWindDir.value;
    const speed = 1.2 + U.uWindStrength.value * 1.6;
    this.cloudDrift.x += wind.x * speed * dt;
    this.cloudDrift.y += wind.y * speed * dt;

    const cam = this._camPos;
    const m = this._cloudMatrix;
    const e = m.elements;
    const size = CLOUD_HALF * 2;
    for (const c of this.clouds) {
      const dx = wrap(c.x + this.cloudDrift.x * c.speed - cam.x, size);
      const dz = wrap(c.z + this.cloudDrift.y * c.speed - cam.z, size);
      // Shrink clouds near the wrap edge so they never pop when they jump sides.
      const k = 1 - smooth(0.8, 1, Math.max(Math.abs(dx), Math.abs(dz)) / CLOUD_HALF);
      for (let i = 0; i < c.count; i++) {
        m.copy(this.cloudLocal[c.start + i]);
        for (let j = 0; j < 15; j++) if (j % 4 !== 3) e[j] *= k;
        e[12] += cam.x + dx;
        e[13] += c.y;
        e[14] += cam.z + dz;
        this.cloudMesh.setMatrixAt(c.start + i, m);
      }
    }
    this.cloudMesh.instanceMatrix.needsUpdate = true;
  }
}

// Wrap v into [-size / 2, size / 2).
function wrap(v, size) {
  return ((((v + size / 2) % size) + size) % size) - size / 2;
}

// Center an object on the camera at draw time, so it never lags a frame.
function followCamera(object, camera, spin = 0) {
  object.position.setFromMatrixPosition(camera.matrixWorld);
  object.rotation.set(0, spin, 0);
  object.updateMatrix();
  object.matrixWorld.copy(object.matrix);
}
