// Item thumbnails: renders catalog models offscreen into small transparent PNGs.
//
// One shared WebGLRenderer draws every thumbnail. Requests are cached, queued,
// and rendered a few at a time in idle callbacks, so opening a menu never stalls.
//
//   getThumbnail(itemId, variant)   Promise<dataURL | null>
//   peekThumbnail(itemId, variant)  the cached dataURL, or null if not ready yet

import * as THREE from 'three';
import { buildModel, hasModel } from '../catalog/models/index.js';
import { getItem } from '../catalog/catalog.js';
import { TERRAIN, HEX_SIZE, LEVEL_H } from '../core/constants.js';
import { toon } from '../render/materials.js';
import { U } from '../render/shared.js';

const SIZE = 128;
const PADDING = 1.1;
const BATCH = 3;

// A pleasant 3/4 view: 40° around from the front, 30° above the horizon.
const AZIMUTH = THREE.MathUtils.degToRad(40);
const ELEVATION = THREE.MathUtils.degToRad(30);
const VIEW_DIR = new THREE.Vector3(
  Math.sin(AZIMUTH) * Math.cos(ELEVATION),
  Math.sin(ELEVATION),
  Math.cos(AZIMUTH) * Math.cos(ELEVATION),
);

const promises = new Map(); // key → Promise<string | null>
const ready = new Map(); // key → string | null
const queue = [];
const jobs = new Map(); // key → queued job

// Requests made in the same tick share a generation. Newer generations render
// first, so whatever is on screen right now wins over older requests.
let generation = 0;
let bumpQueued = false;
function currentGeneration() {
  if (!bumpQueued) {
    bumpQueued = true;
    queueMicrotask(() => {
      generation += 1;
      bumpQueued = false;
    });
  }
  return generation;
}

let renderer = null;
let scene = null;
let camera = null;
let broken = false;
let scheduled = false;

// Without requestIdleCallback (Safari), run right after a frame is drawn.
const idle =
  typeof requestIdleCallback === 'function'
    ? (fn) => requestIdleCallback(fn, { timeout: 150 })
    : (fn) => requestAnimationFrame(() => setTimeout(() => fn(null), 0));

export function getThumbnail(itemId, variant = 0) {
  const key = `${itemId}:${variant}`;
  const gen = currentGeneration();
  let p = promises.get(key);
  if (!p) {
    p = new Promise((resolve) => {
      const job = { itemId, variant, key, resolve, gen };
      queue.push(job);
      jobs.set(key, job);
    });
    promises.set(key, p);
    schedule();
  } else if (jobs.has(key)) {
    jobs.get(key).gen = gen;
  }
  return p;
}

export function peekThumbnail(itemId, variant = 0) {
  return ready.get(`${itemId}:${variant}`) ?? null;
}

function schedule() {
  if (scheduled || !queue.length) return;
  scheduled = true;
  idle(work);
}

// The newest generation first, oldest request first within it.
function nextJob() {
  let best = 0;
  for (let i = 1; i < queue.length; i++) if (queue[i].gen > queue[best].gen) best = i;
  return queue.splice(best, 1)[0];
}

function work(deadline) {
  scheduled = false;
  const start = performance.now();
  let done = 0;
  while (queue.length && done < BATCH) {
    // Always make progress, then keep going only while there's time to spare.
    if (done > 0) {
      const left = deadline && !deadline.didTimeout ? deadline.timeRemaining() : 8 - (performance.now() - start);
      if (left < 5) break;
    }
    const job = nextJob();
    jobs.delete(job.key);
    const url = render(job.itemId, job.variant);
    ready.set(job.key, url);
    job.resolve(url);
    done++;
  }
  schedule();
}

// ---- Rendering ------------------------------------------------------------

function init() {
  if (renderer || broken) return !broken;
  try {
    const canvas = document.createElement('canvas');
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
      powerPreference: 'low-power',
    });
    renderer.setPixelRatio(1);
    renderer.setSize(SIZE, SIZE, false);
    renderer.setClearColor(0x000000, 0);
    canvas.addEventListener('webglcontextlost', () => {
      broken = true;
    });
  } catch (err) {
    console.warn('[thumbnails] WebGL is unavailable', err);
    broken = true;
    return false;
  }

  scene = new THREE.Scene();
  const hemi = new THREE.HemisphereLight('#fff6e6', '#b5a688', 2.2);
  const sun = new THREE.DirectionalLight('#fff0d8', 2.4);
  // Light from the upper left of the camera, so faces read clearly.
  sun.position.set(-1.2, 6, 4.5);
  scene.add(hemi, sun, sun.target);

  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
  camera.layers.enableAll();
  return true;
}

function render(itemId, variant) {
  if (!init()) return null;
  let model = null;
  const night = U.uNight.value;
  const wind = U.uWindStrength.value;
  try {
    model = makeModel(itemId, variant);
    scene.add(model);
    frame(model);
    // Render with daytime glow and calm wind, whatever the world is doing.
    U.uNight.value = 0;
    U.uWindStrength.value = 0;
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/png');
  } catch (err) {
    console.warn(`[thumbnails] couldn't render ${itemId}`, err);
    return null;
  } finally {
    U.uNight.value = night;
    U.uWindStrength.value = wind;
    if (model) {
      scene.remove(model);
      disposeGeometry(model);
    }
  }
}

const _box = new THREE.Box3();
const _center = new THREE.Vector3();
const _size = new THREE.Vector3();
const _v = new THREE.Vector3();

// Point the camera at the model from the 3/4 angle and fit its projected bounds.
function frame(model) {
  model.updateMatrixWorld(true);
  _box.setFromObject(model);
  if (_box.isEmpty()) _box.set(_v.set(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5));
  _box.getCenter(_center);
  const radius = Math.max(0.05, _box.getSize(_size).length() / 2);

  camera.position.copy(_center).addScaledVector(VIEW_DIR, radius * 4);
  camera.up.set(0, 1, 0);
  camera.lookAt(_center);
  camera.updateMatrixWorld(true);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const { min, max } = _box;
  for (let i = 0; i < 8; i++) {
    _v.set(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z);
    _v.applyMatrix4(camera.matrixWorldInverse);
    minX = Math.min(minX, _v.x);
    maxX = Math.max(maxX, _v.x);
    minY = Math.min(minY, _v.y);
    maxY = Math.max(maxY, _v.y);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const half = (Math.max(maxX - minX, maxY - minY) / 2) * PADDING;
  camera.left = cx - half;
  camera.right = cx + half;
  camera.top = cy + half;
  camera.bottom = cy - half;
  camera.near = 0.01;
  camera.far = radius * 8;
  camera.updateProjectionMatrix();
}

function disposeGeometry(root) {
  // Materials are shared across the game, so only geometry is disposed.
  root.traverse((o) => o.geometry?.dispose());
}

// ---- Models ---------------------------------------------------------------

function makeModel(itemId, variant) {
  const item = getItem(itemId);
  const isTile = item && (item.placement === 'tile' || item.placement === 'water');
  if (isTile && !hasModel(itemId)) return hexTile(item, variant);
  return buildModel(itemId, variant, 1);
}

// Non-indexed geometry with recomputed normals shades flat, face by face.
function flat(geo) {
  const g = geo.toNonIndexed();
  geo.dispose();
  g.computeVertexNormals();
  return g;
}

const tileMats = new Map();
function tileMat(color) {
  if (!tileMats.has(color)) tileMats.set(color, toon({ color, vertexColors: false, flatShading: false }));
  return tileMats.get(color);
}

// A small hex column for terrain and water items that have no model of their own.
function hexTile(item, variant) {
  const type = TERRAIN[item.terrainType] ? item.terrainType : 'grass';
  const v = TERRAIN[type].variants[variant] ?? TERRAIN[type].variants[0];
  const group = new THREE.Group();
  const height = LEVEL_H * 2;
  const cap = 0.22;

  const column = new THREE.Mesh(flat(new THREE.CylinderGeometry(HEX_SIZE, HEX_SIZE, height - cap, 6)), tileMat(v.side));
  column.position.y = (height - cap) / 2;
  group.add(column);

  const top = new THREE.Mesh(flat(new THREE.CylinderGeometry(HEX_SIZE, HEX_SIZE * 0.985, cap, 6)), tileMat(v.top));
  top.position.y = height - cap / 2;
  group.add(top);

  if (type === 'water') {
    const pool = new THREE.Mesh(flat(new THREE.CylinderGeometry(HEX_SIZE * 0.8, HEX_SIZE * 0.8, 0.06, 6)), tileMat(v.tint));
    pool.position.y = height + 0.01;
    group.add(pool);
  } else if (v.blade) {
    // A few soft tufts so grass reads as grass at hotbar size.
    const spots = [
      [0.2, -0.5], [-0.7, 0.3], [0.9, 0.5], [-0.2, 1], [0.6, -1.1], [-1.1, -0.5], [1.2, -0.2], [-0.4, -1.2],
    ];
    for (const [x, z] of spots) {
      const tuft = new THREE.Mesh(flat(new THREE.ConeGeometry(0.16, 0.42, 4)), tileMat(v.blade));
      tuft.position.set(x, height + 0.21, z);
      tuft.rotation.y = x * 3 + z;
      group.add(tuft);
    }
  }
  return group;
}
