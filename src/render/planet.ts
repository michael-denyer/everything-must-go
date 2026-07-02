// src/render/planet.ts
import * as THREE from 'three';
import type { PlanetSpec, MoonSpec } from '../core/cosmosGen';
import type { Palette } from '../core/palette';
import { paletteRgb } from '../core/palette';
import { mulberry32 } from '../sim/random';
import { RING_STRIP, MOON_UNBIND, BURST, CONSUME, stretchFactor } from '../core/tidal';

export interface PlanetBody {
  object: THREE.Group; // planet mesh + ring mesh + moon meshes, positioned in world space
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
  alive: boolean; // false after burst; conductor removes + disposes
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

const PLANET_DRAG_SCALE = 0.55; // planets are heavy: they decay slower than gas
const FORCE_SOFTENING = 3e-4; // matches debris.ts's force law exactly
const STRETCH_DEBRIS_PER_SEC = 4 / (1 / 60); // "≤4/frame" budget expressed as a rate, capped per-frame below

// ---- Lit-sphere shader shared by planet and moon meshes -------------------
// VERT transforms the normal by uNormalMat — the inverse-transpose of the
// mesh's world matrix, captured each frame AFTER position/rotation/scale are
// written (see updateShadingUniforms). mat3(modelMatrix) would skew normals
// under the anisotropic tidal stretch (up to ~5:1 radial vs tangential).
// The disk is the light source, so uHoleDir is also refreshed per frame.

const LIT_VERT = /* glsl */ `
  uniform mat3 uNormalMat;
  varying vec3 vWorldNormal;
  varying vec2 vUv;
  void main() {
    vWorldNormal = normalize(uNormalMat * normal);
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const LIT_FRAG = /* glsl */ `
  uniform sampler2D uTex;
  uniform vec3 uHoleDir;
  varying vec3 vWorldNormal;
  varying vec2 vUv;
  void main() {
    vec3 tex = texture2D(uTex, vUv).rgb;
    float light = 0.22 + 0.78 * max(0.0, dot(normalize(vWorldNormal), uHoleDir));
    gl_FragColor = vec4(tex * light, 1.0);
  }
`;

function createLitMaterial(tex: THREE.CanvasTexture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: LIT_VERT,
    fragmentShader: LIT_FRAG,
    uniforms: {
      uTex: { value: tex },
      uHoleDir: { value: new THREE.Vector3(0, 0, 1) },
      uNormalMat: { value: new THREE.Matrix3() },
    },
  });
}

// ---- Texture bakes ----------------------------------------------------
// All randomness here flows through mulberry32(seed) — no Math.random.

function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  return { canvas, ctx };
}

const rgbCss = (r: number, g: number, b: number): string =>
  `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;

const rgbaCss = (r: number, g: number, b: number, a: number): string =>
  `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;

export function bakePlanetTexture(
  kind: PlanetSpec['kind'],
  texSeed: number,
  palette: Palette,
  hueIdx: number,
): THREE.CanvasTexture {
  const W = 256;
  const H = 128;
  const { canvas, ctx } = makeCanvas(W, H);
  const rand = mulberry32(texSeed);

  if (kind === 'giant') {
    // Latitudinal bands in two palette tones.
    const toneA = paletteRgb(palette, hueIdx, 0.62, 0.5);
    const toneB = paletteRgb(palette, hueIdx + 1, 0.55, 0.38);
    const bandCount = 8 + Math.floor(rand() * 6); // 8-13
    let y = 0;
    let bandIdx = 0;
    while (y < H) {
      const bandH = Math.max(2, Math.round((H / bandCount) * (0.5 + rand())));
      const tone = bandIdx % 2 === 0 ? toneA : toneB;
      const jitter = 1 + (rand() - 0.5) * 0.25;
      ctx.fillStyle = rgbCss(
        Math.min(1, tone[0] * jitter),
        Math.min(1, tone[1] * jitter),
        Math.min(1, tone[2] * jitter),
      );
      ctx.fillRect(0, y, W, bandH);
      y += bandH;
      bandIdx++;
    }
  } else if (kind === 'rocky') {
    // Speckle noise over a base tone.
    const base = paletteRgb(palette, hueIdx, 0.4, 0.4);
    ctx.fillStyle = rgbCss(base[0], base[1], base[2]);
    ctx.fillRect(0, 0, W, H);
    const speckleCount = Math.floor(W * H * 0.35);
    for (let i = 0; i < speckleCount; i++) {
      const x = Math.floor(rand() * W);
      const y = Math.floor(rand() * H);
      const s = 1 + Math.floor(rand() * 2);
      const shade = 0.7 + rand() * 0.6; // darker or lighter speckle
      ctx.fillStyle = rgbCss(
        Math.min(1, base[0] * shade),
        Math.min(1, base[1] * shade),
        Math.min(1, base[2] * shade),
      );
      ctx.fillRect(x, y, s, s);
    }
  } else {
    // Ice: pale, low-contrast bands.
    const toneA = paletteRgb(palette, hueIdx, 0.18, 0.82);
    const toneB = paletteRgb(palette, hueIdx + 1, 0.14, 0.76);
    const bandCount = 6 + Math.floor(rand() * 5); // 6-10
    let y = 0;
    let bandIdx = 0;
    while (y < H) {
      const bandH = Math.max(2, Math.round((H / bandCount) * (0.5 + rand())));
      const tone = bandIdx % 2 === 0 ? toneA : toneB;
      ctx.fillStyle = rgbCss(tone[0], tone[1], tone[2]);
      ctx.fillRect(0, y, W, bandH);
      y += bandH;
      bandIdx++;
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

function bakeMoonTexture(texSeed: number): THREE.CanvasTexture {
  // Plain gray-lit speckle — same shader family as planets, palette-independent.
  const W = 128;
  const H = 64;
  const { canvas, ctx } = makeCanvas(W, H);
  const rand = mulberry32(texSeed);
  ctx.fillStyle = 'rgb(140,140,140)';
  ctx.fillRect(0, 0, W, H);
  const speckleCount = Math.floor(W * H * 0.3);
  for (let i = 0; i < speckleCount; i++) {
    const x = Math.floor(rand() * W);
    const y = Math.floor(rand() * H);
    const shade = Math.floor(90 + rand() * 110);
    ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
    ctx.fillRect(x, y, 1, 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

export function bakeRingTexture(rgb: [number, number, number]): THREE.CanvasTexture {
  const S = 256;
  const { canvas, ctx } = makeCanvas(S, S);
  const cx = S / 2;
  const cy = S / 2;
  const rOuter = S / 2;
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rOuter);
  // RingGeometry(size*1.6, size*2.4, ...) maps its inner edge to uv radius
  // ~0.667 and its outer edge to uv radius 1.0 — alpha ramps up through that
  // band and tapers at both ends so the ring reads as a soft strip, not a disc.
  const [r, g, b] = rgb;
  grad.addColorStop(0.0, rgbaCss(r, g, b, 0));
  grad.addColorStop(0.6, rgbaCss(r, g, b, 0));
  grad.addColorStop(0.68, rgbaCss(r, g, b, 0.9));
  grad.addColorStop(0.85, rgbaCss(r, g, b, 0.55));
  grad.addColorStop(1.0, rgbaCss(r, g, b, 0));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

// ---- Orbiting body state (shared shape for the planet and each freed moon) -

interface OrbitState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

function circularVelocity(x: number, z: number, gm0: number): { vx: number; vz: number } {
  const r = Math.hypot(x, z) || 1e-6;
  const speed = Math.sqrt(gm0 / r);
  // Tangential direction (counter-clockwise in the XZ plane).
  return { vx: (-z / r) * speed, vz: (x / r) * speed };
}

// Same force law and drag application as debris.ts: a = gm/(r²+softening)
// inward, velocity decayed by a multiplicative (1 - drag*dt) factor.
function integrate(state: OrbitState, dt: number, gm: number, dragMul: number): void {
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

interface MoonRuntime {
  spec: MoonSpec;
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  texture: THREE.CanvasTexture;
  bound: boolean;
  consumed: boolean;
  angle: number; // while bound: angle around the parent, driven by spec.speed
  state: OrbitState; // while free: independent world-space orbit state
}

export function createPlanet(spec: PlanetSpec, palette: Palette, gm0: number): PlanetBody {
  const group = new THREE.Group();

  // ---- Planet mesh ----
  const planetTex = bakePlanetTexture(spec.kind, spec.texSeed, palette, spec.hueIdx);
  const planetMaterial = createLitMaterial(planetTex);
  const planetGeometry = new THREE.SphereGeometry(spec.size, 24, 16);
  const planetMesh = new THREE.Mesh(planetGeometry, planetMaterial);
  group.add(planetMesh);

  const planetTint = paletteRgb(palette, spec.hueIdx, 0.75, 0.55);
  const ringTint = paletteRgb(palette, spec.hueIdx + 2, 0.6, 0.65);

  // ---- Ring mesh (only if spec.ringed) ----
  let ringMesh: THREE.Mesh | null = null;
  let ringGeometry: THREE.RingGeometry | null = null;
  let ringMaterial: THREE.MeshBasicMaterial | null = null;
  let ringTexture: THREE.CanvasTexture | null = null;
  if (spec.ringed) {
    const ringRand = mulberry32(spec.texSeed + 1);
    ringGeometry = new THREE.RingGeometry(spec.size * 1.6, spec.size * 2.4, 48);
    ringTexture = bakeRingTexture(ringTint);
    ringMaterial = new THREE.MeshBasicMaterial({
      map: ringTexture,
      transparent: true,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    ringMesh = new THREE.Mesh(ringGeometry, ringMaterial);
    ringMesh.rotation.x = 0.35; // fixed tilt
    ringMesh.rotation.z = ringRand() * Math.PI * 2; // seeded yaw so ringed planets differ
    group.add(ringMesh);
  }

  // ---- Moons ----
  // MoonSpec's dist/size/speed are raw rand() rolls in [0,1) (cosmosGen leaves
  // them unscaled — see task-m3a-2's report). Scale them relative to the
  // parent planet's own size so moons render as moons, not planet-sized bodies.
  const moonSize = (m: MoonSpec): number => spec.size * (0.12 + m.size * 0.35);
  const moonDist = (m: MoonSpec): number => spec.size * (2.2 + m.dist * 4.5);
  const moonSpeed = (m: MoonSpec): number => 0.4 + m.speed * 1.6; // rad/s while bound

  const moons: MoonRuntime[] = spec.moons.map((moonSpec, i) => {
    const texture = bakeMoonTexture(spec.texSeed + 100 + i);
    const material = createLitMaterial(texture);
    const geometry = new THREE.SphereGeometry(moonSize(moonSpec), 10, 8);
    const mesh = new THREE.Mesh(geometry, material);
    const dist = moonDist(moonSpec);
    mesh.position.set(dist * Math.cos(moonSpec.phase), 0, dist * Math.sin(moonSpec.phase));
    group.add(mesh);
    return {
      spec: moonSpec,
      mesh,
      material,
      texture,
      bound: true,
      consumed: false,
      angle: moonSpec.phase,
      state: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 },
    };
  });

  // ---- Orbit state (planet's own path around the origin) ----
  const startX = spec.orbitR * Math.cos(spec.phase);
  const startZ = spec.orbitR * Math.sin(spec.phase);
  const startV = circularVelocity(startX, startZ, gm0);
  const orbit: OrbitState = { x: startX, y: 0, z: startZ, vx: startV.vx, vy: 0, vz: startV.vz };
  group.position.set(orbit.x, orbit.y, orbit.z);

  // ---- Death state machine ----
  let ringStripped = !spec.ringed; // no ring to strip means this stage is already done
  let moonsFree = moons.length === 0; // no moons to unbind means this stage is already done
  let alive = true;
  let disposed = false;
  let stretchDebrisCarry = 0; // fractional carry for the ≤4/frame stretch trickle
  let debrisOrdinal = 0; // ordinal for cadence-independent stretch-debris seeding
  let maxStretch = 0; // ratcheted tidal deformation — one-way, never relaxes

  const ringDebrisRand = mulberry32(spec.texSeed + 7);
  const burstRand = mulberry32(spec.texSeed + 999);

  function updateShadingUniforms(): void {
    // Normal matrices must be captured AFTER this frame's position/rotation/
    // scale writes. group.updateMatrixWorld() recomputes the whole subtree
    // (planet mesh + moon meshes) in one pass, so each mesh.matrixWorld is
    // current before getNormalMatrix reads it.
    group.updateMatrixWorld();

    const dir = new THREE.Vector3(-orbit.x, -orbit.y, -orbit.z);
    const len = dir.length() || 1e-6;
    dir.multiplyScalar(1 / len);
    (planetMaterial.uniforms.uHoleDir!.value as THREE.Vector3).copy(dir);
    (planetMaterial.uniforms.uNormalMat!.value as THREE.Matrix3).getNormalMatrix(planetMesh.matrixWorld);

    for (const m of moons) {
      if (m.consumed) continue;
      const mx = m.bound ? group.position.x + m.mesh.position.x : m.state.x;
      const my = m.bound ? group.position.y + m.mesh.position.y : m.state.y;
      const mz = m.bound ? group.position.z + m.mesh.position.z : m.state.z;
      const mdir = new THREE.Vector3(-mx, -my, -mz);
      const mlen = mdir.length() || 1e-6;
      mdir.multiplyScalar(1 / mlen);
      (m.material.uniforms.uHoleDir!.value as THREE.Vector3).copy(mdir);
      (m.material.uniforms.uNormalMat!.value as THREE.Matrix3).getNormalMatrix(m.mesh.matrixWorld);
    }
  }

  function spawnRingDebris(spawnDebris: SpawnDebris): void {
    if (!ringMesh) return;
    const innerR = spec.size * 1.6;
    const outerR = spec.size * 2.4;
    const count = 140;
    const cx = group.position.x;
    const cy = group.position.y;
    const cz = group.position.z;
    for (let i = 0; i < count; i++) {
      const theta = (i / count) * Math.PI * 2;
      const rr = innerR + ringDebrisRand() * (outerR - innerR);
      const local = new THREE.Vector3(rr * Math.cos(theta), rr * Math.sin(theta), 0);
      local.applyEuler(ringMesh.rotation); // ring's local tilt + seeded yaw
      const outward = local.clone().normalize();
      const speed = 0.02 + ringDebrisRand() * 0.04;
      spawnDebris(
        cx + local.x,
        cy + local.y,
        cz + local.z,
        orbit.vx + outward.x * speed,
        orbit.vy + outward.y * speed,
        orbit.vz + outward.z * speed,
        ringTint[0],
        ringTint[1],
        ringTint[2],
      );
    }
  }

  function unbindMoon(m: MoonRuntime): void {
    m.bound = false;
    const worldX = group.position.x + m.mesh.position.x;
    const worldY = group.position.y + m.mesh.position.y;
    const worldZ = group.position.z + m.mesh.position.z;
    // Orbital tangential velocity around the planet at the moment of unbind,
    // plus the planet's own world velocity (inherited).
    const tangentialSpeed = moonDist(m.spec) * moonSpeed(m.spec);
    m.state = {
      x: worldX,
      y: worldY,
      z: worldZ,
      vx: orbit.vx + -Math.sin(m.angle) * tangentialSpeed,
      vy: orbit.vy,
      vz: orbit.vz + Math.cos(m.angle) * tangentialSpeed,
    };
  }

  function consumeMoon(m: MoonRuntime, index: number, spawnDebris: SpawnDebris): void {
    m.consumed = true;
    group.remove(m.mesh);
    const rand = mulberry32(spec.texSeed + 200 + index);
    for (let i = 0; i < 6; i++) {
      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(rand() * 2 - 1);
      const speed = 0.03 + rand() * 0.05;
      spawnDebris(
        m.state.x,
        m.state.y,
        m.state.z,
        m.state.vx + Math.sin(phi) * Math.cos(theta) * speed,
        m.state.vy + Math.cos(phi) * speed,
        m.state.vz + Math.sin(phi) * Math.sin(theta) * speed,
        planetTint[0],
        planetTint[1],
        planetTint[2],
      );
    }
    // Release this moon's GPU resources now rather than at planet dispose();
    // the final dispose() skips consumed moons, staying idempotent.
    m.mesh.geometry.dispose();
    m.material.dispose();
    m.texture.dispose();
  }

  function burst(spawnDebris: SpawnDebris): void {
    const count = 300;
    const cx = group.position.x;
    const cy = group.position.y;
    const cz = group.position.z;
    for (let i = 0; i < count; i++) {
      const theta = burstRand() * Math.PI * 2;
      const phi = Math.acos(burstRand() * 2 - 1);
      const speed = 0.05 + burstRand() * 0.12;
      spawnDebris(
        cx,
        cy,
        cz,
        orbit.vx + Math.sin(phi) * Math.cos(theta) * speed,
        orbit.vy + Math.cos(phi) * speed,
        orbit.vz + Math.sin(phi) * Math.sin(theta) * speed,
        planetTint[0],
        planetTint[1],
        planetTint[2],
      );
    }
  }

  const body: PlanetBody = {
    object: group,
    alive: true,
    update(dt, gm, dragBase, holeR, spawnDebris): void {
      if (!alive) return;
      const dragMul = 1 - dragBase * PLANET_DRAG_SCALE * dt;

      integrate(orbit, dt, gm, dragMul);
      group.position.set(orbit.x, orbit.y, orbit.z);

      const r = Math.hypot(orbit.x, orbit.y, orbit.z);
      const ratio = r / holeR;

      if (!ringStripped && ratio <= RING_STRIP) {
        ringStripped = true;
        spawnRingDebris(spawnDebris);
        if (ringMesh) group.remove(ringMesh);
      }

      if (!moonsFree && ratio <= MOON_UNBIND) {
        moonsFree = true;
        for (const m of moons) {
          if (!m.consumed) unbindMoon(m);
        }
      }

      moons.forEach((m, index) => {
        if (m.consumed) return;
        if (m.bound) {
          m.angle += moonSpeed(m.spec) * dt;
          const dist = moonDist(m.spec);
          m.mesh.position.set(dist * Math.cos(m.angle), 0, dist * Math.sin(m.angle));
        } else {
          integrate(m.state, dt, gm, dragMul);
          m.mesh.position.set(
            m.state.x - group.position.x,
            m.state.y - group.position.y,
            m.state.z - group.position.z,
          );
          const mr = Math.hypot(m.state.x, m.state.y, m.state.z);
          if (mr / holeR <= CONSUME) {
            consumeMoon(m, index, spawnDebris);
          }
        }
      });

      // Tidal deformation is one-way: ratchet to the deepest stretch reached,
      // so an eccentric orbit re-crossing STRETCH_START*holeR outward doesn't
      // snap the mesh back to rest in a single frame. No reset branch — scale
      // stays (1,1,1) until the ratchet first engages, then only ever deepens.
      maxStretch = Math.max(maxStretch, stretchFactor(r, holeR));
      if (maxStretch > 0) {
        planetMesh.rotation.y = Math.atan2(orbit.z, orbit.x); // radial axis = local X
        planetMesh.scale.set(1 + 2.4 * maxStretch, 1 - 0.3 * maxStretch, 1 - 0.3 * maxStretch);

        stretchDebrisCarry += maxStretch * STRETCH_DEBRIS_PER_SEC * dt;
        const budget = Math.min(4, Math.floor(stretchDebrisCarry));
        stretchDebrisCarry -= budget;
        for (let i = 0; i < budget; i++) {
          // Ordinal-seeded: the Nth shed particle's rolls depend only on
          // (texSeed, N), never on frame cadence.
          const rand = mulberry32((spec.texSeed ^ (0x9e3779b9 + debrisOrdinal++)) >>> 0);
          const theta = rand() * Math.PI * 2;
          const phi = Math.acos(rand() * 2 - 1);
          const speed = 0.02 + rand() * 0.05;
          spawnDebris(
            orbit.x,
            orbit.y,
            orbit.z,
            orbit.vx + Math.sin(phi) * Math.cos(theta) * speed,
            orbit.vy + Math.cos(phi) * speed,
            orbit.vz + Math.sin(phi) * Math.sin(theta) * speed,
            planetTint[0],
            planetTint[1],
            planetTint[2],
          );
        }
      }

      if (ratio <= BURST) {
        burst(spawnDebris);
        alive = false;
        body.alive = false;
        return;
      }

      updateShadingUniforms();
    },
    dispose(): void {
      // Idempotent: the conductor may sweep dead bodies whose dispose already ran.
      if (disposed) return;
      disposed = true;
      planetGeometry.dispose();
      planetMaterial.dispose();
      planetTex.dispose();
      if (ringGeometry) ringGeometry.dispose();
      if (ringMaterial) ringMaterial.dispose();
      if (ringTexture) ringTexture.dispose();
      for (const m of moons) {
        if (m.consumed) continue; // already released at consume time
        m.mesh.geometry.dispose();
        m.material.dispose();
        m.texture.dispose();
      }
    },
  };
  return body;
}
