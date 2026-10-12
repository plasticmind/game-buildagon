// Pure placement math shared by the build controller and the world generator.

import { hexToWorld, edgeMidOffset, edgeAngle, angleToRotY, edgeKey, key as hexKey } from '../core/hex.js';

// Transform for an edge item on edge `edge` of cell (q, r), base at y.
// The model's local X runs along the edge; local +Z faces the cell interior.
export function edgeTransform(q, r, edge, y) {
  const c = hexToWorld(q, r);
  const o = edgeMidOffset(edge);
  return {
    x: c.x + o.x,
    y,
    z: c.z + o.z,
    rotY: angleToRotY(edgeAngle(edge) + Math.PI / 2),
    cell: hexKey(q, r),
    edge,
    edgeKey: edgeKey(q, r, edge),
  };
}

// Transform for a cell item centered on (q, r), base at y, rotated `steps` × 60°.
export function cellTransform(q, r, y, steps = 0) {
  const c = hexToWorld(q, r);
  return { x: c.x, y, z: c.z, rotY: angleToRotY(edgeAngle(steps)), cell: hexKey(q, r), edge: null };
}
