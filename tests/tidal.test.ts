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
