# Milestone 5: Sound — the adaptive score and the enter gate

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The cosmos gets its voice. An ominous, fully-synthesized adaptive score (WebAudio) whose layers are driven by cycle progress — a low detuned drone from serene, pads and swells through decay, a dissonant tension layer through carnage, sparse percussion on planet breaks and galaxy deaths, a rising gravitational-wave chirp at the rogue merger, **true silence in darkness**, and a short soft resolution at rebirth. In front of it all, an enter gate offering "enter with sound" / "enter silent", a corner toggle to switch later, and localStorage persistence.

**Architecture:** A pure, unit-testable score model (`src/audio/score.ts`) maps cycle params → layer gains + event envelopes with NO WebAudio dependency. A thin engine (`src/audio/audioEngine.ts`) builds the WebAudio graph (synth voices + filters + master gain + analyser) and applies the pure model via smoothed parameter ramps; it degrades gracefully when `AudioContext` is unavailable. `src/ui/enterGate.ts` owns the gate overlay, the corner toggle, the about overlay, and persistence, and owns the audio-unlock gesture. The conductor (`main.ts`) drives `setCycle(params)` every frame, emits one-shot events from the body-death/rogue/rebirth seams it already computes, suspends/resumes audio on tab visibility, and optionally lets the analyser level nudge a small visual accent.

**Scope decision (fully synthesized):** The spec permits "synthesized layers plus CC0 samples where they raise quality." This milestone ships **synthesized-only** — no external audio assets — so there is no third-party license to verify or credit and no asset-loading path. The about overlay credits the piece itself. If MD later wants sampled layers, that is a follow-up. (Flag this at acceptance.)

**Tech stack:** unchanged (WebAudio API is built into the browser; no new deps).

## Global Constraints

- **Determinism boundary:** the score is *progress-driven* (the arc always syncs to the cycle), but audio is NOT part of the seed-reproducibility contract — oscillator phase is not sample-identical across loads, and that is fine. Do NOT route audio state back into the sim/visual (one-directional: audio READS core state, per the spec's data-flow rule). No `Math.random`/`Date` is needed in the score (it is a pure function of cycle params); event one-shots may vary timbre by a cheap counter, not by wall-clock.
- **The enter-gate / e2e seam (important — read before Task 3/4):** the 15 existing e2e tests and the dev workflow load `/?seed=...&t=...&debug` and expect the scene to render immediately with `__emg` populated and the pixel gates valid. So: **the gate is shown only for a canonical visitor entry (no programmatic params); when the URL contains any of `?seed`, `?t`, `?cycle`, or `?debug`, skip the gate and start the scene immediately in SILENT mode.** This keeps every existing e2e working unchanged and fast, and is defensible product behavior (deep-links/dev go straight in silent; the corner toggle enables sound later). The render loop ALWAYS runs (scene renders behind/without the gate); "enter" only unlocks audio and dismisses the overlay. Add one dedicated e2e for the bare-`/` gate path. Flag this seam for the final review.
- **Autoplay unlock:** an `AudioContext` starts `suspended` until a user gesture. Only the enter-gate click (or the corner toggle) may create/resume it. Never attempt to start audio without a gesture (it throws/stays suspended and logs console noise — which would break the "zero console errors" smoke gate).
- **Hidden tab:** on `visibilitychange` to hidden, suspend the AudioContext; on visible, resume. The render loop already pauses via rAF and `cycleT` uses a `MAX_DT`-clamped `dt`, so there is no audio/visual time jump on resume.
- **Graceful absence:** if `AudioContext`/`webkitAudioContext` is missing or `new AudioContext()` throws, the engine must no-op cleanly (silent, no throw, no console error) so the visual piece is unaffected.
- TypeScript strict, `npx tsc` 0 pre-commit. **No `--quiet`/`-q`/`--silent` flags ever.** Commits plain, no AI attribution. Branch `milestone-5`. Foreground commands, explicit timeouts, no background jobs, no Monitor (for subagents). Existing 15 e2e + 48 unit green at every task boundary. SwiftShader/headless caveat: WebAudio has no audible output in CI; e2e verifies graph/state/no-errors only — actual sound is MD's ears at acceptance.
- Numeric contract (starting values, MD-tunable at acceptance): master ramp time 0.05s (`setTargetAtTime`); layer gain map — drone present `serene..` at ~0.12, ramps to ~0.22 by carnage; pad enters at progress 0.25→ ~0.18 by 0.6; tension (dissonant, detuned cluster) enters at 0.55→ ~0.3 by 0.9; sub-boom on the drone through carnage; **all layers × `p.fade`² so darkness (fade→0) is true silence** (same squared-fade reasoning as the visual emissive); rebirth: a short (~2.5s) soft major-ish resolution swell triggered on reseed. Percussion hit: a filtered noise burst + low sine thump, gated to decay/carnage only. Rogue chirp: a sine sweeping ~40Hz→~320Hz over the `[spawnP, mergeP]` window, amplitude rising to a climax at merge.

---

### Task 1: The pure score model (TDD)

**Files:**
- Create: `src/audio/score.ts`
- Test: `tests/score.test.ts`

**Interface (no WebAudio — pure):**
```typescript
export interface CycleAudioParams { progress: number; phase: string; fade: number; rogueActive: boolean; rogueProgress: number; } // rogueProgress: 0..1 through [spawnP,mergeP], else 0
export interface LayerGains { master: number; drone: number; pad: number; tension: number; sub: number; }
export function scoreGains(p: CycleAudioParams): LayerGains; // all in [0,1], darkness => ~0
export function chirpFrequency(rogueProgress: number): number; // 40..320 Hz over 0..1
export function rebirthEnvelope(tSeconds: number): number;     // 0..1..0 soft swell over ~2.5s, 0 outside
```

- [ ] **Step 1: Write `tests/score.test.ts`** asserting: (a) drone > 0 in serene and rises by carnage; (b) pad ~0 before progress 0.25, > 0 by 0.6; (c) tension ~0 before 0.55, high by 0.9; (d) **every layer gain and master are ~0 in the darkness phase** (fade≈0) — the silence contract; (e) `chirpFrequency` monotonic 40→320 over [0,1] and clamped; (f) `rebirthEnvelope` is 0 at t=0-ish rise, peaks mid, returns to 0 by ~2.5s, and is 0 for t>2.5 and t<0; (g) all gains stay within [0,1] across a progress sweep 0..1.
- [ ] **Step 2: RED** — `npx vitest run tests/score.test.ts`.
- [ ] **Step 3: Implement `score.ts`** — pure functions, layers as smoothstep ramps over progress, everything multiplied by `fade*fade`, chirp as a lerp (log or linear — comment), rebirth as a raised-cosine window. No side effects, no WebAudio, no Math.random/Date.
- [ ] **Step 4:** all green (report count), tsc, build.
- [ ] **Step 5:** Commit `"Compose the score as a pure function of the cycle"`. Push.

---

### Task 2: The WebAudio engine

**Files:**
- Create: `src/audio/audioEngine.ts`
- Test: `tests/audioEngine.test.ts` (guarded — see below)

**Contract:** `createAudioEngine(): AudioEngine` where
```typescript
interface AudioEngine {
  unlock(): void;                          // create/resume AudioContext on a user gesture; idempotent
  setCycle(p: CycleAudioParams): void;     // apply scoreGains via setTargetAtTime; drive the rogue chirp osc
  hit(kind: 'break' | 'galaxyDeath' | 'rebirth'): void; // one-shot envelopes
  setEnabled(on: boolean): void;           // master mute/unmute (silent mode); persists nothing (UI owns storage)
  suspend(): void; resume(): void;         // hidden-tab
  level(): number;                         // analyser RMS 0..1 for visual accents (0 if no context)
  dispose(): void;
}
```
- The graph: a `master` GainNode → `AnalyserNode` → destination. Voices: **drone** (2-3 detuned sawtooth/sine oscillators through a lowpass), **pad** (triangle/sine cluster, slow LFO on filter), **tension** (detuned dissonant interval, e.g. minor-second/tritone cluster, gentle distortion via WaveShaper optional), **sub** (low sine). Each voice → its own GainNode set by `scoreGains`. A dedicated **chirp** oscillator whose frequency is driven by `chirpFrequency(rogueProgress)` and whose gain rises with `rogueProgress` then is silenced.
- `unlock()`: lazily construct the `AudioContext` (guard `window.AudioContext ?? webkitAudioContext`; wrap in try/catch → no-op on failure), build the graph, start the oscillators, `ctx.resume()`. Idempotent (second call just resumes). Do NOT construct the context in the module top-level or the constructor (autoplay + headless-throw).
- `setCycle`: if no context yet, no-op. Else set each voice gain to `scoreGains(p).<layer> * master` via `gain.setTargetAtTime(target, ctx.currentTime, 0.05)`. Darkness → gains ramp to 0.
- `hit`: 'break'/'galaxyDeath' = a short filtered-noise burst + sine thump through a one-shot envelope (create → ramp → stop → gc); 'rebirth' = trigger the soft resolution swell (drive a temporary voice by `rebirthEnvelope` over ~2.5s). Guard: no-op without a context.
- `setEnabled(false)`: ramp master to 0 (keep the graph running so re-enabling is instant); `true`: ramp master back.
- `dispose`: stop oscillators, close the context.

- [ ] **Step 1: `tests/audioEngine.test.ts`** — WebAudio is NOT available in node/vitest, so test the GUARDED behavior: `createAudioEngine()` constructs without throwing; `setCycle`/`hit`/`level`/`suspend`/`setEnabled`/`dispose` are all safe no-ops BEFORE `unlock()` (no context) and never throw; `level()` returns 0 with no context. (Do NOT try to instantiate a real AudioContext in vitest — assert the graceful-absence contract.)
- [ ] **Step 2: Implement `audioEngine.ts`** per contract, importing the pure model from `score.ts`. Every method that touches the context guards on its existence.
- [ ] **Step 3:** tsc, `npx vitest run` (48 + new stay green), build. Do NOT run playwright (not wired yet).
- [ ] **Step 4:** Commit `"Build the WebAudio voices behind a graceful guard"`. Push.

---

### Task 3: The enter gate, toggle, and about overlay

**Files:**
- Create: `src/ui/enterGate.ts`
- Modify: `index.html` (add gate + toggle + about DOM and styles)

**Contract:** `createEnterGate(opts: { onEnter: (withSound: boolean) => void; onToggleSound: (on: boolean) => void }): { shouldSkip(): boolean; showIfNeeded(): void; setSoundState(on: boolean): void }`.
- DOM (added to `index.html`, hidden by default, shown by JS): a full-screen `#enter-gate` overlay over the canvas with the title, two buttons "Enter with sound" / "Enter silent"; a corner `#sound-toggle` button (hidden until entered); an `#about` overlay (a short credit/description panel) opened from a small "about" link.
- `shouldSkip()`: true when `location.search` contains any of `seed`, `t`, `cycle`, `debug` (programmatic/dev/test entry → skip gate, start silent). Persisted preference: if `localStorage['emg-sound']` is set AND this is a canonical entry, you MAY auto-apply it but STILL show a brief gate (per spec everyone "arrives at an enter gate") — simplest: always show the gate on canonical entry, pre-selecting the stored preference; skip only for programmatic entry.
- `onEnter(withSound)`: fired when a gate button is clicked (the user gesture) — the conductor uses this to `audio.unlock()` (if withSound) and reveal the toggle. Dismiss the overlay.
- `onToggleSound(on)`: the corner toggle; persists to `localStorage['emg-sound']`.
- `setSoundState(on)`: reflect current sound on/off in the toggle glyph.
- Styling: match the existing minimal aesthetic (system-ui, low-contrast, letter-spacing; the overlay dark with a soft vignette). Buttons keyboard-focusable and `pointer-events` enabled (unlike the title). The about overlay lists: the piece's name/idea, "sound & visuals procedurally generated", and a one-line synthesized-audio note.

- [ ] **Step 1: Implement** `enterGate.ts` + the `index.html` DOM/styles. Pure DOM, no audio (it calls the injected callbacks). localStorage guarded (private-mode throw → try/catch).
- [ ] **Step 2:** tsc, vitest (unchanged green), build. Step 3: Commit `"Raise the enter gate and the sound toggle"`. Push.

---

### Task 4: Conductor wiring — the score follows the cosmos

**Files:**
- Modify: `src/main.ts`

**Contract:**
- Build `audio = createAudioEngine()` and `gate = createEnterGate({...})` at boot. Wire: `onEnter(withSound)` → `if (withSound) audio.unlock(); audio.setEnabled(withSound); revealToggle`. `onToggleSound(on)` → `if (on) audio.unlock(); audio.setEnabled(on)`.
- Gate gating: `if (gate.shouldSkip()) { audio stays silent, scene starts as today } else { gate.showIfNeeded(); scene still starts (renders behind the gate) }`. The render loop ALWAYS starts (do not block it on entry) so the scene is live behind the overlay.
- Per frame: build `CycleAudioParams` from `p` (progress, phase, fade) + rogue state (`rogueActive`, and `rogueProgress` = normalized position through `[spawnP, mergeP]`, else 0), and call `audio.setCycle(params)`.
- Events (emit from the seams already in the loop):
  - In the body prune loop, when a body flips alive→false, call `audio.hit(b.kind === 'galaxy' || b.kind === 'cluster' ? 'galaxyDeath' : 'break')` — but only in decay/carnage (skip serene) so deaths there don't fire (there shouldn't be deaths in serene anyway; guard by phase for safety).
  - On rebirth (the existing reseed branch / `cosmosNo` increment), call `audio.hit('rebirth')`.
  - The rogue chirp is driven continuously via `setCycle`'s `rogueProgress` (no discrete hit needed), climaxing at merge.
- `visibilitychange`: hidden → `audio.suspend()`; visible → `audio.resume()`.
- **Optional, low-risk visual accent** (the spec's "analyser feeding small visual accents"): read `audio.level()` and add a SMALL transient to an existing post uniform (e.g. `post` bloom or a subtle additive nudge) — gated so it is exactly 0 in silent mode / no context (level() returns 0). Keep it subtle; if it risks the pixel gates or looks off, OMIT it and note that in the report (it is a nice-to-have, not required for acceptance).

- [ ] **Step 1: Implement** the wiring. Keep the existing conductor behavior intact (all 15 e2e must still pass — they take the `shouldSkip` path).
- [ ] **Step 2: Verify** — tsc, vitest, build, then FULL e2e (existing 15 must stay green via the skip path). PREVIEW: dev server; check console has zero errors on a canonical `/` load (gate shown) and on a `/?seed=1` load (gate skipped, scene live); capture a screenshot of the gate overlay to `.superpowers/sdd/task-m5-4-gate.png`. Report console-error status for both paths.
- [ ] **Step 3:** Commit `"Let the score follow the cosmos and gate the entrance"`. Push.

---

### Task 5: E2e and docs

**Files:**
- Modify: `e2e/smoke.spec.ts` (or `e2e/cycle.spec.ts`), `README.md`

**Contract (new e2e — the gate path; existing tests stay on the skip path unchanged):**
1. **Gate present on canonical entry:** load bare `/`, assert `#enter-gate` is visible and the two buttons exist, and `__emg` is NOT required to be visible yet is fine either way (scene runs behind). Zero console errors.
2. **Enter silent dismisses + scene runs:** click "Enter silent", assert the gate hides, `__emg` populates, and no AudioContext is running (or master is muted). Zero console errors.
3. **Enter with sound unlocks:** click "Enter with sound", assert the gate hides and (via `page.evaluate`) an AudioContext exists in state `running` (Playwright's click is a gesture). Zero console errors. (Cannot assert audible output headless — assert graph/state only.)
4. **Toggle + persistence:** after entering, click the corner toggle, assert it flips sound state and writes `localStorage['emg-sound']`; reload and assert the stored preference is reflected.
5. **Programmatic entry skips the gate:** load `/?seed=1`, assert `#enter-gate` is hidden and `__emg` populates immediately (regression guard for the seam).
- **README:** check the M5 box; one line on the adaptive synth score + enter gate. Strip any provenance tags.

- [ ] Steps: implement → tsc → full e2e green (report count, paste summary) → commit `"Prove the gate and the silent path"` → push.

---

### Task 6: Acceptance

- [ ] Soak (controller-run): a rogue-present seed, `cycle=60`, two rebirths, zero console errors with the scene live (gate-skipped path). Confirms no audio-path errors across reseeds.
- [ ] **MD listens (the real acceptance):** MD enters with sound on the live view and confirms — the build-up lands (drone→pad→tension across the arc), percussion hits register on deaths, the rogue chirp rises to the merger, **darkness is true silence**, rebirth gets its soft resolution, the corner toggle works, and **silent mode stands alone** (the visual piece is unaffected). MD reports fps (unchanged from ~120 baseline) and signs off. Knobs (layer gains, ramp times) are MD-tunable here.
- [ ] Final whole-branch review (most capable model): scrutinize the gate/e2e seam, the graceful-absence guards, the one-directional audio→core boundary (no audio state leaking into sim/visual), determinism (no seed contamination), and leak/suspend correctness across rebirths and hidden-tab. Fix wave if needed, re-verify, PR + merge per MD's disposition.
