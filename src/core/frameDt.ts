// src/core/frameDt.ts
import { MAX_DT } from '../config';

// Sim step from the raw rAF delta in seconds. The first rAF timestamp can
// precede the performance.now() that seeded the clock, so a non-positive or
// NaN delta takes a nominal 60 fps step instead of integrating backwards.
export function frameDt(rawDt: number): number {
  return rawDt > 0 ? Math.min(MAX_DT, rawDt) : 1 / 60;
}
