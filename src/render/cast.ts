// src/render/cast.ts
import * as THREE from 'three';
import { mulberry32 } from '../sim/random';
import { BURST, CONSUME, stretchFactor } from '../core/tidal';
import type { Body } from './body';

// Same Body shape as PlanetBody/CometBody (src/render/planet.ts, comet.ts):
// object/update/alive/dispose. Not imported from either — the cast has no
// ring/moon/trail lifecycle, so this is the same interface re-declared
// locally rather than a shared base type (comet.ts's precedent).
export interface CastBody extends Body {
  readonly kind: 'cast';
  readonly object: THREE.Group; // billboard quad, positioned in world space
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

const FORCE_SOFTENING = 3e-4; // matches debris.ts's, planet.ts's, and comet.ts's force law exactly
const ENTRY_R = 1.5;
const ENTRY_SPEED_FRAC = 0.62; // fraction of circular velocity: decaying plunge, not a stable orbit
const ESCAPE_R = 3.4; // guard: a cast member that drags this far back out is swept, house pattern
const DISSOLVE_START = 0.75; // maxStretch threshold that begins the dissolve ramp
const DISSOLVE_SECONDS = 2.5; // ramp duration once dissolve begins, in cycle-time seconds
const SHED_DEBRIS_PER_SEC = 5 / (1 / 60); // "<=5/frame" budget expressed as a rate, capped per-frame below
const SHED_TINT: [number, number, number] = [1.0, 0.72, 0.42]; // warm tint while dissolving
const RIM_TINT: [number, number, number] = [1.0, 0.66, 0.37]; // warm rim color, uRim uniform
const BASE_COLOR: [number, number, number] = [0.028, 0.031, 0.055]; // near-black blue

// Camera set once by the conductor (Task 5) via setCastCamera. Billboarding
// and the uHoleDirScreen projection both need it; if it's never set, update()
// skips those steps gracefully rather than throwing (no call sites exist yet
// — this module is compile-only until Task 5 wires the conductor).
let sharedCamera: THREE.PerspectiveCamera | null = null;

export function setCastCamera(cam: THREE.PerspectiveCamera): void {
  sharedCamera = cam;
}

function circularVelocity(x: number, z: number, gm0: number): { vx: number; vz: number } {
  const r = Math.hypot(x, z) || 1e-6;
  const speed = Math.sqrt(gm0 / r);
  return { vx: (-z / r) * speed, vz: (x / r) * speed };
}

// ---- Shader: near-black silhouette lit by a warm rim facing the hole ------
// vUv is the quad's own [0,1] uv; uHoleDirScreen is CPU-computed per update
// (see projectToScreen below) since the billboard has no stable "toward the
// hole" direction in its own rotating local space once tidal scale/rotation
// is applied.

const CAST_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const CAST_FRAG = /* glsl */ `
  uniform sampler2D uMask;
  uniform vec2 uHoleDirScreen;
  uniform float uStretch;
  uniform float uDissolve;
  uniform vec3 uRim;
  varying vec2 vUv;
  void main() {
    vec4 mask = texture2D(uMask, vUv);
    vec3 base = vec3(0.028, 0.031, 0.055);
    float edge = mask.r;
    float facing = clamp(dot(normalize(vUv - 0.5), uHoleDirScreen), 0.0, 1.0);
    vec3 col = base + uRim * edge * facing * 1.6;
    float alpha = mask.a * (1.0 - uDissolve);
    if (alpha < 0.02) discard;
    gl_FragColor = vec4(col, alpha);
  }
`;

export function createCast(
  name: string,
  maskUrl: string,
  aspect: number,
  entryAngle: number,
  gm0: number,
  ordinalSeed: number,
): CastBody {
  const group = new THREE.Group();

  const geometry = new THREE.PlaneGeometry(0.2 * aspect, 0.2);
  const texture = new THREE.TextureLoader().load(maskUrl);
  const material = new THREE.ShaderMaterial({
    vertexShader: CAST_VERT,
    fragmentShader: CAST_FRAG,
    uniforms: {
      uMask: { value: texture },
      uHoleDirScreen: { value: new THREE.Vector2(0, 1) },
      uStretch: { value: 0 },
      uDissolve: { value: 0 },
      uRim: { value: new THREE.Vector3(RIM_TINT[0], RIM_TINT[1], RIM_TINT[2]) },
    },
    transparent: true,
    blending: THREE.NormalBlending, // silhouettes occlude — dark bodies, not lights
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  group.add(mesh);

  // ---- Orbit state: enter at ENTRY_R with a sub-circular tangential speed,
  // so the body plunges inward on a decaying spiral rather than holding orbit.
  const startX = ENTRY_R * Math.cos(entryAngle);
  const startZ = ENTRY_R * Math.sin(entryAngle);
  const startV = circularVelocity(startX, startZ, gm0);
  let x = startX;
  let y = 0;
  let z = startZ;
  let vx = startV.vx * ENTRY_SPEED_FRAC;
  let vy = 0;
  let vz = startV.vz * ENTRY_SPEED_FRAC;

  group.position.set(x, y, z);

  let alive = true;
  let disposed = false;
  let maxStretch = 0; // ratcheted tidal deformation — one-way, never relaxes (planet.ts precedent)
  let dissolveTime = 0; // cycle-time seconds accumulated once dissolve begins
  let dissolve = 0;
  let shedCarry = 0; // fractional carry for the <=5/frame shed-debris trickle
  let shedOrdinal = 0; // ordinal for cadence-independent shed-debris seeding, planet.ts's idiom

  const burstRand = mulberry32(ordinalSeed + 999);

  function projectToScreen(px: number, py: number, pz: number): { x: number; y: number } {
    // Direction from the body toward the origin (the hole), projected onto
    // the camera's own right/up axes (matrixWorld columns 0 and 1) — the
    // billboard's screen plane. Falls back to (0,1) if no camera is set yet.
    if (!sharedCamera) return { x: 0, y: 1 };
    const toHole = new THREE.Vector3(-px, -py, -pz);
    const right = new THREE.Vector3().setFromMatrixColumn(sharedCamera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(sharedCamera.matrixWorld, 1);
    const sx = toHole.dot(right);
    const sy = toHole.dot(up);
    const len = Math.hypot(sx, sy) || 1e-6;
    return { x: sx / len, y: sy / len };
  }

  function burst(spawnDebris: SpawnDebris): void {
    const count = 80;
    for (let i = 0; i < count; i++) {
      const theta = burstRand() * Math.PI * 2;
      const phi = Math.acos(burstRand() * 2 - 1);
      const speed = 0.03 + burstRand() * 0.08;
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
  }

  const body: CastBody = {
    kind: 'cast' as const,
    object: group,
    alive: true,
    update(dt, gm, dragBase, holeR, spawnDebris): void {
      if (!alive) return;

      const r2 = x * x + y * y + z * z;
      const r = Math.sqrt(r2);
      const a = gm / (r2 + FORCE_SOFTENING);
      const dragMul = 1 - dragBase * dt; // unscaled, per contract
      vx = (vx - (x / r) * a * dt) * dragMul;
      vy = (vy - (y / r) * a * dt) * dragMul;
      vz = (vz - (z / r) * a * dt) * dragMul;
      x += vx * dt;
      y += vy * dt;
      z += vz * dt;

      group.position.set(x, y, z);
      if (sharedCamera) group.quaternion.copy(sharedCamera.quaternion);

      const screenDir = projectToScreen(x, y, z);
      (material.uniforms.uHoleDirScreen!.value as THREE.Vector2).set(screenDir.x, screenDir.y);

      const ratio = r / holeR;

      // Tidal deformation is one-way: ratchet to the deepest stretch reached
      // (planet.ts precedent). Applied as local scale along the screen-
      // projected fall direction so the quad stretches toward the hole as it
      // is seen on screen, not in its own unrotated local axes.
      //
      // Convention: under the parent group's billboard quaternion, a child
      // rotation.z of θ maps local +X to cosθ·cameraRight + sinθ·cameraUp,
      // i.e. screen-plane (cosθ, sinθ). So rotation.z = atan2 of screenDir
      // aligns local +X — the stretched axis — with the projected fall
      // direction (probe-verified dot(localX, screenDir) = 1.0). Visually
      // unverifiable until Task 5 wires call sites: flag for the Task 5
      // capture check — a stretching cast body must elongate TOWARD the hole.
      maxStretch = Math.max(maxStretch, stretchFactor(r, holeR));
      if (maxStretch > 0) {
        mesh.rotation.z = Math.atan2(screenDir.y, screenDir.x);
        mesh.scale.set(1 + 2.4 * maxStretch, Math.max(0.55, 1 - 0.3 * maxStretch), 1);
        (material.uniforms.uStretch!.value as number) = maxStretch;
      }

      if (maxStretch > DISSOLVE_START) {
        dissolveTime += dt;
        dissolve = Math.min(1, dissolveTime / DISSOLVE_SECONDS);
        (material.uniforms.uDissolve!.value as number) = dissolve;

        shedCarry += SHED_DEBRIS_PER_SEC * dt;
        const budget = Math.min(5, Math.floor(shedCarry));
        shedCarry -= budget;
        for (let i = 0; i < budget; i++) {
          // Ordinal-seeded: the Nth shed particle's rolls depend only on
          // (ordinalSeed, N), never on frame cadence — planet.ts's idiom.
          const rand = mulberry32((ordinalSeed ^ (0x9e3779b9 + shedOrdinal++)) >>> 0);
          const theta = rand() * Math.PI * 2;
          const phi = Math.acos(rand() * 2 - 1);
          const speed = 0.02 + rand() * 0.04;
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
      }

      if (ratio <= BURST || dissolve >= 1) {
        burst(spawnDebris);
        alive = false;
        body.alive = false;
        return;
      }

      // Consumed/escape guards, house pattern (comet.ts's CONSUME check):
      // either swallowed by the hole or dragged back out past a sane radius.
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
      texture.dispose();
    },
  };

  void name; // identity carried for the conductor/debug tooling; unused in this module
  return body;
}
