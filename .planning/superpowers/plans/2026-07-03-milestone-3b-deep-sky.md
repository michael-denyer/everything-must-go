# Milestone 3b: The Deep Sky — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The cosmos gets its sky: a galactic band and layered nebulae in the seeded palette painted behind everything, satellite galaxies that get dragged in whole and smeared, star clusters swallowed as units, a strobing pulsar with sweeping beams, shooting stars — and the nebulae drain into the disk as colored wisp streams as the cycle consumes them.

**Architecture:** The generator grows append-only (pin-guarded) with the deep-sky roster. A per-cosmos sky texture (canvas-baked at `seedCosmos`, seeded and deterministic) covers a distant background plane: band + nebula clouds + decor galaxies, dimming and drawing inward via uniforms as the cycle progresses. Dynamic content implements the established `Body` interface with new kinds: `galaxy` (billboarded baked-spiral quads reusing the cast module's corrected screen-stretch idiom), `cluster` (a point-cloud ball consumed as a unit), `pulsar` (strobe + rotating beams). Nebula drain reuses the debris pool: the conductor emits palette-tinted wisps from nebula world anchors on a progress window. Debris pool gains its long-owed unit tests; two queued hardening nits land in Task 1.

**Tech Stack:** unchanged.

## Global Constraints

- Spec roster rows implemented here: nebulae 3–5 ("layered clouds; drained as glowing wisp streams into the disk"), satellite galaxies 2 dynamic + decor ("dragged in whole, smeared into colored streams"), star clusters 0–2 ("dense swarm, swallowed as a unit"), pulsar 0–1 ("strobing point with sweeping beams, plunges mid-cycle"), galactic band ("baked sky layer; dims and drifts inward"), shooting stars ("pure decor, every 10–18 s"). Spec art rule: wild color lives in the nebulae/sky via the seeded palette; disk stays blackbody.
- Append-only cosmosGen discipline (pin must stay green); all new draws after `cometSeeds`. The e2e's hardcoded seed-1/seed-7 values depend on the existing draw prefix staying frozen.
- New bodies implement `Body` with kinds `'galaxy' | 'cluster' | 'pulsar'` added to `BodyKind`; conductor counts by kind (no side-channel sets).
- Known art limitation, do not fight: the screen-space recarve blacks out anything transiting in front of the shadow — galaxies/nebula wisps included (documented since M3a).
- Determinism: everything from the cosmos seed. Shooting stars are seeded (occurrence ordinal streams), not `Math.random`.
- Sky-anchor parallax note: nebula world anchors are painted onto the distant sky plane by one-time projection at bake; the camera pull-back introduces a small painted-vs-anchor drift over the cycle — acceptable at background distance, comment it at the bake site.
- Queued hardening folded into Task 1: gpuSim's `${wellRadiusSq}` interpolation gains `.toFixed(6)` (whole-number squares would emit GLSL int literals); titleEater's reset-vs-creation seed derivation unified; debris pool gets headless unit tests (spawn/recycle/park/cull).
- SwiftShader discipline: sim time ≈ 0.26× wall under MAX_DT clamping — settle-polls and sim-second measurements only.
- TypeScript strict, `npx tsc` 0 pre-commit. **No `--quiet`/`-q`/`--silent` ever.** Commits plain, no AI attribution. Branch `milestone-3b`. Foreground commands, explicit timeouts, no background jobs, no Monitor (for subagents). Existing e2e green at every task boundary; perf budget: MD's 120 fps baseline, ≥ 60 floor at acceptance.
- Numeric contract: sky plane at z-behind everything (a 14×7 world-unit plane at y≈0 tilted to face the camera, distance ~10 — behind the starfield shell); sky fade = `p.fade` × band-drift factor `1 − 0.25·progress` (scale toward center); nebula drain window: wisps emit while `progress ∈ [0.30, 0.85]`, rate ramping 0→6/s per nebula by progress 0.6, tinted `paletteRgb(hueA)`↔`(hueB)` alternating; galaxies: orbitR 1.9–2.3, drag `dragBase × 0.8`, smear via ratcheted screen-stretch beginning at `holeR·4.2` (STRETCH_START), burst ~220 debris at `BURST·holeR`; clusters: orbitR 1.3–1.7, 220–320 points radius 0.09–0.13, unit-swallow beginning at `holeR·3.0` (points lerp toward the hole center over ~4 s then die, ~40 debris puff); pulsar: orbitR 0.7–0.9, strobe 4 Hz sim-time, beams rotating 3 rad/s, plunge drag engages at progress 0.4, consumed at CONSUME with a 30-debris flash; shooting stars: seeded interval 10–18 s, one streak ~0.7 s.

---

### Task 1: Generator roster, hardening nits, debris tests (TDD, pin-guarded)

**Files:**
- Modify: `src/core/cosmosGen.ts`, `src/render/body.ts`, `src/sim/gpuSim.ts` (toFixed), `src/ui/titleEater.ts` + its main.ts call (seed unification)
- Test: `tests/cosmosGen.test.ts` (extend), `tests/debris.test.ts` (create)

**Interfaces (append-only draws, after cometSeeds, in this order):**

```typescript
// CosmosSpec additions:
nebulae: Array<{ x: number; z: number; y: number; scale: number; hueA: number; hueB: number; seed: number }>; // 3-5; anchors r 1.2-2.2, y in [-0.25, 0.35], scale 0.35-0.7
galaxies: Array<{ orbitR: number; size: number; hueIdx: number; phase: number; seed: number }>;               // exactly 2 dynamic
decorGalaxyCount: number;   // 3-5, baked into the sky only
clusters: Array<{ orbitR: number; size: number; pointCount: number; phase: number; seed: number }>;           // 0-2
pulsar: { present: boolean; orbitR: number; phase: number };  // present ~60%; draws unconditional
bandAngle: number;          // radians
skySeed: number;
shootingStarSeed: number;

// body.ts: BodyKind widens to 'planet' | 'comet' | 'cast' | 'galaxy' | 'cluster' | 'pulsar'
```

- [ ] **Step 1: Extend tests/cosmosGen.test.ts** — pin untouched; a ranged-roster test over 200 seeds asserting every range above, unconditional pulsar draws (presence rate 0.45–0.75 across seeds), counts (nebulae 3–5, galaxies exactly 2, clusters ≤ 2), and integer sub-seeds. Also create `tests/debris.test.ts`: construct `createDebrisPool(64)` with a stub `THREE` scene-free (pure construction works in node — three runs headless for non-render objects), spawn 3, `update` with gravity toward origin and assert positions move inward; spawn past capacity and assert ring-buffer recycling (oldest slot overwritten); park-on-consume (position ≥ 50 after passing inside `CONSUME·holeR`); escape-cull beyond `ESCAPE_R`.
- [ ] **Step 2: RED for the right reasons (pin green, roster/debris tests fail on missing fields/file).**
- [ ] **Step 3: Implement** — generator (unconditional draws; counts drawn before loops; no draw-skipping), BodyKind widening, `.toFixed(6)` on the wellRadiusSq interpolation with a one-line reason, titleEater seed derivation unified to `castSeed ^ 0x51ed` at BOTH creation and reset (pick the reset variant; comment the symmetry).
- [ ] **Step 4: All green** (expect ~40 unit tests — report the real count), tsc, build, full e2e foreground (timeout 1200000).
- [ ] **Step 5: Commit** `"Chart the deep sky and shore up the small debts"`. Push.

---

### Task 2: The sky layer

**Files:**
- Create: `src/render/sky.ts`

**Contract:** `createSky(spec: CosmosSpec, palette: Palette, camera: THREE.PerspectiveCamera): { object: THREE.Object3D; setParams(p: { fade: number; progress: number }): void; dispose(): void }`. A `PlaneGeometry(14, 7)` mesh at distance ~10 behind the origin, oriented to face the camera's home position (computed once — the camera never yaws), `renderOrder = -2` (behind starfield's -1), NormalBlending, depthWrite/depthTest false. Texture: a 2048×1024 canvas baked at construction, seeded by `spec.skySeed`: (a) galactic band along `spec.bandAngle` — ~2600 dots gaussian-spread about the band line with a soft linear-gradient glow, warm/cool white mix; (b) each nebula in `spec.nebulae` painted at its anchor's one-time projected position (project the world anchor via the camera; comment the parallax drift note from Global Constraints): 3 layered radial gradients per nebula in `hueA`/`hueB` via `paletteRgb`, plus 1–2 dark lanes; (c) `decorGalaxyCount` mini-spirals (small dot-spiral stamps, palette-tinted). setParams drives shader uniforms: `uFade` multiplies color; `uPull = 1 − 0.25·progress` scales the plane (drawn inward). Dispose releases geometry/material/texture. All randomness `mulberry32(spec.skySeed)`.

- [ ] **Step 1: Implement.** Step 2: compile-only (tsc/test/build; state plainly). Step 3: Commit `"Paint the sky that will be eaten"`. Push.

---

### Task 3: Galaxies and clusters

**Files:**
- Create: `src/render/galaxy.ts`, `src/render/cluster.ts`

**Contract (both implement Body):**
- `createGalaxy(spec entry, palette, gm0): Body` kind 'galaxy' — a billboarded quad (like cast.ts: parent group takes the camera quaternion via the module's `setCastCamera` pattern — import and reuse cast.ts's camera if exported, else replicate the setter locally with a comment) with a per-galaxy baked canvas spiral texture (seeded, palette-tinted, additive blending — galaxies are light, unlike cast silhouettes); orbit at `orbitR` with `phase`, drag `dragBase × 0.8`; ratcheted screen-stretch from STRETCH_START·holeR using the corrected rotation convention (`atan2(screenDir.y, screenDir.x)`, NO offset — cite cast.ts's comment); shed ≤ 3 palette-tinted debris/frame while stretching (ordinal-seeded); burst ~220 debris at BURST·holeR.
- `createCluster(spec entry, palette, gm0): Body` kind 'cluster' — a `THREE.Points` ball: `pointCount` points gaussian within `size`, warm-white with a palette accent minority; orbits as a unit; at `holeR·3.0` begins unit-swallow: every point's local offset lerps toward the world hole position over ~4 s sim time (a uniform `uSwallow` 0→1 driving mix in the vertex shader against per-point offsets), brightness rising then fading; at completion, ~40-debris puff and `alive = false`. Consumed/escape guards; idempotent dispose.

- [ ] **Step 1: Implement both.** Step 2: compile-only + suites green. Step 3: Commit `"Add the galaxies and clusters that will be swallowed"`. Push.

---

### Task 4: Pulsar and shooting stars

**Files:**
- Create: `src/render/pulsar.ts`, `src/render/shootingStars.ts`

**Contract:**
- `createPulsar(spec.pulsar, gm0): Body` kind 'pulsar' — a bright 3-px additive point strobing at 4 Hz sim time (intensity square-wave 0.4↔1.0) plus two opposed thin additive beam quads (length ~0.5 world, width ~0.008) rotating at 3 rad/s about the point; circular orbit at `orbitR` until `progress` (passed via update's cycle param — NOTE: Body.update signature carries no progress; drive the plunge from the conductor by scaling dragBase? NO — keep the Body signature: the pulsar receives `dragBase` already scheduled by the cycle (p.drag grows with progress), and engages a ×6 personal drag multiplier once its radius decays below `orbitR·0.85`, which the growing global drag causes mid-cycle naturally. Comment this indirection); consumed at CONSUME·holeR with a 30-debris flash (pale blue).
- `createShootingStars(seed: number): { object: THREE.Object3D; update(dtSeconds: number): void; dispose(): void }` (NOT a Body — pure decor, never dies): one reusable streak (a short additive line/quad) that activates on a seeded interval 10–18 s, sweeps across a seeded far-field path over ~0.7 s, deactivates. Successive occurrences draw from `mulberry32(seed)` sequentially (ordinal determinism).

- [ ] **Step 1: Implement both.** Step 2: compile-only + suites green. Step 3: Commit `"Set the pulsar spinning and the meteors falling"`. Push.

---

### Task 5: Conductor integration — the sky lives and drains

**Files:**
- Modify: `src/main.ts`

**Contract:** `seedCosmos` additionally builds: sky (`createSky`, scene-added, disposables-registered), 2 galaxies + clusters + pulsar-if-present into `bodies`, `shootingStars` (module-level, rebuilt per cosmos, disposables-registered). Frame loop: `sky.setParams({ fade: p.fade, progress: p.progress })`; `shootingStars.update(dt)`; nebula wisp emission — while `p.progress ∈ [0.30, 0.85]`, per nebula accumulate `rate(p.progress) · dt` (rate ramps 0→6/s by 0.6) with a fractional carry, each emission spawning one debris at the nebula anchor (± small seeded jitter) with a gentle inward-tangential velocity, tinted alternately `hueA`/`hueB` — all draws ordinal-seeded per nebula (`spec.nebulae[i].seed`). `__emg.alive` gains `galaxies`, `clusters`, `pulsar` counts by kind. Everything per-cosmos is swept by the existing disposables path.

- [ ] **Step 1: Implement.** Step 2: tsc/test/build + FULL e2e green; scratch phase captures at `?seed=7&t=0.1/0.5/0.75` saved as `.superpowers/sdd/task-m3b-5-{early,mid,late}.png` (early: band + nebulae + full deep sky; mid: wisp streams flowing, cluster mid-swallow if timing allows; late: sky dimmed and drawn inward) + factual descriptions. Zero console errors. Step 3: Commit `"Conduct the deep sky through the consumption"`. Push.

---

### Task 6: E2e and docs

**Files:**
- Modify: `e2e/cycle.spec.ts`, `README.md`

**Contract:** (1) roster determinism extended to nebulae/galaxies/clusters/pulsar JSON; (2) deep-sky lifecycle: `/?seed=7&t=0.05` settle → `alive.galaxies === 2` and cluster/pulsar counts match spec; `/?seed=7&t=0.9` settle-poll ≤ 45 s → galaxies < 2 (dragged in by late carnage); (3) sky presence pixel check: at t=0.05 an off-disk region along the band (compute its screen position from `spec.bandAngle` — or simpler, assert the four frame corners' mean at t=0.05 exceeds the same corners' mean at t=0.95 by ≥ 3× — sky dims with the cycle); (4) README: milestone 3b checked, one line for the sky. Full e2e foreground green (timeout 1200000).

- [ ] Steps: implement → full suite green with output → commit `"Prove the sky exists and dies"` → push.

---

### Task 7: Acceptance

- [ ] Soak (controller-run): rogue-present seed, `cycle=60`, two rebirths, zero errors, final frame.
- [ ] Controller eyeballs the phase captures; MD watches live — band, nebula colors, wisp drain, a cluster being swallowed, the pulsar — reports fps (120 baseline / 60 floor) and signs off.
- [ ] Final whole-branch review (most capable model), fix wave if needed, PR + merge per MD's standing preference.
