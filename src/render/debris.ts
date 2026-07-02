import * as THREE from 'three';
import { CONSUME } from '../core/tidal';

// Debris that drifts past this radius has left the visible cosmos; matches
// no other module's constant, this is purely a cull-distance budget.
const ESCAPE_R = 4;

const VERT = /* glsl */ `
  attribute vec3 aColor;
  varying vec3 vColor;
  void main() {
    vColor = aColor;
    if (position.x > 50.0) {
      gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(6.0 / -mvPosition.z, 1.5, 8.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const FRAG = /* glsl */ `
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float alpha = smoothstep(0.5, 0.1, d);
    gl_FragColor = vec4(vColor * alpha, 1.0);
  }
`;

export function createDebrisPool(capacity = 8192): {
  points: THREE.Points;
  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, r: number, g: number, b: number): void;
  update(dt: number, gm: number, drag: number, holeR: number): void;
  dispose(): void;
} {
  const positions = new Float32Array(capacity * 3).fill(99);
  const colors = new Float32Array(capacity * 3);
  const velocities = new Float32Array(capacity * 3);
  const alive = new Uint8Array(capacity);
  let head = 0;

  const geometry = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3);
  const colAttr = new THREE.BufferAttribute(colors, 3);
  geometry.setAttribute('position', posAttr);
  geometry.setAttribute('aColor', colAttr);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 10);

  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 1;

  return {
    points,
    spawn(x, y, z, vx, vy, vz, r, g, b): void {
      const i = head;
      head = (head + 1) % capacity;
      alive[i] = 1;
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      velocities[i * 3] = vx;
      velocities[i * 3 + 1] = vy;
      velocities[i * 3 + 2] = vz;
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
      colAttr.needsUpdate = true; // colors only ever change here, not in update()
    },
    update(dt, gm, drag, holeR): void {
      const dragMul = 1 - drag * dt;
      for (let i = 0; i < capacity; i++) {
        if (!alive[i]) continue;
        const o = i * 3;
        const x = positions[o]!, y = positions[o + 1]!, z = positions[o + 2]!;
        const r2 = x * x + y * y + z * z;
        const r = Math.sqrt(r2);
        if (r < holeR * CONSUME || r > ESCAPE_R) {
          alive[i] = 0;
          positions[o] = 99;
          positions[o + 1] = 99;
          positions[o + 2] = 99;
          continue;
        }
        const a = gm / (r2 + 3e-4);
        velocities[o] = (velocities[o]! - (x / r) * a * dt) * dragMul;
        velocities[o + 1] = (velocities[o + 1]! - (y / r) * a * dt) * dragMul;
        velocities[o + 2] = (velocities[o + 2]! - (z / r) * a * dt) * dragMul;
        positions[o] = x + velocities[o]! * dt;
        positions[o + 1] = y + velocities[o + 1]! * dt;
        positions[o + 2] = z + velocities[o + 2]! * dt;
      }
      posAttr.needsUpdate = true;
    },
    dispose(): void {
      geometry.dispose();
      material.dispose();
    },
  };
}
