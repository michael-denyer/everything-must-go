// src/render/postChain.ts
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { BLOOM_RADIUS, BLOOM_STRENGTH, BLOOM_THRESHOLD, EXPOSURE, SHADOW_R } from '../config';
import { createLensingPass } from './lensing';
import { createShadowRecarve } from './shadowRecarve';
import { projectHole } from './projectHole';

export function createPostChain(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
): {
  composer: EffectComposer;
  lensing: ReturnType<typeof createLensingPass>;
  lensingUpdate(camera: THREE.PerspectiveCamera, width: number, height: number, shadowR: number): void;
  setFlash(f: number): void;
  setCycleFade(f: number): void;
  setSize(width: number, height: number): void;
  holeScreen(): [number, number];
} {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = EXPOSURE;

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const lensing = createLensingPass();
  composer.addPass(lensing.pass);

  // Bloom now runs AFTER lensing (reverses the M2 order): the lensed photon
  // ring and fold bands can bloom outward into a halo. This reopens the M1
  // problem (bloom's wide coarse-mip kernels refill the shadow interior from
  // the bright ring at any strength) — the fix is the recarve pass below,
  // which is the final multiply against the shadow radius and restores a
  // pitch-black horizon by construction regardless of bloom strength.
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(innerWidth, innerHeight),
    BLOOM_STRENGTH,
    BLOOM_RADIUS,
    BLOOM_THRESHOLD,
  );
  composer.addPass(bloom);

  const recarve = createShadowRecarve();
  composer.addPass(recarve.pass);

  composer.addPass(new OutputPass());

  let lastShadowR = SHADOW_R;
  let lastCenterUv: [number, number] = [0.5, 0.5];
  let lastWidth = innerWidth;
  let lastHeight = innerHeight;

  function project(cam: THREE.PerspectiveCamera, width: number, height: number, shadowR: number): void {
    const { centerUv, radiusUv } = projectHole(cam, shadowR, width, height);
    const aspect = width / height;
    lensing.update(centerUv, radiusUv, aspect);
    recarve.update(centerUv, radiusUv, aspect);
    lastCenterUv = centerUv;
    lastWidth = width;
    lastHeight = height;
  }

  return {
    composer,
    lensing,
    lensingUpdate(cam: THREE.PerspectiveCamera, width: number, height: number, shadowR: number): void {
      lastShadowR = shadowR;
      project(cam, width, height, shadowR);
    },
    setFlash(f: number): void {
      recarve.setFlash(f);
    },
    setCycleFade(f: number): void {
      // Raise the threshold as the cosmos fades so bloom retires with it.
      // UnrealBloomPass re-reads .threshold every render; strength and radius
      // stay static — only the source cut varies across the cycle.
      bloom.threshold = BLOOM_THRESHOLD + (1 - f) * 24;
    },
    setSize(width: number, height: number): void {
      composer.setSize(width, height);
      bloom.setSize(width, height);
      project(camera, width, height, lastShadowR);
    },
    holeScreen(): [number, number] {
      return [lastCenterUv[0] * lastWidth, lastCenterUv[1] * lastHeight];
    },
  };
}
