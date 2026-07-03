import { describe, expect, it } from 'vitest';
import { createDebrisPool } from '../src/render/debris';
import { CONSUME } from '../src/core/tidal';

// ESCAPE_R is not exported from debris.ts (module-private cull-distance
// budget); mirrored here as a literal. Keep in sync if debris.ts changes it.
const ESCAPE_R = 4;

function readPos(points: ReturnType<typeof createDebrisPool>['points'], i: number): [number, number, number] {
  const arr = points.geometry.getAttribute('position').array as Float32Array;
  return [arr[i * 3]!, arr[i * 3 + 1]!, arr[i * 3 + 2]!];
}

describe('createDebrisPool', () => {
  it('constructs headlessly with a parked (off-screen) initial buffer', () => {
    const pool = createDebrisPool(8);
    const [x, y, z] = readPos(pool.points, 0);
    expect(x).toBe(99);
    expect(y).toBe(99);
    expect(z).toBe(99);
    pool.dispose();
  });

  it('spawn moves a particle into the live set and update() with gravity advances it inward', () => {
    const pool = createDebrisPool(8);
    pool.spawn(1, 0, 0, 0, 0, 0, 1, 1, 1);
    const [x0] = readPos(pool.points, 0);
    expect(x0).toBe(1);

    const r0 = Math.hypot(...readPos(pool.points, 0));
    // gm pulls the particle toward the origin; small dt, no drag, no well/rogue.
    pool.update(0.01, 0.35, 0, 0.2);
    const r1 = Math.hypot(...readPos(pool.points, 0));
    expect(r1).toBeLessThan(r0);
    pool.dispose();
  });

  it('recycles the oldest slot once spawns exceed capacity (ring buffer)', () => {
    const capacity = 4;
    const pool = createDebrisPool(capacity);
    // Fill every slot with a distinguishable x position.
    for (let i = 0; i < capacity; i++) {
      pool.spawn(10 + i, 0, 0, 0, 0, 0, 1, 1, 1);
    }
    for (let i = 0; i < capacity; i++) {
      expect(readPos(pool.points, i)[0]).toBe(10 + i);
    }
    // One more spawn should overwrite slot 0 (the oldest), not append.
    pool.spawn(999, 0, 0, 0, 0, 0, 1, 1, 1);
    expect(readPos(pool.points, 0)[0]).toBe(999);
    for (let i = 1; i < capacity; i++) {
      expect(readPos(pool.points, i)[0]).toBe(10 + i);
    }
    pool.dispose();
  });

  it('parks a particle that passes inside the consume radius', () => {
    const pool = createDebrisPool(8);
    const holeR = 0.2;
    // Place it just inside CONSUME*holeR so update() culls it on the first step.
    const rConsume = CONSUME * holeR * 0.5;
    pool.spawn(rConsume, 0, 0, 0, 0, 0, 1, 1, 1);
    pool.update(0.01, 0.35, 0, holeR);
    const [x, y, z] = readPos(pool.points, 0);
    expect(x).toBe(99);
    expect(y).toBe(99);
    expect(z).toBe(99);
    pool.dispose();
  });

  it('culls a particle beyond the escape radius', () => {
    const pool = createDebrisPool(8);
    const holeR = 0.2;
    pool.spawn(ESCAPE_R + 1, 0, 0, 0, 0, 0, 1, 1, 1);
    pool.update(0.01, 0.35, 0, holeR);
    const [x, y, z] = readPos(pool.points, 0);
    expect(x).toBe(99);
    expect(y).toBe(99);
    expect(z).toBe(99);
    pool.dispose();
  });
});
