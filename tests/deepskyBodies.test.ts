import { describe, expect, it } from 'vitest';
import { generateCosmos } from '../src/core/cosmosGen';
import { evalCycle } from '../src/core/cycle';
import { generatePalette } from '../src/core/palette';
import { CONSUME } from '../src/core/tidal';
import { GM, MAX_DT } from '../src/config';
import { createCluster } from '../src/render/cluster';
import { createPulsar } from '../src/render/pulsar';

// Drive a Body through a full cycle exactly as main.ts's conductor does: step
// sim-time by dt, evalCycle at that time, call update(dt, gm, drag, holeR,
// spawnDebris). Returns the progress at death and the world position of the
// last debris spawned (the puff/flash site).
function runToDeath(
  spec: ReturnType<typeof generateCosmos>,
  body: { alive: boolean; update: (dt: number, gm: number, drag: number, holeR: number, spawn: (x: number, y: number, z: number, vx: number, vy: number, vz: number, r: number, g: number, b: number) => void) => void },
): { diedAtProgress: number | null; lastSpawn: { x: number; y: number; z: number } | null; holeRAtDeath: number } {
  const dt = MAX_DT;
  let cycleT = 0;
  let lastSpawn: { x: number; y: number; z: number } | null = null;
  const spawn = (x: number, y: number, z: number): void => {
    lastSpawn = { x, y, z };
  };
  let holeRAtDeath = 0;
  while (cycleT <= spec.cycleSeconds) {
    const p = evalCycle(spec, cycleT);
    const wasAlive = body.alive;
    body.update(dt, p.gm, p.drag, p.holeR, spawn);
    if (wasAlive && !body.alive) {
      holeRAtDeath = p.holeR;
      return { diedAtProgress: p.progress, lastSpawn, holeRAtDeath };
    }
    cycleT += dt;
  }
  return { diedAtProgress: null, lastSpawn, holeRAtDeath };
}

function firstSeedWith(pred: (spec: ReturnType<typeof generateCosmos>) => boolean): ReturnType<typeof generateCosmos> {
  for (let s = 0; s < 400; s++) {
    const spec = generateCosmos(s);
    if (pred(spec)) return spec;
  }
  throw new Error('no seed found matching predicate within 400 seeds');
}

describe('cluster unit-swallow', () => {
  it('implodes and puffs AT the hole, not out at its spawn orbit', () => {
    const spec = firstSeedWith((c) => c.clusters.length >= 1);
    const palette = generatePalette(spec.paletteSeed);
    const cluster = createCluster(spec.clusters[0]!, palette, GM);
    const { diedAtProgress, lastSpawn, holeRAtDeath } = runToDeath(spec, cluster);

    // It must actually be swallowed within the cycle (the whole point of the body).
    expect(diedAtProgress).not.toBeNull();
    expect(lastSpawn).not.toBeNull();

    // The puff site must be near the hole (r <= CONSUME*holeR by the consume
    // guard). The pre-fix bug puffed at ~3*holeR (its spawn orbit) because the
    // collapse was a 4s timer, not proximity-gated. Pin it to the hole.
    const puffR = Math.hypot(lastSpawn!.x, lastSpawn!.y, lastSpawn!.z);
    expect(puffR).toBeLessThanOrEqual(CONSUME * holeRAtDeath * 1.05);
    // Sanity: that is far inside 3*holeR, where the bug fired.
    expect(puffR).toBeLessThan(3 * holeRAtDeath);
  });

  it('ratchets the swallow uniform one-way toward full collapse', () => {
    const spec = firstSeedWith((c) => c.clusters.length >= 1);
    const palette = generatePalette(spec.paletteSeed);
    const cluster = createCluster(spec.clusters[0]!, palette, GM);
    const material = (cluster.object as unknown as { material: { uniforms: { uSwallow: { value: number } } } }).material;

    const dt = MAX_DT;
    let cycleT = 0;
    let prev = 0;
    let sawPartial = false;
    while (cycleT <= spec.cycleSeconds && cluster.alive) {
      const p = evalCycle(spec, cycleT);
      cluster.update(dt, p.gm, p.drag, p.holeR, () => {});
      const u = material.uniforms.uSwallow.value;
      expect(u).toBeGreaterThanOrEqual(prev - 1e-9); // monotonic
      if (u > 0.05 && u < 0.95) sawPartial = true;
      prev = u;
      cycleT += dt;
    }
    // The collapse actually ramped through intermediate values (not a 0->1 jump).
    expect(sawPartial).toBe(true);
  });
});

describe('pulsar plunge', () => {
  it('survives past the serene phase and is consumed mid-cycle, not in the first seconds', () => {
    const spec = firstSeedWith((c) => c.pulsar.present);
    const pulsar = createPulsar(spec.pulsar, GM);
    const { diedAtProgress } = runToDeath(spec, pulsar);

    expect(diedAtProgress).not.toBeNull();
    // The pre-fix bug consumed it at progress ~0.02 (inside serene, p<0.25).
    // The plan wants the plunge to engage ~0.4 and be consumed mid-cycle.
    expect(diedAtProgress!).toBeGreaterThan(0.3);
    expect(diedAtProgress!).toBeLessThan(0.85);
  });

  it('holds a stable radius until release, then falls in', () => {
    const spec = firstSeedWith((c) => c.pulsar.present);
    const pulsar = createPulsar(spec.pulsar, GM);
    const dt = MAX_DT;
    let cycleT = 0;
    let radiusEarly = 0;
    let captured = false;
    while (cycleT <= spec.cycleSeconds && pulsar.alive) {
      const p = evalCycle(spec, cycleT);
      // Capture the pulsar's orbital radius early (well before the ~0.4 release).
      if (!captured && p.progress >= 0.15) {
        radiusEarly = Math.hypot(pulsar.object.position.x, pulsar.object.position.y, pulsar.object.position.z);
        captured = true;
      }
      pulsar.update(dt, p.gm, p.drag, p.holeR, () => {});
      cycleT += dt;
    }
    // Early on it should still be near its spawn orbit (0.7-0.9), not already
    // decayed toward the hole as the pre-fix version was.
    expect(radiusEarly).toBeGreaterThan(spec.pulsar.orbitR * 0.9);
  });
});
