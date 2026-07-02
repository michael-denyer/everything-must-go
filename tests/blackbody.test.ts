import { describe, expect, it } from 'vitest';
import { blackbody, blackbodyGlsl } from '../src/color/blackbody';

describe('blackbody', () => {
  it('is deep red at t=0', () => {
    const [r, g, b] = blackbody(0);
    expect(r).toBeGreaterThan(0.4);
    expect(g).toBeLessThan(0.15);
    expect(b).toBeLessThan(0.1);
  });

  it('is near white at t=1', () => {
    const [r, g, b] = blackbody(1);
    expect(r).toBeGreaterThanOrEqual(0.95);
    expect(g).toBeGreaterThanOrEqual(0.9);
    expect(b).toBeGreaterThanOrEqual(0.85);
  });

  it('clamps out-of-range input', () => {
    expect(blackbody(-1)).toEqual(blackbody(0));
    expect(blackbody(2)).toEqual(blackbody(1));
  });

  it('every channel is nondecreasing in t', () => {
    for (let c = 0; c < 3; c++) {
      let prev = -1;
      for (let t = 0; t <= 1.001; t += 0.05) {
        const v = blackbody(Math.min(1, t))[c] as number;
        expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = v;
      }
    }
  });

  it('emits a GLSL function with all stops', () => {
    const glsl = blackbodyGlsl();
    expect(glsl).toContain('vec3 blackbody(float t)');
    expect(glsl).toContain('0.510');
    expect(glsl).toContain('1.000');
  });
});
