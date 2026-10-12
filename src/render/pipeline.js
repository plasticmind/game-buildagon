// Renderer, camera, and post-processing.
//
// Each frame:
//   1. Depth pre-pass: the DEPTH layer only, depth only, into a DepthTexture
//      that water reads through U.uDepthTex (depth fade and shore foam).
//   2. Main pass into a HalfFloat target (MSAA on medium and high).
//   3. Subtle bloom: only values well above 1.0 bloom (sun, glow, embers).
//   4. Grade: saturation lift, warm/cool tint, soft vignette.
//   5. Output: Neutral tone mapping (keeps pastels pastel), sRGB, dithering.

import './fog.js'; // Patch the fog chunks before any material compiles.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { U, LAYERS } from './shared.js';

const QUALITY = {
  low: { pixelRatio: 1, shadowMapSize: 1024, shadowRadius: 1.5, samples: 0, bloom: false },
  medium: { pixelRatio: 1.5, shadowMapSize: 2048, shadowRadius: 2.5, samples: 2, bloom: true },
  high: { pixelRatio: 1.75, shadowMapSize: 4096, shadowRadius: 4, samples: 4, bloom: true },
};

const GradeShader = {
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uNight;
    uniform float uGolden;
    uniform float uSaturation;
    uniform float uVignette;
    uniform vec3 uDayTint;
    uniform vec3 uGoldenTint;
    uniform vec3 uNightTint;
    uniform vec3 uLift;
    varying vec2 vUv;

    void main() {
      vec4 src = texture2D( tDiffuse, vUv );
      vec3 col = src.rgb;
      float lum = dot( col, vec3( 0.2126, 0.7152, 0.0722 ) );

      // Gentle saturation lift, eased off on hot highlights so the sun stays white.
      float sat = mix( uSaturation, 1.0, smoothstep( 1.0, 3.0, lum ) );
      col = max( mix( vec3( lum ), col, sat ), 0.0 );

      // Warm by day and at golden hour, cool at night. Glowing pixels keep
      // their own color so lanterns stay warm under the night tint.
      vec3 tint = mix( uDayTint, uGoldenTint, uGolden );
      tint = mix( tint, uNightTint, uNight );
      col *= mix( tint, vec3( 1.0 ), smoothstep( 0.8, 2.0, lum ) );

      // Lift the darkest tones a touch toward lavender for a soft, toy-like feel.
      col += uLift * ( 1.0 - smoothstep( 0.0, 0.25, lum ) );

      // Soft vignette that follows the screen shape, mostly in the corners.
      float v = smoothstep( 0.42, 0.86, length( vUv - 0.5 ) );
      col *= 1.0 - uVignette * v;

      gl_FragColor = vec4( col, src.a );
    }
  `,
};

// Interleaved gradient noise after the sRGB encode hides banding in the sky
// and fog gradients.
const DITHER = /* glsl */ `
  gl_FragColor.rgb += ( fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) ) - 0.5 ) / 255.0;
`;

export class RenderPipeline {
  constructor(container) {
    this.container = container;
    this.quality = 'high';
    this.shadowMapSize = QUALITY.high.shadowMapSize;
    this.shadowRadius = QUALITY.high.shadowRadius;

    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap; // PCF with shadow.radius is the soft path in r186.
    // The shadow map renders once per frame in the main pass, not in the pre-pass.
    renderer.shadowMap.autoUpdate = false;
    renderer.info.autoReset = false;
    renderer.setClearColor(0x000000, 1);
    renderer.setPixelRatio(Math.min(devicePixelRatio, QUALITY.high.pixelRatio));
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    // FogExp2 from the start so every material compiles with FOG_EXP2. Sky
    // drives its color and density.
    this.scene.fog = new THREE.FogExp2('#d6ebf5', 0.0045);

    this.camera = new THREE.PerspectiveCamera(56, 1, 0.1, 800);
    this.camera.layers.enableAll();

    // Depth pre-pass target. The color attachment is never written.
    this.depthTarget = new THREE.WebGLRenderTarget(1, 1, {
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false,
      depthTexture: new THREE.DepthTexture(1, 1, THREE.UnsignedIntType),
    });
    this.depthTarget.texture.name = 'Pipeline.depthPrepass';
    this.depthMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, fog: false });
    U.uDepthTex.value = this.depthTarget.depthTexture;

    // Main pass target. Composer ping-pongs between this (MSAA) and a plain
    // clone; render() makes sure the scene always lands in this one.
    this.sceneTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: QUALITY.high.samples,
    });
    this.sceneTarget.texture.name = 'Pipeline.scene';
    this.composer = new EffectComposer(renderer, this.sceneTarget);
    this.composer.renderTarget2.samples = 0;

    this.renderPass = new RenderPass(this.scene, this.camera);

    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.55, 1.15);
    this.bloom.highPassUniforms.smoothWidth.value = 0.6;
    // Bloom is a soft glow, so its blur chain runs at half the size three uses
    // by default. That's a quarter of the pixels, with no visible difference.
    const bloomSetSize = this.bloom.setSize.bind(this.bloom);
    this.bloom.setSize = (w, h) => bloomSetSize(Math.max(2, w / 2), Math.max(2, h / 2));

    this.gradeUniforms = {
      tDiffuse: { value: null },
      uNight: U.uNight,
      uGolden: { value: 0 }, // Sky writes this: 0 midday/night, 1 at golden hour.
      uSaturation: { value: 1.1 },
      uVignette: { value: 0.18 },
      uDayTint: { value: new THREE.Vector3(1.02, 1.0, 0.97) },
      uGoldenTint: { value: new THREE.Vector3(1.08, 0.99, 0.88) },
      uNightTint: { value: new THREE.Vector3(0.84, 0.92, 1.12) },
      uLift: { value: new THREE.Vector3(0.012, 0.009, 0.02) },
    };
    this.grade = new ShaderPass(
      new THREE.ShaderMaterial({
        name: 'GradeShader',
        uniforms: this.gradeUniforms,
        vertexShader: GradeShader.vertexShader,
        fragmentShader: GradeShader.fragmentShader,
        depthTest: false,
        depthWrite: false,
      }),
    );

    this.output = new OutputPass();
    const fs = this.output.material.fragmentShader;
    const end = fs.lastIndexOf('}');
    this.output.material.fragmentShader = `${fs.slice(0, end)}${DITHER}\n}`;

    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.grade);
    this.composer.addPass(this.output);

    this._size = new THREE.Vector2();
    this.resize();
  }

  get canvas() {
    return this.renderer.domElement;
  }

  resize() {
    const w = Math.max(1, this.container.clientWidth || innerWidth);
    const h = Math.max(1, this.container.clientHeight || innerHeight);
    const { renderer, camera, composer } = this;

    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();

    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(w, h);

    const size = renderer.getDrawingBufferSize(this._size);
    // Water foam and depth fade are soft, so half-resolution depth is plenty.
    // Shaders still divide gl_FragCoord by the full size to get the UV.
    this.depthTarget.setSize(Math.ceil(size.x / 2), Math.ceil(size.y / 2));
    U.uResolution.value.copy(size);
  }

  setQuality(level = 'high') {
    const q = QUALITY[level] ?? QUALITY.high;
    this.quality = QUALITY[level] ? level : 'high';
    this.shadowMapSize = q.shadowMapSize;
    this.shadowRadius = q.shadowRadius;
    this.bloom.enabled = q.bloom;

    if (this.sceneTarget.samples !== q.samples) {
      this.sceneTarget.samples = q.samples;
      this.sceneTarget.dispose(); // Reallocated with the new sample count on next use.
    }

    const pr = Math.min(devicePixelRatio, q.pixelRatio);
    if (this.renderer.getPixelRatio() !== pr) {
      this.renderer.setPixelRatio(pr);
      this.resize();
    }
  }

  render(dt = 0) {
    const { renderer, scene, camera, composer } = this;
    renderer.info.reset();

    U.uCameraNear.value = camera.near;
    U.uCameraFar.value = camera.far;

    // 1. Depth pre-pass: only what can touch water (the DEPTH layer), no shadow
    //    map update, no background.
    const background = scene.background;
    scene.background = null;
    scene.overrideMaterial = this.depthMaterial;
    camera.layers.set(LAYERS.DEPTH);
    renderer.shadowMap.needsUpdate = false;
    renderer.setRenderTarget(this.depthTarget);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    camera.layers.enableAll();
    scene.overrideMaterial = null;
    scene.background = background;

    // 2-5. Main pass and post. Matrices are already current from the pre-pass.
    // Shadows re-render every other frame. The sun moves slowly, and three keeps
    // the shadow map and its matrix in step, so a skipped frame reuses last
    // frame's shadows without misaligning them.
    renderer.shadowMap.needsUpdate = (this._frame = (this._frame ?? 0) + 1) % 2 === 1;
    if (composer.readBuffer !== this.sceneTarget) composer.swapBuffers();
    const autoUpdate = scene.matrixWorldAutoUpdate;
    scene.matrixWorldAutoUpdate = false;
    composer.render(dt);
    scene.matrixWorldAutoUpdate = autoUpdate;
  }

  // Render a frame and grab a center-cropped JPEG of it.
  captureThumbnail(w = 320, h = 180) {
    this.render(0);
    const src = this.renderer.domElement;
    const target = w / h;
    let sw = src.width;
    let sh = src.height;
    if (sw / sh > target) sw = sh * target;
    else sh = sw / target;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, 0, 0, w, h);
    return c.toDataURL('image/jpeg', 0.8);
  }
}
