import { describe, expect, it } from 'vitest';
import { generateCosmos } from '../src/core/cosmosGen';
import { evalCycle } from '../src/core/cycle';
import { chirpFrequency, masterGain, type CycleAudioParams } from '../src/audio/score';

// Params are constructed directly from the documented contract (progress, phase, fade,
// rogueActive, rogueProgress). generateCosmos/evalCycle are used in one test (the
// progress sweep) to sanity-check against a real (progress, phase, fade) trajectory too.
function paramsAt(progress: number, phase: string, fade = 1): CycleAudioParams {
  return { progress, phase, fade, rogueActive: false, rogueProgress: 0 };
}

describe('masterGain', () => {
  it('is ~0 in darkness (fade≈0) — the silence contract', () => {
    expect(masterGain(paramsAt(0.95, 'darkness', 0))).toBeCloseTo(0, 5);
  });

  it('attenuates by fade^2, not linearly', () => {
    const full = masterGain(paramsAt(0.9, 'carnage', 1));
    const half = masterGain(paramsAt(0.9, 'carnage', 0.5));
    expect(half).toBeCloseTo(full * 0.25, 5);
  });

  it('stays within [0,1] across a real cycle trajectory and hits silence in darkness', () => {
    const spec = generateCosmos(42);
    for (let p = 0; p <= 1.0001; p += 0.05) {
      const c = evalCycle(spec, Math.min(1, p) * spec.cycleSeconds);
      const g = masterGain({
        progress: c.progress,
        phase: c.phase,
        fade: c.fade,
        rogueActive: c.rogueActive,
        rogueProgress: 0,
      });
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(1);
      if (c.phase === 'darkness' && c.fade < 0.05) {
        expect(g).toBeCloseTo(0, 1);
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
