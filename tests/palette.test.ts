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
