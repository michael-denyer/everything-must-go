# Milestone 4: Hands and Guests — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The piece becomes touchable and strange: your cursor stirs the infalling gas, a click sends the next silhouette — whale, grand piano, T. rex, teacup, bicycle, rubber duck — gliding in backlit to stretch and dissolve; the title eats its own letters and regrows them; and one cosmos in four hosts a rogue second black hole that drifts in, feeds, and merges with a flash and a visible growth spurt.

**Architecture:** Ordered by dependency: the cosmos generator gains rogue/cast fields (append-only, pin-guarded) plus three inherited seeds (planet orbitR floor, comet integer seed, and a shared `Body` interface with a `kind` discriminant that retires `cometSet`); `evalCycle` computes the rogue's hole-growth boost purely from spec+time. The GPU sim gains two new force uniforms (cursor well, rogue attractor-consumer). Cast shapes are baked once by a committed tools script into small PNG masks (alpha silhouette + edge band), rendered as billboarded rim-lit quads implementing `Body`. The conductor wires pointer input, feeding cadence, the rogue visual, and the DOM letter-eater.

**Tech Stack:** unchanged. Cast assets are committed PNGs baked by `tools/bake-cast.mjs` (headless chromium, run manually when the roster changes — not in the build).

**Milestone-order note:** M4 runs before M3b (deep sky) by MD's call, 2026-07-02. Nothing here depends on 3b content; the cosmosGen seeds earmarked "for M3b's touch" land here instead because this milestone opens the generator first.

## Global Constraints

- Spec: `.planning/superpowers/specs/2026-07-02-everything-must-go-design.md`, sections "The cast", "Interaction", and the M4 milestone row ("Accept: interactions feel weighty, cast dies beautifully"). Sound (chirp) is M5 — the merger is silent for now.
- Spec bindings, verbatim: cursor/touch is a WEAK well — "force clamped so it stirs but cannot rescue anything," radius ≈ 12% of the viewport's short side; feeding auto every 45–75 s during decay and carnage ONLY, max two cast alive, click sends the next member from the click direction; title letters detach every 90–150 s and regrow over ~10 s; rogue hole in ~25% of cosmoses.
- Cast rendering per spec: backlit near-black silhouettes with a warm rim light on the disk-facing side; no runtime font/emoji dependency (committed baked masks); they tidally stretch along the fall direction, shed glowing debris, and dissolve.
- Determinism: rogue presence/timing and the cast roster order are seeded; the hole-growth boost is computed in `evalCycle` (pure). Cursor input and click feeds are the piece's ONLY nondeterminism — by design (they're the visitor's hands). Auto-feed timing derives from cycle time, not wall clock.
- Append-only cosmosGen discipline continues; the seed-42 pin must stay green. NOTE: the orbitR floor is a post-draw VALUE transform (no draw added/removed) — existing seeds' rosters may shift values; the pin covers only M2 fields, and the project is pre-launch, so this is acceptable and gets a comment.
- Rogue hole visual is a screen-space approximation (small shadow disc + thin ring, no lensing) — documented, consistent with the recarve limitation already on record.
- TypeScript strict; `npx tsc` exit 0 before every commit. **No `--quiet`/`-q`/`--silent` flags.** Commits plain, no AI attribution. Branch `milestone-4`. Foreground commands with explicit timeouts; no background jobs; no Monitor. Existing e2e must stay green at every task boundary.
- Numeric contract: well radius `WELL_RADIUS = 0.5` world units, strength `WELL_STRENGTH = 0.05` (clamped falloff `s·dt/(d²+0.006)`, zero beyond radius); cast enter radius 1.5, orbit factor 0.62 of circular (decaying), stretch/burst reuse `tidal.ts` with cast burst at `BURST` and dissolve beginning at stretch > 0.75 (the M2-sketch behavior); rogue: spawn at `spec.rogue.spawnP` ∈ [0.45, 0.55], merge at `mergeP` ∈ [0.62, 0.75], boost ramps holeR ×1.22 over Δp = 0.02 after merge; rogue attract strength 0.2·gm, consume radius 0.45·holeR.

---

### Task 1: Generator and cycle — rogue, cast seeds, inherited fixes (TDD, pin-guarded)

**Files:**
- Modify: `src/core/cosmosGen.ts`, `src/core/cycle.ts`, `src/render/planet.ts`, `src/render/comet.ts` (kind field only)
- Create: `src/render/body.ts`
- Test: `tests/cosmosGen.test.ts` (extend), `tests/cycle.test.ts` (extend)

**Interfaces:**

```typescript
// body.ts
export type BodyKind = 'planet' | 'comet' | 'cast';
export interface Body {
  readonly kind: BodyKind;
  readonly object: THREE.Object3D;
  update(dt: number, gm: number, dragBase: number, holeR: number,
         spawnDebris: (x: number, y: number, z: number, vx: number, vy: number, vz: number, r: number, g: number, b: number) => void): void;
  readonly alive: boolean;
  dispose(): void;
}

// CosmosSpec additions (drawn append-only, after comets):
rogue: { present: boolean; spawnP: number; mergeP: number };  // present ~25%; spawnP [0.45,0.55]; mergeP [0.62,0.75]
castSeed: number;        // integer, shuffles the cast roster order per cosmos
castCadence: number;     // [45, 75] seconds of cycle time between auto-feeds
cometSeeds: number[];    // one integer per comet (inherited fix: retire float-phase-derived seeding)

// CycleParams additions:
rogueActive: boolean;    // spawnP <= p < mergeP when present
rogueMerged: boolean;    // p >= mergeP when present
// holeR now includes the merger boost: base * (1 + 0.22 * smoothstep(mergeP, mergeP + 0.02, p)) when present
```

- [ ] **Step 1: Extend the two test files first**

Append to `tests/cosmosGen.test.ts` (PINNED test untouched — it must stay green throughout):

```typescript
  it('draws rogue, cast, and comet-seed fields in ranges', () => {
    let present = 0;
    for (let s = 0; s < 400; s++) {
      const c = generateCosmos(s);
      if (c.rogue.present) {
        present++;
        expect(c.rogue.spawnP).toBeGreaterThanOrEqual(0.45);
        expect(c.rogue.spawnP).toBeLessThanOrEqual(0.55);
        expect(c.rogue.mergeP).toBeGreaterThanOrEqual(0.62);
        expect(c.rogue.mergeP).toBeLessThanOrEqual(0.75);
      }
      expect(c.castCadence).toBeGreaterThanOrEqual(45);
      expect(c.castCadence).toBeLessThanOrEqual(75);
      expect(Number.isInteger(c.castSeed)).toBe(true);
      expect(c.cometSeeds.length).toBe(c.comets.length);
      for (const cs of c.cometSeeds) expect(Number.isInteger(cs)).toBe(true);
    }
    expect(present / 400).toBeGreaterThan(0.15);
    expect(present / 400).toBeLessThan(0.35);
  });

  it('floors planet orbits clear of the burst radius', () => {
    for (let s = 0; s < 200; s++) {
      const c = generateCosmos(s);
      for (const p of c.planets) {
        expect(p.orbitR).toBeGreaterThanOrEqual(c.holeR0 * 2.0 * 1.35 - 1e-9);
      }
    }
  });
```

Append to `tests/cycle.test.ts`:

```typescript
  it('activates and merges the rogue purely from spec and time', () => {
    let spec9: ReturnType<typeof generateCosmos> | undefined;
    for (let s = 0; s < 200 && !spec9; s++) {
      const c = generateCosmos(s);
      if (c.rogue.present) spec9 = c;
    }
    expect(spec9).toBeDefined();
    const sp = spec9!;
    const atP = (p: number) => evalCycle(sp, p * sp.cycleSeconds);
    expect(atP(sp.rogue.spawnP - 0.01).rogueActive).toBe(false);
    expect(atP(sp.rogue.spawnP + 0.01).rogueActive).toBe(true);
    expect(atP(sp.rogue.mergeP - 0.01).rogueActive).toBe(true);
    expect(atP(sp.rogue.mergeP + 0.001).rogueActive).toBe(false);
    expect(atP(sp.rogue.mergeP + 0.001).rogueMerged).toBe(true);
    const before = atP(sp.rogue.mergeP - 0.005).holeR;
    const after = atP(sp.rogue.mergeP + 0.03).holeR;
    expect(after / before).toBeGreaterThan(1.15);
  });

  it('keeps rogue fields inert for rogue-free cosmoses', () => {
    let spec0: ReturnType<typeof generateCosmos> | undefined;
    for (let s = 0; s < 200 && !spec0; s++) {
      const c = generateCosmos(s);
      if (!c.rogue.present) spec0 = c;
    }
    const sp = spec0!;
    const p = evalCycle(sp, 0.7 * sp.cycleSeconds);
    expect(p.rogueActive).toBe(false);
    expect(p.rogueMerged).toBe(false);
  });
```

- [ ] **Step 2: Run — pin green, new tests RED (missing fields).**

- [ ] **Step 3: Implement**

cosmosGen: append draws after the comet loop, in this order: rogue present (rand < 0.25), spawnP, mergeP (draw both unconditionally — no conditional draws; when present is false the values are drawn and stored anyway), castSeed (floor(rand()*2^31)), castCadence (lerp 45..75), then one integer per comet into `cometSeeds` (count fixed by the already-drawn comet count). Apply the orbitR floor as a post-draw transform inside the existing planet loop: `orbitR: Math.max(drawnOrbitR, holeR0 * 2.0 * 1.35)` with a comment (value transform, no draw change; BURST literal 2.0 mirrored from tidal — import it). comet.ts: `createComet` gains a `seed: number` parameter (threaded from `cometSeeds[i]` at the conductor in Task 5) replacing the float-phase derivation — keep the old derivation as fallback ONLY if the parameter is undefined, so this task compiles without touching main.ts; Task 5 removes the fallback. body.ts as specified; planet.ts and comet.ts add `readonly kind = 'planet' as const` / `'comet' as const` and declare `implements Body` (import type). cycle.ts: add the two fields + boost math per the numeric contract (smoothstep already local).

- [ ] **Step 4: Run — all green (pin included), tsc, build. Full e2e (foreground, timeout 900000) — the orbitR floor may shift seed-7 roster VALUES; the determinism e2e compares within one build (stays green); the early-alive test only gains margin. If anything else moves, investigate.**

- [ ] **Step 5: Commit** `git commit -m "Seed the rogue hole and cast, floor doomed orbits, give bodies kinds"` (all five files + both tests). Push.

---

### Task 2: Cast masks — bake tool and committed assets

**Files:**
- Create: `tools/bake-cast.mjs`, `src/assets/cast/*.png` (6 files), `src/assets/cast/manifest.json`

**Contract:** `bake-cast.mjs` launches headless chromium via playwright, renders each glyph of the roster `['🐋','🎹','🦖','☕','🚲','🦆']` at 256px onto a canvas, and writes per-shape PNGs where the ALPHA channel is the silhouette and the RED channel is an edge band (alpha minus a 6px-eroded alpha — computed in-page with a second canvas pass). Filenames `whale.png, piano.png, trex.png, teacup.png, bicycle.png, duck.png`; `manifest.json` lists `[{ name, file, aspect }]` in roster order. The script is run MANUALLY (node tools/bake-cast.mjs) and its outputs committed — the runtime never rasterizes text, so the piece has no font dependency. Vite serves the PNGs as static imports (`new URL('../assets/cast/whale.png', import.meta.url)` pattern or direct imports — match Vite idiom).

- [ ] **Step 1: Write the script; run it; verify the six PNGs exist, are 256px, non-empty alpha (script prints per-file alpha pixel counts — paste them).**
- [ ] **Step 2: Commit** `git commit -m "Bake the cast into committed silhouette masks"` (script + PNGs + manifest). Push.

---

### Task 3: Sim forces — cursor well and rogue attractor

**Files:**
- Modify: `src/sim/gpuSim.ts`, `src/render/debris.ts`, `src/config.ts`

**Contract:** config gains `WELL_RADIUS = 0.5`, `WELL_STRENGTH = 0.05`. gpuSim SIM_COMMON gains `uniform vec4 uWell;` (xyz world pos, w strength; w=0 off) and `uniform vec4 uRogue;` (xyz pos, w consume radius; w=0 off). Velocity shader: well force `vel += dir * (uWell.w * uDt / (d2 + 0.006))` only when `d2 < WELL_RADIUS²` (bake the literal 0.25 with a comment) and `uWell.w > 0`; rogue attracts with `0.2 * uGm / (d2r + 3e-4)` toward uRogue.xyz when `uRogue.w > 0`. Position shader: consume (park at 99s) when `distance(pos, uRogue.xyz) < uRogue.w` and `uRogue.w > 0` — mirror the branch in the velocity shader (same texel condition, zero velocity), matching the M2 park-pair discipline. Class: `setWell(x, y, z, strength)` and `setRogue(x, y, z, radius)` updating BOTH variables' uniforms. debris.ts `update` gains optional trailing args `well?: {x,y,z,strength}` and `rogue?: {x,y,z,radius}` applying the same forces/consumption CPU-side so debris reacts identically. Defaults keep current behavior bit-identical (both off) — the full e2e is the regression gate.

- [ ] **Step 1: Implement. Step 2: unit 31/31? (no new unit tests — counts stay), tsc, build, FULL e2e green. Step 3: Commit** `git commit -m "Teach the sim about hands and a second mouth"`. Push.

---

### Task 4: The cast body

**Files:**
- Create: `src/render/cast.ts`

**Contract:** `createCast(name: string, maskUrl: string, aspect: number, entryAngle: number, gm0: number, ordinalSeed: number): Body` (kind 'cast'). A `PlaneGeometry(0.2 * aspect, 0.2)` quad, billboarded to the camera each update (`object.quaternion.copy(camera.quaternion)` — pass the camera via a module-level setter `setCastCamera(cam)` called once by the conductor, keeping the Body interface unchanged). ShaderMaterial: uniforms uMask (texture), uHoleDirScreen (vec2, direction from body to hole in screen plane), uStretch, uDissolve, uRim (vec3 warm rim color [1.0, 0.66, 0.37]); fragment: `base = vec3(0.028, 0.031, 0.055) (near-black blue)`, `edge = texture red channel`, `facing = clamp(dot(normalize(vUv - 0.5), uHoleDirScreen), 0.0, 1.0)`, `col = base + uRim * edge * facing * 1.6`, alpha = mask alpha × (1 − dissolve) with `discard` under 0.02; transparent, depthWrite false, NormalBlending (silhouettes occlude, they don't add). Orbit/death: enter at radius 1.5 with 0.62× circular velocity (decaying plunge), drag `dragBase` (unscaled); tidal stretch via the quad's local scale along the screen-projected fall direction using `stretchFactor` (ratcheted, Task 4-M3a precedent); at stretch > 0.75 begin dissolve (ramp over ~2.5s of cycle time) while shedding ordinal-seeded debris (≤ 5/frame, warm-tinted [1.0, 0.72, 0.42]); at `BURST` or dissolve ≥ 1 → final ~80-debris burst, alive=false. Consumed/escape guards and idempotent dispose per house pattern. All randomness from `mulberry32(ordinalSeed)` + the ordinal-mix idiom for shed debris.

- [ ] **Step 1: Implement. Step 2: tsc/build/tests green (compile-only; no call sites yet — state it plainly). Step 3: Commit** `git commit -m "Give the guests their silhouettes"`. Push.

---

### Task 5: The conductor — hands, feeding, rogue, letters

**Files:**
- Modify: `src/main.ts`, `index.html`
- Create: `src/ui/titleEater.ts`

**Contract:**
- Pointer: pointermove unprojects to the y=0 plane (Raycaster from camera through NDC, intersect plane) → `sim.setWell(x, 0, z, WELL_STRENGTH)` while active (decay to off 1.5s after the last move, matching the sketches); the same well passed to debris.update. Touch drag = same path.
- Feeding: pointerdown (not on the about link) computes the click's world angle and spawns the next cast member (manifest order shuffled by `mulberry32(spec.castSeed)`) at radius 1.5 from that angle IF phase is decay/carnage and fewer than 2 cast alive. Auto-feed: a cycle-time accumulator fires every `spec.castCadence` seconds under the same conditions, entry angle from the seeded stream. Cast bodies join `bodies` (kind 'cast'); `cometSet` is deleted — counts by `b.kind` (planets/comets/cast in `__emg.alive`). Comet construction now passes `spec.cometSeeds[i]`; remove the float-phase fallback in comet.ts.
- Rogue: when `p.rogueActive`, a rogue visual exists (created lazily, disposed on merge/reseed): a small black circle mesh + thin ring sprite, positioned on a seeded inward drift from spawn radius 1.7 toward the hole, arriving at merge time (interpolate radius by (p - spawnP)/(mergeP - spawnP), angle advancing at the local orbital rate — deterministic from spec + p, no integration). Per frame: `sim.setRogue(x, 0, z, 0.45 * p.holeR)` while active, `setRogue(0,0,0,0)` otherwise; debris.update receives the same. On the frame rogueMerged flips true: `flashDecay = Math.max(flashDecay, 0.5)` (half whiteout), dispose the visual. evalCycle's holeR already carries the boost — no conductor-side multiplier.
- Title eater (`src/ui/titleEater.ts`): `createTitleEater(titleEl: HTMLElement, cadenceFraction: [number, number], seed: number)` — cadence drawn per firing from `[0.125, 0.208] * spec.cycleSeconds` (equals the spec's 90–150 s at the default 720 s cycle, and scales down for compressed cycles so the behavior remains observable and testable). Returns `{ update(dtCycleSeconds: number, holeScreenXY: [number, number]): void; reset(): void; dispose(): void }`. Wraps each letter of EVERYTHING MUST GO in a span once; on each seeded-cadence firing, picks a random un-eaten letter, clones it absolutely positioned, animates the clone along a quadratic curve to the hole's screen position over ~3s (rAF-driven inside update, scaling to 0 and fading), and collapses the original's width over 1s; the original regrows (width + opacity) after ~10s. `reset()` on reseed restores all letters instantly; conductor calls `update` with cycle dt and the projected hole center (available from postChain's last projection — expose `post.holeScreen(): [number, number]` returning the last centerUv converted to pixels).
- index.html: no structural change needed beyond ensuring the title text sits in a `<span id="title-line">` wrapper if needed for the eater — keep the visual identical.

- [ ] **Step 1: Implement (postChain holeScreen getter is a 5-line addition). Step 2: tsc/build/units green; FULL e2e green (interactions are additive; nothing changes without input; auto-feed only fires mid-cycle — the compressed-cycle soak will now include cast deaths: zero console errors required). Step 3: scratch captures: `?seed=<a rogue seed found via node -e>&cycle=75` — capture at rogue-active and just-post-merge moments (two PNGs to .superpowers/sdd/), plus one cast-alive frame via a scripted click during decay on any seed. Paste which seed you used. Step 4: Commit** `git commit -m "Wire the hands, the guests, the rogue, and the hungry title"`. Push.

---

### Task 6: E2e and docs

**Files:**
- Modify: `e2e/cycle.spec.ts`, `README.md`

**Contract — four additions:**
1. Feeding: `/?seed=7&t=0.4` (decay phase), settle 5s, `page.mouse.click` at (400, 300), poll __emg up to 10s for `alive.cast === 1`; click twice more rapidly and assert cast never exceeds 2.
2. Phase gating: `/?seed=7&t=0.05` (serene), click, wait 5s, assert `alive.cast === 0`.
3. Rogue determinism: find a rogue-present seed at test-authoring time (node one-liner against generateCosmos — hardcode the found seed with a comment), then `/?seed=<it>&t=<mergeP+0.03 for that seed>`, read __emg params: `rogueMerged === true`, and holeR exceeds the same progress's holeR for a non-rogue seed by > 15% (compare against spec math inline rather than a second page load: recompute expected base via the exported evalCycle? e2e can't import TS src — instead assert `params.holeR / (spec.holeR0 * (1 + (spec.holeGrowth - 1) * Math.pow(params.progress, 1.6))) > 1.15` — the boost ratio, all fields available in __emg).
4. Title eater presence: `/?seed=7&cycle=75` live (no t-freeze), wait for progress > 0.15 via __emg, then poll the title's letter spans until at least one enters the eaten state (reduced width/opacity) before the counter reaches cosmos no. 2 — the cadence-fraction contract in Task 5 guarantees 4–8 firings per cycle at any cycle length.
README: add the interaction line ("move to stir the gas, click to feed it something") and mark milestone 4 in the status list (3b stays unchecked, note the order swap).

- [ ] **Step 1: Implement per contract (including the Task 5 cadence-fraction adjustment if Task 5 didn't already — coordinate via the brief). Step 2: FULL e2e green with real output. Step 3: Commit** `git commit -m "Prove the hands work and the title gets eaten"`. Push.

---

### Task 7: Acceptance

- [ ] **Step 1: Soak** — a rogue-present seed at `cycle=75`, two rebirths, zero console errors, final screenshot (controller-run pattern).
- [ ] **Step 2: Controller eyeballs** the rogue captures + cast frames.
- [ ] **Step 3: MD plays with it** — this milestone's acceptance is explicitly tactile ("interactions feel weighty, cast dies beautifully"): stir the disk, feed all six guests, watch a rogue cosmos, watch a letter die. fps check. Sign-off + any feel-tuning (well strength/radius are single config constants).
- [ ] **Step 4:** Final whole-branch review, fix wave if needed, PR + merge per MD's standing preference.
