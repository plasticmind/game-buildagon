// Renders placed objects (decorations and structures) from World events.
// Handles the squash-and-stretch pop on placement, the shrink on removal,
// per-model animation hooks, particle emitters, and a small pool of night lights.
//
// Hex roofs on neighboring cells at the same height join into one roof. Each
// roof's model knows which of its edges are joined; when a roof comes, goes, or
// moves, its neighbors rebuild in place to match.

import * as THREE from 'three';
import { buildModel } from '../catalog/models/index.js';
import { getItem } from '../catalog/catalog.js';
import { worldToHex, neighbor, mod6, parseKey, key as hexKey } from '../core/hex.js';
import { popScale, shrinkScale, springValue } from '../fx/spring.js';
import { U, LAYERS } from '../render/shared.js';

const LIGHT_POOL = 6;
const DEFAULT_LIGHT = { color: '#ffc87a', intensity: 6, distance: 9, decay: 1.6 };
const LIGHT_RANGE = 90; // Light sources farther than this from the camera get no pool light.
const SHADOW_MIN_HEIGHT = 0.7; // Shorter objects don't cast shadows.
const JOIN_ITEM = 'roof_hex'; // Roofs that join their neighbors.
const JOIN_DY = 0.05; // Roofs this close in height count as level.
const STEP = Math.PI / 3;

const _v = new THREE.Vector3();
const _box = new THREE.Box3();

export class ObjectRenderer {
  constructor(scene, world, { particles }) {
    this.scene = scene;
    this.world = world;
    this.particles = particles;
    this.group = new THREE.Group();
    this.group.name = 'objects';
    this.dyingGroup = new THREE.Group();
    this.dyingGroup.name = 'objects-dying';
    scene.add(this.group, this.dyingGroup);
    this.entries = new Map(); // id → entry
    this.animated = new Set(); // Entries with a model animate hook.
    this.moving = new Set(); // Entries mid pop or move; raycasts see them shift.
    this.dying = new Set(); // Removed entries still shrinking away.
    this.lit = new Set(); // Entries that give off light at night.

    // Point lights cost every lit pixel in the scene, so the pool is switched on
    // only at night when something glows. The whole pool toggles together, so
    // there are exactly two shader variants; prewarm() compiles the second one.
    this.lights = [];
    this.lightsOn = false;
    for (let i = 0; i < LIGHT_POOL; i++) {
      const { color, distance, decay } = DEFAULT_LIGHT;
      const l = new THREE.PointLight(color, 0, distance, decay);
      l.visible = false;
      l.userData.owner = null;
      scene.add(l);
      this.lights.push(l);
    }
    this._lightTimer = 0;

    world.on('objectAdded', (obj, opts) => {
      this._add(obj, opts.animate);
      if (obj.item === JOIN_ITEM) this._rejoinAround(obj);
    });
    world.on('objectRemoved', (obj, opts) => {
      this._remove(obj, opts.animate);
      if (obj.item === JOIN_ITEM) this._rejoinAround(obj);
    });
    world.on('objectUpdated', (obj, prev, opts) => {
      this._update(obj, prev, opts);
      if (obj.item !== JOIN_ITEM && prev.item !== JOIN_ITEM) return;
      const e = this.entries.get(obj.id);
      if (e && obj.item === JOIN_ITEM && this._joinsOf(obj) !== e.joins) this._rebuildModel(e);
      this._rejoinAround(prev);
      this._rejoinAround(obj);
    });
    world.on('reset', () => this._rebuildAll());
  }

  get(id) {
    return this.entries.get(id)?.root ?? null;
  }

  getRaycastTargets() {
    return [this.group];
  }

  // True while a placement pop or move is changing what raycasts hit.
  get isAnimating() {
    return this.moving.size > 0;
  }

  setLightsVisible(on) {
    if (on === this.lightsOn) return;
    this.lightsOn = on;
    for (const l of this.lights) l.visible = on;
  }

  // Compile shaders for the other light setup in the background, so the lights
  // switching on at dusk (or off at dawn) never stall a frame.
  prewarm(renderer, camera) {
    const was = this.lightsOn;
    this.setLightsVisible(!was);
    const done = renderer.compileAsync(this.scene, camera).catch(() => {});
    this.setLightsVisible(was);
    return done;
  }

  // Model bounds in the object's own space, before its placement scale.
  boundsOf(id) {
    return this.entries.get(id)?.bounds ?? null;
  }

  // Which edges of a hex roof at (q, r), height y, have a level hex roof next
  // door. Bit i is the model's local edge i: a model turned by rotY has its local
  // edge i on world edge i - rotY / 60°.
  roofJoins(q, r, y, rotY = 0, exceptId = null) {
    const turn = Math.round(rotY / STEP);
    let mask = 0;
    for (let i = 0; i < 6; i++) {
      const nb = neighbor(q, r, i);
      for (const o of this.world.objectsInCell(hexKey(nb.q, nb.r))) {
        if (o.item === JOIN_ITEM && o.edge === null && o.id !== exceptId && Math.abs(o.y - y) < JOIN_DY) {
          mask |= 1 << mod6(i + turn);
          break;
        }
      }
    }
    return mask;
  }

  // Height of an object's stacking surface above its base, in world units.
  topOf(id) {
    const e = this.entries.get(id);
    if (!e) return 0;
    return (e.model.userData.topY ?? 0) * e.obj.scale;
  }

  // ---- Lifecycle ------------------------------------------------------------

  _rebuildAll() {
    for (const e of this.entries.values()) this._dispose(e);
    for (const set of [this.entries, this.animated, this.moving, this.lit]) set.clear();
    for (const obj of this.world.objects.values()) this._add(obj, false);
  }

  _add(obj, animate) {
    if (this.entries.has(obj.id)) this._dispose(this.entries.get(obj.id));
    const joins = obj.item === JOIN_ITEM ? this._joinsOf(obj) : 0;
    const model = buildModel(obj.item, obj.variant, obj.seed, { joins });
    const root = new THREE.Group();
    root.add(model);
    root.position.set(obj.x, obj.y, obj.z);
    root.rotation.y = obj.rotY;
    root.scale.setScalar(obj.scale);
    root.userData.objectId = obj.id;
    this.group.add(root);

    const item = getItem(obj.item);
    const entry = { obj, root, model, bounds: null, joins, anim: null, emitters: [], light: null };
    this._prepModel(entry);
    if (model.userData.lightOffset || item?.light) {
      const offset = model.userData.lightOffset ?? new THREE.Vector3(0, 1, 0);
      entry.light = { ...DEFAULT_LIGHT, ...item?.light, offset };
      this.lit.add(entry);
    }
    if (model.userData.animate) this.animated.add(entry);
    if (animate) {
      this._animate(entry, { type: 'pop', t: 0 });
      const s = popScale(0);
      model.scale.set(s.xz, s.y, s.xz);
    }
    this.entries.set(obj.id, entry);
  }

  // Bounds, shadows, layers, and emitters for an entry's current model.
  _prepModel(e) {
    const { obj, model, root } = e;
    // Low things (flowers, lily pads, floors) cast shadows nobody notices, and
    // every caster is another draw call in the shadow pass.
    _box.setFromObject(model);
    e.bounds = _box.clone();
    const castShadow = (_box.max.y - _box.min.y) * obj.scale >= SHADOW_MIN_HEIGHT;
    model.traverse((o) => {
      o.userData.objectId = obj.id;
      if (!o.isMesh) return;
      if (o.layers.mask === 0) o.layers.set(LAYERS.WORLD);
      if (!castShadow) o.castShadow = false;
    });
    root.updateMatrixWorld(true);
    this._syncDepthLayer(e);
    for (const em of model.userData.emitters ?? []) {
      const pos = root.localToWorld(em.offset.clone());
      e.emitters.push({ handle: this.particles.addEmitter(em.type, pos, em), offset: em.offset });
    }
  }

  _joinsOf(obj) {
    const [q, r] = obj.cell ? parseKey(obj.cell) : (({ q, r }) => [q, r])(worldToHex(obj.x, obj.z));
    return this.roofJoins(q, r, obj.y, obj.rotY, obj.id);
  }

  // Swap in a model with the roof's current joins, without a pop. A placement
  // pop or move already under way carries on with the new model.
  _rebuildModel(e) {
    const { obj } = e;
    const joins = this._joinsOf(obj);
    const old = e.model;
    const model = buildModel(obj.item, obj.variant, obj.seed, { joins });
    model.scale.copy(old.scale);
    e.root.remove(old);
    old.traverse((o) => {
      if (o.isMesh) o.geometry.dispose();
    });
    this._removeEmitters(e);
    e.root.add(model);
    e.model = model;
    e.joins = joins;
    this._prepModel(e);
  }

  // Rebuild the level hex roofs around obj's cell whose joins changed.
  _rejoinAround(obj) {
    const [q, r] = obj.cell ? parseKey(obj.cell) : (({ q, r }) => [q, r])(worldToHex(obj.x, obj.z));
    for (let i = 0; i < 6; i++) {
      const nb = neighbor(q, r, i);
      for (const o of this.world.objectsInCell(hexKey(nb.q, nb.r))) {
        if (o.item !== JOIN_ITEM || o.edge !== null) continue;
        const e = this.entries.get(o.id);
        if (e && this._joinsOf(o) !== e.joins) this._rebuildModel(e);
      }
    }
  }

  _remove(obj, animate) {
    const e = this.entries.get(obj.id);
    if (!e) return;
    this.entries.delete(obj.id);
    for (const set of [this.animated, this.moving, this.lit]) set.delete(e);
    this._releaseLight(e);
    this._removeEmitters(e);
    if (animate) {
      this.group.remove(e.root);
      this.dyingGroup.add(e.root);
      e.anim = { type: 'shrink', t: 0 };
      this.dying.add(e);
    } else {
      this._dispose(e);
    }
  }

  _update(obj, prev, opts) {
    const e = this.entries.get(obj.id);
    if (!e) return;
    if (obj.item !== prev.item || obj.variant !== prev.variant || obj.seed !== prev.seed) {
      this._remove(prev, false);
      this._add(obj, opts.animate);
      return;
    }
    e.root.rotation.y = obj.rotY;
    // Growing plants ease up to their new size.
    if (opts.grow && obj.scale !== prev.scale) this._animate(e, { type: 'grow', t: 0, from: prev.scale, to: obj.scale });
    else e.root.scale.setScalar(obj.scale);
    if (opts.animate && (obj.y !== prev.y || obj.x !== prev.x || obj.z !== prev.z)) {
      this._animate(e, { type: 'move', t: 0, from: e.root.position.clone(), to: new THREE.Vector3(obj.x, obj.y, obj.z) });
    } else {
      e.root.position.set(obj.x, obj.y, obj.z);
      this._moveEmitters(e);
    }
    this._syncDepthLayer(e);
  }

  _animate(e, anim) {
    e.anim = anim;
    this.moving.add(e);
  }

  // The water depth pre-pass only draws what can touch water: terrain, the
  // seabed, and objects standing on water cells or the open ocean.
  _syncDepthLayer(e) {
    const { q, r } = worldToHex(e.obj.x, e.obj.z);
    const cell = this.world.getCell(q, r);
    const inWater = !cell || cell.type === 'water';
    e.model.traverse((o) => {
      if (!o.isMesh || o.userData.waterMask) return;
      if (inWater) o.layers.enable(LAYERS.DEPTH);
      else o.layers.disable(LAYERS.DEPTH);
    });
  }

  _dispose(e) {
    e.root.parent?.remove(e.root);
    e.root.traverse((o) => {
      if (o.isMesh) o.geometry.dispose();
    });
    this._removeEmitters(e);
    this._releaseLight(e);
  }

  _removeEmitters(e) {
    for (const em of e.emitters) this.particles.removeEmitter(em.handle);
    e.emitters = [];
  }

  _moveEmitters(e) {
    e.root.updateMatrixWorld(true);
    for (const em of e.emitters) this.particles.moveEmitter(em.handle, e.root.localToWorld(em.offset.clone()));
  }

  // ---- Per frame ------------------------------------------------------------

  update(dt, camera) {
    for (const e of this.moving) {
      e.anim.t += dt;
      if (e.anim.type === 'pop') {
        const s = popScale(e.anim.t);
        e.model.scale.set(s.xz, s.y, s.xz);
        if (s.done) this._settle(e);
      } else if (e.anim.type === 'grow') {
        const k = springValue(e.anim.t, { stiffness: 7, damping: 5 });
        e.root.scale.setScalar(e.anim.from + (e.anim.to - e.anim.from) * k);
        if (e.anim.t > 1.6) {
          e.root.scale.setScalar(e.anim.to);
          this._settle(e);
        }
      } else {
        const k = Math.min(1, springValue(e.anim.t, { stiffness: 14, damping: 9 }));
        e.root.position.lerpVectors(e.anim.from, e.anim.to, k);
        if (e.anim.t > 0.6) {
          e.root.position.copy(e.anim.to);
          this._settle(e);
          this._moveEmitters(e);
        }
      }
    }

    for (const e of this.dying) {
      e.anim.t += dt;
      const s = shrinkScale(e.anim.t);
      e.model.scale.setScalar(Math.max(0.001, s.s));
      if (s.done) {
        this.dying.delete(e);
        this._dispose(e);
      }
    }

    for (const e of this.animated) e.model.userData.animate(e.model, U.uTime.value, dt);

    this._lightTimer -= dt;
    if (this._lightTimer <= 0) {
      this._lightTimer = 0.3;
      this._assignLights(camera);
    }
    this._updateLights();
  }

  _settle(e) {
    e.anim = null;
    this.moving.delete(e);
  }

  _freeLight(l) {
    l.userData.owner = null;
    l.intensity = 0;
  }

  _releaseLight(e) {
    for (const l of this.lights) if (l.userData.owner === e) this._freeLight(l);
  }

  // Give the pool of point lights to the light sources nearest the camera.
  _assignLights(camera) {
    const candidates = [];
    if (U.uNight.value >= 0.05) {
      const cam = camera.position;
      for (const e of this.lit) {
        e.root.localToWorld(_v.copy(e.light.offset));
        const d = _v.distanceToSquared(cam);
        if (d < LIGHT_RANGE * LIGHT_RANGE) candidates.push({ e, d, pos: _v.clone() });
      }
      candidates.sort((a, b) => a.d - b.d);
    }
    this.setLightsVisible(candidates.length > 0);
    this.lights.forEach((l, i) => {
      const c = candidates[i];
      if (!c) {
        this._freeLight(l);
        return;
      }
      l.userData.owner = c.e;
      l.position.copy(c.pos);
      l.color.set(c.e.light.color);
      l.distance = c.e.light.distance;
    });
  }

  _updateLights() {
    if (!this.lightsOn) return;
    const night = THREE.MathUtils.smoothstep(U.uNight.value, 0.05, 0.6);
    const t = U.uTime.value;
    for (const l of this.lights) {
      const e = l.userData.owner;
      if (!e) continue;
      const id = e.obj.id;
      // Fires flicker; lamps breathe very slightly.
      const flicker =
        e.light.flicker === 'fire'
          ? 0.8 + 0.2 * Math.sin(t * 13 + id) * Math.sin(t * 7.3 + id * 2)
          : 0.97 + 0.03 * Math.sin(t * 2 + id);
      // Grow new lights in with the placement pop.
      const grow = e.anim?.type === 'pop' ? Math.min(1, e.anim.t * 2) : 1;
      l.intensity = e.light.intensity * night * flicker * grow;
    }
  }
}
