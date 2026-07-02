import { DRAG_BASE, GM } from '../config';
import type { CosmosSpec } from './cosmosGen';

export type Phase = 'serene' | 'decay' | 'carnage' | 'darkness' | 'rebirth';

export interface CycleParams {
  progress: number;
  phase: Phase;
  holeR: number;
  gm: number;
  drag: number;
  diskRespawn: boolean;
  starPlunge: number;
  camDist: number;
  fade: number;
  flash: number;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

function phaseOf(p: number): Phase {
  if (p < 0.25) return 'serene';
  if (p < 0.6) return 'decay';
  if (p < 0.92) return 'carnage';
  if (p < 0.97) return 'darkness';
  return 'rebirth';
}

export function evalCycle(spec: CosmosSpec, tSeconds: number): CycleParams {
  const p = clamp01(tSeconds / spec.cycleSeconds);
  const holeR = spec.holeR0 * (1 + (spec.holeGrowth - 1) * Math.pow(p, 1.6));
  return {
    progress: p,
    phase: phaseOf(p),
    holeR,
    gm: GM * (holeR / spec.holeR0) ** 2,
    drag: DRAG_BASE * (1 + 5 * Math.pow(p, 1.8)),
    diskRespawn: p < 0.88,
    starPlunge: clamp01((p - 0.65) / 0.27),
    camDist: 1 + 0.45 * smoothstep(0.1, 0.9, p),
    fade: p < 0.92 ? 1 : 1 - smoothstep(0.92, 0.965, p),
    flash: smoothstep(0.955, 0.975, p),
  };
}
