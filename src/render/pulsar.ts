// src/render/pulsar.ts
import * as THREE from 'three';
import type { PulsarSpec } from '../core/cosmosGen';
import { mulberry32 } from '../sim/random';
import { CONSUME } from '../core/tidal';
import type { Body } from './body';

export interface PulsarBody extends Body {
  readonly kind: 'pulsar';
  readonly object: THREE.Group; // strobe point + two beam quads, positioned in world space
  alive: boolean; // false after the CONSUME flash; conductor removes + disposes
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

const FORCE_SOFTENING = 3e-4; // matches debris.ts's/planet.ts's/cast.ts's force law exactly
const ESCAPE_R = 3.4; // guard: same "dragged back out past a sane radius" threshold as cast.ts/galaxy.ts/cluster.ts
const STROBE_HZ = 4; // sim-time square-wave frequency
const STROBE_LOW = 0.4;
const STROBE_HIGH = 1.0;
const BEAM_OMEGA = 3; // rad/s, sim-time
const BEAM_LENGTH = 0.5; // world units
const BEAM_WIDTH = 0.008; // world units
const POINT_SIZE_PX = 3;
const PLUNGE_RATIO = 0.85; // fraction of orbitR below which the personal drag multiplier engages
const PLUNGE_DRAG_MUL = 6; // x6 personal drag multiplier once plunging
const FLASH_TINT: [number, number, number] = [0.6, 0.75, 1.0]; // pale blue
const FLASH_COUNT = 30;

function circularVelocity(x: number, z: number, gm0: number): { vx: number; vz: number } {
  const r = Math.hypot(x, z) || 1e-6;
  const speed = Math.sqrt(gm0 / r);
  return { vx: (-z / r) * speed, vz: (x / r) * speed };
}

// Same force law and drag application as planet.ts's/galaxy.ts's/cluster.ts's
// integrate. Replicated locally (module-private in each file, house pattern).
// dragMul is passed in fully-formed (base drag already combined with any
// personal multiplier) so this stays a pure orbital-mechanics step.
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

// ---- Strobe shader: a single additive point, intensity driven by a CPU-
// computed uIntensity uniform (the 4 Hz square wave lives in update(), not
// in the shader, so it stays driven by accumulated sim dt like everything
// else here — no wall-clock, no shader-side time uniform to keep in sync).

const STROBE_VERT = /* glsl */ `
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = ${POINT_SIZE_PX.toFixed(1)};
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const STROBE_FRAG = /* glsl */ `
  uniform float uIntensity;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float alpha = smoothstep(0.5, 0.1, d);
    gl_FragColor = vec4(vec3(1.0) * uIntensity * alpha, alpha);
  }
`;

// ---- Beam shader: a flat additive quad, brightest along its centerline and
// fading toward the long edges, uIntensity-scaled to match the strobe.
// ADDITIVE + DoubleSide (set on the material below) so the beam can never be
// culled to invisibility regardless of how BEAM_OMEGA has rotated it —
// applying the lesson from sky.ts's front-face-away bug directly rather than
// depending on winding order or a lookAt.

const BEAM_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const BEAM_FRAG = /* glsl */ `
  uniform float uIntensity;
  varying vec2 vUv;
  void main() {
    float across = abs(vUv.y - 0.5) * 2.0; // 0 at centerline, 1 at edge
    float along = 1.0 - abs(vUv.x - 0.5) * 2.0; // 0 at tips, 1 at center
    float falloff = (1.0 - smoothstep(0.0, 1.0, across)) * mix(0.4, 1.0, along);
    gl_FragColor = vec4(vec3(0.75, 0.85, 1.0) * uIntensity * falloff, falloff);
  }
`;

export function createPulsar(spec: PulsarSpec, gm0: number): PulsarBody {
  const group = new THREE.Group();

  // ---- Strobe point ----
  const pointGeometry = new THREE.BufferGeometry();
  pointGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
  const pointMaterial = new THREE.ShaderMaterial({
    vertexShader: STROBE_VERT,
    fragmentShader: STROBE_FRAG,
    uniforms: { uIntensity: { value: STROBE_HIGH } },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });
  const strobePoint = new THREE.Points(pointGeometry, pointMaterial);
  strobePoint.frustumCulled = false;
  strobePoint.renderOrder = 1; // matches debris/foreground particle convention (comet.ts precedent)
  group.add(strobePoint);

  // ---- Two opposed beam quads, rotated about the pulsar point by a parent
  // "beams" group so BEAM_OMEGA only has to update one rotation.z. ----
  const beamGeometry = new THREE.PlaneGeometry(BEAM_LENGTH, BEAM_WIDTH);
  const beamMaterialA = new THREE.ShaderMaterial({
    vertexShader: BEAM_VERT,
    fragmentShader: BEAM_FRAG,
    uniforms: { uIntensity: { value: STROBE_HIGH } },
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false,
  });
  const beamMaterialB = new THREE.ShaderMaterial({
    vertexShader: BEAM_VERT,
    fragmentShader: BEAM_FRAG,
    uniforms: { uIntensity: { value: STROBE_HIGH } },
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false,
  });
  const beamsGroup = new THREE.Group();
  const beamA = new THREE.Mesh(beamGeometry, beamMaterialA);
  beamA.position.x = BEAM_LENGTH / 2;
  const beamB = new THREE.Mesh(beamGeometry, beamMaterialB);
  beamB.position.x = -BEAM_LENGTH / 2;
  beamsGroup.add(beamA);
  beamsGroup.add(beamB);
  group.add(beamsGroup);

  // ---- Orbit state: circular start at orbitR/phase, planet.ts's/galaxy.ts's
  // idiom (pulsar holds orbit until drag erodes it, same as planets/galaxies —
  // NOT cast.ts's plunge-entry model).
  const startX = spec.orbitR * Math.cos(spec.phase);
  const startZ = spec.orbitR * Math.sin(spec.phase);
  const startV = circularVelocity(startX, startZ, gm0);
  const orbit = { x: startX, y: 0, z: startZ, vx: startV.vx, vy: 0, vz: startV.vz };
  group.position.set(orbit.x, orbit.y, orbit.z);

  let alive = true;
  let disposed = false;
  let clock = 0; // accumulated sim-time seconds, drives both the strobe and the beam rotation
  const burstRand = mulberry32(
    // No dedicated integer seed field on PulsarSpec — orbitR/phase are floats,
    // not seeds. Derive a stable integer stream from the phase the same way
    // titleEater.ts's unified derivation folds a float-adjacent value into a
    // seed (bitwise fold via Math.imul), so a given cosmos always produces the
    // same flash roll without adding a new generator field mid-plan.
    (Math.imul(Math.floor(spec.phase * 1e6), 0x9e3779b9) ^ Math.floor(spec.orbitR * 1e6)) >>> 0,
  );

  function flash(spawnDebris: SpawnDebris): void {
    for (let i = 0; i < FLASH_COUNT; i++) {
      const theta = burstRand() * Math.PI * 2;
      const phi = Math.acos(burstRand() * 2 - 1);
      const speed = 0.03 + burstRand() * 0.08;
      spawnDebris(
        orbit.x,
        orbit.y,
        orbit.z,
        orbit.vx + Math.sin(phi) * Math.cos(theta) * speed,
        orbit.vy + Math.cos(phi) * speed,
        orbit.vz + Math.sin(phi) * Math.sin(theta) * speed,
        FLASH_TINT[0],
        FLASH_TINT[1],
        FLASH_TINT[2],
      );
    }
  }

  const body: PulsarBody = {
    kind: 'pulsar' as const,
    object: group,
    alive: true,
    update(dt, gm, dragBase, holeR, spawnDebris): void {
      if (!alive) return;

      clock += dt;

      // Body.update carries no `progress` parameter, so the plunge cannot be
      // driven directly from cycle progress the way the conductor schedules
      // dragBase itself. Instead: the conductor already grows dragBase with
      // progress (see main.ts's frame loop), so as the cycle advances the
      // pulsar's own orbital radius decays under that same growing base drag
      // like every other orbiting body. Once that natural decay carries the
      // radius below orbitR * PLUNGE_RATIO, engage an extra x6 PERSONAL drag
      // multiplier on top of dragBase — the plunge emerges from watching its
      // own state, not from being told what progress it is. This is the
      // indirection the plan's contract calls for: no progress input, just a
      // radius threshold against a multiplier of the same dragBase the
      // conductor is already scheduling.
      const rBefore = Math.hypot(orbit.x, orbit.y, orbit.z);
      const plunging = rBefore < spec.orbitR * PLUNGE_RATIO;
      const dragMul = 1 - dragBase * (plunging ? PLUNGE_DRAG_MUL : 1) * dt;
      integrate(orbit, dt, gm, dragMul);
      group.position.set(orbit.x, orbit.y, orbit.z);

      // Strobe: 4 Hz sim-time square wave, 0.4 <-> 1.0. floor(clock * hz * 2)
      // parity flips twice per cycle, i.e. STROBE_HZ times per second.
      const phase = Math.floor(clock * STROBE_HZ * 2) % 2;
      const intensity = phase === 0 ? STROBE_HIGH : STROBE_LOW;
      (pointMaterial.uniforms.uIntensity!.value as number) = intensity;
      (beamMaterialA.uniforms.uIntensity!.value as number) = intensity;
      (beamMaterialB.uniforms.uIntensity!.value as number) = intensity;

      // Beams: rotate about the pulsar point at BEAM_OMEGA rad/s sim-time.
      beamsGroup.rotation.z = clock * BEAM_OMEGA;

      const r = Math.hypot(orbit.x, orbit.y, orbit.z);
      const ratio = r / holeR;

      if (ratio <= CONSUME || r > ESCAPE_R) {
        if (ratio <= CONSUME) flash(spawnDebris);
        alive = false;
        body.alive = false;
        return;
      }
    },
    dispose(): void {
      // Idempotent: the conductor may sweep dead bodies whose dispose already ran.
      if (disposed) return;
      disposed = true;
      pointGeometry.dispose();
      pointMaterial.dispose();
      beamGeometry.dispose();
      beamMaterialA.dispose();
      beamMaterialB.dispose();
    },
  };

  return body;
}
