// Keyboard and mouse state for the game canvas.
//
// Events:
//   'keydown' (KeyboardEvent)  game keys only; typing in form fields is ignored
//   'primaryDown' (PointerEvent) left button pressed on the canvas
//   'primaryUp'   (PointerEvent)
//   'wheel'   (steps)            +1 or -1 per detent; trackpads accumulate
//
// Looking around: hold the right or middle mouse button, or hold Space, and move
// the mouse. The pointer is locked while looking, so the cursor stays put.

import * as THREE from 'three';
import { Emitter } from '../core/events.js';

const WHEEL_STEP = 50; // Pixels of scroll per rotation step.
const BLOCKED_DEFAULTS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'F1']);

function isTyping(target) {
  if (!target || !(target instanceof Element)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export class Input extends Emitter {
  constructor(canvas) {
    super();
    this.canvas = canvas;
    this.keys = new Set();
    this.mouse = { x: innerWidth / 2, y: innerHeight / 2, ndc: new THREE.Vector2(), overCanvas: false };
    this.primaryHeld = false;
    this._lookButtons = new Set();
    this._lookDx = 0;
    this._lookDy = 0;
    this._wheelAccum = 0;

    addEventListener('keydown', (e) => this._keyDown(e));
    addEventListener('keyup', (e) => this._keyUp(e));
    addEventListener('blur', () => this._reset());
    addEventListener('pointermove', (e) => this._pointerMove(e));
    addEventListener('pointerup', (e) => this._pointerUp(e));
    canvas.addEventListener('pointerdown', (e) => this._pointerDown(e));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => this._wheel(e), { passive: false });
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== canvas) this._lookButtons.clear();
    });
  }

  isDown(code) {
    return this.keys.has(code);
  }

  get looking() {
    return this._lookButtons.size > 0;
  }

  // Mouse movement accumulated while looking, then cleared.
  consumeLook() {
    const d = { dx: this._lookDx, dy: this._lookDy };
    this._lookDx = 0;
    this._lookDy = 0;
    return d;
  }

  // ---- Internals ----------------------------------------------------------

  _keyDown(e) {
    if (isTyping(e.target)) return;
    if (BLOCKED_DEFAULTS.has(e.code)) e.preventDefault();
    if (e.code === 'Space' && !e.repeat) this._startLook('space');
    // Ctrl + WASD would trigger browser shortcuts on some platforms.
    if (e.ctrlKey && /^Key[WASDQE]$/.test(e.code)) e.preventDefault();
    const repeat = this.keys.has(e.code);
    this.keys.add(e.code);
    if (!repeat || e.code.startsWith('Arrow')) this.emit('keydown', e);
  }

  _keyUp(e) {
    this.keys.delete(e.code);
    // macOS drops keyup for other keys while Cmd is held.
    if (e.key === 'Meta') this.keys.clear();
    if (e.code === 'Space') this._stopLook('space');
  }

  _pointerMove(e) {
    if (this.looking) {
      this._lookDx += e.movementX || 0;
      this._lookDy += e.movementY || 0;
      if (document.pointerLockElement === this.canvas) return;
    }
    this.mouse.x = e.clientX;
    this.mouse.y = e.clientY;
    this.mouse.overCanvas = e.target === this.canvas;
    this._updateNdc();
  }

  _updateNdc() {
    const r = this.canvas.getBoundingClientRect();
    this.mouse.ndc.set(((this.mouse.x - r.left) / r.width) * 2 - 1, -((this.mouse.y - r.top) / r.height) * 2 + 1);
  }

  _pointerDown(e) {
    this.mouse.overCanvas = true;
    if (e.button === 0) {
      if (this.isDown('Space')) return;
      this.primaryHeld = true;
      this.emit('primaryDown', e);
    } else if (e.button === 1 || e.button === 2) {
      e.preventDefault();
      this._startLook(`button${e.button}`);
    }
  }

  _pointerUp(e) {
    if (e.button === 0 && this.primaryHeld) {
      this.primaryHeld = false;
      this.emit('primaryUp', e);
    } else if (e.button === 1 || e.button === 2) {
      this._stopLook(`button${e.button}`);
    }
  }

  _startLook(source) {
    const wasLooking = this.looking;
    this._lookButtons.add(source);
    if (!wasLooking) {
      this._lookDx = 0;
      this._lookDy = 0;
      try {
        const p = this.canvas.requestPointerLock?.({ unadjustedMovement: false });
        p?.catch?.(() => {});
      } catch {
        // Pointer lock can be refused; movementX still works without it.
      }
    }
  }

  _stopLook(source) {
    this._lookButtons.delete(source);
    if (!this.looking && document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  _wheel(e) {
    e.preventDefault();
    if (e.ctrlKey) return; // Pinch-zoom gesture on trackpads.
    const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1;
    const delta = (Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX) * scale;
    this._wheelAccum += delta;
    let steps = Math.trunc(this._wheelAccum / WHEEL_STEP);
    if (steps === 0 && Math.abs(delta) >= WHEEL_STEP * 0.8) steps = Math.sign(delta);
    if (steps !== 0) {
      this._wheelAccum = 0;
      steps = Math.max(-3, Math.min(3, steps));
      for (let i = 0; i < Math.abs(steps); i++) this.emit('wheel', Math.sign(steps));
    }
  }

  _reset() {
    this.keys.clear();
    this._lookButtons.clear();
    if (this.primaryHeld) {
      this.primaryHeld = false;
      this.emit('primaryUp', null);
    }
  }
}
