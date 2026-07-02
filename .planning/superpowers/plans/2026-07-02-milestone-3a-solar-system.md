# Milestone 3a: The Solar System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The cosmos gains a dying solar system: 7–10 procedurally varied planets (2–3 ringed, 0–4 moons) that lose rings, moons, and finally crack into glowing debris; an asteroid belt that drains grain by grain; comets shedding tails on eccentric orbits — all colored by a seeded per-cosmos palette, plus the ring-halo bloom pass MD chose (lensed ring and folds now glow).

**Architecture:** Pure additions first: a seeded palette generator and a roster extension to `CosmosSpec` (append-only RNG draws, pinned by a regression test so every existing seed's M2 fields are bit-stable). The composer is re-ordered once — Render → Lensing → Bloom → ShadowRecarve → Output — so the analytic ring/folds bloom while a cheap final mask keeps the horizon black and hosts the rebirth whiteout. Discrete content lives in a small CPU `Body` framework (planets, moons, comets implement it) feeding a fixed-size CPU debris pool rendered as one additive Points; the belt is a self-orbiting instanced shader that culls per-grain by progress. The conductor's rebirth seam (`seedCosmos` + a widened `disposables`) is the only integration point.

**Tech Stack:** unchanged — TypeScript strict, Vite, three.js, vitest, Playwright.

## Global Constraints

- Spec: `.planning/superpowers/specs/2026-07-02-everything-must-go-design.md`. This plan implements the solar-system half of Milestone 3's roster: planets 7–10 (rings stripped first, then tidal stretch, then crack into debris), ringed 2–3, moons 0–4 total (stripped before their planet breaks, plunge alone), asteroid belt (drains grain by grain through decay), comets 4–6 (eccentric orbits, shed tails, die at the horizon). Deep-sky roster (nebulae, galaxies, clusters, pulsar, band, shooting stars) is Milestone 3b — out of scope here.
- Also in scope, per MD's M2 sign-off decision: the ring-halo pass (mask-after-bloom) with its bloom retune.
- Carry-overs assigned in this plan: widen the `disposables` seam (Task 1); cosmosGen append-only draws + starShell derivation comment (Task 2); `?t=0.97` flash e2e (Task 7). Not this plan: projectHole camera staleness (M4 note), Doppler axis (only if realism tuning), dependabot chain (M6).
- Wild color lives in the new content: nebula-class palettes seed planet/belt/ring hues; the disk stays physical blackbody (spec art rule).
- Textures are procedural (offscreen canvas bakes, seeded) — no external imagery in 3a, so no licensing work; NASA/ESA imagery remains a 3b option.
- Determinism: everything a cosmos shows must derive from its seed. No `Math.random()` outside `mulberry32` streams.
- Existing e2e gates must keep passing at every task boundary (early money shot, darkness, rebirth band). The ring-halo task retunes bloom and must re-prove the gates.
- Performance budget: MD's hardware ran 120 fps at M2. The new content adds ≤ 15 meshes (spheres at 24×16 segments), one instanced belt (≤ 900 grains), one 8192-point debris pool — all trivial next to the million-particle disk. If MD measures < 60 fps at acceptance, that is a finding to investigate, not tune away silently.
- TypeScript `strict: true`; `npx tsc` exit 0 before every commit. **No `--quiet`/`-q`/`--silent` flags ever.** Commits plain, imperative, no AI attribution. Branch `milestone-3a`. Working directory `/Users/mdenyer/projects/everything-must-go`.
- Timing-sensitive e2e additions use the repo's settle-poll pattern (SwiftShader runs sim time at ~0.26× wall; whiteout decays in dt-clamped wall time).
- Numeric contract for deaths (single source: `src/core/tidal.ts`, Task 3): rings strip at `r < holeR * 5.5`; moons unbind at `r < holeR * 4.5`; tidal stretch ramps over `r ∈ [holeR * 4.2, holeR * 2.0]`; bodies burst at `r < holeR * 2.0`; debris and comets are consumed at `r < holeR * 1.05`.

---

### Task 1: Disposal seam and body/debris framework

**Files:**
- Modify: `src/main.ts` (widen `disposables`)
- Create: `src/render/debris.ts`, `src/core/tidal.ts`
- Test: `tests/tidal.test.ts`

**Interfaces:**
- Produces (every later task depends on these):

```typescript
// main.ts internal shape (call sites in Task 6):
const disposables: Array<{ object: THREE.Object3D; dispose(): void }> = [];

// src/core/tidal.ts (pure):
export const RING_STRIP = 5.5;
export const MOON_UNBIND = 4.5;
export const STRETCH_START = 4.2;
export const BURST = 2.0;
export const CONSUME = 1.05;
export function stretchFactor(r: number, holeR: number): number; // 0 at STRETCH_START*holeR, 1 at BURST*holeR, clamped

// src/render/debris.ts:
export function createDebrisPool(capacity?: number): {
  points: THREE.Points;
  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, r: number, g: number, b: number): void;
  update(dt: number, gm: number, drag: number, holeR: number): void;
  dispose(): void;
};
```

- [ ] **Step 1: Write the failing tidal test**

```typescript
// tests/tidal.test.ts
import { describe, expect, it } from 'vitest';
import { BURST, CONSUME, MOON_UNBIND, RING_STRIP, STRETCH_START, stretchFactor } from '../src/core/tidal';

describe('tidal contract', () => {
  it('orders the death radii correctly', () => {
    expect(RING_STRIP).toBeGreaterThan(MOON_UNBIND);
    expect(MOON_UNBIND).toBeGreaterThan(STRETCH_START);
    expect(STRETCH_START).toBeGreaterThan(BURST);
    expect(BURST).toBeGreaterThan(CONSUME);
  });

  it('ramps stretch from 0 to 1 across the stretch zone', () => {
    const holeR = 0.2;
    expect(stretchFactor(STRETCH_START * holeR + 0.01, holeR)).toBe(0);
    expect(stretchFactor(STRETCH_START * holeR, holeR)).toBeCloseTo(0, 6);
    expect(stretchFactor(BURST * holeR, holeR)).toBeCloseTo(1, 6);
    expect(stretchFactor(0.01, holeR)).toBe(1);
    const mid = stretchFactor(((STRETCH_START + BURST) / 2) * holeR, holeR);
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.7);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL, cannot resolve `../src/core/tidal`.

- [ ] **Step 3: Implement tidal.ts**

```typescript
// src/core/tidal.ts
export const RING_STRIP = 5.5;
export const MOON_UNBIND = 4.5;
export const STRETCH_START = 4.2;
export const BURST = 2.0;
export const CONSUME = 1.05;

export function stretchFactor(r: number, holeR: number): number {
  const t = (STRETCH_START * holeR - r) / ((STRETCH_START - BURST) * holeR);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}
```

- [ ] **Step 4: Implement debris.ts**

CPU-integrated ring-buffer pool rendered as one additive Points. 8192 default capacity; dead slots collapse to a parked position the vertex path never rasterizes (same trick as the disk's park guard).

```typescript
// src/render/debris.ts
import * as THREE from 'three';

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
    },
    update(dt, gm, drag, holeR): void {
      const dragMul = 1 - drag * dt;
      for (let i = 0; i < capacity; i++) {
        if (!alive[i]) continue;
        const o = i * 3;
        const x = positions[o]!, y = positions[o + 1]!, z = positions[o + 2]!;
        const r2 = x * x + y * y + z * z;
        const r = Math.sqrt(r2);
        if (r < holeR * 1.05 || r > 4) {
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
      colAttr.needsUpdate = true;
    },
    dispose(): void {
      geometry.dispose();
      material.dispose();
    },
  };
}
```

- [ ] **Step 5: Widen the disposables seam in main.ts**

Replace the `disposables` declaration and its uses:

```typescript
const disposables: Array<{ object: THREE.Object3D; dispose(): void }> = [];
```

In `seedCosmos`, the cleanup loop becomes:

```typescript
  for (const d of disposables) {
    scene.remove(d.object);
    d.dispose();
  }
  disposables.length = 0;
```

and the disk/stars registrations become:

```typescript
  disposables.push(
    { object: disk.points, dispose: () => { disk.points.geometry.dispose(); (disk.points.material as THREE.Material).dispose(); } },
    { object: stars.points, dispose: () => { stars.points.geometry.dispose(); (stars.points.material as THREE.Material).dispose(); } },
  );
```

- [ ] **Step 6: Verify**

Run: `npm test && npx tsc && npm run build`
Expected: green (24 unit tests). Then `npm run e2e` — all gates unchanged (nothing renders differently yet; debris pool is not yet constructed anywhere).

- [ ] **Step 7: Commit**

```bash
git add src/core/tidal.ts src/render/debris.ts src/main.ts tests/tidal.test.ts
git commit -m "Add tidal contract, debris pool, and a general disposal seam"
```

---

### Task 2: Palette generator and roster extension (TDD, seed-stable)

**Files:**
- Create: `src/core/palette.ts`
- Modify: `src/core/cosmosGen.ts`
- Test: `tests/palette.test.ts`, `tests/cosmosGen.test.ts` (extend)

**Interfaces:**
- Produces:

```typescript
// src/core/palette.ts (pure)
export type Rgb = [number, number, number];
export function hslToRgb(h: number, s: number, l: number): Rgb; // h degrees any range, s/l 0..1, out 0..1 linear-ish
export interface Palette { scheme: 'analogous' | 'triad' | 'clash'; hues: number[]; } // 5-7 hue angles
export function generatePalette(seed: number): Palette;
export function paletteRgb(p: Palette, idx: number, s: number, l: number): Rgb; // hues[idx % hues.length] via hslToRgb

// cosmosGen additions to CosmosSpec (all drawn AFTER every existing field — append-only):
export interface MoonSpec { dist: number; size: number; speed: number; phase: number; }
export interface PlanetSpec {
  orbitR: number; size: number; kind: 'giant' | 'rocky' | 'ice';
  ringed: boolean; moons: MoonSpec[]; hueIdx: number; phase: number; texSeed: number;
}
export interface CosmosSpec {
  /* ...all ten M2 fields unchanged, then: */
  paletteSeed: number;
  planets: PlanetSpec[];      // 7-10
  beltCount: number;          // 600-900
  beltInner: number;          // 0.78-0.84
  beltHueIdx: number;
  comets: Array<{ aphelion: number; perihelion: number; phase: number }>; // 4-6
}
```

- [ ] **Step 1: Write the failing palette test**

```typescript
// tests/palette.test.ts
import { describe, expect, it } from 'vitest';
import { generatePalette, hslToRgb, paletteRgb } from '../src/core/palette';

describe('palette', () => {
  it('hslToRgb hits known anchors', () => {
    expect(hslToRgb(0, 1, 0.5)).toEqual([1, 0, 0]);
    const [r, g, b] = hslToRgb(120, 1, 0.5);
    expect(r).toBeCloseTo(0, 6);
    expect(g).toBeCloseTo(1, 6);
    expect(b).toBeCloseTo(0, 6);
    expect(hslToRgb(360 + 240, 1, 0.5)[2]).toBeCloseTo(1, 6);
  });

  it('is deterministic and in range for 100 seeds', () => {
    for (let s = 0; s < 100; s++) {
      const p = generatePalette(s);
      expect(p).toEqual(generatePalette(s));
      expect(['analogous', 'triad', 'clash']).toContain(p.scheme);
      expect(p.hues.length).toBeGreaterThanOrEqual(5);
      expect(p.hues.length).toBeLessThanOrEqual(7);
    }
    expect(generatePalette(1)).not.toEqual(generatePalette(2));
  });

  it('paletteRgb wraps the hue index', () => {
    const p = generatePalette(9);
    expect(paletteRgb(p, p.hues.length + 2, 0.8, 0.6)).toEqual(paletteRgb(p, 2, 0.8, 0.6));
  });
});
```

- [ ] **Step 2: Extend the cosmosGen test with the seed-stability pin FIRST**

Append to `tests/cosmosGen.test.ts` — this is the regression pin that makes append-only violations loud. Capture the M2 values of seed 42 BEFORE touching cosmosGen (run a tiny script or temporary console.log against the current build and inline the numbers; they are stable):

```typescript
  it('keeps every M2 field of seed 42 bit-stable after the roster extension', () => {
    const c = generateCosmos(42);
    // Values pinned from the M2 implementation before the roster fields were added.
    // If this test fails, a new RNG draw was inserted before existing draws —
    // that silently re-rolls every existing cosmos. Append draws at the end only.
    expect(c.holeR0).toBeCloseTo(PINNED.holeR0, 12);
    expect(c.cycleSeconds).toBe(PINNED.cycleSeconds);
    expect(c.holeGrowth).toBeCloseTo(PINNED.holeGrowth, 12);
    expect(c.diskInner0).toBeCloseTo(PINNED.diskInner0, 12);
    expect(c.diskOuter0).toBeCloseTo(PINNED.diskOuter0, 12);
    expect(c.starCount).toBe(PINNED.starCount);
    expect(c.starShell[0]).toBeCloseTo(PINNED.starShell0, 12);
    expect(c.starShell[1]).toBeCloseTo(PINNED.starShell1, 12);
    expect(c.diskSeed).toBe(PINNED.diskSeed);
    expect(c.starSeed).toBe(PINNED.starSeed);
  });

  it('generates a ranged roster', () => {
    for (let s = 0; s < 100; s++) {
      const c = generateCosmos(s);
      expect(c.planets.length).toBeGreaterThanOrEqual(7);
      expect(c.planets.length).toBeLessThanOrEqual(10);
      const ringed = c.planets.filter((p) => p.ringed).length;
      expect(ringed).toBeGreaterThanOrEqual(2);
      expect(ringed).toBeLessThanOrEqual(3);
      const moons = c.planets.reduce((n, p) => n + p.moons.length, 0);
      expect(moons).toBeLessThanOrEqual(4);
      for (const p of c.planets) {
        expect(p.orbitR).toBeGreaterThanOrEqual(0.55);
        expect(p.orbitR).toBeLessThanOrEqual(1.9);
        expect(p.size).toBeGreaterThanOrEqual(0.012);
        expect(p.size).toBeLessThanOrEqual(0.055);
      }
      expect(c.beltCount).toBeGreaterThanOrEqual(600);
      expect(c.beltCount).toBeLessThanOrEqual(900);
      expect(c.comets.length).toBeGreaterThanOrEqual(4);
      expect(c.comets.length).toBeLessThanOrEqual(6);
      for (const cm of c.comets) {
        expect(cm.perihelion).toBeLessThan(cm.aphelion);
        expect(cm.perihelion).toBeGreaterThanOrEqual(0.2);
        expect(cm.aphelion).toBeLessThanOrEqual(2.4);
      }
    }
  });
```

`PINNED` is a const object at the top of the test file holding the captured literals (fill in the real numbers; do not compute them from `generateCosmos` inside the test — that would make the pin circular).

- [ ] **Step 3: Run to verify the right failures**

Run: `npm test`
Expected: palette suite fails on missing module; the stability pin PASSES against unmodified cosmosGen (proving the pinned literals are right); the roster test fails on missing fields.

- [ ] **Step 4: Implement palette.ts**

```typescript
// src/core/palette.ts
import { mulberry32 } from '../sim/random';

export type Rgb = [number, number, number];

export function hslToRgb(h: number, s: number, l: number): Rgb {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (hue < 60) { r = c; g = x; }
  else if (hue < 120) { r = x; g = c; }
  else if (hue < 180) { g = c; b = x; }
  else if (hue < 240) { g = x; b = c; }
  else if (hue < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return [r + m, g + m, b + m];
}

export interface Palette {
  scheme: 'analogous' | 'triad' | 'clash';
  hues: number[];
}

export function generatePalette(seed: number): Palette {
  const rand = mulberry32(seed);
  const h0 = rand() * 360;
  const pick = rand();
  const scheme: Palette['scheme'] = pick < 1 / 3 ? 'analogous' : pick < 2 / 3 ? 'triad' : 'clash';
  const count = 5 + Math.floor(rand() * 3);
  const hues: number[] = [];
  for (let i = 0; i < count; i++) {
    const jitter = (rand() - 0.5) * 14;
    if (scheme === 'analogous') hues.push(h0 - 30 + i * (90 / count) + jitter);
    else if (scheme === 'triad') hues.push(h0 + (i % 3) * 120 + Math.floor(i / 3) * 18 + jitter);
    else hues.push(h0 + (i % 2) * 180 + (i % 3) * 24 + jitter);
  }
  return { scheme, hues };
}

export function paletteRgb(p: Palette, idx: number, s: number, l: number): Rgb {
  return hslToRgb(p.hues[idx % p.hues.length]!, s, l);
}
```

- [ ] **Step 5: Extend cosmosGen — append-only, with the derivation comment**

At the end of `generateCosmos`'s existing draws (after `starSeed`), append new draws in this exact order: `paletteSeed`, then planets (count draw, then per-planet: orbitR, size, kind, ringed-candidate, phase, texSeed, hueIdx), then moon assignment (total 0-3 draws + per-moon dist/size/speed/phase), then belt (count, inner, hueIdx), then comets (count, then per-comet aphelion/perihelion/phase). Also add the owed derivation comment above `starShell`:

```typescript
  // starShell's upper bound is shellMin + lerp(5,8): both terms draw from [5,8),
  // so the supremum 16 is approached but never reached — the test cap of 16 is
  // exact, not slack. Change either lerp range and the cap must move with it.
```

Ring assignment: draw a shuffled candidate order and mark the first `2 + (rand() < 0.5 ? 0 : 1)` planets in it as ringed, giants preferred (sort candidates giants-first before marking). Kind: `rand()` thirds → giant/rocky/ice, giants get sizes in the upper half of the range. Moon assignment: `total = Math.floor(rand() * 5)` clamped to 4; distribute one at a time to random planets. All ranges per the Interfaces block above. This is the one code block in this plan left to the implementer's construction — the test in Step 2 is the spec; keep every draw appended after `starSeed` and inside the ranges, and structure the loops so counts drawn early fix the number of later draws (no conditional draw-skipping within a planet).

- [ ] **Step 6: Run to verify green**

Run: `npm test && npx tsc`
Expected: all green including the stability pin (proving append-only held) — 27+ tests.

- [ ] **Step 7: Commit**

```bash
git add src/core/palette.ts src/core/cosmosGen.ts tests/palette.test.ts tests/cosmosGen.test.ts
git commit -m "Add seeded palette and solar-system roster to the cosmos generator"
```

---

### Task 3: Ring-halo pass — Render → Lensing → Bloom → ShadowRecarve → Output

**Files:**
- Create: `src/render/shadowRecarve.ts`
- Modify: `src/render/postChain.ts`, `src/render/lensing.ts`, `src/main.ts`, `src/config.ts`

**Interfaces:**
- `createShadowRecarve(): { pass: ShaderPass; update(centerUv: [number, number], radiusUv: number, aspect: number): void; setFlash(f: number): void }`.
- The flash MOVES from lensing to the recarve pass (the whiteout must fill the re-carved shadow and must not be dimmed by bloom-order effects): lensing loses `uFlash`/`setFlash`; postChain routes `setFlash` to the recarve pass and keeps the external surface `post.lensing.setFlash(...)`-free — main.ts switches to `post.setFlash(f)`.
- `postChain.lensingUpdate(camera, w, h, shadowR)` now also updates the recarve pass's uniforms from the same `projectHole` result (one projection, two consumers).
- New bloom constants in config (old ones replaced): `BLOOM_STRENGTH = 0.35`, `BLOOM_RADIUS = 0.25`, `BLOOM_THRESHOLD = 1.5` — starting points; the acceptance gates below own the final values.

- [ ] **Step 1: Write shadowRecarve.ts**

```typescript
// src/render/shadowRecarve.ts
import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec2 uHoleUv;
  uniform float uShadowUv;
  uniform float uAspect;
  uniform float uFlash;
  varying vec2 vUv;

  void main() {
    vec2 o = vUv - uHoleUv;
    o.x *= uAspect;
    float d = length(o);
    vec3 col = texture2D(tDiffuse, vUv).rgb;
    col *= smoothstep(uShadowUv * 0.985, uShadowUv * 1.015, d);
    col = mix(col, vec3(1.0, 0.98, 0.94), uFlash);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createShadowRecarve(): {
  pass: ShaderPass;
  update(centerUv: [number, number], radiusUv: number, aspect: number): void;
  setFlash(f: number): void;
} {
  const pass = new ShaderPass({
    name: 'ShadowRecarvePass',
    uniforms: {
      tDiffuse: { value: null },
      uHoleUv: { value: new THREE.Vector2(0.5, 0.5) },
      uShadowUv: { value: 0.1 },
      uAspect: { value: 16 / 9 },
      uFlash: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: FRAG,
  });
  return {
    pass,
    update(centerUv, radiusUv, aspect): void {
      (pass.uniforms.uHoleUv!.value as THREE.Vector2).set(centerUv[0], centerUv[1]);
      pass.uniforms.uShadowUv!.value = radiusUv;
      pass.uniforms.uAspect!.value = aspect;
    },
    setFlash(f: number): void {
      pass.uniforms.uFlash!.value = f;
    },
  };
}
```

- [ ] **Step 2: Rework lensing.ts**

Remove `uFlash`, its `setFlash`, and the final `col = mix(col, vec3(1.0, 0.98, 0.94), uFlash);` line. Everything else (distortion, folds, ring, fade on emissive, shadow mask) stays — the lensing mask still runs so the pre-bloom image has a black hole (bloom then blooms the ring INTO the shadow edge, which is exactly the halo MD wants; the recarve then restores the hard horizon).

- [ ] **Step 3: Rework postChain.ts**

Chain: `RenderPass → lensing.pass → UnrealBloomPass → recarve.pass → OutputPass`. `lensingUpdate(camera, width, height, shadowR)` computes `projectHole` ONCE and feeds both `lensing.update(...)` (which may keep its own projectHole call removed — refactor lensing.update to accept the projected values OR leave it calling projectHole and give recarve the same inputs; choose the single-projection refactor: `lensing.update(centerUv, radiusUv, aspect)` with main-facing signature unchanged at the postChain level). Expose `setFlash(f)` forwarding to recarve. `setSize` continues to drive composer + bloom + the stored-lastShadowR re-projection.

- [ ] **Step 4: main.ts + config.ts**

`post.lensing.setFlash(...)` call becomes `post.setFlash(Math.max(p.flash, flashDecay))`. Replace the three bloom constants in config with the new starting values (keep the HDR comment, updated: threshold is now in post-lensing HDR space where the ring peaks ~2.4).

- [ ] **Step 5: Verify against the full gate set — this is a retune, prove it**

Scratch harness (`.superpowers/sdd/`, uncommitted, keep for the reviewer): build + preview + headless captures with pngjs stats:
1. `/?seed=7&t=0.05`: shadow center 12×12 mean < 10; ring annulus max > 180; whole mean in (2, 110).
2. Ring-halo efficacy — the point of this task: with final constants vs bloom strength forced 0 (runtime patch in scratch only), the mean of a thin annulus just OUTSIDE the photon ring (radius 1.3–1.8 × the projected shadow radius) must be ≥ 20% brighter with bloom on. Paste both numbers.
3. `/?seed=7&t=0.95` settle-poll: mean < 8 still holds (fade dims the emissive pre-bloom, so bloom input dims too — verify, don't assume).
4. Rebirth whiteout: `/?seed=7&t=0.97` frame mean > 180 (flash ≈ 1 fills via recarve).
5. `npm test`, `npx tsc`, `npm run build`, then the FULL `npm run e2e` (money-shot spec + cycle spec) — all green.
Tune the three constants until all five hold; report every iteration's numbers.

- [ ] **Step 6: Commit**

```bash
git add src/render/shadowRecarve.ts src/render/lensing.ts src/render/postChain.ts src/main.ts src/config.ts
git commit -m "Bloom the lensed ring, then re-carve the horizon"
```

---

### Task 4: Planets, moons, rings

**Files:**
- Create: `src/render/planet.ts`
- Test: none new (pure parts live in tidal.ts; planet is exercised by e2e in Task 7 and eyes at acceptance)

**Interfaces:**
- Produces: `createPlanet(spec: PlanetSpec, palette: Palette, gm0: number): PlanetBody` where

```typescript
export interface PlanetBody {
  object: THREE.Group;        // planet mesh + ring mesh + moon meshes, positioned in world space
  update(dt: number, gm: number, dragBase: number, holeR: number,
         spawnDebris: (x: number, y: number, z: number, vx: number, vy: number, vz: number, r: number, g: number, b: number) => void): void;
  alive: boolean;             // false after burst; conductor removes + disposes
  dispose(): void;
}
```

- Behavior contract (uses tidal.ts constants; all radii × holeR): ring strips at RING_STRIP — ring mesh removed, ~140 debris spawned along its ellipse tinted ring color; moons unbind at MOON_UNBIND — each becomes an independent plunging point-mass rendered as its small mesh, consumed at CONSUME with a 6-debris puff; stretch zone scales the planet mesh along the radial direction by `1 + 2.4 * stretchFactor` (and 1 − 0.3 · stretch on the tangential axes) while shedding a debris trickle (≤ 4/frame, planet-tinted); burst at BURST — ~300 debris in a shell, tinted planet hue, `alive = false`.
- Orbit: CPU integration, same force law as debris (`a = gm/(r²+3e-4)` inward, drag `dragBase * 0.55` — planets are heavy, they decay slower than gas), seeded on a circular orbit at `spec.orbitR` with `spec.phase` as the start angle, orbit in the XZ plane with y = 0.
- Rendering: sphere `SphereGeometry(spec.size, 24, 16)` with a custom ShaderMaterial — baked equirect canvas texture (seeded by `spec.texSeed`: giants = latitudinal bands in two palette tones; rocky = speckle noise; ice = pale low-contrast bands) modulated by hole-facing light: `light = 0.22 + 0.78 * max(0.0, dot(normal, uHoleDir))` where `uHoleDir` is the unit vector from planet toward the origin, updated per frame (the disk is the light source). Ring: `RingGeometry(size*1.6, size*2.4, 48)` with a radial-gradient alpha canvas texture in the ring tone, `DoubleSide`, additive, slight fixed tilt (0.35 rad about X, then a seeded yaw so ringed planets differ). Moons: `SphereGeometry(spec.moons[i].size, 10, 8)`, plain gray-lit same shader, orbiting the planet at `dist` with `speed` rad/s while bound.
- All geometries/materials/textures disposed in `dispose()`.

- [ ] **Step 1: Implement planet.ts per the contract**

Full file; structure it as: texture bake helpers (`bakePlanetTexture(kind, texSeed, palette, hueIdx)`, `bakeRingTexture(rgb)`), the lit-sphere ShaderMaterial (VERT passes world normal; FRAG samples the texture by uv and multiplies the hole-facing light term), then `createPlanet` assembling the group and returning the Body implementation with the death state machine (`ringStripped`, `moonsFree`, per the radii). Moons after unbind keep their inherited world velocity plus their orbital tangential component and integrate like debris but rendered as their mesh; consumed → 6-debris puff + mesh removed.

- [ ] **Step 2: Verify compile-only**

Run: `npx tsc && npm run build && npm test`
Expected: green; nothing constructs planets yet.

- [ ] **Step 3: Commit**

```bash
git add src/render/planet.ts
git commit -m "Add planets with rings, moons, and tidal death"
```

---

### Task 5: Asteroid belt and comets

**Files:**
- Create: `src/render/belt.ts`, `src/render/comet.ts`

**Interfaces:**
- `createBelt(spec: { count: number; inner: number; rgb: Rgb; seed: number }): { points: THREE.Points; setParams(p: { progress: number; time: number }): void; dispose(): void }` — instanced self-orbiting grains: per-grain attributes (radius in [inner, inner+0.18], angle0, speed = √(gm0/r)/r as angular rate baked at seed time, drainSeed); vertex shader positions each grain at `angle0 + speed * uTime`, y jitter ±0.012, and discards (parks) grains whose `drainSeed < drainAmount(uProgress)` where `drainAmount = smoothstep(0.25, 0.88, progress)` — the belt visibly thins through decay/carnage, grain by grain, oldest seeds first. Color: `rgb` at 0.75 alpha, 1.8 px points.
- `createComet(spec: { aphelion: number; perihelion: number; phase: number }, gm0: number): CometBody` implementing the same Body shape as PlanetBody (object/update/alive/dispose): seeded at aphelion with vis-viva speed `v = sqrt(gm0 * 2 * perihelion / (aphelion * (aphelion + perihelion)))` tangential; renders as a 2.5-px bright head (small additive sprite mesh or Points of 1) plus a trail of its last 24 positions (a THREE.Line with per-vertex fading alpha via vertex colors, updated per frame from a ring buffer); sheds 1 debris per 0.25 s while `r < 1.1` (pale-blue tinted); consumed at CONSUME × holeR with `alive = false`.

- [ ] **Step 1: Implement belt.ts** (full file; the shader is the starfield pattern plus the drain discard and `uTime` orbit rotation)

- [ ] **Step 2: Implement comet.ts** (full file per the contract)

- [ ] **Step 3: Verify compile-only**

Run: `npx tsc && npm run build && npm test`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add src/render/belt.ts src/render/comet.ts
git commit -m "Add draining asteroid belt and tailed comets"
```

---

### Task 6: Conductor integration — the system lives and dies

**Files:**
- Modify: `src/main.ts`

**Interfaces (consumed):** everything above. The conductor owns: constructing per-cosmos content in `seedCosmos` from the roster, updating bodies + belt + debris per frame with `p`, pruning dead bodies (remove + dispose + drop from the update list), and exposing counts on `window.__emg`.

- [ ] **Step 1: Extend seedCosmos**

After the disk/stars construction: build `palette = generatePalette(spec.paletteSeed)`; `debris = createDebrisPool()`; `belt = createBelt({ count: spec.beltCount, inner: spec.beltInner, rgb: paletteRgb(palette, spec.beltHueIdx, 0.5, 0.55), seed: spec.seed + 7 })`; `bodies = [...spec.planets.map(ps => createPlanet(ps, palette, GM)), ...spec.comets.map(cs => createComet(cs, GM))]`. Scene-add and register every one of them in `disposables` (debris and belt via their own dispose; each body as `{ object: body.object, dispose: () => body.dispose() }`). Keep `bodies` in a module-level `let` list replaced per cosmos.

- [ ] **Step 2: Frame loop additions**

After `stars.setParams(...)`:

```typescript
  for (const b of bodies) {
    if (!b.alive) continue;
    b.update(dt, p.gm, p.drag, p.holeR, debris.spawn);
  }
  bodies = bodies.filter((b) => {
    if (b.alive) return true;
    scene.remove(b.object);
    b.dispose();
    return false;
  });
  belt.setParams({ progress: p.progress, time: cycleT });
  debris.update(dt, p.gm, p.drag * 2, p.holeR);
```

(Dead bodies also stay in `disposables` — make dispose() idempotent in planet/comet so the rebirth sweep double-call is harmless; note this in both files.)

`window.__emg` gains counts: `{ spec, params: p, alive: { planets: <count of alive PlanetBodies>, comets: <alive comets>, } }` — keep the existing fields.

- [ ] **Step 3: Verify — the watchable gate**

`npm test && npx tsc && npm run build`, full `npm run e2e` (existing gates must hold — the new content adds brightness; if the whole-frame ceiling (110) trips at t=0.05, dim planet emissive/ring alpha rather than touching the gate). Then scratch headless captures at `?seed=11&t=0.1/0.45/0.8` saved to `.superpowers/sdd/task-m3a-6-{early,mid,late}.png` for controller eyeballs: early = full system; mid = belt thinning, inner planets stretching or gone; late = few survivors, debris streams.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "Conduct the solar system through the consumption cycle"
```

---

### Task 7: E2e coverage and docs

**Files:**
- Modify: `e2e/cycle.spec.ts`, `README.md`

- [ ] **Step 1: Add roster + lifecycle tests**

Three additions to cycle.spec.ts (reuse existing helpers):
1. Roster determinism: extend the existing same-seed test to also compare `JSON.stringify(spec.planets)` and comet arrays across loads.
2. Lifecycle: `/?seed=7&t=0.8` — settle-poll 30s, then read `window.__emg.alive`: expect `alive.planets` strictly less than `spec.planets.length` (inner worlds die by 80%) and ≥ 0; at `/?seed=7&t=0.05` expect `alive.planets === spec.planets.length`.
3. Flash gate (the deferred `?t=0.97` test): `/?seed=7&t=0.97` — after 5 s, frame mean > 150 (whiteout fills via recarve; frozen t holds flash at 1, no decay wait needed).

- [ ] **Step 2: Run the full suite**

Run: `npm run e2e` (foreground, Bash timeout 900000)
Expected: everything green; paste output.

- [ ] **Step 3: README**

Milestone 3 line becomes two: `- [x] Milestone 3a: solar system — planets, moons, rings, belt, comets, ring halo` and `- [ ] Milestone 3b: deep sky — nebulae, galaxies, clusters, pulsar, band`.

- [ ] **Step 4: Commit**

```bash
git add e2e/cycle.spec.ts README.md
git commit -m "Cover the solar system lifecycle and split milestone 3 status"
```

---

### Task 8: Acceptance

- [ ] **Step 1: Unattended soak** — scratch run, `?seed=13&cycle=60`, two rebirths, zero console errors, final screenshot; report progression.
- [ ] **Step 2: Controller eyeballs** the Task 6 phase captures plus a reborn frame.
- [ ] **Step 3: MD watches** a compressed cycle on the dev server, reports fps (budget: ≥ 60 on target hardware; 120 was the M2 baseline — a large drop is a finding), and signs off. Ring halo is part of this look.
- [ ] **Step 4:** Final whole-branch review (most capable model), fix wave if needed, then finishing-a-development-branch (PR to main, merge per MD's standing preference unless they say otherwise).
