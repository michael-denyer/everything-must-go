import { CYCLE_SECONDS } from '../config';
import { mulberry32 } from '../sim/random';

export interface CosmosSpec {
  seed: number;
  cycleSeconds: number;
  holeR0: number;
  holeGrowth: number;
  diskInner0: number;
  diskOuter0: number;
  starCount: number;
  starShell: [number, number];
  diskSeed: number;
  starSeed: number;
}

export function generateCosmos(seed: number): CosmosSpec {
  const rand = mulberry32(seed);
  const lerp = (a: number, b: number): number => a + (b - a) * rand();
  const holeR0 = lerp(0.19, 0.25);
  const shellMin = lerp(5, 8);
  return {
    seed,
    cycleSeconds: Math.round(CYCLE_SECONDS * lerp(0.9, 1.1)),
    holeR0,
    holeGrowth: lerp(2.6, 3.4),
    diskInner0: Math.max(holeR0 * 1.2, lerp(0.26, 0.32)),
    diskOuter0: lerp(1.7, 2.1),
    starCount: Math.round(lerp(3200, 4800)),
    starShell: [shellMin, shellMin + lerp(5, 8)],
    diskSeed: Math.floor(rand() * 2 ** 31),
    starSeed: Math.floor(rand() * 2 ** 31),
  };
}
