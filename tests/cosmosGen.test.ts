import { describe, expect, it } from 'vitest';
import { generateCosmos } from '../src/core/cosmosGen';

// Captured via `vite-node` against the unmodified M2 cosmosGen.ts for seed 42,
// before the roster fields (Step 5) were appended. Do not compute these from
// generateCosmos inside the test — that would make the pin circular.
const PINNED = {
  holeR0: 0.22606622511520982,
  cycleSeconds: 771,
  holeGrowth: 3.1357872331514955,
  diskInner0: 0.27127947013825177,
  diskOuter0: 1.9106370168738067,
  starCount: 3637,
  starShell0: 6.344871676992625,
  starShell1: 13.219105638796464,
  diskSeed: 1858592655,
  starSeed: 1014293152,
};

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
});
