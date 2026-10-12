// Buildagon bootstrap: creates every system, routes input, and runs the frame loop.

import './ui/ui.css';
import * as THREE from 'three';

import { settings, loadSettings, saveSettings } from './settings.js';
import { U } from './render/shared.js';
import { RenderPipeline } from './render/pipeline.js';
import { Sky } from './render/sky.js';
import { Particles } from './fx/particles.js';
import { World, SAVE_VERSION } from './world/World.js';
import { TerrainRenderer } from './world/TerrainRenderer.js';
import { GrassRenderer } from './world/GrassRenderer.js';
import { WaterRenderer } from './world/WaterRenderer.js';
import { generateStarterWorld, generateEmptyIsland } from './world/worldgen.js';
import { ObjectRenderer } from './world/ObjectRenderer.js';
import { Wildlife } from './life/Wildlife.js';
import { Growth } from './life/Growth.js';
import { AudioSystem } from './audio/AudioSystem.js';
import { Hotbars } from './build/hotbars.js';
import { BuildController } from './build/BuildController.js';
import { Input } from './player/Input.js';
import { FlyCamera } from './player/FlyCamera.js';
import { SaveSystem } from './save/SaveSystem.js';
import { UI } from './ui/UI.js';
import * as catalog from './catalog/catalog.js';
import { randomSeed } from './core/random.js';
import { worldToHex } from './core/hex.js';

loadSettings();

const pipeline = new RenderPipeline(document.getElementById('app'));
const { scene, camera } = pipeline;

const world = new World();
const particles = new Particles(scene);
// Keeps ambient fireflies and pollen above the terrain.
particles.groundAt = (x, z) => {
  const { q, r } = worldToHex(x, z);
  return world.surfaceY(q, r);
};
const sky = new Sky(scene, pipeline);
const terrain = new TerrainRenderer(scene, world);
const grass = new GrassRenderer(scene, world);
const water = new WaterRenderer(scene, world, particles);
const objects = new ObjectRenderer(scene, world, { particles });
const audio = new AudioSystem(settings);
const wildlife = new Wildlife(scene, world, { objects, particles, audio });
const growth = new Growth(world, { particles, sound: wildlife.ctx.sound });
const hotbars = new Hotbars();
const input = new Input(pipeline.canvas);
const cameraRig = new FlyCamera(camera, input, world, settings);
const build = new BuildController({
  scene,
  camera,
  world,
  terrain,
  water,
  objects,
  particles,
  audio,
  hotbars,
  input,
});

// Add ?fresh to the URL for a new world that never touches the autosave, which
// is handy for testing in a second tab. ?fresh=starter or ?fresh=empty picks
// the kind; plain ?fresh starts on open water.
const params = new URLSearchParams(location.search);
const fresh = params.has('fresh');
const saves = new SaveSystem({ world, sky, pipeline, hotbars, cameraRig, autosave: !fresh });
const ui = new UI(document.getElementById('ui'), { hotbars, audio, saves, settings, catalog, build });

// ---- World lifecycle ----------------------------------------------------

// kind: 'water' (open ocean, the default), 'starter' (a ready-made island),
// or 'empty' (a small flat island).
function worldData(kind, seed = randomSeed()) {
  if (kind === 'starter') return generateStarterWorld({ seed });
  if (kind === 'empty') return generateEmptyIsland();
  return { version: SAVE_VERSION, cells: [], objects: [], meta: { time: 9.5 } };
}

function newWorld(kind = 'water', seed = randomSeed()) {
  const data = worldData(kind, seed);
  world.load(data);
  sky.time = data.meta.time;
  saves.current = null; // A new world isn't any named save yet.
  build.clearHistory();
  cameraRig.reset({ close: kind === 'water' });
}

if (!saves.loadAutosave()) newWorld(params.get('fresh') || 'water', 7);
saves.startAutosave(60);

// While the sea is empty, the UI offers a one-click starter island.
const syncEmptyWorld = () => ui.setEmptyWorld(world.cells.size === 0);
world.on('cell', syncEmptyWorld);
world.on('reset', syncEmptyWorld);
syncEmptyWorld();

// ---- Settings -------------------------------------------------------------

// Each setter skips work when its value hasn't changed, so this is cheap to
// call on every slider tick.
function applySettings() {
  U.uWindStrength.value = settings.windStrength;
  sky.dayLengthMinutes = settings.dayLengthMinutes;
  sky.paused = settings.timePaused;
  pipeline.setQuality(settings.quality, settings.retina);
  wildlife.setQuality(settings.quality);
  wildlife.setEnabled(settings.wildlife);
  growth.setEnabled(settings.natureGrowth);
  const qualityGrass = { low: 0.35, medium: 0.7, high: 1 }[settings.quality] ?? 1;
  grass.setDensity(settings.grassDensity * qualityGrass);
  audio.applySettings(settings);
  saveSettings();
}
applySettings();

ui.on('settings', applySettings);
ui.on('newWorld', newWorld);
ui.on('menu', (open) => build.setEnabled(!open));
ui.on('timeOfDay', (h) => (sky.time = h));
build.on('state', (s) => ui.setState(s));
wildlife.on('announce', (msg) => ui.toast(msg));
audio.onTrack = (track) => ui.toast(`Now playing: ${track.title} by ${track.author}`);

// ---- Input routing --------------------------------------------------------

addEventListener('pointerdown', () => audio.unlock(), { once: true });
addEventListener('keydown', () => audio.unlock(), { once: true });

input.on('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.code === 'KeyZ') {
    e.preventDefault();
    if (e.shiftKey) build.redo();
    else build.undo();
    return;
  }
  if (mod && e.code === 'KeyY') {
    e.preventDefault();
    build.redo();
    return;
  }
  if (mod && e.code === 'KeyS') {
    e.preventDefault();
    const saved = saves.autosave();
    if (saved === null) {
      ui.toast('Autosave is off in this tab');
    } else if (saved) {
      ui.toast('Saved');
      audio.play('save');
    } else {
      audio.play('error');
    }
    return;
  }

  switch (e.code) {
    case 'Escape':
      if (ui.closeAll()) break;
      if (build.mode === 'destroy') build.setMode('build');
      else ui.toggleSystemMenu();
      break;
    case 'KeyC':
      ui.toggleBuildMenu();
      break;
    case 'KeyV':
      build.toggleDestroy();
      break;
    case 'KeyF':
      build.cycleVariant(e.shiftKey ? -1 : 1);
      break;
    case 'KeyG':
      build.toggleSnap();
      break;
    case 'KeyH':
      hotbars.cyclePreset(e.shiftKey ? -1 : 1);
      audio.play('preset');
      break;
    case 'KeyP':
      ui.toggleHud();
      break;
    case 'F1':
    case 'Slash':
      e.preventDefault();
      ui.toggleHelp();
      break;
    case 'ArrowLeft':
      build.rotate(-1);
      break;
    case 'ArrowRight':
      build.rotate(1);
      break;
    case 'ArrowUp':
      build.scaleStep(1);
      break;
    case 'ArrowDown':
      build.scaleStep(-1);
      break;
    default: {
      const digit = /^Digit([1-9])$/.exec(e.code);
      if (digit && !mod) {
        hotbars.selectSlot(Number(digit[1]) - 1);
        audio.play('hotbar');
        break;
      }
      const pad = /^Numpad([1-9])$/.exec(e.code);
      if (pad) {
        hotbars.selectPreset(Number(pad[1]) - 1);
        audio.play('preset');
      }
    }
  }
});

addEventListener('resize', () => pipeline.resize());

// ---- Frame loop -----------------------------------------------------------

let lastFrame = performance.now();
const camPos = new THREE.Vector3();
let ambienceTimer = 0;

function step(dt) {
  U.uTime.value += dt;

  const timeLapse = input.isDown('KeyT') && !ui.anyMenuOpen ? 45 : 1;
  sky.update(dt * timeLapse, camera, cameraRig.focus);

  cameraRig.update(dt, !ui.anyMenuOpen);
  build.update(dt);

  terrain.update(dt);
  grass.update(dt, camera);
  water.update(dt, camera);
  objects.update(dt, camera);
  wildlife.update(dt, camera);
  growth.update(dt * timeLapse, cameraRig.focus);
  particles.update(dt, camera);

  // The ambience mix eases toward these values, so 10 updates a second is plenty.
  ambienceTimer -= dt;
  if (ambienceTimer <= 0) {
    ambienceTimer = 0.1;
    camera.getWorldPosition(camPos);
    const prox = water.proximity(camPos);
    audio.setAmbience({
      night: U.uNight.value,
      water: prox.water,
      waterfall: prox.waterfall,
      height: camPos.y,
      wind: settings.windStrength,
    });
  }
  audio.update(dt);

  ui.setTime(sky.time);

  pipeline.render(dt);
}

function frame(now) {
  step(Math.min(0.05, (now - lastFrame) / 1000));
  lastFrame = now;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
// After the first frame, compile the night-light shader variants in the background.
requestAnimationFrame(() => objects.prewarm(pipeline.renderer, camera));

// Runs frames synchronously. Useful for automated checks when the tab is hidden
// and requestAnimationFrame is paused.
function advance(seconds = 1, fps = 30) {
  const n = Math.max(1, Math.round(seconds * fps));
  for (let i = 0; i < n; i++) step(1 / fps);
}

// Handy for debugging from the browser console.
window.game = { advance, world, pipeline, scene, camera, sky, terrain, grass, water, objects, wildlife, growth, particles, audio, hotbars, input, cameraRig, build, saves, ui, settings, U };
