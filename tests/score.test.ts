import { describe, expect, it } from 'vitest';
import { generateCosmos } from '../src/core/cosmosGen';
import { evalCycle } from '../src/core/cycle';
import { chirpFrequency, rebirthEnvelope, scoreGains, type CycleAudioParams } from '../src/audio/score';

// Params are constructed directly from the documented contract (progress, phase, fade,
// rogueActive, rogueProgress) rather than via evalCycle/generateCosmos, since scoreGains
// only reads those five fields and the plan's numeric contract is phrased in terms of them.
// generateCosmos/evalCycle are used in one test (the progress sweep) to sanity-check against
// a real (progress, phase, fade) trajectory too.
function paramsAt(progress: number, phase: string, fade = 1): CycleAudioParams {
  return { progress, phase, fade, rogueActive: false, rogueProgress: 0 };
}

describe('scoreGains', () => {
  it('drone is present from serene and rises by carnage', () => {
    const serene = scoreGains(paramsAt(0.05, 'serene'));
    const carnage = scoreGains(paramsAt(0.9, 'carnage'));
    expect(serene.drone).toBeGreaterThan(0);
    expect(serene.drone).toBeCloseTo(0.12, 1);
    expect(carnage.drone).toBeGreaterThan(serene.drone);
    expect(carnage.drone).toBeCloseTo(0.22, 1);
  });

  it('pad is ~0 before progress 0.25 and audible by 0.6', () => {
    const before = scoreGains(paramsAt(0.1, 'serene'));
    const at06 = scoreGains(paramsAt(0.6, 'carnage'));
    expect(before.pad).toBeCloseTo(0, 2);
    expect(at06.pad).toBeGreaterThan(0.1);
    expect(at06.pad).toBeCloseTo(0.18, 1);
  });

  it('tension is ~0 before 0.55 and high by 0.9', () => {
    const before = scoreGains(paramsAt(0.5, 'decay'));
    const at09 = scoreGains(paramsAt(0.9, 'carnage'));
    expect(before.tension).toBeCloseTo(0, 2);
    expect(at09.tension).toBeGreaterThan(0.2);
    expect(at09.tension).toBeCloseTo(0.3, 1);
  });

  it('sub grows through carnage', () => {
    const decay = scoreGains(paramsAt(0.4, 'decay'));
    const carnage = scoreGains(paramsAt(0.9, 'carnage'));
    expect(carnage.sub).toBeGreaterThan(decay.sub);
    expect(carnage.sub).toBeGreaterThan(0);
  });

  it('every layer gain and master are ~0 in darkness (fade≈0) — the silence contract', () => {
    const dark = scoreGains(paramsAt(0.95, 'darkness', 0));
    expect(dark.master).toBeCloseTo(0, 5);
    expect(dark.drone).toBeCloseTo(0, 5);
    expect(dark.pad).toBeCloseTo(0, 5);
    expect(dark.tension).toBeCloseTo(0, 5);
    expect(dark.sub).toBeCloseTo(0, 5);
  });

  it('a partial fade attenuates by fade^2, not linearly', () => {
    const full = scoreGains(paramsAt(0.9, 'carnage', 1));
    const half = scoreGains(paramsAt(0.9, 'carnage', 0.5));
    expect(half.master).toBeCloseTo(full.master * 0.25, 5);
    expect(half.drone).toBeCloseTo(full.drone * 0.25, 5);
  });

  it('keeps all gains within [0,1] across a progress sweep, including a real cycle trajectory', () => {
    for (let p = 0; p <= 1.0001; p += 0.01) {
      const progress = Math.min(1, p);
      const fade = progress < 0.92 ? 1 : progress < 0.965 ? 0.3 : 0;
      const g = scoreGains(paramsAt(progress, 'decay', fade));
      for (const v of Object.values(g)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }

    // Cross-check against a real cosmos spec's (progress, phase, fade) trajectory.
    const spec = generateCosmos(42);
    for (let p = 0; p <= 1.0001; p += 0.05) {
      const c = evalCycle(spec, Math.min(1, p) * spec.cycleSeconds);
      const g = scoreGains({
        progress: c.progress,
        phase: c.phase,
        fade: c.fade,
        rogueActive: c.rogueActive,
        rogueProgress: 0,
      });
      for (const v of Object.values(g)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      if (c.phase === 'darkness' && c.fade < 0.05) {
        expect(g.master).toBeCloseTo(0, 1);
      }
    }
  });
});

describe('chirpFrequency', () => {
  it('is monotonic from 40 to 320 Hz over [0,1]', () => {
    expect(chirpFrequency(0)).toBeCloseTo(40, 5);
    expect(chirpFrequency(1)).toBeCloseTo(320, 5);
    let prev = chirpFrequency(0);
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const f = chirpFrequency(Math.min(1, t));
      expect(f).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = f;
    }
  });

  it('clamps outside [0,1]', () => {
    expect(chirpFrequency(-1)).toBe(40);
    expect(chirpFrequency(2)).toBe(320);
  });
});

describe('rebirthEnvelope', () => {
  it('is 0 for t<0 and t>2.5', () => {
    expect(rebirthEnvelope(-1)).toBe(0);
    expect(rebirthEnvelope(-0.001)).toBe(0);
    expect(rebirthEnvelope(2.5001)).toBe(0);
    expect(rebirthEnvelope(4)).toBe(0);
  });

  it('rises from 0, peaks near the middle, and returns to 0 by 2.5s', () => {
    expect(rebirthEnvelope(0)).toBeCloseTo(0, 5);
    expect(rebirthEnvelope(2.5)).toBeCloseTo(0, 5);
    const mid = rebirthEnvelope(1.25);
    expect(mid).toBeGreaterThan(0.9);
    expect(rebirthEnvelope(0.2)).toBeGreaterThan(rebirthEnvelope(0));
    expect(rebirthEnvelope(0.2)).toBeLessThan(mid);
    expect(rebirthEnvelope(2.3)).toBeLessThan(mid);
    expect(rebirthEnvelope(2.3)).toBeGreaterThan(rebirthEnvelope(2.5));
  });

  it('stays within [0,1] across the swell', () => {
    for (let t = -0.5; t <= 3; t += 0.05) {
      const v = rebirthEnvelope(t);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
