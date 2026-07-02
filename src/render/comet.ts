// src/render/comet.ts
import * as THREE from 'three';
import { CONSUME } from '../core/tidal';
import { mulberry32 } from '../sim/random';
import type { Rgb } from '../core/palette';
import type { Body } from './body';

// Same Body shape as PlanetBody (src/render/planet.ts): object/update/alive/dispose.
// Not imported from planet.ts — comets have no ring/moon lifecycle, so this is
// the same interface re-declared locally rather than a shared base type.
export interface CometBody extends Body {
  readonly kind: 'comet';
  readonly object: THREE.Group; // head sprite + trail line, positioned in world space
  update(
    dt: number,
    gm: number,
    dragBase: number,
    holeR: number,
    spawnDebris: (
      x: number,
      y: number,
      z: number,
      vx: number,
      vy: number,
      vz: number,
      r: number,
      g: number,
      b: number,
    ) => void,
  ): void;
  alive: boolean;
  dispose(): void;
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

const FORCE_SOFTENING = 3e-4; // matches debris.ts's and planet.ts's force law exactly
const COMET_DRAG_SCALE = 1.0; // comets are light: full drag, unlike planet.ts's 0.55
const TRAIL_LEN = 24;
const HEAD_SIZE_PX = 2.5;
const SHED_PERIOD = 0.25; // seconds between shed debris while r < SHED_R
const SHED_R = 1.1;
const SHED_TINT: Rgb = [0.78, 0.86, 1.0]; // pale-blue

// ---- Head shader: a single additive point, bright, small ------------------

const HEAD_VERT = /* glsl */ `
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = ${HEAD_SIZE_PX.toFixed(1)};
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const HEAD_FRAG = /* glsl */ `
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float alpha = smoothstep(0.5, 0.1, d);
    gl_FragColor = vec4(vec3(1.0) * alpha, 1.0);
  }
`;

// ---- Trail shader: THREE.Line with per-vertex fading alpha via vertex
// colors — the ring buffer writes both position and color each frame, so the
// fade is baked into the buffer rather than computed in-shader.

const TRAIL_VERT = /* glsl */ `
  attribute vec4 aColor;
  varying vec4 vColor;
  void main() {
    vColor = aColor;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const TRAIL_FRAG = /* glsl */ `
  varying vec4 vColor;
  void main() {
    gl_FragColor = vColor;
  }
`;

function visVivaTangentialVelocity(
  x: number,
  z: number,
  gm0: number,
  aphelion: number,
  perihelion: number,
): { vx: number; vz: number } {
  const r = Math.hypot(x, z) || 1e-6;
  const speed = Math.sqrt((gm0 * 2 * perihelion) / (aphelion * (aphelion + perihelion)));
  return { vx: (-z / r) * speed, vz: (x / r) * speed };
}

export function createComet(
  spec: { aphelion: number; perihelion: number; phase: number },
  gm0: number,
  seed?: number,
): CometBody {
  const group = new THREE.Group();
  // Inherited fix: seed shed-debris off the generator's own integer seed
  // (cometSeeds[i], threaded in by the Task 5 conductor) rather than
  // re-deriving one from the float phase. The float-phase derivation only
  // remains as a fallback for when seed is undefined — main.ts still calls
  // createComet(cs, GM) without a seed until Task 5 wires cometSeeds through;
  // Task 5 removes this fallback once every caller passes seed.
  const seedMaterial = seed !== undefined ? seed : Math.floor(spec.phase * 1e6) ^ 0x2545f491;

  // ---- Head ----
  const headGeometry = new THREE.BufferGeometry();
  headGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
  const headMaterial = new THREE.ShaderMaterial({
    vertexShader: HEAD_VERT,
    fragmentShader: HEAD_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });
  const headPoint = new THREE.Points(headGeometry, headMaterial);
  headPoint.frustumCulled = false;
  headPoint.renderOrder = 1; // matches debris/foreground particle convention
  group.add(headPoint);

  // ---- Trail: ring buffer of the last TRAIL_LEN world positions, rendered
  // as one THREE.Line whose vertex order always runs oldest -> newest so the
  // line never zigzags as the ring buffer wraps. ----
  const trailPositions = new Float32Array(TRAIL_LEN * 3);
  const trailColors = new Float32Array(TRAIL_LEN * 4);
  const trailGeometry = new THREE.BufferGeometry();
  const trailPosAttr = new THREE.BufferAttribute(trailPositions, 3);
  const trailColorAttr = new THREE.BufferAttribute(trailColors, 4);
  trailGeometry.setAttribute('position', trailPosAttr);
  trailGeometry.setAttribute('aColor', trailColorAttr);
  const trailMaterial = new THREE.ShaderMaterial({
    vertexShader: TRAIL_VERT,
    fragmentShader: TRAIL_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });
  const trailLine = new THREE.Line(trailGeometry, trailMaterial);
  trailLine.frustumCulled = false;
  trailLine.renderOrder = 1;
  group.add(trailLine);

  // Ring buffer state: trailHead is the index the NEXT sample overwrites;
  // trailFilled counts how many of the TRAIL_LEN slots hold real history.
  // Starts at 0 here; the seed call below (pushTrailSample at the comet's
  // start position) brings it to 1 before the first update() ever runs.
  const trailX = new Float32Array(TRAIL_LEN);
  const trailY = new Float32Array(TRAIL_LEN);
  const trailZ = new Float32Array(TRAIL_LEN);
  let trailHead = 0;
  let trailFilled = 0;

  function pushTrailSample(x: number, y: number, z: number): void {
    trailX[trailHead] = x;
    trailY[trailHead] = y;
    trailZ[trailHead] = z;
    trailHead = (trailHead + 1) % TRAIL_LEN;
    trailFilled = Math.min(TRAIL_LEN, trailFilled + 1);
  }

  function writeTrailBuffers(): void {
    // Oldest sample is TRAIL_LEN-trailFilled steps behind trailHead (mod
    // TRAIL_LEN); iterate from oldest to newest so vertex 0 is always the
    // tail and the last written vertex is always the head-adjacent point.
    const start = (trailHead - trailFilled + TRAIL_LEN) % TRAIL_LEN;
    for (let i = 0; i < TRAIL_LEN; i++) {
      if (i < trailFilled) {
        const idx = (start + i) % TRAIL_LEN;
        trailPositions[i * 3] = trailX[idx]!;
        trailPositions[i * 3 + 1] = trailY[idx]!;
        trailPositions[i * 3 + 2] = trailZ[idx]!;
        // Fade oldest -> newest: alpha 0 at the tail, ~1 approaching the head.
        const alpha = trailFilled > 1 ? i / (trailFilled - 1) : 1;
        trailColors[i * 4] = SHED_TINT[0];
        trailColors[i * 4 + 1] = SHED_TINT[1];
        trailColors[i * 4 + 2] = SHED_TINT[2];
        trailColors[i * 4 + 3] = alpha * 0.6;
      } else {
        // Unfilled slots collapse onto the tail position at zero alpha so
        // THREE.Line's fixed-length vertex buffer draws no visible segment
        // there before the trail has TRAIL_LEN samples of history.
        const idx = start % TRAIL_LEN;
        trailPositions[i * 3] = trailX[idx]!;
        trailPositions[i * 3 + 1] = trailY[idx]!;
        trailPositions[i * 3 + 2] = trailZ[idx]!;
        trailColors[i * 4] = SHED_TINT[0];
        trailColors[i * 4 + 1] = SHED_TINT[1];
        trailColors[i * 4 + 2] = SHED_TINT[2];
        trailColors[i * 4 + 3] = 0;
      }
    }
    trailPosAttr.needsUpdate = true;
    trailColorAttr.needsUpdate = true;
  }

  // ---- Orbit state: seeded at aphelion, vis-viva tangential speed. ----
  const startX = spec.aphelion * Math.cos(spec.phase);
  const startZ = spec.aphelion * Math.sin(spec.phase);
  const startV = visVivaTangentialVelocity(startX, startZ, gm0, spec.aphelion, spec.perihelion);
  let x = startX;
  let y = 0;
  let z = startZ;
  let vx = startV.vx;
  let vy = 0;
  let vz = startV.vz;

  pushTrailSample(x, y, z);
  group.position.set(x, y, z);
  writeTrailBuffers();

  let alive = true;
  let disposed = false;
  let shedCarry = 0; // time-accumulated shed timer: cadence-independent, not frame-counted
  let shedOrdinal = 0; // ordinal for cadence-independent shed-debris seeding, planet.ts's idiom

  const body: CometBody = {
    kind: 'comet' as const,
    object: group,
    alive: true,
    update(dt, gm, dragBase, holeR, spawnDebris): void {
      if (!alive) return;

      const r2 = x * x + y * y + z * z;
      const r = Math.sqrt(r2);
      const a = gm / (r2 + FORCE_SOFTENING);
      const dragMul = 1 - dragBase * COMET_DRAG_SCALE * dt;
      vx = (vx - (x / r) * a * dt) * dragMul;
      vy = (vy - (y / r) * a * dt) * dragMul;
      vz = (vz - (z / r) * a * dt) * dragMul;
      x += vx * dt;
      y += vy * dt;
      z += vz * dt;

      group.position.set(x, y, z);
      pushTrailSample(x, y, z);
      writeTrailBuffers();

      const ratio = r / holeR;

      if (r < SHED_R) {
        shedCarry += dt;
        while (shedCarry >= SHED_PERIOD) {
          shedCarry -= SHED_PERIOD;
          // Ordinal-seeded: the Nth shed particle's rolls depend only on the
          // comet's own seed material (the generator's integer cometSeeds[i]
          // when provided, folded into the ordinal via XOR) and N, never on
          // frame cadence — matches planet.ts's stretch-debris idiom
          // (mulberry32((seed ^ (0x9e3779b9 + ordinal++)) >>> 0)).
          const rand = mulberry32((seedMaterial ^ (0x9e3779b9 + shedOrdinal++)) >>> 0);
          const theta = rand() * Math.PI * 2;
          const phi = Math.acos(rand() * 2 - 1);
          const speed = 0.01 + rand() * 0.02;
          spawnDebris(
            x,
            y,
            z,
            vx + Math.sin(phi) * Math.cos(theta) * speed,
            vy + Math.cos(phi) * speed,
            vz + Math.sin(phi) * Math.sin(theta) * speed,
            SHED_TINT[0],
            SHED_TINT[1],
            SHED_TINT[2],
          );
        }
      } else {
        shedCarry = 0; // outside the shed radius: don't bank time toward a shed on re-entry
      }

      if (ratio <= CONSUME) {
        alive = false;
        body.alive = false;
        return;
      }
    },
    dispose(): void {
      // Idempotent: the conductor may sweep dead bodies whose dispose already ran.
      if (disposed) return;
      disposed = true;
      headGeometry.dispose();
      headMaterial.dispose();
      trailGeometry.dispose();
      trailMaterial.dispose();
    },
  };
  return body;
}
