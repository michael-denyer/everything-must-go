# Milestone 2: The Cycle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The full consumption arc runs unattended: a seeded cosmos generator, a pure cycle evaluator driving hole growth, disk drain, star plunge, camera pull-back, darkness, a rebirth flash, and a fresh cosmos — default 12 minutes per cycle, compressible and seedable by URL for testing.

**Architecture:** Two new pure modules (`core/cosmosGen.ts`, `core/cycle.ts`) are the brain: seed → `CosmosSpec`, and `(spec, seconds) → CycleParams`. Everything else is plumbing that lets the existing render/sim stack accept live parameters instead of baked constants: `GpuSim` gains uniform setters, a respawn gate, and disposal (rebirth constructs a fresh sim — `diskPoints.update(sim)` was designed for texture-source swaps); `diskPoints`/`lensing`/`starfield` gain uniforms for radii, fade, flash, and plunge; `main.ts` becomes the cycle conductor with `?seed=`, `?cycle=`, `?t=` URL controls and a consumed-counter UI.

**Tech Stack:** unchanged — TypeScript strict, Vite, three.js, vitest, Playwright.

## Global Constraints

- Spec: `.planning/superpowers/specs/2026-07-02-everything-must-go-design.md`. This plan implements Milestone 2: "The cycle. Cosmos generator, state machine, consumption schedules, camera pull, darkness and rebirth. Accept: a full 12-minute death and rebirth runs unattended."
- Phase boundaries are the spec's, expressed as progress fractions: serene < 0.25 ≤ decay < 0.60 ≤ carnage < 0.92 ≤ darkness < 0.97 ≤ rebirth ≤ 1.0.
- Carry-overs from the M1 whole-branch review are in scope and assigned to tasks below: starfield explicit `renderOrder`, radius parameterization (lensing `shadowR` argument, disk heat-ramp uniforms), shader literal extraction (drag, thickness) with a config home, dead `PARTICLE_COUNT` export removal, `projectHole` origin-assumption comment plus a pinned `radiusUv` magnitude test.
- Consciously deferred (record, do not build): star streak rendering during plunge (M3, alongside the other sky content); bloom retune and the ring-halo decision (MD decides at M2 sign-off when the grown hole makes the current tuning visibly wrong or not); Doppler axis alignment (aesthetic, only if realism tuning happens).
- TypeScript `strict: true`; `npx tsc` exit 0 before every commit. **No `--quiet`/`-q`/`--silent` flags ever.** Commits plain, imperative, no AI attribution. `package-lock.json` stays committed. Working directory `/Users/mdenyer/projects/everything-must-go`, branch `milestone-2`.
- Existing e2e money-shot assertions must keep passing at early-cycle progress; new cycle assertions come in Task 8.
- Numeric contract used across tasks (single source of truth is `evalCycle` in Task 3): hole radius grows as `holeR0 * (1 + (holeGrowth - 1) * pow(p, 1.6))`; gravity scales with hole area `GM * pow(holeR / holeR0, 2)`; drag multiplier `1 + 5 * pow(p, 1.8)`; disk respawn stops at p ≥ 0.88; star plunge ramps `clamp((p - 0.65) / 0.27, 0, 1)`; camera distance multiplier `1 + 0.45 * smoothstep(0.1, 0.9, p)`; fade holds 1 until p = 0.92 then smoothsteps to 0 by p = 0.965; flash ramps 0→1 over p ∈ [0.955, 0.975] and holds 1 to cycle end (post-rebirth decay lives in `main.ts`).

---

### Task 1: Config homes and projection hardening (carry-overs, TDD)

**Files:**
- Modify: `src/config.ts` (remove `PARTICLE_COUNT`; add `DRAG_BASE`, `CYCLE_SECONDS`)
- Modify: `src/render/projectHole.ts` (origin-assumption comment)
- Test: `tests/projectHole.test.ts` (add pinned-magnitude test)

**Interfaces:**
- Consumes: existing config exports.
- Produces: `DRAG_BASE = 0.012`, `CYCLE_SECONDS = 720` (both consumed by Tasks 3–4); `PARTICLE_COUNT` gone (verify nothing imports it before removing — it was dead at M1 review).

- [ ] **Step 1: Write the failing pinned-magnitude test**

Append to `tests/projectHole.test.ts`:

```typescript
  it('pins the projected radius magnitude for the M1 composition', () => {
    const cam = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100);
    cam.position.set(0, 1.05, 4.2);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld(true);
    const { radiusUv } = projectHole(cam, 0.22, 1600, 900);
    expect(radiusUv).toBeGreaterThan(0.05);
    expect(radiusUv).toBeLessThan(0.06);
  });
```

- [ ] **Step 2: Run to verify it fails or passes honestly**

Run: `npm test`
Expected: the new test PASSES immediately (it pins existing behavior — that is its job; the M1 review measured ≈0.0545). If it FAILS, the projection changed since review: stop and report, do not adjust the bounds.

- [ ] **Step 3: Apply config and comment changes**

In `src/config.ts`: delete the `PARTICLE_COUNT` line (first run `grep -rn "PARTICLE_COUNT" src tests e2e` — expect only the config definition; if any other hit appears, stop and report). Add:

```typescript
export const DRAG_BASE = 0.012;
export const CYCLE_SECONDS = 720;
```

In `src/render/projectHole.ts`, directly above the `const center` line:

```typescript
  // Assumes the hole sits at the world origin; both projected points below
  // bake that in. Revisit if the hole ever gets a position parameter.
```

- [ ] **Step 4: Verify**

Run: `npm test && npx tsc && npm run build`
Expected: all green (14 unit tests now).

- [ ] **Step 5: Commit**

```bash
git add src/config.ts src/render/projectHole.ts tests/projectHole.test.ts
git commit -m "Pin projection contract and give shader literals a config home"
```

---

### Task 2: Cosmos generator (TDD)

**Files:**
- Create: `src/core/cosmosGen.ts`
- Test: `tests/cosmosGen.test.ts`

**Interfaces:**
- Consumes: `mulberry32` from `src/sim/random.ts`; `CYCLE_SECONDS` from config.
- Produces (Tasks 3, 7 depend on the exact shape):

```typescript
export interface CosmosSpec {
  seed: number;
  cycleSeconds: number;
  holeR0: number;
  holeGrowth: number;
  diskInner0: number;
  diskOuter0: number;
  starCount: number;
  starShell: [number, number];
  diskSeed: number;
  starSeed: number;
}
export function generateCosmos(seed: number): CosmosSpec;
```

- [ ] **Step 1: Write the failing test**

```typescript
// tests/cosmosGen.test.ts
import { describe, expect, it } from 'vitest';
import { generateCosmos } from '../src/core/cosmosGen';

describe('generateCosmos', () => {
  it('is deterministic for the same seed and varies across seeds', () => {
    expect(generateCosmos(42)).toEqual(generateCosmos(42));
    expect(generateCosmos(42)).not.toEqual(generateCosmos(43));
  });

  it('stays inside its documented ranges for 200 seeds', () => {
    for (let s = 0; s < 200; s++) {
      const c = generateCosmos(s);
      expect(c.cycleSeconds).toBeGreaterThanOrEqual(648);
      expect(c.cycleSeconds).toBeLessThanOrEqual(792);
      expect(c.holeR0).toBeGreaterThanOrEqual(0.19);
      expect(c.holeR0).toBeLessThanOrEqual(0.25);
      expect(c.holeGrowth).toBeGreaterThanOrEqual(2.6);
      expect(c.holeGrowth).toBeLessThanOrEqual(3.4);
      expect(c.diskInner0).toBeGreaterThan(c.holeR0 * 1.15);
      expect(c.diskOuter0).toBeGreaterThanOrEqual(1.7);
      expect(c.diskOuter0).toBeLessThanOrEqual(2.1);
      expect(c.starCount).toBeGreaterThanOrEqual(3200);
      expect(c.starCount).toBeLessThanOrEqual(4800);
      expect(c.starShell[0]).toBeGreaterThanOrEqual(5);
      expect(c.starShell[1]).toBeLessThanOrEqual(16);
      expect(c.starShell[0]).toBeLessThan(c.starShell[1]);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL, cannot resolve `../src/core/cosmosGen`.

- [ ] **Step 3: Implement**

```typescript
// src/core/cosmosGen.ts
import { CYCLE_SECONDS } from '../config';
import { mulberry32 } from '../sim/random';

export interface CosmosSpec {
  seed: number;
  cycleSeconds: number;
  holeR0: number;
  holeGrowth: number;
  diskInner0: number;
  diskOuter0: number;
  starCount: number;
  starShell: [number, number];
  diskSeed: number;
  starSeed: number;
}

export function generateCosmos(seed: number): CosmosSpec {
  const rand = mulberry32(seed);
  const lerp = (a: number, b: number): number => a + (b - a) * rand();
  const holeR0 = lerp(0.19, 0.25);
  const shellMin = lerp(5, 8);
  return {
    seed,
    cycleSeconds: Math.round(CYCLE_SECONDS * lerp(0.9, 1.1)),
    holeR0,
    holeGrowth: lerp(2.6, 3.4),
    diskInner0: Math.max(holeR0 * 1.2, lerp(0.26, 0.32)),
    diskOuter0: lerp(1.7, 2.1),
    starCount: Math.round(lerp(3200, 4800)),
    starShell: [shellMin, shellMin + lerp(5, 8)],
    diskSeed: Math.floor(rand() * 2 ** 31),
    starSeed: Math.floor(rand() * 2 ** 31),
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test && npx tsc`
Expected: green (16 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/cosmosGen.ts tests/cosmosGen.test.ts
git commit -m "Add seeded cosmos generator"
```

---

### Task 3: Cycle evaluator (TDD)

**Files:**
- Create: `src/core/cycle.ts`
- Test: `tests/cycle.test.ts`

**Interfaces:**
- Consumes: `CosmosSpec` (Task 2); `GM`, `DRAG_BASE` from config.
- Produces (Task 7 consumes every field each frame):

```typescript
export type Phase = 'serene' | 'decay' | 'carnage' | 'darkness' | 'rebirth';
export interface CycleParams {
  progress: number;
  phase: Phase;
  holeR: number;
  gm: number;
  drag: number;
  diskRespawn: boolean;
  starPlunge: number;
  camDist: number;
  fade: number;
  flash: number;
}
export function evalCycle(spec: CosmosSpec, tSeconds: number): CycleParams;
```

- [ ] **Step 1: Write the failing test**

```typescript
// tests/cycle.test.ts
import { describe, expect, it } from 'vitest';
import { generateCosmos } from '../src/core/cosmosGen';
import { evalCycle, type Phase } from '../src/core/cycle';
import { DRAG_BASE, GM } from '../src/config';

const spec = generateCosmos(42);
const at = (p: number) => evalCycle(spec, p * spec.cycleSeconds);

describe('evalCycle', () => {
  it('maps progress to the spec phase boundaries', () => {
    const cases: Array<[number, Phase]> = [
      [0.0, 'serene'], [0.249, 'serene'], [0.25, 'decay'], [0.599, 'decay'],
      [0.6, 'carnage'], [0.919, 'carnage'], [0.92, 'darkness'], [0.969, 'darkness'],
      [0.97, 'rebirth'], [1.0, 'rebirth'],
    ];
    for (const [p, phase] of cases) expect(at(p).phase).toBe(phase);
  });

  it('clamps progress to [0,1] outside the cycle', () => {
    expect(evalCycle(spec, -5).progress).toBe(0);
    expect(evalCycle(spec, spec.cycleSeconds * 2).progress).toBe(1);
  });

  it('grows the hole monotonically to holeGrowth times its start', () => {
    let prev = 0;
    for (let p = 0; p <= 1.0001; p += 0.01) {
      const r = at(Math.min(1, p)).holeR;
      expect(r).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = r;
    }
    expect(at(0).holeR).toBeCloseTo(spec.holeR0, 10);
    expect(at(1).holeR).toBeCloseTo(spec.holeR0 * spec.holeGrowth, 10);
  });

  it('scales gravity with hole area', () => {
    expect(at(0).gm).toBeCloseTo(GM, 10);
    const p = at(0.7);
    expect(p.gm).toBeCloseTo(GM * (p.holeR / spec.holeR0) ** 2, 10);
  });

  it('drives drag, respawn, plunge, and camera per contract', () => {
    expect(at(0).drag).toBeCloseTo(DRAG_BASE, 10);
    expect(at(1).drag).toBeCloseTo(DRAG_BASE * 6, 10);
    expect(at(0.87).diskRespawn).toBe(true);
    expect(at(0.88).diskRespawn).toBe(false);
    expect(at(0.6).starPlunge).toBeCloseTo(0, 5);
    expect(at(0.65).starPlunge).toBe(0);
    expect(at(0.92).starPlunge).toBe(1);
    expect(at(0).camDist).toBeCloseTo(1, 5);
    expect(at(1).camDist).toBeCloseTo(1.45, 5);
  });

  it('fades to black through darkness and flashes into rebirth', () => {
    expect(at(0.5).fade).toBe(1);
    expect(at(0.92).fade).toBe(1);
    expect(at(0.965).fade).toBeCloseTo(0, 5);
    expect(at(0.95).flash).toBe(0);
    expect(at(0.955).flash).toBe(0);
    expect(at(0.975).flash).toBe(1);
    expect(at(1).flash).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL, cannot resolve `../src/core/cycle`.

- [ ] **Step 3: Implement**

```typescript
// src/core/cycle.ts
import { DRAG_BASE, GM } from '../config';
import type { CosmosSpec } from './cosmosGen';

export type Phase = 'serene' | 'decay' | 'carnage' | 'darkness' | 'rebirth';

export interface CycleParams {
  progress: number;
  phase: Phase;
  holeR: number;
  gm: number;
  drag: number;
  diskRespawn: boolean;
  starPlunge: number;
  camDist: number;
  fade: number;
  flash: number;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

function phaseOf(p: number): Phase {
  if (p < 0.25) return 'serene';
  if (p < 0.6) return 'decay';
  if (p < 0.92) return 'carnage';
  if (p < 0.97) return 'darkness';
  return 'rebirth';
}

export function evalCycle(spec: CosmosSpec, tSeconds: number): CycleParams {
  const p = clamp01(tSeconds / spec.cycleSeconds);
  const holeR = spec.holeR0 * (1 + (spec.holeGrowth - 1) * Math.pow(p, 1.6));
  return {
    progress: p,
    phase: phaseOf(p),
    holeR,
    gm: GM * (holeR / spec.holeR0) ** 2,
    drag: DRAG_BASE * (1 + 5 * Math.pow(p, 1.8)),
    diskRespawn: p < 0.88,
    starPlunge: clamp01((p - 0.65) / 0.27),
    camDist: 1 + 0.45 * smoothstep(0.1, 0.9, p),
    fade: p < 0.92 ? 1 : 1 - smoothstep(0.92, 0.965, p),
    flash: smoothstep(0.955, 0.975, p),
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test && npx tsc`
Expected: green (22 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/cycle.ts tests/cycle.test.ts
git commit -m "Add pure cycle evaluator for the consumption arc"
```

---

### Task 4: GpuSim live parameters, park gate, disposal

**Files:**
- Modify: `src/sim/gpuSim.ts`

**Interfaces:**
- Consumes: `CycleParams` field values (as plain numbers/bool — no import of core/).
- Produces (Task 7 depends on): `setParams(p: { gm: number; innerR: number; outerR: number; drag: number; respawnOn: boolean }): void` (updates uniforms; call once per frame before `step`); `dispose(): void` (releases both render-target chains; safe to call once; the instance must not be used after). Constructor/`step`/getters/`debugSampleRadii` signatures unchanged.

- [ ] **Step 1: Extend the shaders**

In `SIM_COMMON`, add uniforms and replace the hardcoded thickness:

```glsl
  uniform float uDrag;
  uniform float uRespawnOn;
  uniform float uThickness;
```

In `respawnPos`, change `* 0.02 *` to `* uThickness *`.

In `POSITION_SHADER`, replace the respawn branch with a park-or-respawn gate (parked particles sit far outside every radius check and stay parked because `needsRespawn` keeps returning true while `uRespawnOn` stays 0 — and once respawn re-enables, parked particles respawn normally):

```glsl
    if (needsRespawn(pos)) {
      if (uRespawnOn < 0.5) {
        gl_FragColor = vec4(99.0, 99.0, 99.0, 0.0);
        return;
      }
      gl_FragColor = vec4(respawnPos(gl_FragCoord.xy), 0.0);
      return;
    }
```

In `VELOCITY_SHADER`, mirror the same gate (parked velocity is zero) and replace the hardcoded drag `(1.0 - 0.012 * uDt)` with `(1.0 - uDrag * uDt)`:

```glsl
    if (needsRespawn(pos)) {
      if (uRespawnOn < 0.5) {
        gl_FragColor = vec4(0.0);
        return;
      }
      gl_FragColor = vec4(respawnVel(respawnPos(gl_FragCoord.xy)), 0.0);
      return;
    }
```

- [ ] **Step 2: Extend the class**

In the constructor's uniform loop add:

```typescript
      v.material.uniforms.uDrag = { value: 0.012 };
      v.material.uniforms.uRespawnOn = { value: 1 };
      v.material.uniforms.uThickness = { value: opts.thickness };
```

Add methods:

```typescript
  setParams(p: { gm: number; innerR: number; outerR: number; drag: number; respawnOn: boolean }): void {
    for (const v of [this.posVar, this.velVar]) {
      v.material.uniforms.uGm!.value = p.gm;
      v.material.uniforms.uInnerR!.value = p.innerR;
      v.material.uniforms.uOuterR!.value = p.outerR;
      v.material.uniforms.uDrag!.value = p.drag;
      v.material.uniforms.uRespawnOn!.value = p.respawnOn ? 1 : 0;
    }
  }

  dispose(): void {
    for (const v of [this.posVar, this.velVar]) {
      for (const rt of (v as unknown as { renderTargets: THREE.WebGLRenderTarget[] }).renderTargets) {
        rt.dispose();
      }
      v.material.dispose();
    }
  }
```

(`renderTargets` is a real runtime property of GPUComputationRenderer variables; if `@types/three` declares it, drop the cast and access it directly — prefer the typed path when available.)

- [ ] **Step 3: Verify**

Run: `npm test && npx tsc && npm run build`
Expected: green. Behavior at defaults is unchanged (drag default matches DRAG_BASE, respawn on), so the money-shot e2e must still pass: run `npm run e2e` and expect the pixel test green (fps test skips on software rendering).

- [ ] **Step 4: Commit**

```bash
git add src/sim/gpuSim.ts
git commit -m "Give the sim live parameters, a park gate, and disposal"
```

---

### Task 5: Live radii, fade, and flash in the render layer

**Files:**
- Modify: `src/render/diskPoints.ts`, `src/render/lensing.ts`, `src/render/postChain.ts`, `src/main.ts`

**Interfaces:**
- Produces (Task 7 depends on):
  - `createDiskPoints(texSize)` return gains `setParams(p: { heatInner: number; heatOuter: number; fade: number }): void`.
  - `createLensingPass()` return becomes `{ pass, update(camera, width, height, shadowR: number): void, setFlash(f: number): void }` — `shadowR` is now an argument, not `SHADOW_R` baked in.
  - `createPostChain(...)` unchanged shape, but its `setSize` forwards `SHADOW_R`? No — `setSize` calls `lensing.update(camera, width, height, this.lastShadowR)` where `lastShadowR` is whatever the last per-frame update supplied (store it; initialize to `SHADOW_R`).

- [ ] **Step 1: diskPoints — uniforms replace baked radii; parked guard; fade**

In `VERT`: add `uniform float uHeatInner; uniform float uHeatOuter;` and replace the interpolated-constant heat line with:

```glsl
    vHeat = pow(clamp(1.0 - (r - uHeatInner) / max(uHeatOuter - uHeatInner, 1e-4), 0.0, 1.0), 1.6);
```

Add a parked guard as the first statements of `main()` (parked particles collapse to a zero-size point behind the camera):

```glsl
    if (pos.x > 50.0) {
      gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      vHeat = 0.0;
      vDoppler = 0.0;
      return;
    }
```

(Place the guard after `pos` is read; declare nothing before it that the early return would skip.)

In `FRAG`: add `uniform float uFade;` and multiply the output color by it.

In the material uniforms add `uHeatInner: { value: DISK_INNER }`, `uHeatOuter: { value: DISK_OUTER }`, `uFade: { value: 1 }`. Extend the returned object:

```typescript
    setParams(p: { heatInner: number; heatOuter: number; fade: number }): void {
      material.uniforms.uHeatInner!.value = p.heatInner;
      material.uniforms.uHeatOuter!.value = p.heatOuter;
      material.uniforms.uFade!.value = p.fade;
    },
```

- [ ] **Step 2: lensing — shadowR argument and flash uniform**

Add uniform `uFlash: { value: 0 }`. At the end of the fragment shader, after the shadow-mask multiply, add:

```glsl
    col = mix(col, vec3(1.0, 0.98, 0.94), uFlash);
```

Change `update` to `update(camera, width, height, shadowR: number)` using `projectHole(camera, shadowR, width, height)`, and add:

```typescript
    setFlash(f: number): void {
      pass.uniforms.uFlash!.value = f;
    },
```

- [ ] **Step 3: postChain and main keep compiling**

`postChain.ts`: hold `let lastShadowR = SHADOW_R;` in the closure; `setSize` calls `lensing.update(camera, width, height, lastShadowR)`; expose nothing new — instead change nothing else and let `main.ts` call `post.lensing.update(camera, innerWidth, innerHeight, shadowR)` per frame (it already calls update per frame; add the fourth argument `SHADOW_R` for now — Task 7 substitutes the live value and also routes `lastShadowR` by having `main.ts` call update immediately after any resize anyway, which it does since update runs every frame). Concretely: in `postChain.ts` change the `setSize` lensing call to `lensing.update(camera, width, height, lastShadowR)` and set `lastShadowR` inside a small wrapper:

```typescript
    lensingUpdate(cam: THREE.PerspectiveCamera, width: number, height: number, shadowR: number): void {
      lastShadowR = shadowR;
      lensing.update(cam, width, height, shadowR);
    },
```

Return `lensingUpdate` and `lensing` both; `main.ts` switches its per-frame call to `post.lensingUpdate(camera, innerWidth, innerHeight, SHADOW_R)` and its initial call likewise.

- [ ] **Step 4: Verify — behavior identical at defaults**

Run: `npm test && npx tsc && npm run build && npm run e2e`
Expected: all green; the money shot is pixel-identical at defaults (same radii, fade 1, flash 0).

- [ ] **Step 5: Commit**

```bash
git add src/render/diskPoints.ts src/render/lensing.ts src/render/postChain.ts src/main.ts
git commit -m "Route radii, fade, and flash through live uniforms"
```

---

### Task 6: Starfield rebuilt for plunge, fade, and explicit ordering

**Files:**
- Modify: `src/render/starfield.ts`

**Interfaces:**
- Produces (Task 7 depends on): `createStarfield(count: number, shell: [number, number], seed: number): { points: THREE.Points; setParams(p: { plunge: number; fade: number }): void }` — note the signature change from the M1 zero-arg version; per-cosmos values now come from `CosmosSpec`. `points.renderOrder = -1` set inside (M1 review carry-over: stars must composite under the disk explicitly, not by insertion order).

- [ ] **Step 1: Rewrite starfield.ts**

```typescript
// src/render/starfield.ts
import * as THREE from 'three';
import { mulberry32 } from '../sim/random';

const VERT = /* glsl */ `
  attribute float aSeed;
  uniform float uPlunge;
  varying float vBright;
  varying vec3 vColor;
  attribute vec3 color;

  void main() {
    float gate = clamp((uPlunge * 1.3 - aSeed * 0.3) / 1.0, 0.0, 1.0);
    float fall = pow(gate, 1.5);
    vec3 p = mix(position, position * 0.02, fall);
    vBright = 1.0 + fall * 2.5;
    vColor = color;
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = (1.6 + fall * 2.0) * (300.0 / max(-mvPosition.z, 1.0)) * 0.01 + 1.6;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const FRAG = /* glsl */ `
  uniform float uFade;
  varying float vBright;
  varying vec3 vColor;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    float alpha = smoothstep(0.5, 0.15, d) * 0.85 * uFade;
    gl_FragColor = vec4(vColor * vBright * alpha, 1.0);
  }
`;

export function createStarfield(
  count: number,
  shell: [number, number],
  seed: number,
): { points: THREE.Points; setParams(p: { plunge: number; fade: number }): void } {
  const rand = mulberry32(seed);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const [rMin, rMax] = shell;
  for (let i = 0; i < count; i++) {
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
    seeds[i] = rand();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uPlunge: { value: 0 },
      uFade: { value: 1 },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = -1;
  return {
    points,
    setParams(p: { plunge: number; fade: number }): void {
      material.uniforms.uPlunge!.value = p.plunge;
      material.uniforms.uFade!.value = p.fade;
    },
  };
}
```

Note the blending change from M1's NormalBlending PointsMaterial to additive — this is the actual fix behind the M1 review's render-order finding (emissive stars add into the scene instead of stamping over the disk), and `renderOrder = -1` makes ordering explicit regardless.

- [ ] **Step 2: Fix the call site so the build compiles**

`src/main.ts` currently calls `createStarfield()` with no arguments; change to `createStarfield(STAR_COUNT, [...STAR_SHELL], SEED + 1)` and `scene.add(starfield.points)` (Task 7 replaces these constants with `CosmosSpec` values — for this task the visual must match M1 defaults).

- [ ] **Step 3: Verify**

Run: `npm test && npx tsc && npm run build && npm run e2e`
Expected: green; money-shot pixels still pass (stars additive now — whole-frame mean may shift slightly; the e2e ceiling is 110 and healthy was ~66, ample headroom; if any pixel gate fails, investigate before loosening anything).

- [ ] **Step 4: Commit**

```bash
git add src/render/starfield.ts src/main.ts
git commit -m "Rebuild starfield with plunge, fade, and explicit ordering"
```

---

### Task 7: The conductor — cycle wiring, URL controls, rebirth, counter

**Files:**
- Modify: `src/main.ts`, `index.html`

**Interfaces:**
- Consumes: everything above.
- Produces: URL controls `?seed=<int>` (cosmos seed, default 1), `?cycle=<seconds>` (override spec.cycleSeconds), `?t=<0..1>` (freeze progress for tests/screens; sim keeps animating); `window.__emg = { spec, params }` refreshed each frame (test hook); `#counter` element bottom-left "cosmos no. N · X% consumed"; `?debug` HUD line gains the phase name.

- [ ] **Step 1: index.html — counter element and style**

Add below the `#title` div:

```html
  <div id="counter"></div>
```

and to the `<style>` block:

```css
    #counter {
      position: fixed; bottom: 14px; left: 22px; color: rgba(168, 178, 205, .62);
      font-family: system-ui, sans-serif; font-size: 11px; letter-spacing: 1px;
      user-select: none; pointer-events: none;
    }
```

- [ ] **Step 2: main.ts becomes the conductor**

Replace the body of `src/main.ts` with:

```typescript
import * as THREE from 'three';
import { CAM_POS, DISK_THICKNESS, GM, MAX_DT, SHADOW_R, TEX_SIZE } from './config';
import { createScene } from './scene';
import { generateCosmos, type CosmosSpec } from './core/cosmosGen';
import { evalCycle } from './core/cycle';
import { GpuSim } from './sim/gpuSim';
import { createDiskPoints } from './render/diskPoints';
import { createStarfield } from './render/starfield';
import { createPostChain } from './render/postChain';

const canvas = document.getElementById('app') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);

const { scene, camera } = createScene();
scene.background = new THREE.Color(0x05060b);

const q = new URLSearchParams(location.search);
const debug = q.has('debug');
const seedParam = Number.parseInt(q.get('seed') ?? '1', 10);
const cycleOverride = Number.parseFloat(q.get('cycle') ?? '');
const tFreeze = Number.parseFloat(q.get('t') ?? '');

const debugEl = document.getElementById('debug') as HTMLDivElement;
const counterEl = document.getElementById('counter') as HTMLDivElement;
if (debug) debugEl.style.display = 'block';

let cosmosNo = 0;
let spec: CosmosSpec;
let sim: GpuSim;
let disk: ReturnType<typeof createDiskPoints>;
let stars: ReturnType<typeof createStarfield>;
let cycleT = 0;
let flashDecay = 0;

const disposables: Array<{ points: THREE.Points }> = [];

function seedCosmos(seed: number): void {
  cosmosNo++;
  spec = generateCosmos(seed);
  if (Number.isFinite(cycleOverride) && cycleOverride > 0) spec.cycleSeconds = cycleOverride;
  cycleT = 0;
  if (sim) sim.dispose();
  sim = new GpuSim(renderer, {
    texSize: TEX_SIZE,
    innerR: spec.diskInner0,
    outerR: spec.diskOuter0,
    gm: GM,
    thickness: DISK_THICKNESS,
    seed: spec.diskSeed,
  });
  for (const d of disposables) {
    scene.remove(d.points);
    d.points.geometry.dispose();
    (d.points.material as THREE.Material).dispose();
  }
  disposables.length = 0;
  disk = createDiskPoints(TEX_SIZE);
  stars = createStarfield(spec.starCount, spec.starShell, spec.starSeed);
  scene.add(stars.points);
  scene.add(disk.points);
  disposables.push({ points: disk.points }, { points: stars.points });
}

seedCosmos(Number.isFinite(seedParam) ? seedParam : 1);
const post = createPostChain(renderer, scene, camera);
post.lensingUpdate(camera, innerWidth, innerHeight, SHADOW_R);

function onResize(): void {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  post.setSize(innerWidth, innerHeight);
}
addEventListener('resize', onResize);

let last = performance.now();
let frames = 0;
let fpsWindowStart = performance.now();

function frame(now: number): void {
  const dt = Math.min(MAX_DT, (now - last) / 1000) || 1 / 60;
  last = now;

  cycleT += dt;
  const effT = Number.isFinite(tFreeze)
    ? Math.min(Math.max(tFreeze, 0), 1) * spec.cycleSeconds
    : cycleT;
  const p = evalCycle(spec, effT);

  if (!Number.isFinite(tFreeze) && cycleT >= spec.cycleSeconds) {
    flashDecay = 1;
    seedCosmos(spec.seed + 1);
  }

  const innerR = Math.max(spec.diskInner0, p.holeR * 1.27);
  sim.setParams({ gm: p.gm, innerR, outerR: spec.diskOuter0, drag: p.drag, respawnOn: p.diskRespawn });
  sim.step(dt);
  disk.update(sim);
  disk.setParams({ heatInner: innerR, heatOuter: spec.diskOuter0, fade: p.fade });
  stars.setParams({ plunge: p.starPlunge, fade: p.fade });

  camera.position.set(CAM_POS[0] * p.camDist, CAM_POS[1] * p.camDist, CAM_POS[2] * p.camDist);
  camera.lookAt(0, 0, 0);

  flashDecay = Math.max(0, flashDecay - dt * 0.8);
  post.lensingUpdate(camera, innerWidth, innerHeight, p.holeR);
  post.lensing.setFlash(Math.max(p.flash, flashDecay));
  post.composer.render();

  counterEl.textContent = `cosmos no. ${cosmosNo} · ${Math.round(p.progress * 100)}% consumed`;
  (window as unknown as { __emg: object }).__emg = { spec, params: p };

  if (debug) {
    frames++;
    if (now - fpsWindowStart >= 1000) {
      debugEl.textContent = `${frames} fps · ${p.phase}`;
      frames = 0;
      fpsWindowStart = now;
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

Notes for the implementer: `gm: 0.35` in the sim constructor is only the seeding speed base (GM at progress 0) — `setParams` overrides the live value every frame; the disk is re-created per cosmos so its geometry matches nothing stale; `SHADOW_R` remains only as the pre-first-frame lensing radius.

- [ ] **Step 3: Verify behavior at both ends**

Run: `npm run build && npm test && npx tsc`
Expected: green.

Run: `npm run dev`, open `http://localhost:5173/?debug&cycle=90` and watch one full 90-second cycle end to end.
Expected: serene disk → visibly growing shadow and accelerating drain → stars falling in late → screen fades to near-black with only the ring → white flash → fresh cosmos, counter reads "cosmos no. 2 · 0% consumed". Zero console errors across the rebirth boundary (the sim swap is the risky moment — watch for it).

Open `http://localhost:5173/?debug&t=0.95`: near-black frame, ring visible, counter shows 95%.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts index.html
git commit -m "Wire the consumption cycle: growth, drain, plunge, rebirth"
```

---

### Task 8: Cycle e2e coverage and docs

**Files:**
- Create: `e2e/cycle.spec.ts`
- Modify: `README.md` (milestone checklist + URL controls section)

**Interfaces:**
- Consumes: `window.__emg` hook, `?seed`/`?t`/`?cycle` params, existing pngjs helpers (duplicate the small helpers into this spec file rather than importing across spec files).

- [ ] **Step 1: Write `e2e/cycle.spec.ts`**

```typescript
// e2e/cycle.spec.ts
import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';

function luminanceAt(png: PNG, x: number, y: number): number {
  const i = (png.width * y + x) << 2;
  return (png.data[i]! + png.data[i + 1]! + png.data[i + 2]!) / 3;
}

function frameMean(png: PNG): number {
  let sum = 0;
  for (let y = 0; y < png.height; y += 4) {
    for (let x = 0; x < png.width; x += 4) sum += luminanceAt(png, x, y);
  }
  return sum / ((png.width / 4) * (png.height / 4));
}

test('same seed produces the same cosmos spec', async ({ page }) => {
  await page.goto('/?seed=7');
  await page.waitForFunction(() => (window as unknown as { __emg?: object }).__emg !== undefined);
  const a = await page.evaluate(() => JSON.stringify((window as unknown as { __emg: { spec: object } }).__emg.spec));
  await page.goto('/?seed=7');
  await page.waitForFunction(() => (window as unknown as { __emg?: object }).__emg !== undefined);
  const b = await page.evaluate(() => JSON.stringify((window as unknown as { __emg: { spec: object } }).__emg.spec));
  expect(a).toBe(b);
  await page.goto('/?seed=8');
  await page.waitForFunction(() => (window as unknown as { __emg?: object }).__emg !== undefined);
  const c = await page.evaluate(() => JSON.stringify((window as unknown as { __emg: { spec: object } }).__emg.spec));
  expect(c).not.toBe(a);
});

test('darkness phase is near-black with the counter reading 95%', async ({ page }) => {
  await page.goto('/?seed=7&t=0.95');
  await page.waitForTimeout(3000);
  const png = PNG.sync.read(await page.screenshot());
  expect(frameMean(png)).toBeLessThan(8);
  await expect(page.locator('#counter')).toContainText('95% consumed');
});

test('early cycle still passes the money-shot gates', async ({ page }) => {
  await page.goto('/?seed=7&t=0.05');
  await page.waitForTimeout(3000);
  const png = PNG.sync.read(await page.screenshot());
  const cx = Math.floor(png.width / 2);
  const cy = Math.floor(png.height / 2);
  let shadowSum = 0;
  for (let y = cy - 6; y <= cy + 6; y++)
    for (let x = cx - 6; x <= cx + 6; x++) shadowSum += luminanceAt(png, x, y);
  expect(shadowSum / 169).toBeLessThan(10);
  const mean = frameMean(png);
  expect(mean).toBeGreaterThan(2);
  expect(mean).toBeLessThan(110);
});

test('a compressed cycle survives rebirth without console errors', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/?seed=7&cycle=45');
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __emg?: { params: { progress: number } } };
      return w.__emg !== undefined && w.__emg.params.progress > 0.1;
    },
    { timeout: 30_000 },
  );
  await page.waitForFunction(
    () => document.getElementById('counter')?.textContent?.includes('cosmos no. 2') ?? false,
    { timeout: 90_000 },
  );
  expect(errors).toEqual([]);
});
```

- [ ] **Step 2: Run the whole e2e suite**

Run: `npm run e2e`
Expected: money-shot spec green, all four cycle tests green (the compressed-cycle test takes ~60-90s), fps test skipped on software rendering. Paste real output.

- [ ] **Step 3: README updates**

Mark milestone 2 `[x]` in the checklist and add under Quick start:

```markdown
URL controls: `?seed=<n>` picks the cosmos, `?cycle=<seconds>` compresses the cycle,
`?t=<0..1>` freezes progress at a point in the arc, `?debug` shows fps and phase.
```

- [ ] **Step 4: Full sweep and commit**

Run: `npm test && npx tsc && npm run build && npm run e2e`
Expected: everything green.

```bash
git add e2e/cycle.spec.ts README.md
git commit -m "Cover the cycle with e2e tests and document URL controls"
```

---

### Task 9: Milestone acceptance

No new files. The acceptance is the spec's: "a full 12-minute death and rebirth runs unattended."

- [ ] **Step 1: Unattended soak** — run three consecutive compressed cycles headlessly (`?cycle=60`, watch for `cosmos no. 4`) with zero console errors, via a scratch script in `.superpowers/sdd/` (not committed). Report the counter progression and error count.
- [ ] **Step 2: MD watches a real or compressed cycle** on the dev server and signs off. Ask MD the deferred ring-halo question here if the grown hole's look raises it (the ring is much larger by carnage phase — judge the bloom interaction visually).
- [ ] **Step 3:** Final whole-branch review, then finishing-a-development-branch (PR to main).
