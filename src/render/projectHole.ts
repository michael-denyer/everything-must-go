// src/render/projectHole.ts
import * as THREE from 'three';

export function projectHole(
  camera: THREE.PerspectiveCamera,
  worldRadius: number,
  viewportWidth: number,
  viewportHeight: number,
): { centerUv: [number, number]; radiusUv: number } {
  // Assumes the hole sits at the world origin; both projected points below
  // bake that in. Revisit if the hole ever gets a position parameter.
  const center = new THREE.Vector3(0, 0, 0).project(camera);
  const right = new THREE.Vector3()
    .setFromMatrixColumn(camera.matrixWorld, 0)
    .multiplyScalar(worldRadius)
    .project(camera);
  const centerUv: [number, number] = [(center.x + 1) / 2, (center.y + 1) / 2];
  const edgeUv: [number, number] = [(right.x + 1) / 2, (right.y + 1) / 2];
  const aspect = viewportWidth / viewportHeight;
  const dx = (edgeUv[0] - centerUv[0]) * aspect;
  const dy = edgeUv[1] - centerUv[1];
  return { centerUv, radiusUv: Math.hypot(dx, dy) };
}

// Converts a bottom-up NDC-derived uv (y=0 at the bottom, as produced by
// projectHole above) into top-down CSS pixel space (y=0 at the top). This is
// the flip point between the shader convention (bottom-up) and DOM/CSS
// convention (top-down) — callers handing a hole position to DOM elements
// must go through here rather than scaling uv by width/height directly.
export function uvToPixels(uv: [number, number], width: number, height: number): [number, number] {
  return [uv[0] * width, (1 - uv[1]) * height];
}
