// Blueprint ghost: a translucent, color-coded preview of the selected item that
// glides after the cursor, plus hex outlines and red removal highlights.

import * as THREE from 'three';
import { buildModel } from '../catalog/models/index.js';
import { cornerOffset, hexToWorld } from '../core/hex.js';
import { HEX_SIZE, LEVEL_H } from '../core/constants.js';
import { U, LAYERS } from '../render/shared.js';

const GHOST_COLORS = {
  valid: new THREE.Color('#8fe3ff'),
  invalid: new THREE.Color('#ff9a85'),
  destroy: new THREE.Color('#ff6f6f'),
};

function blueprintMaterial(color, { opacity = 1, xray = false } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: color.clone() },
      uOpacity: { value: opacity },
      uTime: U.uTime,
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormalW;
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uTime;
      varying vec3 vNormalW;
      varying vec3 vWorld;
      void main() {
        vec3 n = normalize(vNormalW);
        vec3 v = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - abs(dot(n, v)), 2.0);
        float scan = smoothstep(0.82, 1.0, sin(vWorld.y * 14.0 - uTime * 3.5) * 0.5 + 0.5);
        float top = smoothstep(0.6, 0.95, n.y) * 0.12;
        float a = uOpacity * (0.2 + fres * 0.5 + scan * 0.14 + top);
        gl_FragColor = vec4(uColor * (1.0 + fres * 0.5 + scan * 0.35), a);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: !xray,
    side: THREE.FrontSide,
  });
}

function edgeMaterial(color, opacity = 0.75) {
  return new THREE.LineBasicMaterial({ color: color.clone(), transparent: true, opacity, depthWrite: false });
}

function hexRingGeometry(inner, outer) {
  const pos = [];
  for (let i = 0; i < 6; i++) {
    const a0 = cornerOffset(i, inner);
    const a1 = cornerOffset(i + 1, inner);
    const b0 = cornerOffset(i, outer);
    const b1 = cornerOffset(i + 1, outer);
    pos.push(a0.x, 0, a0.z, b1.x, 0, b1.z, b0.x, 0, b0.z);
    pos.push(a0.x, 0, a0.z, a1.x, 0, a1.z, b1.x, 0, b1.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function setLayer(obj) {
  obj.traverse((o) => o.layers.set(LAYERS.GHOST));
}

export class Ghost {
  constructor(scene) {
    this.root = new THREE.Group();
    this.root.name = 'ghost';
    scene.add(this.root);

    this.fillMat = blueprintMaterial(GHOST_COLORS.valid);
    this.xrayMat = blueprintMaterial(GHOST_COLORS.valid, { opacity: 0.22, xray: true });
    this.lineMat = edgeMaterial(GHOST_COLORS.valid);
    this.destroyFill = blueprintMaterial(GHOST_COLORS.destroy, { opacity: 1.4 });
    this.destroyLine = edgeMaterial(GHOST_COLORS.destroy, 0.9);

    // Model preview.
    this.holder = new THREE.Group();
    this.root.add(this.holder);
    this.modelKey = null;
    this.target = { pos: new THREE.Vector3(), rotY: 0, scale: 1 };
    this.current = { pos: new THREE.Vector3(), rotY: 0, scale: 1 };
    this.hasTarget = false;
    this._modelGeometries = []; // Owned by the current preview; disposed on change.

    // Hex outline on the target cell.
    const ringGeo = hexRingGeometry(HEX_SIZE * 0.86, HEX_SIZE * 0.98);
    this.ringMat = new THREE.MeshBasicMaterial({
      color: GHOST_COLORS.valid.clone(),
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.ring = new THREE.Mesh(ringGeo, this.ringMat);
    this.ring.visible = false;
    this.root.add(this.ring);
    this.ringTarget = new THREE.Vector3();

    // Removal highlight for a terrain layer.
    const prism = new THREE.CylinderGeometry(HEX_SIZE * 1.01, HEX_SIZE * 1.01, LEVEL_H + 0.04, 6);
    this.cellHighlight = new THREE.Group();
    this.cellHighlight.add(new THREE.Mesh(prism, this.destroyFill));
    this.cellHighlight.add(new THREE.LineSegments(new THREE.EdgesGeometry(prism), this.destroyLine));
    this.cellHighlight.visible = false;
    this.root.add(this.cellHighlight);

    // Removal highlight for an object: overlay meshes that copy its transforms.
    this.objectHighlight = new THREE.Group();
    this.objectHighlight.visible = false;
    this.root.add(this.objectHighlight);
    this.highlightSource = null;

    setLayer(this.root);
  }

  // ---- Model preview --------------------------------------------------------

  setItem(itemId, variant = 0, seed = 1) {
    const k = `${itemId}|${variant}|${seed}`;
    if (k === this.modelKey) return;
    this.modelKey = k;
    this._clearHolder();
    this.bounds = null;
    if (!itemId) return;
    const model = buildModel(itemId, variant, seed);
    model.updateMatrixWorld(true);
    this.bounds = new THREE.Box3().setFromObject(model);
    const ghost = new THREE.Group();
    model.traverse((o) => {
      if (!o.isMesh || o.userData.waterMask) return;
      this._modelGeometries.push(o.geometry);
      const m = o.matrixWorld.clone();
      const fill = new THREE.Mesh(o.geometry, this.fillMat);
      fill.matrixAutoUpdate = false;
      fill.matrix.copy(m);
      const xray = new THREE.Mesh(o.geometry, this.xrayMat);
      xray.matrixAutoUpdate = false;
      xray.matrix.copy(m);
      xray.renderOrder = -1;
      const lines = new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, 32), this.lineMat);
      lines.matrixAutoUpdate = false;
      lines.matrix.copy(m);
      ghost.add(xray, fill, lines);
    });
    this.holder.add(ghost);
    setLayer(ghost);
  }

  _clearHolder() {
    for (const child of [...this.holder.children]) {
      child.traverse((o) => {
        if (o.isLineSegments) o.geometry.dispose();
      });
      this.holder.remove(child);
    }
    for (const g of this._modelGeometries) g.dispose();
    this._modelGeometries = [];
  }

  // Move the preview. Large jumps snap; small moves glide.
  setTransform(x, y, z, rotY = 0, scale = 1) {
    this.target.pos.set(x, y, z);
    this.target.rotY = rotY;
    this.target.scale = scale;
    if (!this.hasTarget || this.current.pos.distanceTo(this.target.pos) > 9) {
      this.current.pos.copy(this.target.pos);
      this.current.rotY = rotY;
      this.current.scale = scale;
    }
    this.hasTarget = true;
    this.holder.visible = true;
  }

  hideModel() {
    this.hasTarget = false;
    this.holder.visible = false;
  }

  setValid(valid) {
    const c = valid ? GHOST_COLORS.valid : GHOST_COLORS.invalid;
    this.fillMat.uniforms.uColor.value.copy(c);
    this.xrayMat.uniforms.uColor.value.copy(c);
    this.lineMat.color.copy(c);
    this.ringMat.color.copy(c);
  }

  // ---- Outlines and highlights ---------------------------------------------

  showRing(q, r, y) {
    const c = hexToWorld(q, r);
    const wasHidden = !this.ring.visible;
    this.ringTarget.set(c.x, y + 0.04, c.z);
    if (wasHidden) this.ring.position.copy(this.ringTarget);
    this.ring.visible = true;
  }

  hideRing() {
    this.ring.visible = false;
  }

  showDestroyCell(q, r, topY) {
    const c = hexToWorld(q, r);
    this.cellHighlight.position.set(c.x, topY - LEVEL_H / 2, c.z);
    this.cellHighlight.visible = true;
  }

  hideDestroyCell() {
    this.cellHighlight.visible = false;
  }

  showDestroyObject(root) {
    if (root === this.highlightSource) {
      this.objectHighlight.visible = !!root;
      return;
    }
    for (const child of [...this.objectHighlight.children]) {
      if (child.isLineSegments) child.geometry.dispose();
      this.objectHighlight.remove(child);
    }
    this.highlightSource = root;
    this.objectHighlight.visible = !!root;
    if (!root) return;
    root.traverse((o) => {
      if (!o.isMesh || o.userData.waterMask) return;
      const fill = new THREE.Mesh(o.geometry, this.destroyFill);
      fill.matrixAutoUpdate = false;
      fill.userData.source = o;
      const lines = new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, 32), this.destroyLine);
      lines.matrixAutoUpdate = false;
      lines.userData.source = o;
      this.objectHighlight.add(fill, lines);
    });
    setLayer(this.objectHighlight);
  }

  hideAll() {
    this.hideModel();
    this.hideRing();
    this.hideDestroyCell();
    this.showDestroyObject(null);
  }

  update(dt) {
    const k = 1 - Math.exp(-24 * dt);
    if (this.hasTarget) {
      const c = this.current;
      c.pos.lerp(this.target.pos, k);
      let d = this.target.rotY - c.rotY;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      c.rotY += d * Math.min(1, k * 1.2);
      c.scale += (this.target.scale - c.scale) * k;
      const bob = Math.sin(U.uTime.value * 3) * 0.035 + 0.05;
      this.holder.position.set(c.pos.x, c.pos.y + bob, c.pos.z);
      this.holder.rotation.y = c.rotY;
      this.holder.scale.setScalar(c.scale);
    }
    if (this.ring.visible) {
      this.ring.position.lerp(this.ringTarget, k);
      const pulse = 0.45 + 0.2 * Math.sin(U.uTime.value * 4);
      this.ringMat.opacity = pulse;
    }
    if (this.objectHighlight.visible) {
      for (const child of this.objectHighlight.children) {
        const src = child.userData.source;
        if (src) child.matrix.copy(src.matrixWorld);
      }
    }
    const pulse = 0.85 + 0.15 * Math.sin(U.uTime.value * 6);
    this.destroyFill.uniforms.uOpacity.value = 1.3 * pulse;
  }
}
