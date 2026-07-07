# Milestone 6: Everyone else — quality tiers, fallbacks, mobile, deploy

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The piece runs for everyone and ships. A quality-tier system (GPU heuristic + a 3-second fps probe behind the enter gate, live downgrade, context-loss recovery) scales the cosmos from desktop discrete GPUs down to old phones. Failure paths never show a blank page (WebGL2-missing poster, prefers-reduced-motion paused poster with a play button). Meta tags and an OG image make links look right. GitHub Actions CI (SHA-pinned, osv-scanner on the lockfile) tests every PR and deploys `main` to GitHub Pages. Accept: MD's phone test passes and the deployed URL loads clean.

**Architecture:** A pure, unit-testable tier model (`src/quality/tiers.ts`) with NO DOM/WebGL dependency: the closed tier table, a heuristic classifier over probe inputs (GPU renderer string, mobile UA, software-renderer detection), a 3-second fps probe reducer, and a sustained-low detector for live downgrade. The conductor (`main.ts`) owns ONE `rebuild(tier)` mechanism that reconstructs the tier-dependent pipeline pieces (sim texSize, disk points, pixel-ratio cap, bloom knobs, lensing on/off) while preserving cycle progress and the untouched scene (bodies, sky, audio); the fps-probe downgrade, the live downgrade, and the `webglcontextlost/restored` listeners all route through it. Boot guards (WebGL2 check, reduced-motion check) run BEFORE any three.js construction and divert to a poster overlay. Deploy is a separate concern: `.github/workflows/` + `dependabot.yml` + a vite `base` that only changes for the Pages build.

**Tier table (numeric contract — MD-tunable at acceptance):**

| Tier | texSize (particles) | pixel-ratio cap | lensing | bloom |
|---|---|---|---|---|
| high | 1024 (1,048,576) | 2.0 | full | current (0.16 / 0.02 / 1.5) |
| medium | 512 (262,144) | 1.5 | full | strength ×0.75 |
| low | 256 (65,536) | 1.0 | OFF (painted fold + photon ring carry the composition, per spec) | strength ×0.5 |

Spec ranges honored: high 1024² = 1,048,576 (the count MD accepted visually in M1–M5; the spec's "600k–1M" is approximate and this sits at its top edge), medium 150k–300k ✓, low 40k–80k ✓. The deep sky, bodies, debris, and audio are identical across tiers (they are cheap; the particles + full-screen passes are the cost).

**Heuristic (initial tier, before any construction):** software renderer (SwiftShader/llvmpipe/ANGLE-on-software) → low; mobile UA → medium; otherwise desktop → high, EXCEPT known-integrated GPU strings (Intel HD/UHD/Iris without Arc) → medium. Unknown desktop defaults HIGH — the probe corrects downward behind the gate, and the art comes first for the common case. The probe is downgrade-only (simpler; upgrade never happens mid-piece).

**Probe & downgrade thresholds:** probe = median fps over the 3 s after boot while the gate is visible; median < 30 → drop one tier before entry. Live downgrade = fps < 24 sustained for 5 s → drop one tier, `console.info('[emg] tier: X -> Y (sustained low fps)')`, re-arm; floor at low. No UI interruption.

## Global Constraints

- **The `?tier` seam (read before Tasks 2/3 — this protects every existing e2e):** `?tier=high|medium|low` pins the tier, disables the probe AND live downgrade. It does NOT affect gate visibility (like `?cycle`, it is not in `shouldSkip`). Headless CI runs SwiftShader, so the heuristic there says LOW and live downgrade would fire mid-test and rebuild the sim under the pixel gates. Therefore **every existing e2e URL gains `tier=high`** (28 `page.goto` calls incl. the bare-`/` gate/smoke entries — `/?tier=high` still shows the gate) and any NEW e2e must pin tier unless it is specifically testing tier behavior. When the gate is skipped (`?seed`/`?t`/`?debug`) the probe is skipped too (probe is gate-phased by spec), but live downgrade stays active unless `?tier` pins — so e2e must always pin.
- **One rebuild path.** The probe downgrade, live downgrade, and context-restore ALL call the same `rebuild(tier)`. Cycle progress, cosmos spec, body roster, sky, and audio state live outside the rebuilt pieces and MUST survive a rebuild unchanged (same `__emg.spec`, same progress before/after). No second bespoke teardown path anywhere.
- **Boot guards precede construction.** `document.createElement('canvas').getContext('webgl2')` null → poster path: show `#poster` (pre-rendered image, one line of text, the about link), construct NOTHING, zero console errors. `matchMedia('(prefers-reduced-motion: reduce)').matches` → poster + a visible play button; clicking play proceeds to the normal boot (gate included). Never a blank page.
- **Shader park-pair discipline stands** (respawn/rogue park branches identical in both shaders); `rebuild` reconstructs shaders via the existing build-time interpolations — do not introduce new template-literal backticks in shader comments.
- **Hidden tab:** loop already suspends via rAF and `MAX_DT` clamps resume dt; audio suspend shipped in M5. Task 3 VERIFIES this (code citation in the ledger), no new mechanism unless verification fails.
- **Deploy hygiene (CLAUDE.md, non-negotiable):** all GitHub Actions pinned to full commit SHAs with trailing `# vX` comments — SHAs fetched live via `gh api` at implementation time, never from memory; Dependabot for `github-actions` + `npm` ecosystems; osv-scanner runs on `package-lock.json` in CI; **no `--quiet`/`-q`/`--silent` flags anywhere**; lockfile stays committed.
- **Vite base:** production Pages build uses `base: '/everything-must-go/'` via an env switch (`EMG_BASE`); dev and the e2e preview server stay at `/` so the 22 e2e and the 4173 webServer are untouched. The deployed URL gets its own post-deploy check instead.
- TypeScript strict, `npx tsc` 0 pre-commit (build typechecks `e2e/` too). Commits plain, no AI attribution, push after every commit. Branch `milestone-6`. 78 unit + 22 e2e green at every task boundary — **controller runs the full suites; subagents run targeted tests only** (token-loss protocol: commit-before-verify, compact returns ≤400 words, evidence to `.superpowers/sdd/` files, briefs cite line ranges).
- SwiftShader/headless caveat: real fps tiers cannot be exercised in CI (SwiftShader is always slow). e2e verifies plumbing (`?tier` pin, HUD readout, poster paths, context-loss rebuild); real perf numbers come from Task 6 measurements on real hardware.

---

### Task 0 (controller, direct): Subtract before adding

Delete the M5 dead code before building on top: `score.ts` unused layer-gain fields + `rebirthEnvelope` (verify dead via grep first), `enterGate.setSoundState` (unused API), and their orphaned tests/type refs. Full suites green. One commit.

### Task 1: The pure tier model (TDD)

**Files:** create `src/quality/tiers.ts`, `tests/tiers.test.ts`; add tier knobs to `src/config.ts`.

**Interface (pure — no DOM, no WebGL, no three.js imports):**
```typescript
export type TierName = 'high' | 'medium' | 'low';
export interface TierSpec { name: TierName; texSize: number; pixelRatioCap: number; lensing: boolean; bloomStrengthScale: number; }
export const TIERS: Record<TierName, TierSpec>;
export function tierBelow(t: TierName): TierName | null;               // high->medium->low->null
export interface ProbeInputs { rendererString: string; userAgent: string; }
export function chooseInitialTier(i: ProbeInputs): TierName;           // heuristic above
export function parseTierParam(v: string | null): TierName | null;    // boundary parse, closed union
export function createFpsProbe(windowSeconds: number): { sample(dtSeconds: number): void; medianFps(): number | null; done(): boolean; };
export function createSustainedLowDetector(thresholdFps: number, sustainSeconds: number): { sample(dtSeconds: number): boolean; reset(): void; }; // true => downgrade now
```

- [ ] Tests first (RED): tier table matches the numeric contract; heuristic classifies SwiftShader→low, iPhone/Android UA→medium, `Intel(R) UHD Graphics`→medium, `NVIDIA GeForce RTX`/`Apple M3`→high, unknown desktop→high; parseTierParam rejects junk; fps probe median over synthetic dt streams incl. `done()` at the window; sustained-low fires only after `sustainSeconds` continuously below threshold, resets on a fast frame, `reset()` re-arms.
- [ ] Implement. No `Math.random`/`Date` (sample() takes dt).
- [ ] Targeted tests green, tsc green. Commit `"Model quality tiers as a pure, probeable table"`. Push.

### Task 2: Conductor wiring — tiers, rebuild, downgrade, context loss

**Files:** `src/main.ts`, `src/config.ts` (thresholds), `src/render/postChain.ts` (bloom scale + lensing-off construction arg if not already expressible), e2e sweep + `e2e/tiers.spec.ts`.

- [ ] Resolve tier at boot: `parseTierParam` → pinned, else `chooseInitialTier` (renderer string via `WEBGL_debug_renderer_info` on a probe context or the real one, UA). Construct sim/diskPoints/postChain/pixel ratio from `TIERS[tier]`.
- [ ] `rebuild(tier)`: dispose + reconstruct sim, disk points, post chain, pixel ratio at the new tier; cosmos spec, cycle progress, bodies, sky, audio untouched. Wire: probe (canonical entries only, 3 s while gate visible, median<30 → drop one tier), live downgrade (sustained-low detector, unless pinned), `webglcontextlost` (preventDefault) + `webglcontextrestored` → `rebuild(current)`.
- [ ] Debug HUD (`?debug`): `fps · tier · particles · progress · phase`. Expose `__emg.tier`.
- [ ] e2e: sweep ALL existing `page.goto` URLs to pin `tier=high` (gate/smoke bare-`/` become `/?tier=high`); new `e2e/tiers.spec.ts`: `?tier=low` yields `__emg.tier==='low'` + HUD shows it + roster/spec unchanged vs same seed at high; context-loss test via `WEBGL_lose_context` extension → scene recovers, progress preserved, no console errors.
- [ ] Targeted tests green, tsc green. Commit(s), push. Reviewer pass (one reviewer, findings fixed before close).

### Task 3: Fallbacks, mobile, meta — never a blank page

**Files:** `index.html`, `src/main.ts` (boot guards only — Task 2 owns the loop), `public/og.jpg` + poster asset, `e2e/fallbacks.spec.ts`.

- [ ] Poster asset: capture the money shot from the dev server (pinned seed, carnage-ish `t`), save as `public/og.jpg` (1200×630) — ONE asset serves OG image, WebGL2-fail poster, and reduced-motion poster.
- [ ] WebGL2 guard: scratch-canvas `getContext('webgl2')` null → show poster + one line + about link, construct nothing, zero console errors.
- [ ] `prefers-reduced-motion: reduce` → poster + play button; play proceeds to normal boot (gate shows if canonical). No auto-starting motion.
- [ ] Meta: description, `og:title/description/image/url/type`, `twitter:card`. OG URLs absolute (Pages URL).
- [ ] Mobile pass: `100dvh` where `100vh` breaks under mobile chrome; gate/title/counter legible at 375px (verify via preview_resize); pointer events already unify touch — verify feeding works with touch-drag (`touch-action: none` present).
- [ ] Hidden-tab verify (no new code expected): cite the rAF + `MAX_DT` clamp lines in the ledger.
- [ ] e2e: WebGL2-fail (init-script stubs `getContext` to null for `webgl2`) → poster visible, no errors, not blank; Playwright `reducedMotion: 'reduce'` → poster + play → click → gate appears; meta tags present.
- [ ] Green, commit, push, one reviewer.

### Task 4: CI + Pages deploy (parallel with Task 1 — disjoint files)

**Files:** `.github/workflows/ci.yml`, `.github/dependabot.yml`, `vite.config.ts` (env-switched base), `README.md`.

- [ ] `ci.yml` on PR + push-to-main: job **test** = checkout, setup-node (lockfile cache), `npm ci`, unit, build, `npx playwright install --with-deps chromium`, e2e; job **scan** = osv-scanner on `package-lock.json`; job **deploy** (push-to-main only, needs test+scan) = build with `EMG_BASE=/everything-must-go/`, configure-pages, upload-pages-artifact, deploy-pages, then a curl check of the live URL (HTTP 200 + `<title>Everything Must Go`). ALL actions SHA-pinned with `# vX` comments — fetch real SHAs via `gh api repos/<owner>/<repo>/git/ref/tags/<tag>` at implementation time.
- [ ] `dependabot.yml`: `github-actions` weekly, `npm` weekly.
- [ ] `vite.config.ts`: `base: process.env.EMG_BASE ?? '/'`.
- [ ] README: live URL, controls (`?seed`, `?t`, `?debug`, `?cycle`, `?tier`), a "Performance" section with an empty tier/device/fps table (filled by Task 6 — spec: numbers recorded before deploy claims).
- [ ] Local validation only (workflows can't run pre-merge from a branch usefully; CI proves itself on the PR): `npx tsc`, yaml sanity, unit+build. Commit, push, one reviewer.

### Task 5: Final adversarial review (whole branch)

Full find→refute workflow over the milestone diff (the one full-depth review per MD's standing policy). Confirmed findings fixed and re-verified before the PR.

### Task 6: Acceptance + ship

- [ ] Controller: full unit + e2e suites; a sound-on soak with `?tier=medium` (rebuild path exercised in anger); perf numbers — high on this Mac (dev server, `?debug` fps), medium via CPU-throttled Chrome (CDP `setCPUThrottlingRate`), recorded in the README table. Low-tier number comes from MD's phone against the live URL.
- [ ] PR #7, squash-merge after MD sign-off, enable Pages (`gh api` build_type=workflow), watch the deploy run (Monitor), verify the live URL.
- [ ] MD (acceptance authority): phone test passes, deployed URL loads clean, look/feel unchanged on desktop high tier.
