import * as THREE from 'three';
import { CONSUME } from '../core/tidal';
import { WELL_RADIUS } from '../config';

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
  update(
    dt: number,
    gm: number,
    drag: number,
    holeR: number,
    well?: { x: number; y: number; z: number; strength: number },
    rogue?: { x: number; y: number; z: number; radius: number },
  ): void;
  aliveCount(): number;
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
    update(dt, gm, drag, holeR, well, rogue): void {
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
        // Rogue consumption: mirrors the gpuSim position/velocity park-pair —
        // same texel condition (distance to rogue center < rogue.radius),
        // park at 99s with zero velocity, checked before any force accumulates.
        if (rogue && rogue.radius > 0) {
          const dxr = x - rogue.x, dyr = y - rogue.y, dzr = z - rogue.z;
          const distR = Math.sqrt(dxr * dxr + dyr * dyr + dzr * dzr);
          if (distR < rogue.radius) {
            alive[i] = 0;
            positions[o] = 99;
            positions[o + 1] = 99;
            positions[o + 2] = 99;
            continue;
          }
        }
        const a = gm / (r2 + 3e-4);
        let ax = -(x / r) * a;
        let ay = -(y / r) * a;
        let az = -(z / r) * a;
        // Rogue attractor: folded into accel (like main gravity), matching
        // gpuSim's velocity shader term `0.2 * uGm / (d2r + 3e-4)`.
        if (rogue && rogue.radius > 0) {
          const dxr = rogue.x - x, dyr = rogue.y - y, dzr = rogue.z - z;
          const d2r = dxr * dxr + dyr * dyr + dzr * dzr;
          const dr = Math.max(Math.sqrt(d2r), 1e-4);
          const ar = (0.2 * gm) / (d2r + 3e-4);
          ax += (dxr / dr) * ar;
          ay += (dyr / dr) * ar;
          az += (dzr / dr) * ar;
        }
        velocities[o] = (velocities[o]! + ax * dt) * dragMul;
        velocities[o + 1] = (velocities[o + 1]! + ay * dt) * dragMul;
        velocities[o + 2] = (velocities[o + 2]! + az * dt) * dragMul;
        // Cursor well: added directly to velocity (not folded into accel),
        // matching gpuSim's velocity shader `next += dir * (strength*dt/(d2+0.006))`.
        // WELL_RADIUS * WELL_RADIUS mirrors gpuSim.ts's `${wellRadiusSq}` build-time
        // interpolation of the same constant — keep both in sync if WELL_RADIUS changes.
        if (well && well.strength > 0) {
          const dxw = well.x - x, dyw = well.y - y, dzw = well.z - z;
          const d2 = dxw * dxw + dyw * dyw + dzw * dzw;
          if (d2 < WELL_RADIUS * WELL_RADIUS) {
            const dw = Math.max(Math.sqrt(d2), 1e-4);
            const wf = (well.strength * dt) / (d2 + 0.006);
            velocities[o] = velocities[o]! + (dxw / dw) * wf;
            velocities[o + 1] = velocities[o + 1]! + (dyw / dw) * wf;
            velocities[o + 2] = velocities[o + 2]! + (dzw / dw) * wf;
          }
        }
        positions[o] = x + velocities[o]! * dt;
        positions[o + 1] = y + velocities[o + 1]! * dt;
        positions[o + 2] = z + velocities[o + 2]! * dt;
      }
      posAttr.needsUpdate = true;
    },
    aliveCount(): number {
      let n = 0;
      for (let i = 0; i < capacity; i++) n += alive[i]!;
      return n;
    },
    dispose(): void {
      geometry.dispose();
      material.dispose();
    },
  };
}
