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
