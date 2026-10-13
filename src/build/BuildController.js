// Placement and removal: turns the cursor ray into a target, shows the blueprint
// ghost, and mutates the World on click. Owns undo/redo history.
//
// Placement rules by item type (see catalog.js):
//   tile   Click a column top to stack a level. Click water to fill it. Click a
//          cliff side to build the neighbor. Drag to paint a plateau at one level.
//   water  Click land to dig a pond at that level. Click water to raise it.
//          Drag to paint a river at one level.
//   free   Sits on whatever surface is under the cursor. G snaps to hex points.
//   edge   Snaps to the hex edge nearest the cursor. Walls stack into stories.
//   cell   Snaps to the hex center. Roofs and ceilings land on top of walls.
//
// Events: 'state' (getState()).

import * as THREE from 'three';
import { Emitter } from '../core/events.js';
import { getItem } from '../catalog/catalog.js';
import {
  worldToHex,
  hexToWorld,
  key as hexKey,
  nearestEdge,
  edgeKey,
  inWorld,
  neighbor,
  mod6,
  cornerOffset,
  hexDistance,
  hexRound,
} from '../core/hex.js';
import { HEX_SIZE, LEVEL_H, MAX_LEVEL, STORY_H, TERRAIN, PALETTE } from '../core/constants.js';
import { rimY, cellGroundY } from '../world/World.js';
import { edgeTransform, cellTransform } from './placement.js';
import { Ghost } from './Ghost.js';
import { LAYERS, addGust } from '../render/shared.js';
import { randomSeed } from '../core/random.js';
import { mix } from '../catalog/models/util.js';

const DEG = Math.PI / 180;
const HISTORY_LIMIT = 200;

// Click-and-hold pacing, in seconds. Dragging repeats as the cursor moves onto
// new targets; holding still repeats only after a pause, and more slowly.
const DRAG_REPEAT = 0.07; // Minimum time between actions while dragging.
const HOLD_DELAY = 0.35; // How long a still, held button waits before repeating.
const HOLD_REPEAT = 0.3; // Time between repeats while holding still.
const CLICK_GAP = 0.15; // A new click this soon after the last action is ignored.
const DRAG_MOVE_PX = 6; // Cursor travel, in pixels, that counts as dragging.
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const FALLBACK_BOUNDS = new THREE.Box3(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5));

const HINTS = {
  tile: 'Click to stack a level. Drag to paint a plateau.',
  water: 'Click land to dig a pond, or water to raise it. Drag to paint a river.',
  free: 'Scroll to rotate. Up/Down to resize. G toggles grid snap.',
  edge: 'Snaps to the nearest hex edge. Walls stack into stories.',
  cell: 'Scroll to rotate. Roofs and ceilings land on top of walls.',
  destroy: 'Click to remove. Drag to clear an area.',
};

const _n = new THREE.Vector3();
const _p = new THREE.Vector3();
const _m3 = new THREE.Matrix3();
const _plane = new THREE.Plane();

function worldNormal(hit) {
  if (!hit.face) return _n.set(0, 1, 0);
  _m3.getNormalMatrix(hit.object.matrixWorld);
  return _n.copy(hit.face.normal).applyMatrix3(_m3).normalize();
}

function objectIdOf(o) {
  while (o && o.userData.objectId === undefined) o = o.parent;
  return o?.userData.objectId;
}

function soundFor(item) {
  return `place_${item.sound ?? 'soft'}`;
}

export class BuildController extends Emitter {
  constructor({ scene, camera, world, terrain, water, objects, particles, audio, hotbars, input }) {
    super();
    Object.assign(this, { scene, camera, world, terrain, water, objects, particles, audio, hotbars, input });

    this.mode = 'build';
    this.snap = false;
    this.enabled = true;
    this.variants = new Map();
    this.freeRot = 0;
    this.cellRot = 0;
    this.userScale = 1;
    this._reroll();

    // Only the nearest hit is ever used, which lets BVH-accelerated meshes stop early.
    this.raycaster = new THREE.Raycaster();
    this.raycaster.layers.set(LAYERS.WORLD);
    this.raycaster.layers.enable(LAYERS.WATER);
    this.raycaster.firstHitOnly = true;
    this.downRay = new THREE.Raycaster();
    this.downRay.layers.mask = this.raycaster.layers.mask;
    this.downRay.firstHitOnly = true;
    this.downRay.far = 60;

    this.ghost = new Ghost(scene);
    this.target = null;
    this.undoStack = [];
    this.redoStack = [];
    this.drag = null;
    this._lastValid = null;

    input.on('primaryDown', () => this._primaryDown());
    input.on('primaryUp', () => this._endDrag());
    input.on('wheel', (d) => this.rotate(d));
    hotbars.on('change', () => this._itemChanged());
    world.on('reset', () => {
      this.drag = null;
      this.target = null;
    });
    // Targeting raycasts the scene, so it reruns only when an input changes: the
    // camera or cursor moves, the selection changes, or the world changes. It
    // also reruns while placement animations move the meshes that rays hit.
    this._dirty = true;
    this._lastCam = new THREE.Matrix4();
    this._lastNdc = new THREE.Vector2(NaN, NaN);
    for (const type of ['cell', 'objectAdded', 'objectRemoved', 'objectUpdated', 'reset']) {
      world.on(type, () => (this._dirty = true));
    }

    this._setCursor();
    this._itemChanged();
  }

  // ---- Public API ------------------------------------------------------------

  get item() {
    return getItem(this.hotbars.currentItem) ?? null;
  }

  variantFor(itemId) {
    return this.variants.get(itemId) ?? 0;
  }

  getState() {
    const item = this.item;
    const v = item ? this.variantFor(item.id) : 0;
    let rotationDeg = 0;
    if (item?.placement === 'free') rotationDeg = Math.round(((this.freeRot / DEG) % 360 + 360) % 360);
    if (item?.placement === 'cell') rotationDeg = this.cellRot * 60;
    return {
      mode: this.mode,
      snap: this.snap,
      itemId: item?.id ?? null,
      itemName: item?.name ?? '',
      variant: v,
      variantName: item?.variants?.[v] ?? '',
      variantCount: item?.variants?.length ?? 0,
      rotationDeg,
      scale: this.userScale,
      canRotate: item?.placement === 'free' || item?.placement === 'cell',
      canScale: item?.placement === 'free',
      // Grid items always snap; G only affects decorations.
      snapLocked: !!item && item.placement !== 'free',
      placement: item?.placement ?? null,
      valid: this.target?.valid ?? true,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      hint: this.mode === 'destroy' ? HINTS.destroy : HINTS[item?.placement] ?? '',
    };
  }

  emitState() {
    this.emit('state', this.getState());
  }

  // End any drag and hide the ghost until the next target is computed.
  _clearTarget() {
    this._endDrag();
    this.ghost.hideAll();
    this.target = null;
    this._dirty = true;
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) this._clearTarget();
  }

  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this._clearTarget();
    this.audio.play(mode === 'destroy' ? 'mode_destroy' : 'mode_build');
    this._setCursor();
    this.emitState();
  }

  toggleDestroy() {
    this.setMode(this.mode === 'destroy' ? 'build' : 'destroy');
  }

  toggleSnap() {
    this.snap = !this.snap;
    this._dirty = true;
    this.audio.play(this.snap ? 'snap_on' : 'snap_off');
    this.emitState();
  }

  cycleVariant(dir = 1) {
    const item = this.item;
    if (!item || this.mode === 'destroy') return;
    const n = item.variants?.length ?? 1;
    if (n < 2) return;
    const v = (this.variantFor(item.id) + dir + n) % n;
    this.variants.set(item.id, v);
    this._dirty = true;
    this._refreshGhostModel();
    this.audio.play('variant', { pitch: 1 + v * 0.06 });
    if (this.ghost.hasTarget) this.particles.sparkle(this.ghost.current.pos.clone().add(UP), { count: 8 });
    this.emitState();
  }

  rotate(dir) {
    const item = this.item;
    if (!item || this.mode === 'destroy' || !this.enabled) return;
    if (item.placement === 'free') {
      this.freeRot += dir * (this.snap ? 30 : 15) * DEG;
    } else if (item.placement === 'cell') {
      this.cellRot = mod6(this.cellRot + dir);
    } else {
      return;
    }
    this._dirty = true;
    this.audio.play('rotate', { pitch: dir > 0 ? 1.06 : 0.94 });
    this.emitState();
  }

  scaleStep(dir) {
    const item = this.item;
    if (!item || item.placement !== 'free' || this.mode === 'destroy') return;
    this.userScale = THREE.MathUtils.clamp(this.userScale * (dir > 0 ? 1.1 : 1 / 1.1), 0.5, 2.5);
    this._dirty = true;
    this.audio.play('rotate', { pitch: 0.9 + this.userScale * 0.15 });
    this.emitState();
  }

  undo() {
    const ops = this.undoStack.pop();
    if (!ops) {
      this.audio.play('error');
      return;
    }
    for (let i = ops.length - 1; i >= 0; i--) this._applyOp(ops[i], 'undo');
    this.redoStack.push(ops);
    this.audio.play('undo');
    this.emitState();
  }

  redo() {
    const ops = this.redoStack.pop();
    if (!ops) {
      this.audio.play('error');
      return;
    }
    for (const op of ops) this._applyOp(op, 'redo');
    this.undoStack.push(ops);
    this.audio.play('redo');
    this.emitState();
  }

  clearHistory() {
    this.undoStack = [];
    this.redoStack = [];
    this.emitState();
  }

  // ---- Frame update -----------------------------------------------------------

  update(dt) {
    this.ghost.update(dt);
    const { input } = this;
    if (!this.enabled || (!input.mouse.overCanvas && !input.looking && !this.drag)) {
      this.ghost.hideAll();
      this.target = null;
      this._dirty = true;
      return;
    }
    const cam = this.camera.matrixWorld;
    if (!cam.equals(this._lastCam) || !input.mouse.ndc.equals(this._lastNdc)) {
      this._lastCam.copy(cam);
      this._lastNdc.copy(input.mouse.ndc);
      this._dirty = true;
    }
    const animating = this.terrain.isAnimating || this.water.isAnimating || this.objects.isAnimating;
    if (this._dirty || this.drag || animating) {
      this._dirty = false;
      this._computeTarget();
      this._showTarget();
    }
    if (this.drag && input.primaryHeld && this._mayRepeat()) this._act(false);

    const valid = this.target?.valid ?? true;
    if (valid !== this._lastValid) {
      this._lastValid = valid;
      this.emitState();
    }
  }

  // ---- Targeting --------------------------------------------------------------

  _computeTarget() {
    this.raycaster.setFromCamera(this.input.mouse.ndc, this.camera);
    if (this.mode === 'destroy') {
      this.target = this._destroyTarget();
      return;
    }
    const item = this.item;
    if (!item) {
      this.target = null;
      return;
    }
    switch (item.placement) {
      case 'tile':
      case 'water':
        this.target = this._tileTarget(item);
        break;
      case 'free':
        this.target = this._freeTarget(item);
        break;
      case 'edge':
        this.target = this._edgeTarget(item);
        break;
      case 'cell':
        this.target = this._cellTarget(item);
        break;
      default:
        this.target = null;
    }
  }

  _hit(list, recursive = false) {
    return this.raycaster.intersectObjects(list, recursive)[0] ?? null;
  }

  _hitTerrain() {
    return this._hit(this.terrain.getRaycastTargets());
  }

  _hitObjects() {
    return this._hit(this.objects.getRaycastTargets(), true);
  }

  _hitPlane(y) {
    _plane.set(UP, -y);
    return this.raycaster.ray.intersectPlane(_plane, new THREE.Vector3());
  }

  // The cell that owns a terrain face: { q, r, key, top, edge }. Terrain corners
  // are jittered, so worldToHex on a hit point could land in a neighbor.
  _terrainCell(hit) {
    return this.terrain.cellFromHit(hit);
  }

  // Nearest hit along a ray among terrain, objects, and optionally water,
  // tagged with its kind.
  _nearest(ray, water = false) {
    let best = null;
    const consider = (kind, list, recursive) => {
      const h = ray.intersectObjects(list, recursive)[0];
      if (h && (!best || h.distance < best.distance)) best = { ...h, kind };
    };
    consider('terrain', this.terrain.getRaycastTargets(), false);
    consider('object', this.objects.getRaycastTargets(), true);
    if (water) consider('water', this.water.getRaycastTargets(), false);
    return best;
  }

  // Cast straight down from a point to find the surface beneath it.
  _dropTo(x, y, z, water = false) {
    this.downRay.set(_p.set(x, y, z), DOWN);
    return this._nearest(this.downRay, water);
  }

  _tileTarget(item) {
    const lock = this.drag?.level;
    if (lock !== null && lock !== undefined) {
      // While dragging, paint across a horizontal plane at the locked level.
      const p = this._hitPlane(rimY(lock));
      if (!p) return null;
      const { q, r } = worldToHex(p.x, p.z);
      return this._paintTarget(q, r, item);
    }
    let q;
    let r;
    const hit = this._hitTerrain();
    if (hit) {
      const owner = this._terrainCell(hit);
      // A cliff side builds on the neighbor that the face looks out over.
      ({ q, r } = owner.top ? owner : neighbor(owner.q, owner.r, owner.edge));
    } else {
      const p = this._hitPlane(0);
      if (!p) return null;
      ({ q, r } = worldToHex(p.x, p.z));
    }
    const prev = this.world.getCell(q, r) ?? null;
    const variant = this.variantFor(item.id);
    const next =
      item.placement === 'water' ? stackWater(prev, variant) : stackTile(prev, item.terrainType, variant);
    return cellResult(q, r, prev, next);
  }

  // Paint target for one cell at the drag's locked level.
  _paintTarget(q, r, item) {
    const lock = this.drag.level;
    const variant = this.variantFor(item.id);
    const prev = this.world.getCell(q, r) ?? null;
    const next =
      item.placement === 'water' ? paintWater(prev, lock, variant) : paintTile(prev, lock, item.terrainType, variant);
    return cellResult(q, r, prev, next);
  }

  _freeTarget(item) {
    const float = item.onWater === 'float';
    let hit = this._nearest(this.raycaster, float);
    if (!hit) return null;
    let n = worldNormal(hit).clone();
    const p = hit.point.clone();

    // On a steep face, step out from it and settle onto the surface below.
    if (hit.kind !== 'water' && n.y < 0.45) {
      p.addScaledVector(n, 0.35);
      // Retry from higher up in case the step lands inside a neighboring column.
      let below = null;
      for (const lift of [0.1, 0.8, 2.5]) {
        below = this._dropTo(p.x, p.y + lift, p.z, float);
        if (below) break;
      }
      if (!below) return { kind: 'free', valid: false, pos: p, rotY: 0, scale: 1 };
      hit = below;
      p.copy(below.point);
      n = worldNormal(below).clone();
    }

    let rotY = this.freeRot + this.randRot;
    if (this.snap) {
      const { q, r } = worldToHex(p.x, p.z);
      const s = snapPoint(q, r, p.x, p.z);
      const below = this._dropTo(s.x, p.y + 4, s.z, float);
      if (below) {
        hit = below;
        p.copy(below.point);
      } else {
        p.x = s.x;
        p.z = s.z;
      }
      rotY = Math.round(rotY / (30 * DEG)) * 30 * DEG;
    }

    const { q, r } = worldToHex(p.x, p.z);
    let ground = null;
    if (hit.kind === 'terrain') {
      ground = this._terrainCell(hit).key;
    } else if (hit.kind === 'water') {
      ground = this.world.hasCell(q, r) ? hexKey(q, r) : null;
    } else if (hit.kind === 'object') {
      const id = objectIdOf(hit.object);
      ground = this.world.getObject(id)?.ground ?? null;
    }
    const valid = inWorld(q, r) && n.y > 0.3;
    return {
      kind: 'free',
      valid,
      pos: p,
      rotY,
      scale: this.userScale * this.randScale,
      ground,
      onWater: hit.kind === 'water',
    };
  }

  _edgeTarget(item) {
    const { world } = this;
    const hit = this._nearest(this.raycaster);
    if (!hit) return null;
    const n = worldNormal(hit);
    _p.copy(hit.point);
    if (n.y <= 0.5) _p.addScaledVector(n, 0.3);
    const { q, r } = worldToHex(_p.x, _p.z);
    const edge = nearestEdge(q, r, _p.x, _p.z);
    const ek = edgeKey(q, r, edge);
    const nb = neighbor(q, r, edge);
    const a = world.getCell(q, r);
    const b = world.getCell(nb.q, nb.r);
    if (!a && !b) return { kind: 'edge', valid: false, ...edgeTransform(q, r, edge, 0) };

    let base = Math.max(a ? rimY(a.h) : -Infinity, b ? rimY(b.h) : -Infinity);
    const groundBase = base;

    // Floors in either cell lift the wall onto the floor.
    for (const k of [hexKey(q, r), hexKey(nb.q, nb.r)]) {
      for (const o of world.objectsInCell(k)) {
        if (o.edge !== null || getItem(o.item)?.stack !== 'ground') continue;
        const top = o.y + this.objects.topOf(o.id);
        if (top >= groundBase - 0.01 && top <= groundBase + 0.6) base = Math.max(base, top);
      }
    }

    const onEdge = world.objectsOnEdge(ek);
    if (item.stack === 'top') {
      for (const o of onEdge) {
        if (getItem(o.item)?.stack === 'top') base = Math.max(base, o.y + this.objects.topOf(o.id));
      }
    }
    let occupied = false;
    for (const o of onEdge) if (Math.abs(o.y - base) < 0.1) occupied = true;
    const tooTall = base - groundBase > STORY_H * 5;
    const t = edgeTransform(q, r, edge, base);
    return { kind: 'edge', ...t, ground: a ? hexKey(q, r) : hexKey(nb.q, nb.r), valid: !occupied && !tooTall && inWorld(q, r) };
  }

  _cellTarget(item) {
    const { world } = this;
    const hit = this._nearest(this.raycaster);
    if (!hit) return null;
    const n = worldNormal(hit);
    let q;
    let r;
    if (hit.kind === 'terrain' && n.y > 0.5) {
      ({ q, r } = this._terrainCell(hit));
    } else {
      _p.copy(hit.point).addScaledVector(n, n.y > 0.5 ? -0.02 : 0.3);
      ({ q, r } = worldToHex(_p.x, _p.z));
    }
    const k = hexKey(q, r);
    const cell = world.getCell(q, r);
    if (!cell) return { kind: 'cellItem', valid: false, ...cellTransform(q, r, 0, this.cellRot), q, r, ringY: 0 };

    // Cell items in this cell; the index also holds edge items, which carry a cell too.
    const inCell = [...world.objectsInCell(k)].filter((o) => o.edge === null);
    let base = rimY(cell.h);
    if (item.stack === 'top') {
      const top = (o) => (base = Math.max(base, o.y + this.objects.topOf(o.id)));
      inCell.forEach(top);
      for (let i = 0; i < 6; i++) world.objectsOnEdge(edgeKey(q, r, i)).forEach(top);
    }
    let occupied = false;
    for (const o of inCell) if (Math.abs(o.y - base) < 0.05) occupied = true;
    const t = cellTransform(q, r, base, this.cellRot);
    return { kind: 'cellItem', ...t, q, r, ground: k, ringY: base, valid: !occupied && inWorld(q, r) };
  }

  _destroyTarget() {
    const o = this._hitObjects();
    const t = this._hitTerrain();
    if (o && (!t || o.distance <= t.distance + 0.01)) {
      const id = objectIdOf(o.object);
      return { kind: 'object', id, root: this.objects.get(id), valid: true };
    }
    if (t) {
      const { q, r } = this._terrainCell(t);
      const cell = this.world.getCell(q, r);
      if (cell) return { kind: 'cell', q, r, key: hexKey(q, r), cell, valid: true };
    }
    return null;
  }

  _showTarget() {
    const { ghost, target } = this;
    if (!target) {
      ghost.hideAll();
      return;
    }
    if (this.mode === 'destroy') {
      ghost.hideModel();
      ghost.hideRing();
      if (target.kind === 'object') {
        ghost.hideDestroyCell();
        ghost.showDestroyObject(target.root);
      } else {
        ghost.showDestroyObject(null);
        ghost.showDestroyCell(target.q, target.r, rimY(target.cell.h));
      }
      return;
    }
    ghost.hideDestroyCell();
    ghost.showDestroyObject(null);
    // Mid-drag, an invalid target is usually a cell just painted. Don't flash red.
    if (this.drag && !target.valid) {
      ghost.hideModel();
      ghost.hideRing();
      return;
    }
    ghost.setValid(target.valid);
    switch (target.kind) {
      case 'cell': {
        const c = hexToWorld(target.q, target.r);
        ghost.setTransform(c.x, target.ghostY, c.z, 0, 1);
        ghost.showRing(target.q, target.r, target.ringY);
        break;
      }
      case 'free':
        ghost.setTransform(target.pos.x, target.pos.y, target.pos.z, target.rotY, target.scale);
        ghost.hideRing();
        break;
      case 'edge':
        ghost.setTransform(target.x, target.y, target.z, target.rotY, 1);
        ghost.hideRing();
        break;
      case 'cellItem':
        // A roof previews joined to the level roofs next door.
        if (this.item?.id === 'roof_hex') {
          const joins = this.objects.roofJoins(target.q, target.r, target.y, target.rotY);
          ghost.setItem(this.item.id, this.variantFor(this.item.id), 1, { joins });
        }
        ghost.setTransform(target.x, target.y, target.z, target.rotY, 1);
        if (target.valid) ghost.showRing(target.q, target.r, target.ringY);
        else ghost.hideRing();
        break;
    }
  }

  // ---- Acting ---------------------------------------------------------------------

  _primaryDown() {
    if (!this.enabled) return;
    const now = performance.now() / 1000;
    // Swallow the second half of an accidental double-click.
    if (now - (this._lastActionAt ?? -1) < CLICK_GAP) return;
    this.drag = {
      visited: new Set(),
      level: null,
      lastPos: null,
      count: 0,
      ops: [],
      kind: null,
      pressAt: now,
      lastActAt: now,
      pointer: { x: this.input.mouse.x, y: this.input.mouse.y },
    };
    this._computeTarget();
    this._act(true);
  }

  // Whether a held button should act again this frame.
  _mayRepeat() {
    const d = this.drag;
    const now = performance.now() / 1000;
    const m = this.input.mouse;
    const moved = Math.hypot(m.x - d.pointer.x, m.y - d.pointer.y) >= DRAG_MOVE_PX;
    if (moved) return now - d.lastActAt >= DRAG_REPEAT;
    // Holding still never digs through to whatever was behind the last removal.
    if (this.mode === 'destroy') return false;
    return now - d.pressAt >= HOLD_DELAY && now - d.lastActAt >= HOLD_REPEAT;
  }

  _endDrag() {
    if (this.drag?.ops.length) this._pushHistory(this.drag.ops);
    this.drag = null;
  }

  _act(first) {
    const { target, drag } = this;
    if (!drag) return;
    if (!target || !target.valid) {
      if (first && target) this.audio.play('error');
      return;
    }
    const pitch = 1 + Math.min(0.35, drag.count * 0.03);
    let ops = null;

    if (this.mode === 'destroy') {
      // A drag that starts on an object only removes objects, and one that starts
      // on terrain only lowers terrain, so clearing a tree never digs the ground.
      if (drag.kind && drag.kind !== target.kind) return;
      if (target.kind === 'object') {
        const k = `o${target.id}`;
        if (drag.visited.has(k)) return;
        drag.visited.add(k);
        ops = this._removeObject(target.id, pitch);
      } else {
        if (drag.visited.has(target.key)) return;
        if (drag.level === null) drag.level = target.cell.h;
        else if (target.cell.h !== drag.level) return;
        drag.visited.add(target.key);
        ops = this._lowerCell(target, pitch);
      }
    } else {
      const item = this.item;
      if (!item) return;
      switch (target.kind) {
        case 'cell': {
          if (drag.visited.has(target.key)) return;
          if (drag.level === null) drag.level = target.next.h;
          // A fast drag can skip past cells between actions, so paint the whole
          // line from the last painted cell to keep strokes unbroken.
          const path = drag.lastCell ? hexLine(drag.lastCell, target).slice(1, -1) : [];
          ops = [];
          for (const { q, r } of path) {
            const t = this._paintTarget(q, r, item);
            if (!t.valid || drag.visited.has(t.key)) continue;
            drag.visited.add(t.key);
            ops.push(...this._placeCell(t, item, pitch));
          }
          drag.visited.add(target.key);
          ops.push(...this._placeCell(target, item, pitch));
          drag.lastCell = { q: target.q, r: target.r };
          break;
        }
        case 'free': {
          if (!first) {
            const spacing = Math.max(0.7, this._ghostRadius() * target.scale * 1.5);
            if (drag.lastPos && drag.lastPos.distanceTo(target.pos) < spacing) return;
          }
          drag.lastPos = target.pos.clone();
          ops = this._placeObject(item, target, pitch);
          break;
        }
        case 'edge':
        case 'cellItem': {
          const k = `${target.kind}:${target.x.toFixed(2)},${target.z.toFixed(2)}@${target.y.toFixed(2)}`;
          if (drag.visited.has(k)) return;
          drag.visited.add(k);
          ops = this._placeObject(item, target, pitch);
          break;
        }
      }
    }
    if (ops?.length) {
      drag.ops.push(...ops);
      drag.count++;
      drag.kind = drag.kind ?? target.kind;
      const now = performance.now() / 1000;
      drag.lastActAt = now;
      drag.pointer = { x: this.input.mouse.x, y: this.input.mouse.y };
      this._lastActionAt = now;
      this._computeTarget();
    }
  }

  _placeCell(t, item, pitch) {
    const { world } = this;
    const ops = [];
    const next = { q: t.q, r: t.r, ...t.next };
    world.setCell(t.q, t.r, next, { animate: true });
    ops.push({ t: 'cell', q: t.q, r: t.r, prev: t.prev ? { ...t.prev } : null, next });
    this._reground(t.key, t.prev, next, ops);

    const c = hexToWorld(t.q, t.r);
    const pos = new THREE.Vector3(c.x, rimY(next.h), c.z);
    this.audio.play(soundFor(item), { pitch: pitch * rand(0.95, 1.05) });
    addGust(c.x, c.z, 1.5);
    if (next.type !== 'water') {
      const top = TERRAIN[next.type].variants[next.variant]?.top ?? '#e8dcc6';
      this.particles.puff(pos, { color: mix(top, '#ffffff', 0.35), count: 18, radius: HEX_SIZE * 0.95, size: 0.5 });
    }
    return ops;
  }

  _placeObject(item, t, pitch) {
    const variant = this.variantFor(item.id);
    const base = { item: item.id, variant, seed: this.seed };
    let data;
    if (t.kind === 'free') {
      data = { ...base, x: t.pos.x, y: t.pos.y, z: t.pos.z, rotY: t.rotY, scale: t.scale, cell: null, edge: null, ground: t.ground };
    } else {
      data = { ...base, x: t.x, y: t.y, z: t.z, rotY: t.rotY, scale: 1, cell: t.cell, edge: t.edge ?? null, ground: t.ground };
    }
    const obj = this.world.addObject(data, { animate: true });
    const pos = new THREE.Vector3(obj.x, obj.y, obj.z);
    this.audio.play(soundFor(item), { pitch: pitch * rand(0.94, 1.06) });
    addGust(obj.x, obj.z, item.foliage ? 0.8 : 1.1);
    if (item.dust) this.particles.puff(pos, { color: '#efe4cf', count: 12, radius: 0.9, size: 0.38 });
    if (item.foliage) {
      const h = Math.max(0.5, this._ghostHeight() * obj.scale * 0.7);
      this.particles.leaves(pos.clone().addScaledVector(UP, h), { color: PALETTE.leafGreen, count: 6 });
    }
    if (t.onWater) this.particles.splash(pos, { count: 10, radius: 0.6 });

    if (item.placement === 'free') {
      this._reroll();
      this._refreshGhostModel();
    } else {
      this.seed = randomSeed();
    }
    return [{ t: 'add', obj: { ...obj } }];
  }

  _removeObject(id, pitch) {
    const obj = this.world.getObject(id);
    if (!obj) return null;
    const snapshot = { ...obj };
    this.world.removeObject(id, { animate: true });
    this.audio.play('destroy', { pitch: pitch * rand(0.92, 1.08) });
    this.particles.puff(new THREE.Vector3(obj.x, obj.y + 0.2, obj.z), { color: '#e9e2d6', count: 12, radius: 0.8, size: 0.4 });
    addGust(obj.x, obj.z, 0.7);
    return [{ t: 'remove', obj: snapshot }];
  }

  _lowerCell(t, pitch) {
    const { world } = this;
    const prev = { ...t.cell };
    const ops = [];
    let next = null;
    if (prev.h > 0) {
      next = { ...prev, h: prev.h - 1 };
      world.setCell(prev.q, prev.r, next, { animate: true });
    } else {
      world.removeCell(prev.q, prev.r, { animate: true });
    }
    ops.push({ t: 'cell', q: prev.q, r: prev.r, prev, next });
    this._reground(t.key, prev, next, ops);
    const c = hexToWorld(prev.q, prev.r);
    this.audio.play('destroy', { pitch: pitch * rand(0.9, 1.0) });
    this.particles.puff(new THREE.Vector3(c.x, rimY(prev.h), c.z), { color: '#e6dccb', count: 16, radius: HEX_SIZE, size: 0.5 });
    addGust(c.x, c.z, 1.2);
    return ops;
  }

  // Move or remove objects resting on a cell whose terrain changed.
  _reground(k, prev, next, ops) {
    const { world } = this;
    // Copy: removing objects changes the index while we walk it.
    for (const o of [...world.objectsOnGround(k)]) {
      const it = getItem(o.item);
      const free = it?.placement === 'free';
      const float = it?.onWater === 'float';
      let remove = false;
      let dy = 0;
      if (!next) {
        remove = true;
      } else if (!prev) {
        dy = 0;
      } else if (prev.type !== 'water' && next.type === 'water') {
        if (free && !float) remove = true;
        else dy = rimY(next.h) - rimY(prev.h);
      } else if (prev.type === 'water' && next.type !== 'water') {
        if (free && float) remove = true;
        else if (free) dy = rimY(next.h) - cellGroundY(prev);
        else dy = rimY(next.h) - rimY(prev.h);
      } else {
        dy = rimY(next.h) - rimY(prev.h);
      }
      if (remove) {
        const snap = { ...o };
        world.removeObject(o.id, { animate: true });
        ops.push({ t: 'remove', obj: snap });
      } else if (Math.abs(dy) > 1e-4) {
        const prevY = o.y;
        world.updateObject(o.id, { y: o.y + dy }, { animate: true });
        ops.push({ t: 'update', id: o.id, prev: { y: prevY }, next: { y: prevY + dy } });
      }
    }
  }

  _pushHistory(ops) {
    this.undoStack.push(ops);
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.emitState();
  }

  _applyOp(op, dir) {
    const { world } = this;
    const undo = dir === 'undo';
    switch (op.t) {
      case 'cell': {
        const c = undo ? op.prev : op.next;
        if (c) world.setCell(op.q, op.r, c, { animate: true });
        else world.removeCell(op.q, op.r, { animate: true });
        break;
      }
      case 'add':
        if (undo) world.removeObject(op.obj.id, { animate: true });
        else world.addObject({ ...op.obj }, { animate: true });
        break;
      case 'remove':
        if (undo) world.addObject({ ...op.obj }, { animate: true });
        else world.removeObject(op.obj.id, { animate: true });
        break;
      case 'update':
        world.updateObject(op.id, undo ? op.prev : op.next, { animate: true });
        break;
    }
  }

  // ---- Ghost model and item state ---------------------------------------------------

  _itemChanged() {
    this._dirty = true;
    this._reroll();
    this._refreshGhostModel();
    this.emitState();
  }

  _reroll() {
    const item = this.item;
    this.seed = randomSeed();
    this.randRot = item?.randomRotation ? Math.random() * Math.PI * 2 : 0;
    const [lo, hi] = item?.scaleRange ?? [1, 1];
    this.randScale = rand(lo, hi);
  }

  _refreshGhostModel() {
    const item = this.item;
    if (!item) {
      this.ghost.setItem(null);
      return;
    }
    this.ghost.setItem(item.id, this.variantFor(item.id), item.placement === 'free' ? this.seed : 1);
  }

  _bounds() {
    const b = this.ghost.bounds;
    return b && !b.isEmpty() ? b : FALLBACK_BOUNDS;
  }

  _ghostRadius() {
    const b = this._bounds();
    return Math.max(b.max.x - b.min.x, b.max.z - b.min.z) / 2;
  }

  _ghostHeight() {
    const b = this._bounds();
    return b.max.y - b.min.y;
  }

  _setCursor() {
    const canvas = this.input.canvas;
    if (this.mode === 'destroy') {
      const svg =
        "<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28'><circle cx='14' cy='14' r='9' fill='none' stroke='%23ff6f6f' stroke-width='3'/><path d='M9 9l10 10M19 9L9 19' stroke='%23ff6f6f' stroke-width='3' stroke-linecap='round'/></svg>";
      canvas.style.cursor = `url("data:image/svg+xml;utf8,${svg}") 14 14, crosshair`;
    } else {
      canvas.style.cursor = 'crosshair';
    }
  }
}

// ---- Terrain rules ------------------------------------------------------------------

function stackTile(prev, type, variant) {
  if (!prev) return { h: 0, type, variant };
  if (prev.type === 'water') return { h: prev.h, type, variant };
  if (prev.h + 1 > MAX_LEVEL) return null;
  return { h: prev.h + 1, type, variant };
}

function stackWater(prev, variant) {
  if (!prev) return { h: 0, type: 'water', variant };
  if (prev.type !== 'water') return { h: prev.h, type: 'water', variant };
  if (prev.h + 1 > MAX_LEVEL) return null;
  return { h: prev.h + 1, type: 'water', variant };
}

// While painting: raise lower land and fill empty cells up to `level`.
function paintTile(prev, level, type, variant) {
  if (!prev) return { h: level, type, variant };
  if (prev.type === 'water') return prev.h === level ? { h: level, type, variant } : null;
  if (prev.h >= level) return null;
  return { h: level, type, variant };
}

// While painting water: dig land at `level`, or extend water into empty cells.
function paintWater(prev, level, variant) {
  if (!prev) return { h: level, type: 'water', variant };
  if (prev.type === 'water') return null;
  if (prev.h !== level) return null;
  return { h: level, type: 'water', variant };
}

// ---- Helpers ------------------------------------------------------------------

// Nearest of seven snap points in a hex: the center and six points halfway to
// each corner.
// Target for a terrain cell change: `prev` becomes `next`, or invalid when null.
function cellResult(q, r, prev, next) {
  const valid = !!next && inWorld(q, r) && next.h <= MAX_LEVEL;
  const h = next?.h ?? prev?.h ?? 0;
  return { kind: 'cell', q, r, key: hexKey(q, r), prev, next, valid, ghostY: rimY(h) - LEVEL_H, ringY: rimY(h) };
}

function snapPoint(q, r, x, z) {
  const c = hexToWorld(q, r);
  let best = { x: c.x, z: c.z };
  let bestD = (x - c.x) ** 2 + (z - c.z) ** 2;
  for (let i = 0; i < 6; i++) {
    const o = cornerOffset(i, HEX_SIZE * 0.5);
    const px = c.x + o.x;
    const pz = c.z + o.z;
    const d = (x - px) ** 2 + (z - pz) ** 2;
    if (d < bestD) {
      bestD = d;
      best = { x: px, z: pz };
    }
  }
  return best;
}

// Cells on the straight line between two hexes, both ends included.
function hexLine(a, b) {
  const n = hexDistance(a.q, a.r, b.q, b.r);
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = n === 0 ? 0 : i / n;
    // A tiny nudge keeps the line off exact cell boundaries.
    out.push(hexRound(a.q + (b.q - a.q) * t + 1e-6, a.r + (b.r - a.r) * t + 1e-6));
  }
  return out;
}

function rand(lo, hi) {
  return lo + Math.random() * (hi - lo);
}

