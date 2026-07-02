// src/core/tidal.ts
export const RING_STRIP = 5.5;
export const MOON_UNBIND = 4.5;
export const STRETCH_START = 4.2;
export const BURST = 2.0;
export const CONSUME = 1.05;

export function stretchFactor(r: number, holeR: number): number {
  const t = (STRETCH_START * holeR - r) / ((STRETCH_START - BURST) * holeR);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}
