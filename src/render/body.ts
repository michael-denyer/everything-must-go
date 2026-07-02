// src/render/body.ts
import type * as THREE from 'three';

export type BodyKind = 'planet' | 'comet' | 'cast';

export interface Body {
  readonly kind: BodyKind;
  readonly object: THREE.Object3D;
  update(
    dt: number,
    gm: number,
    dragBase: number,
    holeR: number,
    spawnDebris: (
      x: number,
      y: number,
      z: number,
      vx: number,
      vy: number,
      vz: number,
      r: number,
      g: number,
      b: number,
    ) => void,
  ): void;
  readonly alive: boolean;
  dispose(): void;
}
