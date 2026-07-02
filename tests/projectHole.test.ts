// tests/projectHole.test.ts
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { projectHole } from '../src/render/projectHole';

function makeCamera(z: number): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100);
  cam.position.set(0, 0, z);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  return cam;
}

describe('projectHole', () => {
  it('projects the origin to screen center for a head-on camera', () => {
    const { centerUv } = projectHole(makeCamera(4.2), 0.22, 1600, 900);
    expect(centerUv[0]).toBeCloseTo(0.5, 3);
    expect(centerUv[1]).toBeCloseTo(0.5, 3);
  });

  it('gives a positive radius that shrinks with distance', () => {
    const near = projectHole(makeCamera(4.2), 0.22, 1600, 900);
    const far = projectHole(makeCamera(8.4), 0.22, 1600, 900);
    expect(near.radiusUv).toBeGreaterThan(0);
    expect(far.radiusUv).toBeLessThan(near.radiusUv);
  });
});
