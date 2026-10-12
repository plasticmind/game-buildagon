// Pooled particle system: one THREE.Points draw call, simulated on the CPU.
//
// One-shot effects: puff (placement dust), splash, leaves, sparkle.
// Emitters: 'mist' (waterfall bases), 'smoke' (chimneys, campfires), 'sparks'.
// Ambient: fireflies at night and faint pollen motes by day, around the view.
//
// Soft round sprites use premultiplied alpha, so one material blends normal
// particles over the scene and adds glowing ones (embers, sparkles, fireflies)
// on top. Glowing particles go past 1.0 for bloom and don't dim at night.
// Sprites fade where they touch the WORLD depth (soft particles).
//
// Ambient fireflies and motes need the ground height. Set
// `particles.groundAt = (x, z) => y` to place them above the terrain; without
// it they hover a little above sea level.

import * as THREE from 'three';
import '../render/fog.js';
import { U, LAYERS } from '../render/shared.js';
import { PALETTE } from '../core/constants.js';
import { smoothstep as smooth } from '../core/math.js';

const CAPACITY = 3000;
const FIREFLIES = 64;
const MOTES = 48;
const POOL = CAPACITY - FIREFLIES - MOTES;
const TAU = Math.PI * 2;
const EMITTER_RANGE = 140; // Emitters farther than this from the camera pause.

// Sprite shapes, read by the fragment shader.
const PUFF = 0;
const DOT = 1;
const LEAF = 2;
const STAR = 3;
const GLOW = 4;

// Particle kinds. grav is vertical acceleration (positive rises), drag damps
// velocity per second, wind is how hard the wind pushes, wob is sideways
// wander, fin and fout are where the fade-in ends and the fade-out starts (as
// fractions of life), soft is the puff edge (lower is softer), and glow marks
// additive particles that skip the night dimming.
const DUST = 0;
const FOAM = 1;
const DROP = 2;
const LEAFY = 3;
const SPARKLE = 4;
const MIST = 5;
const SMOKE = 6;
const EMBER = 7;

const KINDS = [
  { shape: PUFF, grav: 0.35, drag: 3.2, wind: 0.25, wob: 0, fin: 0.08, fout: 0.2, soft: 0.45, glow: 0 }, // Dust
  { shape: PUFF, grav: 0.0, drag: 3.4, wind: 0.1, wob: 0, fin: 0.05, fout: 0.3, soft: 0.4, glow: 0 }, // Foam
  { shape: DOT, grav: -11, drag: 0.4, wind: 0.05, wob: 0, fin: 0.0, fout: 0.85, soft: 0, glow: 0, floor: true }, // Drop
  { shape: LEAF, grav: -2.2, drag: 1.6, wind: 0.9, wob: 1.2, fin: 0.06, fout: 0.75, soft: 0, glow: 0 }, // Leaf
  { shape: STAR, grav: 0.4, drag: 2.0, wind: 0.0, wob: 0, fin: 0.1, fout: 0.55, soft: 0, glow: 1 }, // Sparkle
  { shape: PUFF, grav: 0.25, drag: 1.2, wind: 0.5, wob: 0.3, fin: 0.15, fout: 0.35, soft: 0.1, glow: 0 }, // Mist
  { shape: PUFF, grav: 0.35, drag: 0.6, wind: 0.8, wob: 0.25, fin: 0.12, fout: 0.35, soft: 0.15, glow: 0 }, // Smoke
  { shape: GLOW, grav: 0.9, drag: 0.8, wind: 0.6, wob: 0.8, fin: 0.05, fout: 0.45, soft: 0, glow: 1 }, // Ember
];

const EMITTER_DEFAULTS = {
  mist: { rate: 10, radius: 1.2, size: 1, color: '#f4f9ff' },
  smoke: { rate: 3.5, radius: 0.15, size: 1, color: '#d9d5d1' },
  sparks: { rate: 7, radius: 0.25, size: 1, color: '#ffb35c' },
};

const DUST_COLOR = new THREE.Color('#ead9bb');
const CREAM = new THREE.Color('#f8f1e3');
const WHITE = new THREE.Color('#ffffff');
const DROP_COLOR = new THREE.Color('#eaf6ff');
const LEAF_COLOR = new THREE.Color(PALETTE.leafGreen);
const SPARKLE_COLOR = new THREE.Color('#fff2a8');
const EMBER_HOT = new THREE.Color('#ffd27a');
// Ambient particles wander around a field centered where the view meets the
// ground. lift0 and lift1 bound the height above ground.
const FIREFLY_CFG = {
  radius: 22, lift0: 0.5, lift1: 2.4, wander: 1, size: 0.16,
  color: new THREE.Color('#e4ff7a'),
  // Slow, uneven blinks that peak well past 1.0 for bloom.
  glow: (f, time) => 2.8 * Math.pow(Math.max(0, Math.sin(time * f.blink + f.p3)), 3) + 0.15,
};
const MOTE_CFG = {
  radius: 16, lift0: 0.4, lift1: 4, wander: 0.5, size: 0.06,
  color: new THREE.Color('#fff6dc'),
  // Mostly faint, with an occasional glint as a mote catches the light.
  glow: (f, time) => 0.6 + 0.9 * Math.pow(Math.max(0, Math.sin(time * f.blink * 1.7 + f.p3)), 12),
};

const VERT = /* glsl */ `
attribute vec4 aColor;
attribute float aSize;
attribute vec4 aParams; // shape, rotation, squash or edge softness, glow
uniform float uScale;
uniform float uNight;
varying vec4 vColor;
varying vec4 vParams;
varying float vViewZ;
varying float vSoft;
#include <fog_pars_vertex>

void main() {
  vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
  gl_Position = projectionMatrix * mvPosition;
  float px = aSize * uScale / max( - mvPosition.z, 0.1 );
  gl_PointSize = clamp( px, 1.5, 384.0 );
  vec4 color = aColor;
  color.a *= clamp( px / 1.5, 0.0, 1.0 ); // Fade sub-pixel sprites instead of flickering.
  // Unlit particles dim and cool at night; glowing ones keep their color.
  color.rgb *= mix( vec3( 1.0 ), vec3( 0.36, 0.4, 0.56 ), uNight * ( 1.0 - aParams.w ) );
  vColor = color;
  vParams = aParams;
  vViewZ = - mvPosition.z;
  vSoft = max( aSize * 0.35, 0.05 );
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uDepthTex;
uniform vec2 uResolution;
uniform float uCameraNear;
uniform float uCameraFar;
varying vec4 vColor;
varying vec4 vParams;
varying float vViewZ;
varying float vSoft;
#include <common>
#include <packing>
#include <fog_pars_fragment>

void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  p.y = - p.y;
  float shape = vParams.x;
  float c = cos( vParams.y );
  float s = sin( vParams.y );
  vec2 q = mat2( c, s, - s, c ) * p;
  float r = length( p );
  float a;
  float shade = 1.0;

  if ( shape < 0.5 ) {
    // Soft puff, a little brighter on top.
    a = 1.0 - smoothstep( vParams.z, 1.0, r );
    shade = mix( 0.84, 1.06, smoothstep( - 0.7, 0.7, p.y + p.x * 0.25 ) );
  } else if ( shape < 1.5 ) {
    // Droplet with a small highlight.
    a = 1.0 - smoothstep( 0.6, 1.0, r );
    shade = 1.0 + 0.3 * ( 1.0 - smoothstep( 0.0, 0.45, length( p - vec2( - 0.3, 0.35 ) ) ) );
  } else if ( shape < 2.5 ) {
    // Leaf: a pointed almond with a midrib. Squash fakes the tumble.
    float sq = vParams.z;
    q.x /= max( abs( sq ), 0.12 );
    float d = max( length( q - vec2( 0.55, 0.0 ) ), length( q + vec2( 0.55, 0.0 ) ) );
    a = 1.0 - smoothstep( 0.9, 1.0, d );
    float rib = ( 1.0 - smoothstep( 0.03, 0.09, abs( q.x ) ) ) * step( abs( q.y ), 0.72 );
    shade = ( 1.0 - 0.22 * rib ) * ( sq < 0.0 ? 0.8 : 1.0 );
  } else if ( shape < 3.5 ) {
    // Four-point sparkle.
    float rq = length( q );
    float rays = max( exp( - abs( q.y ) * 16.0 ) * ( 1.0 - abs( q.x ) ), exp( - abs( q.x ) * 16.0 ) * ( 1.0 - abs( q.y ) ) );
    a = clamp( rays + exp( - rq * rq * 18.0 ), 0.0, 1.0 ) * ( 1.0 - smoothstep( 0.85, 1.0, rq ) );
    shade = 1.0 + exp( - rq * rq * 30.0 );
  } else {
    // Glow dot: hot core and a soft halo.
    float r2 = r * r;
    a = ( exp( - r2 * 10.0 ) + 0.35 * exp( - r2 * 3.0 ) ) * ( 1.0 - smoothstep( 0.7, 1.0, r2 ) );
    shade = 1.0 + exp( - r2 * 24.0 );
  }

  // Soft particles: fade where the sprite meets opaque world geometry.
  float depth = texture2D( uDepthTex, gl_FragCoord.xy / uResolution ).x;
  float sceneZ = - perspectiveDepthToViewZ( depth, uCameraNear, uCameraFar );
  a *= clamp( ( sceneZ - vViewZ ) / vSoft, 0.0, 1.0 );

  float alpha = vColor.a * clamp( a, 0.0, 1.0 );
  if ( alpha < 0.003 ) discard;

  vec3 col = vColor.rgb * shade;
  gl_FragColor = vec4( col, alpha );
  #include <fog_fragment>
  #ifdef USE_FOG
    // Glowing particles fade out in fog instead of tinting toward it.
    gl_FragColor.rgb = mix( gl_FragColor.rgb, col * ( 1.0 - fogFactor ), vParams.w );
  #endif

  // Premultiplied: alpha 0 adds (glow), alpha > 0 blends normally.
  gl_FragColor.rgb *= alpha;
  gl_FragColor.a = alpha * ( 1.0 - vParams.w );
}
`;

const rand = (a, b) => a + Math.random() * (b - a);

export class Particles {
  constructor(scene) {
    this.scene = scene;
    this.count = 0;
    this.groundAt = null; // Optional (x, z) => ground height, for ambient particles.

    // Simulation state, one entry per live particle in [0, count).
    const f = () => new Float32Array(POOL);
    this.s = {
      kind: new Uint8Array(POOL),
      px: f(), py: f(), pz: f(),
      vx: f(), vy: f(), vz: f(),
      age: f(), life: f(),
      size0: f(), size1: f(),
      r: f(), g: f(), b: f(), alpha: f(), glow: f(),
      rot: f(), spin: f(), tumble: f(), phase: f(), floor: f(),
    };
    this._arrays = Object.values(this.s);

    // GPU buffers sized for the pool plus the ambient particles.
    this.geometry = new THREE.BufferGeometry();
    this._pos = this._attr('position', 3);
    this._col = this._attr('aColor', 4);
    this._size = this._attr('aSize', 1);
    this._params = this._attr('aParams', 4);
    this._attrs = [this._pos, this._col, this._size, this._params];
    this.geometry.setDrawRange(0, 0);

    this.uniforms = {
      ...THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
      uScale: { value: 800 },
      uNight: U.uNight,
      uDepthTex: U.uDepthTex,
      uResolution: U.uResolution,
      uCameraNear: U.uCameraNear,
      uCameraFar: U.uCameraFar,
    };
    this.material = new THREE.ShaderMaterial({
      name: 'Particles',
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.name = 'Particles';
    this.points.layers.set(LAYERS.FX);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10; // After water, so splashes and mist sit on top.
    this.points.castShadow = false;
    this.points.receiveShadow = false;
    scene.add(this.points);

    this.emitters = new Map();
    this._nextHandle = 1;

    this._fireflies = this._makeAmbient(FIREFLIES);
    this._motes = this._makeAmbient(MOTES);
    this._center = new THREE.Vector3();
    this._camPos = new THREE.Vector3();
    this._camDir = new THREE.Vector3();
    this._damp = new Float32Array(KINDS.length);
    this._c = new THREE.Color();
    this._c2 = new THREE.Color();
  }

  // ---- One-shot effects -----------------------------------------------------

  // Placement dust: a soft ring of cream puffs that spreads, rises, and fades.
  puff(pos, { color, count = 14, radius = 1, size = 1 } = {}) {
    const base = color !== undefined ? this._c2.set(color).lerp(CREAM, 0.45) : DUST_COLOR;
    const c = this._c;
    const spread = 0.6 + radius * 0.4;
    const n = Math.max(1, Math.round(count));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rand(-0.25, 0.25);
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const r0 = radius * rand(0.55, 0.8);
      const sp = rand(1.6, 2.8) * spread;
      const s0 = size * rand(0.45, 0.65) * (0.7 + radius * 0.3);
      c.copy(base).lerp(CREAM, rand(0, 0.5)).multiplyScalar(rand(0.95, 1.05));
      this._add(DUST, pos.x + ca * r0, pos.y + rand(0.05, 0.2), pos.z + sa * r0,
        ca * sp, rand(0.4, 1.0), sa * sp, rand(0.75, 1.2), s0, s0 * 2.2, c, 0.85);
    }
    // A few smaller puffs rising from the middle.
    for (let i = 0; i < Math.ceil(n / 4); i++) {
      const a = rand(0, TAU);
      const s0 = size * rand(0.35, 0.5) * (0.7 + radius * 0.3);
      c.copy(base).lerp(CREAM, rand(0.2, 0.6));
      this._add(DUST, pos.x + Math.cos(a) * radius * 0.3, pos.y + 0.15, pos.z + Math.sin(a) * radius * 0.3,
        Math.cos(a) * 0.5, rand(1.0, 1.7), Math.sin(a) * 0.5, rand(0.8, 1.1), s0, s0 * 2.0, c, 0.7);
    }
  }

  // Water splash: droplets that arc up and fall back, plus an expanding foam ring.
  splash(pos, { count = 16, radius = 1 } = {}) {
    const n = Math.max(1, Math.round(count));
    const spread = 0.6 + radius * 0.4;
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      const sp = rand(0.6, 1.6) * spread;
      const i2 = this._add(DROP, pos.x + Math.cos(a) * radius * 0.2, pos.y + 0.05, pos.z + Math.sin(a) * radius * 0.2,
        Math.cos(a) * sp, rand(2.6, 4.6), Math.sin(a) * sp, 1.4, rand(0.1, 0.2), rand(0.08, 0.14), DROP_COLOR, 0.95);
      if (i2 >= 0) this.s.floor[i2] = pos.y - 0.05;
    }
    const ring = Math.max(10, Math.round(n * 0.8));
    for (let i = 0; i < ring; i++) {
      const a = (i / ring) * TAU + rand(-0.15, 0.15);
      const r0 = radius * 0.4;
      const sp = rand(1.4, 2.0) * spread;
      const s0 = rand(0.3, 0.42) * (0.7 + radius * 0.3);
      this._add(FOAM, pos.x + Math.cos(a) * r0, pos.y + 0.03, pos.z + Math.sin(a) * r0,
        Math.cos(a) * sp, 0.05, Math.sin(a) * sp, rand(0.55, 0.8), s0, s0 * 2.1, WHITE, 0.7);
    }
  }

  // A few leaf flakes that pop out, tumble, and drift down on the wind.
  leaves(pos, { color, count = 6 } = {}) {
    const base = color !== undefined ? this._c2.set(color) : LEAF_COLOR;
    const c = this._c;
    const n = Math.max(1, Math.round(count));
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      const r0 = rand(0, 0.7);
      const sp = rand(0.5, 1.4);
      c.copy(base).multiplyScalar(rand(0.85, 1.15));
      const i2 = this._add(LEAFY, pos.x + Math.cos(a) * r0, pos.y + rand(0, 0.6), pos.z + Math.sin(a) * r0,
        Math.cos(a) * sp, rand(0.6, 1.8), Math.sin(a) * sp, rand(2.2, 3.2), rand(0.2, 0.3), rand(0.2, 0.3), c, 1);
      if (i2 >= 0) {
        this.s.spin[i2] = rand(1.5, 4) * (Math.random() < 0.5 ? -1 : 1);
        this.s.tumble[i2] = rand(4, 9);
      }
    }
  }

  // Small twinkling stars for UI feedback.
  sparkle(pos, { color, count = 10 } = {}) {
    const base = color !== undefined ? this._c2.set(color) : SPARKLE_COLOR;
    const n = Math.max(1, Math.round(count));
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      const r0 = rand(0, 0.8);
      const i2 = this._add(SPARKLE, pos.x + Math.cos(a) * r0, pos.y + rand(0, 0.8), pos.z + Math.sin(a) * r0,
        rand(-0.4, 0.4), rand(0.4, 1.1), rand(-0.4, 0.4), rand(0.6, 1.1), rand(0.28, 0.5), rand(0.08, 0.14), base, 1);
      if (i2 >= 0) {
        this.s.glow[i2] = rand(1.8, 2.6);
        this.s.spin[i2] = rand(-1, 1);
      }
    }
  }

  // ---- Emitters -------------------------------------------------------------

  // type: 'mist' | 'smoke' | 'sparks'. opts: { rate, radius, size, color }.
  addEmitter(type, pos, opts = {}) {
    const handle = this._nextHandle++;
    const d = EMITTER_DEFAULTS[type];
    if (!d) {
      console.warn(`Particles: unknown emitter type "${type}"`);
      return handle;
    }
    // Callers may pass a whole catalog entry; take only the known fields.
    const o = { ...d };
    for (const k of ['rate', 'radius', 'size', 'color']) if (opts?.[k] != null) o[k] = opts[k];
    this.emitters.set(handle, {
      type,
      x: pos.x,
      y: pos.y,
      z: pos.z,
      rate: o.rate,
      radius: o.radius,
      size: o.size,
      color: new THREE.Color(o.color),
      acc: Math.random(),
    });
    return handle;
  }

  moveEmitter(handle, pos) {
    const e = this.emitters.get(handle);
    if (!e) return;
    e.x = pos.x;
    e.y = pos.y;
    e.z = pos.z;
  }

  removeEmitter(handle) {
    this.emitters.delete(handle);
  }

  // ---- Frame update ---------------------------------------------------------

  update(dt, camera) {
    dt = Math.min(Math.max(dt, 0), 0.1);
    if (camera) {
      camera.getWorldPosition(this._camPos);
      camera.getWorldDirection(this._camDir);
      const fov = THREE.MathUtils.degToRad(camera.fov ?? 60);
      this.uniforms.uScale.value = U.uResolution.value.y / (2 * Math.tan(fov / 2));
    }

    this._runEmitters(dt);
    this._simulate(dt);

    let n = this._writePool();
    if (camera) n = this._ambient(dt, n);

    this.geometry.setDrawRange(0, n);
    // A zero-length range would upload the whole buffer, so skip empty frames.
    if (n === 0) return;
    for (const attr of this._attrs) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, n * attr.itemSize);
      attr.needsUpdate = true;
    }
  }

  // ---- Internals ------------------------------------------------------------

  _attr(name, size) {
    const attr = new THREE.BufferAttribute(new Float32Array(CAPACITY * size), size);
    attr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute(name, attr);
    return attr;
  }

  // Add one particle. Returns its index, or -1 when the pool is full.
  _add(kind, x, y, z, vx, vy, vz, life, size0, size1, color, alpha) {
    if (this.count >= POOL) return -1;
    const i = this.count++;
    const s = this.s;
    s.kind[i] = kind;
    s.px[i] = x;
    s.py[i] = y;
    s.pz[i] = z;
    s.vx[i] = vx;
    s.vy[i] = vy;
    s.vz[i] = vz;
    s.age[i] = 0;
    s.life[i] = life;
    s.size0[i] = size0;
    s.size1[i] = size1;
    s.r[i] = color.r;
    s.g[i] = color.g;
    s.b[i] = color.b;
    s.alpha[i] = alpha;
    s.glow[i] = 1;
    s.rot[i] = Math.random() * TAU;
    s.spin[i] = 0;
    s.tumble[i] = 0;
    s.phase[i] = Math.random() * TAU;
    s.floor[i] = -1e9;
    return i;
  }

  // Remove particle i by moving the last live particle into its slot.
  _kill(i) {
    const last = --this.count;
    if (i === last) return;
    for (const arr of this._arrays) arr[i] = arr[last];
  }

  _runEmitters(dt) {
    const cam = this._camPos;
    const c = this._c;
    for (const e of this.emitters.values()) {
      const dx = e.x - cam.x;
      const dy = e.y - cam.y;
      const dz = e.z - cam.z;
      if (dx * dx + dy * dy + dz * dz > EMITTER_RANGE * EMITTER_RANGE) {
        e.acc = 0;
        continue;
      }
      e.acc += e.rate * dt;
      while (e.acc >= 1) {
        e.acc -= 1;
        const a = rand(0, TAU);
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        if (e.type === 'mist') {
          const r0 = e.radius * Math.sqrt(Math.random());
          const sp = rand(0.5, 1.3);
          c.copy(e.color).multiplyScalar(rand(0.96, 1.04));
          this._add(MIST, e.x + ca * r0, e.y + rand(0, 0.3), e.z + sa * r0,
            ca * sp, rand(0.2, 0.6), sa * sp, rand(1.6, 2.6), 0.6 * e.size, 1.9 * e.size, c, rand(0.18, 0.28));
        } else if (e.type === 'smoke') {
          const r0 = e.radius * Math.random();
          c.copy(e.color).multiplyScalar(rand(0.88, 1.04));
          const i = this._add(SMOKE, e.x + ca * r0, e.y, e.z + sa * r0,
            ca * 0.1, rand(0.6, 1.0), sa * 0.1, rand(3.5, 5), 0.35 * e.size, 1.9 * e.size, c, rand(0.4, 0.55));
          if (i >= 0) this.s.spin[i] = rand(-0.4, 0.4);
        } else {
          const r0 = e.radius * Math.random();
          c.copy(e.color).lerp(EMBER_HOT, rand(0, 0.6));
          const s0 = rand(0.07, 0.12) * e.size;
          const i = this._add(EMBER, e.x + ca * r0, e.y + rand(0, 0.15), e.z + sa * r0,
            rand(-0.5, 0.5), rand(1.2, 2.4), rand(-0.5, 0.5), rand(0.8, 1.6), s0, s0 * 0.6, c, 1);
          if (i >= 0) this.s.glow[i] = rand(2.6, 4.0);
        }
      }
    }
  }

  _simulate(dt) {
    const s = this.s;
    const wind = U.uWindDir.value;
    const ws = U.uWindStrength.value;
    const wx = wind.x * ws;
    const wz = wind.y * ws;
    for (let k = 0; k < KINDS.length; k++) this._damp[k] = Math.exp(-KINDS[k].drag * dt);

    for (let i = 0; i < this.count; ) {
      const age = s.age[i] + dt;
      if (age >= s.life[i]) {
        this._kill(i);
        continue;
      }
      const kind = s.kind[i];
      const k = KINDS[kind];
      const damp = this._damp[kind];
      let vx = (s.vx[i] + wx * k.wind * dt) * damp;
      let vy = (s.vy[i] + k.grav * dt) * damp;
      let vz = (s.vz[i] + wz * k.wind * dt) * damp;
      let x = s.px[i] + vx * dt;
      const y = s.py[i] + vy * dt;
      let z = s.pz[i] + vz * dt;
      if (k.wob) {
        const ph = s.phase[i];
        x += Math.cos(age * 2.7 + ph) * k.wob * dt;
        z += Math.sin(age * 2.1 + ph * 1.3) * k.wob * dt;
      }
      if (k.floor && vy < 0 && y < s.floor[i]) {
        this._kill(i);
        continue;
      }
      s.age[i] = age;
      s.vx[i] = vx;
      s.vy[i] = vy;
      s.vz[i] = vz;
      s.px[i] = x;
      s.py[i] = y;
      s.pz[i] = z;
      s.rot[i] += s.spin[i] * dt;
      i++;
    }
  }

  // Write live pool particles into the GPU buffers. Returns how many were written.
  _writePool() {
    const s = this.s;
    const pos = this._pos.array;
    const col = this._col.array;
    const size = this._size.array;
    const par = this._params.array;
    for (let i = 0; i < this.count; i++) {
      const kind = s.kind[i];
      const k = KINDS[kind];
      const age = s.age[i];
      const t = age / s.life[i];
      const ph = s.phase[i];
      let a = s.alpha[i] * (k.fin > 0 ? smooth(0, k.fin, t) : 1) * (1 - smooth(k.fout, 1, t));
      const ease = 1 - (1 - t) * (1 - t);
      const sz = s.size0[i] + (s.size1[i] - s.size0[i]) * ease;
      const r = s.r[i];
      let g = s.g[i];
      let b = s.b[i];
      let glow = s.glow[i];
      let third = k.soft; // Puff edge softness, or the leaf tumble squash.

      if (kind === SPARKLE) {
        a *= 0.55 + 0.45 * Math.sin(age * 22 + ph);
      } else if (kind === EMBER) {
        // Flicker, and cool from yellow-orange toward red as it rises.
        glow *= 0.7 + 0.3 * Math.sin(age * 31 + ph) * Math.sin(age * 17.3 + ph * 2);
        g *= 1 - 0.5 * t;
        b *= 1 - 0.75 * t;
      } else if (kind === LEAFY) {
        third = Math.cos(age * s.tumble[i] + ph);
      }

      pos[i * 3] = s.px[i];
      pos[i * 3 + 1] = s.py[i];
      pos[i * 3 + 2] = s.pz[i];
      col[i * 4] = r * glow;
      col[i * 4 + 1] = g * glow;
      col[i * 4 + 2] = b * glow;
      col[i * 4 + 3] = a;
      size[i] = sz;
      par[i * 4] = k.shape;
      par[i * 4 + 1] = s.rot[i];
      par[i * 4 + 2] = third;
      par[i * 4 + 3] = k.glow;
    }
    return this.count;
  }

  // ---- Ambient fireflies and motes -------------------------------------------

  _makeAmbient(n) {
    return Array.from({ length: n }, () => ({
      x: 0, y: 0, z: 0, // Home position.
      fade: 0,
      seeded: false,
      a1: rand(0.25, 0.6), a2: rand(0.5, 1.1), a3: rand(0.3, 0.8),
      p1: rand(0, TAU), p2: rand(0, TAU), p3: rand(0, TAU),
      reach: rand(0.8, 2.2),
      lift: 0,
      blink: rand(0.6, 1.6),
      size: 0,
    }));
  }

  // Place an ambient particle somewhere in the field around the view.
  _home(f, center, radius, lift0, lift1, edge) {
    const a = rand(0, TAU);
    // Re-homed particles start near the rim and fade in, so none pop up mid-view.
    const d = edge ? radius * rand(0.75, 0.95) : radius * Math.sqrt(Math.random());
    f.x = center.x + Math.cos(a) * d;
    f.z = center.z + Math.sin(a) * d;
    const ground = this.groundAt ? this.groundAt(f.x, f.z) : 0;
    f.y = (Number.isFinite(ground) ? ground : 0) + rand(lift0, lift1);
    f.seeded = true;
    f.fade = 0;
  }

  _ambient(dt, n) {
    const cam = this._camPos;
    const dir = this._camDir;
    // Field center: roughly where the view meets the ground.
    let reach = 26;
    if (dir.y < -0.05) reach = THREE.MathUtils.clamp((cam.y - 1) / -dir.y, 6, 45);
    const center = this._center.set(cam.x + dir.x * reach, 0, cam.z + dir.z * reach);
    const time = U.uTime.value;
    const night = U.uNight.value;

    const fireflyVis = smooth(0.35, 0.8, night);
    if (fireflyVis > 0.001) n = this._writeAmbient(this._fireflies, FIREFLY_CFG, fireflyVis, n, dt, time, center);

    const moteVis = 1 - smooth(0.15, 0.5, night);
    if (moteVis > 0.001) {
      const wind = U.uWindDir.value;
      const drift = 0.35 * U.uWindStrength.value * dt;
      for (const m of this._motes) {
        m.x += wind.x * drift;
        m.z += wind.y * drift;
      }
      n = this._writeAmbient(this._motes, MOTE_CFG, moteVis * 0.45, n, dt, time, center);
    }
    return n;
  }

  _writeAmbient(list, o, vis, n, dt, time, center) {
    const pos = this._pos.array;
    const col = this._col.array;
    const size = this._size.array;
    const par = this._params.array;
    const r2 = o.radius * o.radius;
    for (const f of list) {
      const dx = f.x - center.x;
      const dz = f.z - center.z;
      if (!f.seeded) this._home(f, center, o.radius, o.lift0, o.lift1, false);
      else if (dx * dx + dz * dz > r2) this._home(f, center, o.radius, o.lift0, o.lift1, true);
      f.fade = Math.min(1, f.fade + dt * 0.8);

      // Lazy looping wander around home.
      const w = f.reach * o.wander;
      const x = f.x + (Math.sin(time * f.a1 + f.p1) + 0.5 * Math.sin(time * f.a2 * 1.7 + f.p2)) * w;
      const y = f.y + Math.sin(time * f.a3 + f.p2) * 0.35 * o.wander;
      const z = f.z + (Math.cos(time * f.a2 + f.p3) + 0.5 * Math.cos(time * f.a1 * 1.9 + f.p1)) * w;
      const glow = o.glow(f, time);

      pos[n * 3] = x;
      pos[n * 3 + 1] = y;
      pos[n * 3 + 2] = z;
      col[n * 4] = o.color.r * glow;
      col[n * 4 + 1] = o.color.g * glow;
      col[n * 4 + 2] = o.color.b * glow;
      col[n * 4 + 3] = vis * f.fade;
      size[n] = o.size;
      par[n * 4] = GLOW;
      par[n * 4 + 1] = 0;
      par[n * 4 + 2] = 0;
      par[n * 4 + 3] = 1;
      n++;
    }
    return n;
  }
}
