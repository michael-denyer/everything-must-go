// tests/diskSeeder.test.ts
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/sim/random';
import { seedDisk } from '../src/sim/diskSeeder';

const OPTS = { innerR: 0.28, outerR: 1.9, gm: 0.35, thickness: 0.02, seed: 42 };
const N = 5000;

describe('mulberry32', () => {
  it('is deterministic and in [0,1)', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('seedDisk', () => {
  const { positions, velocities } = seedDisk(N, OPTS);

  it('packs 4 floats per particle', () => {
    expect(positions.length).toBe(N * 4);
    expect(velocities.length).toBe(N * 4);
  });

  it('is deterministic for the same seed', () => {
    const again = seedDisk(N, OPTS);
    expect(again.positions).toEqual(positions);
  });

  it('places every particle inside the annulus with bounded thickness', () => {
    for (let i = 0; i < N; i++) {
      const x = positions[i * 4]!, y = positions[i * 4 + 1]!, z = positions[i * 4 + 2]!;
      const r = Math.hypot(x, z);
      expect(r).toBeGreaterThanOrEqual(OPTS.innerR - 1e-6);
      expect(r).toBeLessThanOrEqual(OPTS.outerR + 1e-6);
      expect(Math.abs(y)).toBeLessThanOrEqual(OPTS.thickness * (1 + r) + 1e-6);
    }
  });

  it('gives near-circular Keplerian speeds', () => {
    for (let i = 0; i < N; i += 50) {
      const x = positions[i * 4]!, z = positions[i * 4 + 2]!;
      const vx = velocities[i * 4]!, vz = velocities[i * 4 + 2]!;
      const r = Math.hypot(x, z);
      const v = Math.hypot(vx, vz);
      const vKep = Math.sqrt(OPTS.gm / r);
      expect(Math.abs(v - vKep) / vKep).toBeLessThan(0.08);
      const radialDot = (x * vx + z * vz) / (r * v);
      expect(Math.abs(radialDot)).toBeLessThan(0.1);
    }
  });

  it('is denser toward the inner edge', () => {
    const radii: number[] = [];
    for (let i = 0; i < N; i++) {
      radii.push(Math.hypot(positions[i * 4]!, positions[i * 4 + 2]!));
    }
    radii.sort((a, b) => a - b);
    const median = radii[Math.floor(N / 2)]!;
    expect(median).toBeLessThan((OPTS.innerR + OPTS.outerR) / 2);
  });
});
