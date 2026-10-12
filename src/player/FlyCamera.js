// Free-flying sandbox camera: WASD to fly level with the ground, Q/E to sink and
// rise, Shift to slow down, Ctrl to speed up. Look around with the right mouse
// button or Space. Movement eases in and out for a soft, floaty feel.

import * as THREE from 'three';
import { worldToHex } from '../core/hex.js';
import { HEX_W, WORLD_RADIUS, SEA_Y } from '../core/constants.js';

const BASE_SPEED = 13;
const LOOK_SPEED = 0.0024;
const MIN_CLEARANCE = 0.9;
const MAX_HEIGHT = 140;
const BOUND = WORLD_RADIUS * HEX_W + 60;
const DEFAULT_POSE = { position: [0, 21, 40], yaw: 0, pitch: -0.5 };
// Closer view for open water, where the first tile goes near the origin.
const CLOSE_POSE = { position: [0, 10, 19], yaw: 0, pitch: -0.48 };

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _wish = new THREE.Vector3();
const _dir = new THREE.Vector3();

export class FlyCamera {
  constructor(camera, input, world, settings) {
    this.camera = camera;
    this.input = input;
    this.world = world;
    this.settings = settings;
    this.yaw = 0;
    this.pitch = 0;
    this.velocity = new THREE.Vector3();
    this.focus = new THREE.Vector3();
    this.reset();
  }

  reset({ close = false } = {}) {
    this.setPose(close ? CLOSE_POSE : DEFAULT_POSE);
  }

  getPose() {
    const p = this.camera.position;
    return { position: [p.x, p.y, p.z], yaw: this.yaw, pitch: this.pitch };
  }

  setPose(pose) {
    if (!pose?.position) return;
    this.camera.position.fromArray(pose.position);
    this.yaw = pose.yaw ?? 0;
    this.pitch = pose.pitch ?? 0;
    this.velocity.set(0, 0, 0);
    this._apply();
  }

  update(dt, enabled = true) {
    const { input, settings } = this;

    if (input.looking) {
      const { dx, dy } = input.consumeLook();
      const sens = LOOK_SPEED * (settings.mouseSensitivity ?? 1);
      this.yaw -= dx * sens;
      this.pitch -= dy * sens * (settings.invertY ? -1 : 1);
      this.pitch = THREE.MathUtils.clamp(this.pitch, -1.53, 1.4);
    }

    // Desired velocity from the keys.
    _wish.set(0, 0, 0);
    if (enabled) {
      _fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      _right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      if (input.isDown('KeyW')) _wish.add(_fwd);
      if (input.isDown('KeyS')) _wish.sub(_fwd);
      if (input.isDown('KeyD')) _wish.add(_right);
      if (input.isDown('KeyA')) _wish.sub(_right);
      if (input.isDown('KeyE')) _wish.y += 1;
      if (input.isDown('KeyQ')) _wish.y -= 1;
      if (_wish.lengthSq() > 0) _wish.normalize();

      let speed = BASE_SPEED * (settings.cameraSpeed ?? 1);
      // Cover ground faster when flying high.
      speed *= 1 + Math.max(0, this.camera.position.y - 12) / 35;
      if (input.isDown('ShiftLeft') || input.isDown('ShiftRight')) speed *= 0.3;
      if (input.isDown('ControlLeft') || input.isDown('ControlRight')) speed *= 3;
      _wish.multiplyScalar(speed);
    }

    // Ease toward the desired velocity: quick to start, gentle to stop.
    const accel = _wish.lengthSq() > 0 ? 9 : 6;
    this.velocity.lerp(_wish, 1 - Math.exp(-accel * dt));
    if (this.velocity.lengthSq() < 1e-6) this.velocity.set(0, 0, 0);
    this.camera.position.addScaledVector(this.velocity, dt);

    this._constrain();
    this._apply();
  }

  _constrain() {
    const p = this.camera.position;
    const horiz = Math.hypot(p.x, p.z);
    if (horiz > BOUND) {
      p.x *= BOUND / horiz;
      p.z *= BOUND / horiz;
    }
    const { q, r } = worldToHex(p.x, p.z);
    const surface = this.world.surfaceY(q, r);
    const floor = Math.max(surface ?? SEA_Y, SEA_Y) + MIN_CLEARANCE;
    if (p.y < floor) {
      p.y = THREE.MathUtils.lerp(p.y, floor, 0.35);
      if (this.velocity.y < 0) this.velocity.y = 0;
    }
    if (p.y > MAX_HEIGHT) p.y = MAX_HEIGHT;
  }

  _apply() {
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.updateMatrixWorld();

    // Focus: where the view ray meets the ground, for shadows and fog.
    this.camera.getWorldDirection(_dir);
    const p = this.camera.position;
    let dist = 30;
    if (_dir.y < -0.05) dist = Math.min(60, (p.y - 0.5) / -_dir.y);
    this.focus.set(p.x + _dir.x * dist, 0, p.z + _dir.z * dist);
    // Keep a shadow-casting area around the camera even when looking far away.
    const back = Math.hypot(this.focus.x - p.x, this.focus.z - p.z);
    if (back > 30) this.focus.lerp(new THREE.Vector3(p.x, 0, p.z), (back - 30) / back);
  }
}
