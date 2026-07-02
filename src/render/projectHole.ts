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
