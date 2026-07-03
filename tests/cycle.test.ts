import { describe, expect, it } from 'vitest';
import { generateCosmos } from '../src/core/cosmosGen';
import { evalCycle, type Phase } from '../src/core/cycle';
import { DRAG_BASE, GM } from '../src/config';

const spec = generateCosmos(42);
const at = (p: number) => evalCycle(spec, p * spec.cycleSeconds);

describe('evalCycle', () => {
  it('maps progress to the spec phase boundaries', () => {
    const cases: Array<[number, Phase]> = [
      [0.0, 'serene'], [0.249, 'serene'], [0.25, 'decay'], [0.599, 'decay'],
      [0.6, 'carnage'], [0.919, 'carnage'], [0.92, 'darkness'], [0.969, 'darkness'],
      [0.97, 'rebirth'], [1.0, 'rebirth'],
    ];
    for (const [p, phase] of cases) expect(at(p).phase).toBe(phase);
  });

  it('clamps progress to [0,1] outside the cycle', () => {
    expect(evalCycle(spec, -5).progress).toBe(0);
    expect(evalCycle(spec, spec.cycleSeconds * 2).progress).toBe(1);
  });

  it('grows the hole monotonically to holeGrowth times its start', () => {
    let prev = 0;
    for (let p = 0; p <= 1.0001; p += 0.01) {
      const r = at(Math.min(1, p)).holeR;
      expect(r).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = r;
    }
    expect(at(0).holeR).toBeCloseTo(spec.holeR0, 10);
    expect(at(1).holeR).toBeCloseTo(spec.holeR0 * spec.holeGrowth, 10);
  });

  it('scales gravity with hole area', () => {
    expect(at(0).gm).toBeCloseTo(GM, 10);
    const p = at(0.7);
    expect(p.gm).toBeCloseTo(GM * (p.holeR / spec.holeR0) ** 2, 10);
  });

  it('drives drag, respawn, plunge, and camera per contract', () => {
    expect(at(0).drag).toBeCloseTo(DRAG_BASE, 10);
    expect(at(1).drag).toBeCloseTo(DRAG_BASE * 6, 10);
    expect(at(0.87).diskRespawn).toBe(true);
    expect(at(0.88).diskRespawn).toBe(false);
    expect(at(0.6).starPlunge).toBeCloseTo(0, 5);
    expect(at(0.65).starPlunge).toBe(0);
    expect(at(0.92).starPlunge).toBe(1);
    expect(at(0).camDist).toBeCloseTo(1, 5);
    expect(at(1).camDist).toBeCloseTo(1.45, 5);
  });

  it('fades to black through darkness and flashes into rebirth', () => {
    expect(at(0.5).fade).toBe(1);
    expect(at(0.92).fade).toBe(1);
    expect(at(0.965).fade).toBeCloseTo(0, 5);
    expect(at(0.95).flash).toBe(0);
    expect(at(0.955).flash).toBe(0);
    expect(at(0.975).flash).toBe(1);
    expect(at(1).flash).toBe(1);
  });

  it('activates and merges the rogue purely from spec and time', () => {
    let spec9: ReturnType<typeof generateCosmos> | undefined;
    for (let s = 0; s < 200 && !spec9; s++) {
      const c = generateCosmos(s);
      if (c.rogue.present) spec9 = c;
    }
    expect(spec9).toBeDefined();
    const sp = spec9!;
    const atP = (p: number) => evalCycle(sp, p * sp.cycleSeconds);
    expect(atP(sp.rogue.spawnP - 0.01).rogueActive).toBe(false);
    expect(atP(sp.rogue.spawnP + 0.01).rogueActive).toBe(true);
    expect(atP(sp.rogue.mergeP - 0.01).rogueActive).toBe(true);
    expect(atP(sp.rogue.mergeP + 0.001).rogueActive).toBe(false);
    expect(atP(sp.rogue.mergeP + 0.001).rogueMerged).toBe(true);
    const before = atP(sp.rogue.mergeP - 0.005).holeR;
    const after = atP(sp.rogue.mergeP + 0.03).holeR;
    expect(after / before).toBeGreaterThan(1.15);
    // The merger boost rides into gravity through the area law (gm ∝ holeR²):
    // swallowed mass pulls harder. Pin the ripple so it can't silently vanish.
    const gmBefore = atP(sp.rogue.mergeP - 0.005).gm;
    const gmAfter = atP(sp.rogue.mergeP + 0.03).gm;
    expect(gmAfter / gmBefore).toBeGreaterThan(1.3);
  });

  it('keeps rogue fields inert for rogue-free cosmoses', () => {
    let spec0: ReturnType<typeof generateCosmos> | undefined;
    for (let s = 0; s < 200 && !spec0; s++) {
      const c = generateCosmos(s);
      if (!c.rogue.present) spec0 = c;
    }
    const sp = spec0!;
    const p = evalCycle(sp, 0.7 * sp.cycleSeconds);
    expect(p.rogueActive).toBe(false);
    expect(p.rogueMerged).toBe(false);
  });
});
