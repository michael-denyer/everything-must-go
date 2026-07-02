# Milestone 1: Money Shot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A static cosmos that already looks like the piece: a million-particle GPU accretion disk around a lensed black hole with shadow, photon ring, folded disk arcs, starfield, and bloom, at 60 fps on a desktop GPU.

**Architecture:** three.js WebGL2 app. Particle positions/velocities live in ping-pong float textures driven by `GPUComputationRenderer`; a `THREE.Points` mesh samples them. The black hole look is a screen-space lensing `ShaderPass` (radial background distortion + analytic fold arcs + photon ring + shadow mask) followed by `UnrealBloomPass` and an ACES output pass. Pure logic (color ramp, disk seeding, screen projection) is unit-tested with vitest; the rendered result is checked by a Playwright smoke test with pixel assertions.

**Tech Stack:** TypeScript (strict), Vite, three.js (WebGL2, `three/addons`), vitest, Playwright, pngjs (test-only PNG analysis).

## Global Constraints

- Spec: `.planning/superpowers/specs/2026-07-02-everything-must-go-design.md`. This plan implements Milestone 1 only: "Scaffold, GPU disk sim, hole with painted fold and photon ring, lensing pass, bloom. One static cosmos, no cycle."
- Two intentional pull-forwards from later milestones, both needed to verify M1: a minimal static starfield (M3 content; the lensing distortion is invisible without background stars) and a `?debug` fps readout (M6 tooling; the 60 fps acceptance needs a number).
- WebGL2 required; no fallback work in M1 (fallbacks are M6).
- Fixed high-tier budget: `TEX_SIZE = 1024` (1,048,576 particles). No quality tiers yet.
- TypeScript `strict: true`. `tsc` must pass with zero errors before every commit.
- **No `--quiet`, `-q`, or `--silent` flags on any command, ever** (user hard rule).
- Commit after every task. Messages plain, imperative, no AI/Claude attribution (user hard rule). Repo has no remote yet; commits are local until MD confirms creating the public GitHub repo (final task).
- `package-lock.json` is committed.
- Working directory for all commands: `/Users/mdenyer/projects/everything-must-go`.
- All shader code is inline template strings in `.ts` files. No GLSL build plugins.
- Rendering uses linear working space with ACES tone mapping applied by `OutputPass` at the end of the chain. Disk/ring emissive values deliberately exceed 1.0 so bloom has HDR headroom.
- Known accepted approximation (documented in spec): the lensing pass is screen-space. The shadow mask darkens everything inside the shadow radius, including foreground particles. With `DISK_INNER (0.28) > SHADOW_R (0.22)` and the 14° camera tilt, near-side disk pixels do not cross the shadow disc, so the artifact is not visible from the fixed composition. Do not "fix" this with depth trickery in M1.

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `.gitignore`, `index.html`, `src/config.ts`, `src/scene.ts`, `src/main.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `config.ts` constants used by every later task (exact names below); `createScene(): { scene: THREE.Scene; camera: THREE.PerspectiveCamera }`; a running render loop in `main.ts` that later tasks extend.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "everything-must-go",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "e2e": "playwright test"
  },
  "dependencies": {
    "three": "^0.172.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.49.0",
    "@types/pngjs": "^6.0.5",
    "@types/three": "^0.172.0",
    "pngjs": "^7.0.0",
    "typescript": "~5.7.0",
    "vite": "^6.0.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["vite/client"]
  },
  "include": ["src", "tests", "e2e"]
}
```

- [ ] **Step 3: Write `vite.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: { target: 'es2022' },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
```

- [ ] **Step 4: Write `.gitignore`**

```
node_modules/
dist/
test-results/
playwright-report/
```

- [ ] **Step 5: Write `index.html`**

The title block is part of the composition (spec: letterspaced caps, top-left, one caption line). Static text only in M1; letter-eating is M4.

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Everything Must Go</title>
  <style>
    html, body { margin: 0; height: 100%; background: #05060b; overflow: hidden; }
    #app { display: block; width: 100vw; height: 100vh; }
    #title {
      position: fixed; top: 20px; left: 22px; color: rgba(238, 242, 252, .85);
      font-family: system-ui, sans-serif; font-size: 13px; letter-spacing: 4px;
      font-weight: 500; user-select: none; pointer-events: none;
    }
    #title small {
      display: block; margin-top: 6px; font-size: 11px; letter-spacing: 1px;
      font-weight: 400; color: rgba(168, 178, 205, .62);
    }
    #debug {
      position: fixed; bottom: 14px; right: 16px; color: rgba(168, 178, 205, .8);
      font-family: ui-monospace, monospace; font-size: 12px; display: none;
    }
  </style>
</head>
<body>
  <canvas id="app"></canvas>
  <div id="title">EVERYTHING MUST GO<small>a spinning black hole is closing this cosmos</small></div>
  <div id="debug"></div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

- [ ] **Step 6: Write `src/config.ts`**

All M1 constants in one place. Later tasks import from here; do not redefine these numbers elsewhere.

```typescript
export const TEX_SIZE = 1024;
export const PARTICLE_COUNT = TEX_SIZE * TEX_SIZE;

export const SHADOW_R = 0.22;
export const DISK_INNER = 0.28;
export const DISK_OUTER = 1.9;
export const DISK_THICKNESS = 0.02;
export const GM = 0.35;
export const SEED = 42;

export const CAM_POS: readonly [number, number, number] = [0, 1.05, 4.2];
export const CAM_FOV = 50;

export const STAR_COUNT = 4000;
export const STAR_SHELL: readonly [number, number] = [6, 14];

export const BLOOM_STRENGTH = 0.85;
export const BLOOM_RADIUS = 0.4;
export const BLOOM_THRESHOLD = 0.55;

export const MAX_DT = 1 / 30;
```

- [ ] **Step 7: Write `src/scene.ts`**

```typescript
import * as THREE from 'three';
import { CAM_FOV, CAM_POS } from './config';

export function createScene(): { scene: THREE.Scene; camera: THREE.PerspectiveCamera } {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAM_FOV, innerWidth / innerHeight, 0.1, 100);
  camera.position.set(...CAM_POS);
  camera.lookAt(0, 0, 0);
  return { scene, camera };
}
```

- [ ] **Step 8: Write `src/main.ts`**

Renders an empty scene at the right clear color, with resize handling, a clamped-dt loop, and the `?debug` fps counter. Later tasks add to this file.

```typescript
import * as THREE from 'three';
import { MAX_DT } from './config';
import { createScene } from './scene';

const canvas = document.getElementById('app') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);

const { scene, camera } = createScene();
scene.background = new THREE.Color(0x05060b);

const debugEl = document.getElementById('debug') as HTMLDivElement;
const debug = new URLSearchParams(location.search).has('debug');
if (debug) debugEl.style.display = 'block';
let frames = 0;
let fpsWindowStart = performance.now();

function onResize(): void {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', onResize);

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(MAX_DT, (now - last) / 1000) || 1 / 60;
  last = now;
  void dt;
  renderer.render(scene, camera);
  if (debug) {
    frames++;
    if (now - fpsWindowStart >= 1000) {
      debugEl.textContent = `${frames} fps`;
      frames = 0;
      fpsWindowStart = now;
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

- [ ] **Step 9: Install and verify**

Run: `npm install`
Expected: completes without errors, creates `package-lock.json`.

Run: `npm run build`
Expected: `tsc` passes, vite build emits `dist/` without errors.

Run: `npm run dev` and open `http://localhost:5173/?debug`
Expected: near-black page, title top-left, fps counter bottom-right showing ~60.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts .gitignore index.html src
git commit -m "Scaffold Vite + TypeScript + three.js app shell"
```

---

### Task 2: Blackbody color ramp (TDD)

**Files:**
- Create: `src/color/blackbody.ts`
- Test: `tests/blackbody.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `BLACKBODY_STOPS: readonly (readonly [number, readonly [number, number, number]])[]`; `blackbody(t: number): [number, number, number]` (linear 0..1 RGB, t 0 = cool outer rim deep red, t 1 = white-hot core); `blackbodyGlsl(): string` returning a GLSL function `vec3 blackbody(float t)` implementing the same stops. Tasks 5 and 6 inject `blackbodyGlsl()` into shaders.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/blackbody.test.ts
import { describe, expect, it } from 'vitest';
import { blackbody, blackbodyGlsl } from '../src/color/blackbody';

describe('blackbody', () => {
  it('is deep red at t=0', () => {
    const [r, g, b] = blackbody(0);
    expect(r).toBeGreaterThan(0.4);
    expect(g).toBeLessThan(0.15);
    expect(b).toBeLessThan(0.1);
  });

  it('is near white at t=1', () => {
    const [r, g, b] = blackbody(1);
    expect(r).toBeGreaterThanOrEqual(0.95);
    expect(g).toBeGreaterThanOrEqual(0.9);
    expect(b).toBeGreaterThanOrEqual(0.85);
  });

  it('clamps out-of-range input', () => {
    expect(blackbody(-1)).toEqual(blackbody(0));
    expect(blackbody(2)).toEqual(blackbody(1));
  });

  it('every channel is nondecreasing in t', () => {
    for (let c = 0; c < 3; c++) {
      let prev = -1;
      for (let t = 0; t <= 1.001; t += 0.05) {
        const v = blackbody(Math.min(1, t))[c] as number;
        expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = v;
      }
    }
  });

  it('emits a GLSL function with all stops', () => {
    const glsl = blackbodyGlsl();
    expect(glsl).toContain('vec3 blackbody(float t)');
    expect(glsl).toContain('0.510');
    expect(glsl).toContain('1.000');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL, cannot resolve `../src/color/blackbody`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/color/blackbody.ts
export const BLACKBODY_STOPS = [
  [0.0, [0.51, 0.098, 0.071]],
  [0.3, [0.921, 0.392, 0.098]],
  [0.6, [1.0, 0.686, 0.235]],
  [0.85, [1.0, 0.878, 0.639]],
  [1.0, [1.0, 0.98, 0.941]],
] as const;

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

export function blackbody(t: number): [number, number, number] {
  const x = clamp01(t);
  for (let i = 0; i < BLACKBODY_STOPS.length - 1; i++) {
    const [t0, c0] = BLACKBODY_STOPS[i]!;
    const [t1, c1] = BLACKBODY_STOPS[i + 1]!;
    if (x <= t1) {
      const f = (x - t0) / (t1 - t0);
      return [
        c0[0] + (c1[0] - c0[0]) * f,
        c0[1] + (c1[1] - c0[1]) * f,
        c0[2] + (c1[2] - c0[2]) * f,
      ];
    }
  }
  const last = BLACKBODY_STOPS[BLACKBODY_STOPS.length - 1]![1];
  return [last[0], last[1], last[2]];
}

const f3 = (n: number): string => n.toFixed(3);

export function blackbodyGlsl(): string {
  const s = BLACKBODY_STOPS;
  let body = `vec3 blackbody(float t) {\n  t = clamp(t, 0.0, 1.0);\n`;
  for (let i = 0; i < s.length - 1; i++) {
    const [t0, c0] = s[i]!;
    const [t1, c1] = s[i + 1]!;
    body += `  if (t <= ${f3(t1)}) return mix(vec3(${f3(c0[0])}, ${f3(c0[1])}, ${f3(c0[2])}), vec3(${f3(c1[0])}, ${f3(c1[1])}, ${f3(c1[2])}), (t - ${f3(t0)}) / ${f3(t1 - t0)});\n`;
  }
  const last = s[s.length - 1]![1];
  body += `  return vec3(${f3(last[0])}, ${f3(last[1])}, ${f3(last[2])});\n}\n`;
  return body;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/color/blackbody.ts tests/blackbody.test.ts
git commit -m "Add blackbody color ramp with GLSL emitter"
```

---

### Task 3: Disk seeder (TDD)

**Files:**
- Create: `src/sim/random.ts`, `src/sim/diskSeeder.ts`
- Test: `tests/diskSeeder.test.ts`

**Interfaces:**
- Consumes: `DISK_INNER`, `DISK_OUTER`, `DISK_THICKNESS`, `GM`, `SEED` from `src/config.ts`.
- Produces: `mulberry32(seed: number): () => number` (deterministic RNG, returns floats in [0,1)); `seedDisk(count: number, opts: { innerR: number; outerR: number; gm: number; thickness: number; seed: number }): { positions: Float32Array; velocities: Float32Array }` — both arrays are RGBA-packed (4 floats per particle, w unused = 0). Disk lies in the XZ plane, Y is thickness. Orbits are counterclockwise seen from +Y. Task 4 uploads these arrays into data textures.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/diskSeeder.test.ts
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/sim/random';
import { seedDisk } from '../src/sim/diskSeeder';

const OPTS = { innerR: 0.28, outerR: 1.9, gm: 0.35, thickness: 0.02, seed: 42 };
const N = 5000;

describe('mulberry32', () => {
  it('is deterministic and in [0,1)', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('seedDisk', () => {
  const { positions, velocities } = seedDisk(N, OPTS);

  it('packs 4 floats per particle', () => {
    expect(positions.length).toBe(N * 4);
    expect(velocities.length).toBe(N * 4);
  });

  it('is deterministic for the same seed', () => {
    const again = seedDisk(N, OPTS);
    expect(again.positions).toEqual(positions);
  });

  it('places every particle inside the annulus with bounded thickness', () => {
    for (let i = 0; i < N; i++) {
      const x = positions[i * 4]!, y = positions[i * 4 + 1]!, z = positions[i * 4 + 2]!;
      const r = Math.hypot(x, z);
      expect(r).toBeGreaterThanOrEqual(OPTS.innerR - 1e-6);
      expect(r).toBeLessThanOrEqual(OPTS.outerR + 1e-6);
      expect(Math.abs(y)).toBeLessThanOrEqual(OPTS.thickness * (1 + r) + 1e-6);
    }
  });

  it('gives near-circular Keplerian speeds', () => {
    for (let i = 0; i < N; i += 50) {
      const x = positions[i * 4]!, z = positions[i * 4 + 2]!;
      const vx = velocities[i * 4]!, vz = velocities[i * 4 + 2]!;
      const r = Math.hypot(x, z);
      const v = Math.hypot(vx, vz);
      const vKep = Math.sqrt(OPTS.gm / r);
      expect(Math.abs(v - vKep) / vKep).toBeLessThan(0.08);
      const radialDot = (x * vx + z * vz) / (r * v);
      expect(Math.abs(radialDot)).toBeLessThan(0.1);
    }
  });

  it('is denser toward the inner edge', () => {
    const radii: number[] = [];
    for (let i = 0; i < N; i++) {
      radii.push(Math.hypot(positions[i * 4]!, positions[i * 4 + 2]!));
    }
    radii.sort((a, b) => a - b);
    const median = radii[Math.floor(N / 2)]!;
    expect(median).toBeLessThan((OPTS.innerR + OPTS.outerR) / 2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL, cannot resolve `../src/sim/random` / `../src/sim/diskSeeder`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/sim/random.ts
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

```typescript
// src/sim/diskSeeder.ts
import { mulberry32 } from './random';

export interface DiskOpts {
  innerR: number;
  outerR: number;
  gm: number;
  thickness: number;
  seed: number;
}

export function seedDisk(
  count: number,
  opts: DiskOpts,
): { positions: Float32Array; velocities: Float32Array } {
  const rand = mulberry32(opts.seed);
  const positions = new Float32Array(count * 4);
  const velocities = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const r = opts.innerR + Math.pow(rand(), 1.5) * (opts.outerR - opts.innerR);
    const a = rand() * Math.PI * 2;
    const y = (rand() * 2 - 1) * opts.thickness * (1 + r) * 0.999;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const v = Math.sqrt(opts.gm / r) * (0.97 + rand() * 0.05);
    positions[i * 4] = x;
    positions[i * 4 + 1] = y;
    positions[i * 4 + 2] = z;
    positions[i * 4 + 3] = 0;
    velocities[i * 4] = Math.sin(a) * v;
    velocities[i * 4 + 1] = 0;
    velocities[i * 4 + 2] = -Math.cos(a) * v;
    velocities[i * 4 + 3] = 0;
  }
  return { positions, velocities };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: all tests PASS (blackbody suite still green).

- [ ] **Step 5: Commit**

```bash
git add src/sim/random.ts src/sim/diskSeeder.ts tests/diskSeeder.test.ts
git commit -m "Add deterministic Keplerian disk seeder"
```

---

### Task 4: GPU particle simulation

**Files:**
- Create: `src/sim/gpuSim.ts`
- Modify: `src/main.ts` (instantiate sim, step it in the loop, `?debug` sanity probe)

**Interfaces:**
- Consumes: `seedDisk` (Task 3), config constants, `THREE.WebGLRenderer`.
- Produces: `class GpuSim { constructor(renderer: THREE.WebGLRenderer, opts: DiskOpts & { texSize: number }); step(dt: number): void; readonly texSize: number; get positionTexture(): THREE.Texture; get velocityTexture(): THREE.Texture; debugSampleRadii(sampleCount?: number): { min: number; max: number; finite: boolean } }`. Task 5's point material reads both textures every frame (they alternate render targets, so re-read the getters after each `step`).

- [ ] **Step 1: Write `src/sim/gpuSim.ts`**

Uses three's `GPUComputationRenderer` addon. Gravity pulls to the origin; a light drag makes an inflow; particles crossing the inner edge respawn in the outer band. Both shaders recompute the same respawn condition from the previous position texture so position and velocity respawn together.

```typescript
// src/sim/gpuSim.ts
import * as THREE from 'three';
import { GPUComputationRenderer, type Variable } from 'three/addons/misc/GPUComputationRenderer.js';
import { seedDisk, type DiskOpts } from './diskSeeder';

const SIM_COMMON = /* glsl */ `
  uniform float uDt;
  uniform float uGm;
  uniform float uInnerR;
  uniform float uOuterR;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  bool needsRespawn(vec3 pos) {
    float r = length(pos.xz);
    return r < uInnerR * 0.9 || r > uOuterR * 1.6;
  }

  vec3 respawnPos(vec2 seed) {
    float r = mix(uOuterR * 0.75, uOuterR, hash(seed));
    float a = hash(seed.yx + 17.0) * 6.28318530718;
    return vec3(cos(a) * r, (hash(seed + 3.0) * 2.0 - 1.0) * 0.02 * (1.0 + r), sin(a) * r);
  }

  vec3 respawnVel(vec3 pos) {
    float r = max(length(pos.xz), 1e-4);
    float v = sqrt(uGm / r);
    return vec3(pos.z / r * v, 0.0, -pos.x / r * v);
  }
`;

const POSITION_SHADER = /* glsl */ `
  ${'$'}{common}
  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec3 pos = texture2D(texturePosition, uv).xyz;
    vec3 vel = texture2D(textureVelocity, uv).xyz;
    if (needsRespawn(pos)) {
      gl_FragColor = vec4(respawnPos(gl_FragCoord.xy), 0.0);
      return;
    }
    gl_FragColor = vec4(pos + vel * uDt, 0.0);
  }
`;

const VELOCITY_SHADER = /* glsl */ `
  ${'$'}{common}
  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec3 pos = texture2D(texturePosition, uv).xyz;
    vec3 vel = texture2D(textureVelocity, uv).xyz;
    if (needsRespawn(pos)) {
      gl_FragColor = vec4(respawnVel(respawnPos(gl_FragCoord.xy)), 0.0);
      return;
    }
    float r2 = dot(pos, pos) + 3e-4;
    vec3 accel = -pos * (uGm / (r2 * sqrt(r2)));
    vec3 next = (vel + accel * uDt) * (1.0 - 0.012 * uDt);
    gl_FragColor = vec4(next, 0.0);
  }
`;

function buildShader(template: string): string {
  return template.replace('${common}', SIM_COMMON);
}

export class GpuSim {
  readonly texSize: number;
  private readonly compute: GPUComputationRenderer;
  private readonly posVar: Variable;
  private readonly velVar: Variable;
  private readonly renderer: THREE.WebGLRenderer;

  constructor(renderer: THREE.WebGLRenderer, opts: DiskOpts & { texSize: number }) {
    this.renderer = renderer;
    this.texSize = opts.texSize;
    this.compute = new GPUComputationRenderer(opts.texSize, opts.texSize, renderer);

    const posTex = this.compute.createTexture();
    const velTex = this.compute.createTexture();
    const seeded = seedDisk(opts.texSize * opts.texSize, opts);
    (posTex.image.data as Float32Array).set(seeded.positions);
    (velTex.image.data as Float32Array).set(seeded.velocities);

    this.posVar = this.compute.addVariable('texturePosition', buildShader(POSITION_SHADER), posTex);
    this.velVar = this.compute.addVariable('textureVelocity', buildShader(VELOCITY_SHADER), velTex);
    this.compute.setVariableDependencies(this.posVar, [this.posVar, this.velVar]);
    this.compute.setVariableDependencies(this.velVar, [this.posVar, this.velVar]);

    for (const v of [this.posVar, this.velVar]) {
      v.material.uniforms.uDt = { value: 0 };
      v.material.uniforms.uGm = { value: opts.gm };
      v.material.uniforms.uInnerR = { value: opts.innerR };
      v.material.uniforms.uOuterR = { value: opts.outerR };
    }

    const err = this.compute.init();
    if (err !== null) throw new Error(`GPUComputationRenderer init failed: ${err}`);
  }

  step(dt: number): void {
    this.posVar.material.uniforms.uDt!.value = dt;
    this.velVar.material.uniforms.uDt!.value = dt;
    this.compute.compute();
  }

  get positionTexture(): THREE.Texture {
    return this.compute.getCurrentRenderTarget(this.posVar).texture;
  }

  get velocityTexture(): THREE.Texture {
    return this.compute.getCurrentRenderTarget(this.velVar).texture;
  }

  debugSampleRadii(sampleCount = 512): { min: number; max: number; finite: boolean } {
    const rt = this.compute.getCurrentRenderTarget(this.posVar) as THREE.WebGLRenderTarget;
    const w = Math.min(this.texSize, sampleCount);
    const buf = new Float32Array(w * 4);
    this.renderer.readRenderTargetPixels(rt, 0, 0, w, 1, buf);
    let min = Infinity;
    let max = -Infinity;
    let finite = true;
    for (let i = 0; i < w; i++) {
      const x = buf[i * 4]!, z = buf[i * 4 + 2]!;
      if (!Number.isFinite(x) || !Number.isFinite(z)) finite = false;
      const r = Math.hypot(x, z);
      min = Math.min(min, r);
      max = Math.max(max, r);
    }
    return { min, max, finite };
  }
}
```

Note on the `${'$'}{common}` construction: the two shader templates contain the literal text `${common}` (not a template interpolation) which `buildShader` replaces. Write them exactly as shown; TypeScript template literals would otherwise try to interpolate a `common` variable that does not exist.

- [ ] **Step 2: Wire the sim into `src/main.ts`**

Add imports and construction after the scene setup, step inside the loop, and a one-shot debug probe:

```typescript
import { DISK_INNER, DISK_OUTER, DISK_THICKNESS, GM, MAX_DT, SEED, TEX_SIZE } from './config';
import { GpuSim } from './sim/gpuSim';
```

```typescript
const sim = new GpuSim(renderer, {
  texSize: TEX_SIZE,
  innerR: DISK_INNER,
  outerR: DISK_OUTER,
  gm: GM,
  thickness: DISK_THICKNESS,
  seed: SEED,
});
```

In `frame()`, replace `void dt;` with:

```typescript
  sim.step(dt);
```

After the first frame when `debug` is set, log the probe once (add near the loop):

```typescript
let probed = false;
```

and inside `frame()` after `sim.step(dt)`:

```typescript
  if (debug && !probed) {
    probed = true;
    const probe = sim.debugSampleRadii();
    console.log(
      `sim ok: finite=${probe.finite} r=[${probe.min.toFixed(2)}, ${probe.max.toFixed(2)}]`,
    );
  }
```

- [ ] **Step 3: Verify**

Run: `npm run build`
Expected: tsc + vite build pass.

Run: `npm run dev`, open `http://localhost:5173/?debug`, check the browser console.
Expected: one line like `sim ok: finite=true r=[0.28, 1.9x]` (max can slightly exceed 1.9 from the speed jitter; anything below `1.9 * 1.6` is healthy). Fps counter still ~60. Screen still shows no particles; that is Task 5.

- [ ] **Step 4: Commit**

```bash
git add src/sim/gpuSim.ts src/main.ts
git commit -m "Add GPU ping-pong particle simulation with inflow respawn"
```

---

### Task 5: Disk points renderer + starfield

**Files:**
- Create: `src/render/diskPoints.ts`, `src/render/starfield.ts`
- Modify: `src/main.ts` (add points + starfield to scene, update textures per frame)

**Interfaces:**
- Consumes: `GpuSim` getters (Task 4), `blackbodyGlsl` (Task 2), config constants.
- Produces: `createDiskPoints(texSize: number): { points: THREE.Points; update(sim: GpuSim): void }` — call `update(sim)` every frame after `sim.step()`; `createStarfield(): THREE.Points`. Task 6's lensing pass distorts whatever these draw.

- [ ] **Step 1: Write `src/render/diskPoints.ts`**

```typescript
// src/render/diskPoints.ts
import * as THREE from 'three';
import { blackbodyGlsl } from '../color/blackbody';
import { DISK_INNER, DISK_OUTER } from '../config';
import type { GpuSim } from '../sim/gpuSim';

const VERT = /* glsl */ `
  uniform sampler2D uPositions;
  uniform sampler2D uVelocities;
  uniform float uPixelRatio;
  varying float vHeat;
  varying float vDoppler;

  void main() {
    vec3 pos = texture2D(uPositions, uv).xyz;
    vec3 vel = texture2D(uVelocities, uv).xyz;
    float r = length(pos.xz);
    vHeat = pow(clamp(1.0 - (r - ${DISK_INNER.toFixed(3)}) / (${(DISK_OUTER - DISK_INNER).toFixed(3)}), 0.0, 1.0), 1.6);
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    vec3 velView = (modelViewMatrix * vec4(vel, 0.0)).xyz;
    vDoppler = 1.0 + 0.55 * clamp(velView.x / max(length(velView), 1e-4), -1.0, 1.0);
    gl_PointSize = clamp((2.0 + vHeat * 6.0) * uPixelRatio * (2.0 / -mvPosition.z), 1.0, 16.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const FRAG = /* glsl */ `
  varying float vHeat;
  varying float vDoppler;
  ${'$'}{blackbody}

  void main() {
    float d = length(gl_PointCoord - 0.5);
    float alpha = smoothstep(0.5, 0.08, d);
    vec3 col = blackbody(vHeat) * (0.35 + vHeat * 1.45) * vDoppler;
    gl_FragColor = vec4(col * alpha, 1.0);
  }
`;

export function createDiskPoints(texSize: number): {
  points: THREE.Points;
  update(sim: GpuSim): void;
} {
  const count = texSize * texSize;
  const geometry = new THREE.BufferGeometry();
  const refs = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    refs[i * 2] = ((i % texSize) + 0.5) / texSize;
    refs[i * 2 + 1] = (Math.floor(i / texSize) + 0.5) / texSize;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(refs, 2));
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), DISK_OUTER * 2);

  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG.replace('${blackbody}', blackbodyGlsl()),
    uniforms: {
      uPositions: { value: null },
      uVelocities: { value: null },
      uPixelRatio: { value: Math.min(devicePixelRatio, 2) },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return {
    points,
    update(sim: GpuSim): void {
      material.uniforms.uPositions!.value = sim.positionTexture;
      material.uniforms.uVelocities!.value = sim.velocityTexture;
    },
  };
}
```

- [ ] **Step 2: Write `src/render/starfield.ts`**

```typescript
// src/render/starfield.ts
import * as THREE from 'three';
import { SEED, STAR_COUNT, STAR_SHELL } from '../config';
import { mulberry32 } from '../sim/random';

export function createStarfield(): THREE.Points {
  const rand = mulberry32(SEED + 1);
  const positions = new Float32Array(STAR_COUNT * 3);
  const colors = new Float32Array(STAR_COUNT * 3);
  const [rMin, rMax] = STAR_SHELL;
  for (let i = 0; i < STAR_COUNT; i++) {
    const r = rMin + rand() * (rMax - rMin);
    const theta = rand() * Math.PI * 2;
    const phi = Math.acos(rand() * 2 - 1);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi);
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    const warm = rand();
    const bright = 0.3 + rand() * 0.7;
    colors[i * 3] = bright;
    colors[i * 3 + 1] = bright * (0.9 + warm * 0.08);
    colors[i * 3 + 2] = bright * (0.85 + (1 - warm) * 0.2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size: 1.6,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });
  return new THREE.Points(geometry, material);
}
```

- [ ] **Step 3: Wire into `src/main.ts`**

```typescript
import { createDiskPoints } from './render/diskPoints';
import { createStarfield } from './render/starfield';
```

After sim construction:

```typescript
const disk = createDiskPoints(TEX_SIZE);
scene.add(disk.points);
scene.add(createStarfield());
```

In `frame()` after `sim.step(dt)`:

```typescript
  disk.update(sim);
```

- [ ] **Step 4: Verify visually**

Run: `npm run dev`, open `http://localhost:5173/?debug`.
Expected: a tilted glowing accretion disk, white-hot inner edge fading to deep red rim, one side brighter than the other, slowly orbiting; stars behind. Fps ≥ 55 at default window size on the desktop GPU. No black hole yet (Task 6).

Run: `npm run build && npm test`
Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add src/render/diskPoints.ts src/render/starfield.ts src/main.ts
git commit -m "Render million-particle disk with blackbody sprites and starfield"
```

---

### Task 6: Lensing pass — shadow, photon ring, fold (TDD for projection)

**Files:**
- Create: `src/render/projectHole.ts`, `src/render/lensing.ts`
- Test: `tests/projectHole.test.ts`

**Interfaces:**
- Consumes: `blackbodyGlsl` (Task 2), `SHADOW_R` from config, `THREE.PerspectiveCamera`.
- Produces: `projectHole(camera: THREE.PerspectiveCamera, worldRadius: number, viewportWidth: number, viewportHeight: number): { centerUv: [number, number]; radiusUv: number }` (uv in [0,1], radius in uv-Y units); `createLensingPass(): { pass: ShaderPass; update(camera: THREE.PerspectiveCamera, width: number, height: number): void }` — Task 7 inserts `pass` into the composer chain and calls `update` on resize and every frame.

- [ ] **Step 1: Write the failing projection test**

```typescript
// tests/projectHole.test.ts
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { projectHole } from '../src/render/projectHole';

function makeCamera(z: number): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100);
  cam.position.set(0, 0, z);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  return cam;
}

describe('projectHole', () => {
  it('projects the origin to screen center for a head-on camera', () => {
    const { centerUv } = projectHole(makeCamera(4.2), 0.22, 1600, 900);
    expect(centerUv[0]).toBeCloseTo(0.5, 3);
    expect(centerUv[1]).toBeCloseTo(0.5, 3);
  });

  it('gives a positive radius that shrinks with distance', () => {
    const near = projectHole(makeCamera(4.2), 0.22, 1600, 900);
    const far = projectHole(makeCamera(8.4), 0.22, 1600, 900);
    expect(near.radiusUv).toBeGreaterThan(0);
    expect(far.radiusUv).toBeLessThan(near.radiusUv);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL, cannot resolve `../src/render/projectHole`.

- [ ] **Step 3: Write `src/render/projectHole.ts`**

```typescript
// src/render/projectHole.ts
import * as THREE from 'three';

export function projectHole(
  camera: THREE.PerspectiveCamera,
  worldRadius: number,
  viewportWidth: number,
  viewportHeight: number,
): { centerUv: [number, number]; radiusUv: number } {
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Write `src/render/lensing.ts`**

Screen-space pass. Order inside the shader matters: distort background first, add fold arcs and photon ring, apply the shadow mask last so nothing leaks inside the horizon.

```typescript
// src/render/lensing.ts
import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { blackbodyGlsl } from '../color/blackbody';
import { SHADOW_R } from '../config';
import { projectHole } from './projectHole';

const FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec2 uHoleUv;
  uniform float uShadowUv;
  uniform float uAspect;
  varying vec2 vUv;
  ${'$'}{blackbody}

  void main() {
    vec2 o = vUv - uHoleUv;
    o.x *= uAspect;
    float d = length(o);
    float rs = uShadowUv;
    vec2 dir = o / max(d, 1e-5);

    float bend = 1.6 * rs * rs / max(d, 1e-4);
    vec2 srcO = o - dir * bend;
    srcO.x /= uAspect;
    vec3 col = texture2D(tDiffuse, clamp(uHoleUv + srcO, 0.0, 1.0)).rgb;

    float heat = clamp(1.0 - (d - rs) / (rs * 2.2), 0.0, 1.0);
    float doppler = 1.0 + 0.55 * clamp(-dir.x, -1.0, 1.0);
    float topBand = exp(-pow((d - rs * 2.0) / (rs * 0.55), 2.0)) * smoothstep(0.05, 0.55, dir.y);
    float botBand = exp(-pow((d - rs * 1.45) / (rs * 0.28), 2.0)) * smoothstep(0.05, 0.55, -dir.y);
    col += blackbody(heat) * (topBand * 1.5 + botBand * 0.9) * doppler * 1.8;

    float ring = exp(-pow((d - rs * 1.12) / (rs * 0.045), 2.0));
    col += vec3(1.0, 0.98, 0.94) * ring * 2.4;

    col *= smoothstep(rs * 0.985, rs * 1.015, d);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createLensingPass(): {
  pass: ShaderPass;
  update(camera: THREE.PerspectiveCamera, width: number, height: number): void;
} {
  const pass = new ShaderPass({
    name: 'LensingPass',
    uniforms: {
      tDiffuse: { value: null },
      uHoleUv: { value: new THREE.Vector2(0.5, 0.5) },
      uShadowUv: { value: 0.1 },
      uAspect: { value: 16 / 9 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: FRAG.replace('${blackbody}', blackbodyGlsl()),
  });

  return {
    pass,
    update(camera: THREE.PerspectiveCamera, width: number, height: number): void {
      const { centerUv, radiusUv } = projectHole(camera, SHADOW_R, width, height);
      (pass.uniforms.uHoleUv!.value as THREE.Vector2).set(centerUv[0], centerUv[1]);
      pass.uniforms.uShadowUv!.value = radiusUv;
      pass.uniforms.uAspect!.value = width / height;
    },
  };
}
```

- [ ] **Step 6: Commit**

Wiring into the render loop happens with the composer in Task 7; the lensing pass cannot run standalone. Commit the tested projection helper and the pass:

```bash
git add src/render/projectHole.ts src/render/lensing.ts tests/projectHole.test.ts
git commit -m "Add lensing pass with shadow, photon ring, and fold arcs"
```

---

### Task 7: Post chain — composer, bloom, ACES output

**Files:**
- Create: `src/render/postChain.ts`
- Modify: `src/main.ts` (replace direct `renderer.render` with the composer; wire lensing updates and resize)

**Interfaces:**
- Consumes: `createLensingPass` (Task 6), bloom constants from config.
- Produces: `createPostChain(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera): { composer: EffectComposer; lensing: ReturnType<typeof createLensingPass>; setSize(width: number, height: number): void }`. `main.ts` calls `composer.render()` per frame and `setSize` + `lensing.update` on resize.

- [ ] **Step 1: Write `src/render/postChain.ts`**

```typescript
// src/render/postChain.ts
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { BLOOM_RADIUS, BLOOM_STRENGTH, BLOOM_THRESHOLD } from '../config';
import { createLensingPass } from './lensing';

export function createPostChain(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
): {
  composer: EffectComposer;
  lensing: ReturnType<typeof createLensingPass>;
  setSize(width: number, height: number): void;
} {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const lensing = createLensingPass();
  composer.addPass(lensing.pass);

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(innerWidth, innerHeight),
    BLOOM_STRENGTH,
    BLOOM_RADIUS,
    BLOOM_THRESHOLD,
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  return {
    composer,
    lensing,
    setSize(width: number, height: number): void {
      composer.setSize(width, height);
      bloom.setSize(width, height);
      lensing.update(camera, width, height);
    },
  };
}
```

- [ ] **Step 2: Rewire `src/main.ts`**

Add import:

```typescript
import { createPostChain } from './render/postChain';
```

After scene/disk/starfield setup:

```typescript
const post = createPostChain(renderer, scene, camera);
post.lensing.update(camera, innerWidth, innerHeight);
```

Update `onResize` to also call:

```typescript
  post.setSize(innerWidth, innerHeight);
```

In `frame()`, replace `renderer.render(scene, camera);` with:

```typescript
  post.lensing.update(camera, innerWidth, innerHeight);
  post.composer.render();
```

(`lensing.update` per frame is cheap and keeps the hole pinned if the camera ever moves; M2 adds camera drift.)

- [ ] **Step 3: Verify visually — the acceptance gate for the money shot**

Run: `npm run dev`, open `http://localhost:5173/?debug`.
Expected, all at once: pure-black shadow disc at center; thin brilliant photon ring around it; disk arcs folding above and below the shadow; the flat particle disk crossing in front at the bottom; background stars visibly smeared into arcs near the ring; one disk side brighter (Doppler); bloom glow off the ring and inner disk; fps ≥ 55.

Resize the window: composition holds, hole stays centered, no stretching.

Run: `npm run build && npm test`
Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add src/render/postChain.ts src/main.ts
git commit -m "Add composer chain: lensing, bloom, ACES output"
```

---

### Task 8: Playwright smoke test with pixel assertions

**Files:**
- Create: `playwright.config.ts`, `e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: the built app (`npm run build && npm run preview`).
- Produces: `npm run e2e` as the repo's smoke gate; later milestones extend `e2e/`.

- [ ] **Step 1: Write `playwright.config.ts`**

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:4173', viewport: { width: 1280, height: 720 } },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

- [ ] **Step 2: Write the smoke test**

(The app already exists, so unlike the unit-test tasks this is written to pass; a failure here is a finding about Tasks 5–7.)

```typescript
// e2e/smoke.spec.ts
import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';

function luminanceAt(png: PNG, x: number, y: number): number {
  const i = (png.width * y + x) << 2;
  return (png.data[i]! + png.data[i + 1]! + png.data[i + 2]!) / 3;
}

function regionStats(
  png: PNG,
  cx: number,
  cy: number,
  half: number,
): { mean: number; max: number } {
  let sum = 0;
  let max = 0;
  let n = 0;
  for (let y = cy - half; y <= cy + half; y++) {
    for (let x = cx - half; x <= cx + half; x++) {
      const l = luminanceAt(png, x, y);
      sum += l;
      max = Math.max(max, l);
      n++;
    }
  }
  return { mean: sum / n, max };
}

test('money shot renders: webgl2, no errors, shadow + ring pixels', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.goto('/');
  await page.waitForTimeout(3000);

  const hasWebgl2 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    return c.getContext('webgl2') !== null;
  });
  expect(hasWebgl2).toBe(true);
  expect(errors).toEqual([]);

  const png = PNG.sync.read(await page.screenshot());
  const cx = Math.floor(png.width / 2);
  const cy = Math.floor(png.height / 2);

  const shadow = regionStats(png, cx, cy, 6);
  expect(shadow.mean).toBeLessThan(10);

  let ringMax = 0;
  for (let a = 0; a < 64; a++) {
    const ang = (a / 64) * Math.PI * 2;
    for (const rr of [0.04, 0.05, 0.06, 0.07, 0.08]) {
      const x = Math.round(cx + Math.cos(ang) * png.height * rr);
      const y = Math.round(cy + Math.sin(ang) * png.height * rr);
      ringMax = Math.max(ringMax, luminanceAt(png, x, y));
    }
  }
  expect(ringMax).toBeGreaterThan(180);

  const whole = regionStats(png, cx, cy, Math.floor(png.height / 2) - 2);
  expect(whole.mean).toBeGreaterThan(2);
});

test('sustains at least 30 fps locally', async ({ page }) => {
  test.skip(!!process.env.CI, 'headless CI GPUs are not representative');
  await page.goto('/');
  await page.waitForTimeout(2000);
  const fps = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let frames = 0;
        const start = performance.now();
        function tick(): void {
          frames++;
          if (performance.now() - start >= 2000) resolve(frames / 2);
          else requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      }),
  );
  expect(fps).toBeGreaterThan(30);
});
```

- [ ] **Step 3: Install browsers and run to verify current state**

Run: `npx playwright install chromium`
Expected: chromium downloads.

Run: `npm run e2e`
Expected: PASS (the app exists by now; if any assertion fails, that is a real finding about Tasks 5–7 — investigate the app, do not loosen the thresholds without understanding why).

- [ ] **Step 4: Commit**

```bash
git add playwright.config.ts e2e/smoke.spec.ts
git commit -m "Add Playwright smoke test with shadow and ring pixel checks"
```

---

### Task 9: README and milestone wrap-up

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the repo's front door; M1 declared done only after MD's visual sign-off.

- [ ] **Step 1: Write `README.md`**

````markdown
# Everything Must Go

A WebGL art site: a spinning black hole consumes a procedurally generated
cosmos over a twelve-minute cycle, then a new cosmos is born and it starts
again. The site is the piece.

Design spec: [.planning/superpowers/specs/2026-07-02-everything-must-go-design.md](.planning/superpowers/specs/2026-07-02-everything-must-go-design.md)

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173 (?debug for fps, ?seed=n later)
npm test           # unit tests (vitest)
npm run e2e        # smoke test (Playwright, builds first)
```

## Status

- [x] Milestone 1: money shot — GPU disk, lensed shadow + photon ring + fold, bloom
- [ ] Milestone 2: the consumption cycle and rebirth
- [ ] Milestone 3: planets, moons, belt, comets, nebulae, galaxies
- [ ] Milestone 4: cursor well, silhouette cast, rogue-hole merger
- [ ] Milestone 5: adaptive score and enter gate
- [ ] Milestone 6: quality tiers, mobile, deploy

## Architecture

`core` (loop) → `sim` (GPU ping-pong particle textures) → `render`
(points, starfield, screen-space lensing) → `post` (bloom, ACES output).
Pure logic (seeding, color ramp, projection) is unit-tested; the rendered
frame is smoke-tested with pixel assertions.
````

- [ ] **Step 2: Full verification sweep**

Run: `npm run build`
Expected: clean.

Run: `npm test`
Expected: all unit tests pass.

Run: `npm run e2e`
Expected: smoke passes, fps test passes locally.

Open `http://localhost:5173/?debug` and get MD's eyes on it. MD's sign-off is the milestone acceptance (spec: "Accept: it already looks like the piece"). Record the observed fps in the sign-off message.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "Add README with quick start and milestone status"
```

- [ ] **Step 4: Remote (requires MD confirmation)**

The spec marks the repo public, but creating a public GitHub repo is an outward-facing action. Ask MD to confirm, then:

```bash
gh repo create everything-must-go --public --source . --push
```

If MD defers, leave the repo local and move on; deploy is M6 regardless.
