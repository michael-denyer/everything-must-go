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

URL controls: `?seed=<n>` picks the cosmos, `?cycle=<seconds>` compresses the cycle,
`?t=<0..1>` freezes progress at a point in the arc, `?debug` shows fps and phase.

## Status

- [x] Milestone 1: money shot — GPU disk, lensed shadow + photon ring + fold, bloom
- [x] Milestone 2: the consumption cycle and rebirth
- [ ] Milestone 3: planets, moons, belt, comets, nebulae, galaxies
- [ ] Milestone 4: cursor well, silhouette cast, rogue-hole merger
- [ ] Milestone 5: adaptive score and enter gate
- [ ] Milestone 6: quality tiers, mobile, deploy

## Architecture

`core` (loop) → `sim` (GPU ping-pong particle textures) → `render`
(points, starfield, screen-space lensing) → `post` (bloom, ACES output).
Pure logic (seeding, color ramp, projection) is unit-tested; the rendered
frame is smoke-tested with pixel assertions.
