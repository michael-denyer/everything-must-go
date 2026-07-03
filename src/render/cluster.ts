// src/render/cluster.ts
import * as THREE from 'three';
import type { ClusterSpec } from '../core/cosmosGen';
import type { Palette } from '../core/palette';
import { paletteRgb } from '../core/palette';
import { mulberry32 } from '../sim/random';
import { CONSUME } from '../core/tidal';
import type { Body } from './body';

export interface ClusterBody extends Body {
  readonly kind: 'cluster';
  readonly object: THREE.Points; // point-cloud ball, positioned in world space
  alive: boolean; // false after unit-swallow completes; conductor removes + disposes
}

type SpawnDebris = (
  x: number,
  y: number,
  z: number,
  vx: number,
  vy: number,
  vz: number,
  r: number,
  g: number,
  b: number,
) => void;

const FORCE_SOFTENING = 3e-4; // matches debris.ts's, planet.ts's, and cast.ts's force law exactly
const ESCAPE_R = 3.4; // guard: same "dragged back out past a sane radius" threshold as cast.ts/galaxy.ts
const SWALLOW_START = 3.0; // ratio (r / holeR) at which unit-swallow begins, per Global Constraints (holeR*3.0)
const SWALLOW_SECONDS = 4.0; // sim-time duration of the swallow ramp
const ACCENT_FRACTION = 0.22; // minority of points drawn as a palette accent rather than warm-white

function circularVelocity(x: number, z: number, gm0: number): { vx: number; vz: number } {
  const r = Math.hypot(x, z) || 1e-6;
  const speed = Math.sqrt(gm0 / r);
  return { vx: (-z / r) * speed, vz: (x / r) * speed };
}

// Same force law and drag application as planet.ts's integrate/galaxy.ts's
// integrate. Replicated locally (module-private in each file, house pattern).
function integrate(
  state: { x: number; y: number; z: number; vx: number; vy: number; vz: number },
  dt: number,
  gm: number,
  dragMul: number,
): void {
  const r2 = state.x * state.x + state.y * state.y + state.z * state.z;
  const r = Math.sqrt(r2);
  const a = gm / (r2 + FORCE_SOFTENING);
  state.vx = (state.vx - (state.x / r) * a * dt) * dragMul;
  state.vy = (state.vy - (state.y / r) * a * dt) * dragMul;
  state.vz = (state.vz - (state.z / r) * a * dt) * dragMul;
  state.x += state.vx * dt;
  state.y += state.vy * dt;
  state.z += state.vz * dt;
}

// Box-Muller gaussian off a mulberry32 stream — same idiom sky.ts uses for
// the band's dot scatter.
function gaussian(rand: () => number): number {
  const u1 = Math.max(rand(), 1e-6);
  const u2 = rand();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(Math.PI * 2 * u2);
}

// ---- Shader: points lerp their local offset toward the object's own origin
// (the swallow target) as uSwallow ramps 0->1, so the whole ball collapses
// inward in its own local frame while the frame itself keeps orbiting toward
// the world hole position — the cloud visually implodes on the way in.
// Brightness rises then fades via a triangular envelope over uSwallow.

const CLUSTER_VERT = /* glsl */ `
  uniform float uSwallow;
  uniform float uPointSize;
  attribute vec3 color;
  varying vec3 vColor;
  varying float vBrightness;
  void main() {
    vColor = color;
    // Triangular envelope: rises to 1 at the midpoint, fades back to 0.15 by completion.
    vBrightness = uSwallow < 0.5
      ? mix(1.0, 2.2, uSwallow * 2.0)
      : mix(2.2, 0.15, (uSwallow - 0.5) * 2.0);
    vec3 collapsed = position * (1.0 - uSwallow);
    vec4 mvPosition = modelViewMatrix * vec4(collapsed, 1.0);
    gl_PointSize = uPointSize * (1.0 - 0.5 * uSwallow) * (300.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const CLUSTER_FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vBrightness;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float falloff = 1.0 - smoothstep(0.0, 0.5, d);
    gl_FragColor = vec4(vColor * vBrightness, falloff);
  }
`;

export function createCluster(spec: ClusterSpec, palette: Palette, gm0: number): ClusterBody {
  const rand = mulberry32(spec.seed);

  const positions = new Float32Array(spec.pointCount * 3);
  const colors = new Float32Array(spec.pointCount * 3);
  const warm: [number, number, number] = [1.0, 0.94, 0.82];
  const accentHueIdx = Math.floor(rand() * 1000);
  const accent = paletteRgb(palette, accentHueIdx, 0.6, 0.62);

  for (let i = 0; i < spec.pointCount; i++) {
    const gx = gaussian(rand);
    const gy = gaussian(rand);
    const gz = gaussian(rand);
    positions[i * 3] = gx * spec.size;
    positions[i * 3 + 1] = gy * spec.size;
    positions[i * 3 + 2] = gz * spec.size;

    const isAccent = rand() < ACCENT_FRACTION;
    const [r, g, b] = isAccent ? accent : warm;
    const shade = 0.75 + rand() * 0.45;
    colors[i * 3] = Math.min(1, r * shade);
    colors[i * 3 + 1] = Math.min(1, g * shade);
    colors[i * 3 + 2] = Math.min(1, b * shade);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.ShaderMaterial({
    vertexShader: CLUSTER_VERT,
    fragmentShader: CLUSTER_FRAG,
    uniforms: {
      uSwallow: { value: 0 },
      uPointSize: { value: 3.2 },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const points = new THREE.Points(geometry, material);

  // ---- Orbit state: circular start at orbitR/phase, planet.ts's/galaxy.ts's
  // idiom — the whole cloud orbits as a unit by moving points.position.
  const startX = spec.orbitR * Math.cos(spec.phase);
  const startZ = spec.orbitR * Math.sin(spec.phase);
  const startV = circularVelocity(startX, startZ, gm0);
  const orbit = { x: startX, y: 0, z: startZ, vx: startV.vx, vy: 0, vz: startV.vz };
  points.position.set(orbit.x, orbit.y, orbit.z);

  let alive = true;
  let disposed = false;
  let swallowing = false;
  let swallowTime = 0; // sim-time seconds accumulated once unit-swallow begins

  const burstRand = mulberry32(spec.seed + 999);

  function puff(spawnDebris: SpawnDebris): void {
    const count = 40;
    for (let i = 0; i < count; i++) {
      const theta = burstRand() * Math.PI * 2;
      const phi = Math.acos(burstRand() * 2 - 1);
      const speed = 0.02 + burstRand() * 0.06;
      const isAccent = burstRand() < ACCENT_FRACTION;
      const [r, g, b] = isAccent ? accent : warm;
      spawnDebris(
        orbit.x,
        orbit.y,
        orbit.z,
        orbit.vx + Math.sin(phi) * Math.cos(theta) * speed,
        orbit.vy + Math.cos(phi) * speed,
        orbit.vz + Math.sin(phi) * Math.sin(theta) * speed,
        r,
        g,
        b,
      );
    }
  }

  const body: ClusterBody = {
    kind: 'cluster' as const,
    object: points,
    alive: true,
    update(dt, gm, dragBase, holeR, spawnDebris): void {
      if (!alive) return;

      // While swallowing, the cloud keeps orbiting/decaying as a unit (the
      // frame moves toward the world hole) while the shader collapses each
      // point's local offset toward the frame's own origin — see CLUSTER_VERT.
      integrate(orbit, dt, gm, 1 - dragBase * dt);
      points.position.set(orbit.x, orbit.y, orbit.z);

      const r = Math.hypot(orbit.x, orbit.y, orbit.z);
      const ratio = r / holeR;

      if (!swallowing && ratio <= SWALLOW_START) {
        swallowing = true;
      }

      if (swallowing) {
        swallowTime += dt;
        const uSwallow = Math.min(1, swallowTime / SWALLOW_SECONDS);
        (material.uniforms.uSwallow!.value as number) = uSwallow;
        if (uSwallow >= 1) {
          puff(spawnDebris);
          alive = false;
          body.alive = false;
          return;
        }
      }

      // Consumed/escape guards, house pattern (cast.ts's/galaxy.ts's CONSUME
      // check): either swallowed by the hole or dragged back out past a sane
      // radius. ESCAPE_R = 3.4 matches cast.ts's/galaxy.ts's guard.
      if (ratio <= CONSUME || r > ESCAPE_R) {
        alive = false;
        body.alive = false;
        return;
      }
    },
    dispose(): void {
      // Idempotent: the conductor may sweep dead bodies whose dispose already ran.
      if (disposed) return;
      disposed = true;
      geometry.dispose();
      material.dispose();
    },
  };

  return body;
}
