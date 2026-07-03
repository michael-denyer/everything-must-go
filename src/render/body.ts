// src/render/body.ts
import type * as THREE from 'three';

export type BodyKind = 'planet' | 'comet' | 'cast' | 'galaxy' | 'cluster' | 'pulsar';

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
  // Optional cosmos-death fade for EMISSIVE bodies (galaxy/cluster/pulsar):
  // the conductor calls this each frame with p.fade so they dim to black
  // through the darkness phase, matching the disk/lensing/sky. Lit bodies
  // (planet) and silhouettes (cast) don't implement it — they're gone by
  // darkness or dark already, so the darkness gate stays satisfied.
  setFade?(fade: number): void;
  dispose(): void;
}
