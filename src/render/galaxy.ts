// src/render/galaxy.ts
import * as THREE from 'three';
import type { GalaxySpec } from '../core/cosmosGen';
import type { Palette } from '../core/palette';
import { paletteRgb } from '../core/palette';
import { mulberry32 } from '../sim/random';
import { BURST, CONSUME, stretchFactor } from '../core/tidal';
import type { Body } from './body';

export interface GalaxyBody extends Body {
  readonly kind: 'galaxy';
  readonly object: THREE.Group; // billboard quad, positioned in world space
  alive: boolean; // false after burst; conductor removes + disposes
  setFade(fade: number): void; // dims the additive glow with the dying cosmos
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
const GALAXY_DRAG_SCALE = 0.8; // per Global Constraints: drag = dragBase * 0.8
const ESCAPE_R = 3.4; // guard: same "dragged back out past a sane radius" threshold as cast.ts
const SHED_DEBRIS_PER_SEC = 3 / (1 / 60); // "<=3/frame" budget expressed as a rate, capped per-frame below
const TEX_SIZE = 128;

// Camera set once by the conductor (Task 5) via setGalaxyCamera. Billboarding
// and the screen-projected stretch direction both need it; if it's never set,
// update() skips those steps gracefully rather than throwing (no call sites
// exist yet — this module is compile-only until Task 5 wires the conductor).
// NOT imported from cast.ts: the plan calls for an independently-owned setter
// here (galaxy.ts and cast.ts stay decoupled modules with their own camera
// state), replicating cast.ts's module-level shared-camera pattern.
let sharedCamera: THREE.PerspectiveCamera | null = null;

export function setGalaxyCamera(cam: THREE.PerspectiveCamera): void {
  sharedCamera = cam;
}

function circularVelocity(x: number, z: number, gm0: number): { vx: number; vz: number } {
  const r = Math.hypot(x, z) || 1e-6;
  const speed = Math.sqrt(gm0 / r);
  return { vx: (-z / r) * speed, vz: (x / r) * speed };
}

// Same force law and drag application as planet.ts's integrate/debris.ts:
// a = gm/(r²+softening) inward, velocity decayed by a multiplicative
// (1 - drag*dt) factor. Replicated locally (not imported) since planet.ts's
// OrbitState/integrate are module-private.
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

function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  return { canvas, ctx };
}

const rgbaCss = (r: number, g: number, b: number, a: number): string =>
  `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;

// Baked per-galaxy spiral texture: a two-arm dot-spiral, palette-tinted and
// seeded by spec.seed — same "seeded canvas bake" idiom as planet.ts's
// bakePlanetTexture and sky.ts's decor-galaxy stamp, sized up for a
// close-up dynamic body rather than a distant sky decal.
function bakeGalaxyTexture(seed: number, palette: Palette, hueIdx: number): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(TEX_SIZE, TEX_SIZE);
  const rand = mulberry32(seed);
  const cx = TEX_SIZE / 2;
  const cy = TEX_SIZE / 2;
  const [r, g, b] = paletteRgb(palette, hueIdx, 0.6, 0.62);
  const [r2, g2, b2] = paletteRgb(palette, hueIdx + 1, 0.5, 0.75);

  // Soft core glow.
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, TEX_SIZE * 0.22);
  core.addColorStop(0, rgbaCss(r2, g2, b2, 0.95));
  core.addColorStop(1, rgbaCss(r2, g2, b2, 0));
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  // Two-arm dot-spiral, dots fading with radius and jittered off the ideal arm.
  const arms = 2;
  const dotsPerArm = 260;
  const maxR = TEX_SIZE * 0.48;
  for (let arm = 0; arm < arms; arm++) {
    const armOffset = (arm / arms) * Math.PI * 2;
    for (let i = 0; i < dotsPerArm; i++) {
      const t = i / dotsPerArm;
      const rad = t * maxR;
      const theta = armOffset + t * Math.PI * 2.4;
      const jitterR = (rand() - 0.5) * TEX_SIZE * 0.05;
      const jitterTheta = (rand() - 0.5) * 0.35;
      const px = cx + Math.cos(theta + jitterTheta) * (rad + jitterR);
      const py = cy + Math.sin(theta + jitterTheta) * (rad + jitterR);
      const alpha = (1 - t) * (0.15 + rand() * 0.35);
      const size = 1 + rand() * 1.6;
      ctx.fillStyle = rgbaCss(r, g, b, alpha);
      ctx.fillRect(px, py, size, size);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

export function createGalaxy(spec: GalaxySpec, palette: Palette, gm0: number): GalaxyBody {
  const group = new THREE.Group();

  const texture = bakeGalaxyTexture(spec.seed, palette, spec.hueIdx);
  const geometry = new THREE.PlaneGeometry(spec.size, spec.size);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    blending: THREE.AdditiveBlending, // galaxies are light, unlike cast's silhouettes
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  group.add(mesh);

  // ---- Orbit state: circular start at orbitR/phase, planet.ts's idiom
  // (not cast.ts's plunge-entry model — galaxies hold orbit until drag
  // and the growing hole erode it, same as planets).
  const startX = spec.orbitR * Math.cos(spec.phase);
  const startZ = spec.orbitR * Math.sin(spec.phase);
  const startV = circularVelocity(startX, startZ, gm0);
  const orbit = { x: startX, y: 0, z: startZ, vx: startV.vx, vy: 0, vz: startV.vz };
  group.position.set(orbit.x, orbit.y, orbit.z);

  let alive = true;
  let disposed = false;
  let maxStretch = 0; // ratcheted tidal deformation — one-way, never relaxes (planet.ts/cast.ts precedent)
  let shedCarry = 0; // fractional carry for the <=3/frame shed-debris trickle
  let shedOrdinal = 0; // ordinal for cadence-independent shed-debris seeding, cast.ts's idiom

  const tint = paletteRgb(palette, spec.hueIdx, 0.65, 0.6);
  const burstRand = mulberry32(spec.seed + 999);

  function projectToScreen(px: number, py: number, pz: number): { x: number; y: number } {
    // Same convention as cast.ts's projectToScreen: direction from the body
    // toward the origin (the hole), projected onto the camera's own
    // right/up axes — the billboard's screen plane. Falls back to (0,1) if
    // no camera is set yet.
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
    const count = 220;
    for (let i = 0; i < count; i++) {
      const theta = burstRand() * Math.PI * 2;
      const phi = Math.acos(burstRand() * 2 - 1);
      const speed = 0.03 + burstRand() * 0.09;
      spawnDebris(
        orbit.x,
        orbit.y,
        orbit.z,
        orbit.vx + Math.sin(phi) * Math.cos(theta) * speed,
        orbit.vy + Math.cos(phi) * speed,
        orbit.vz + Math.sin(phi) * Math.sin(theta) * speed,
        tint[0],
        tint[1],
        tint[2],
      );
    }
  }

  const body: GalaxyBody = {
    kind: 'galaxy' as const,
    object: group,
    alive: true,
    update(dt, gm, dragBase, holeR, spawnDebris): void {
      if (!alive) return;

      const dragMul = 1 - dragBase * GALAXY_DRAG_SCALE * dt;
      integrate(orbit, dt, gm, dragMul);
      group.position.set(orbit.x, orbit.y, orbit.z);
      if (sharedCamera) group.quaternion.copy(sharedCamera.quaternion);

      const r = Math.hypot(orbit.x, orbit.y, orbit.z);
      const ratio = r / holeR;

      // Ratcheted screen-stretch: cast.ts's CORRECTED convention. Under the
      // parent group's billboard quaternion, a child rotation.z of θ maps
      // local +X to cosθ·cameraRight + sinθ·cameraUp — screen-plane (cosθ,
      // sinθ). So rotation.z = atan2(screenDir.y, screenDir.x), with NO
      // offset, aligns local +X (the stretched axis) with the projected
      // fall direction toward the hole (cast.ts's probe-verified convention).
      maxStretch = Math.max(maxStretch, stretchFactor(r, holeR));
      if (maxStretch > 0) {
        const screenDir = projectToScreen(orbit.x, orbit.y, orbit.z);
        mesh.rotation.z = Math.atan2(screenDir.y, screenDir.x);
        mesh.scale.set(1 + 2.2 * maxStretch, Math.max(0.5, 1 - 0.35 * maxStretch), 1);

        shedCarry += SHED_DEBRIS_PER_SEC * dt;
        const budget = Math.min(3, Math.floor(shedCarry));
        shedCarry -= budget;
        for (let i = 0; i < budget; i++) {
          // Ordinal-seeded: the Nth shed particle's rolls depend only on
          // (spec.seed, N), never on frame cadence — cast.ts's idiom.
          const rand = mulberry32((spec.seed ^ (0x9e3779b9 + shedOrdinal++)) >>> 0);
          const theta = rand() * Math.PI * 2;
          const phi = Math.acos(rand() * 2 - 1);
          const speed = 0.02 + rand() * 0.04;
          spawnDebris(
            orbit.x,
            orbit.y,
            orbit.z,
            orbit.vx + Math.sin(phi) * Math.cos(theta) * speed,
            orbit.vy + Math.cos(phi) * speed,
            orbit.vz + Math.sin(phi) * Math.sin(theta) * speed,
            tint[0],
            tint[1],
            tint[2],
          );
        }
      }

      if (ratio <= BURST) {
        burst(spawnDebris);
        alive = false;
        body.alive = false;
        return;
      }

      // Consumed/escape guards, house pattern (cast.ts's/comet.ts's CONSUME
      // check): either swallowed by the hole or dragged back out past a sane
      // radius. ESCAPE_R = 3.4 matches cast.ts's guard — galaxies orbit in
      // the same 1.9-2.3 band as cast entries fall from, so the same "gone
      // too far back out" threshold applies.
      if (ratio <= CONSUME || r > ESCAPE_R) {
        alive = false;
        body.alive = false;
        return;
      }
    },
    setFade(fade: number): void {
      // Additive + transparent: the GL blend multiplies the contribution by
      // srcAlpha (= opacity * texAlpha), so scaling opacity dims the whole
      // galaxy toward black as the cosmos fades.
      material.opacity = fade;
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

  return body;
}
