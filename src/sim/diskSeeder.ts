// src/sim/diskSeeder.ts
import { mulberry32 } from './random';

export interface DiskOpts {
  innerR: number;
  outerR: number;
  gm: number;
  thickness: number;
  seed: number;
}

export function seedDisk(
  count: number,
  opts: DiskOpts,
): { positions: Float32Array; velocities: Float32Array } {
  const rand = mulberry32(opts.seed);
  const positions = new Float32Array(count * 4);
  const velocities = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const r = opts.innerR + Math.pow(rand(), 1.5) * (opts.outerR - opts.innerR);
    const a = rand() * Math.PI * 2;
    const y = (rand() * 2 - 1) * opts.thickness * (1 + r) * 0.999;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const v = Math.sqrt(opts.gm / r) * (0.97 + rand() * 0.05);
    positions[i * 4] = x;
    positions[i * 4 + 1] = y;
    positions[i * 4 + 2] = z;
    positions[i * 4 + 3] = 0;
    velocities[i * 4] = Math.sin(a) * v;
    velocities[i * 4 + 1] = 0;
    velocities[i * 4 + 2] = -Math.cos(a) * v;
    velocities[i * 4 + 3] = 0;
  }
  return { positions, velocities };
}
