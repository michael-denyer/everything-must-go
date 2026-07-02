// src/render/postChain.ts
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { BLOOM_RADIUS, BLOOM_STRENGTH, BLOOM_THRESHOLD, SHADOW_R } from '../config';
import { createLensingPass } from './lensing';

export function createPostChain(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
): {
  composer: EffectComposer;
  lensing: ReturnType<typeof createLensingPass>;
  lensingUpdate(camera: THREE.PerspectiveCamera, width: number, height: number, shadowR: number): void;
  setSize(width: number, height: number): void;
} {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  // Bloom runs BEFORE the lensing pass (controller-approved deviation from the
  // plan's stated order): lensing's shadow mask is then the final multiply, so
  // the horizon stays black at any bloom strength. With bloom after lensing,
  // its wide coarse-mip kernels refill the carved shadow from the bright ring.
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(innerWidth, innerHeight),
    BLOOM_STRENGTH,
    BLOOM_RADIUS,
    BLOOM_THRESHOLD,
  );
  composer.addPass(bloom);

  const lensing = createLensingPass();
  composer.addPass(lensing.pass);

  composer.addPass(new OutputPass());

  let lastShadowR = SHADOW_R;

  return {
    composer,
    lensing,
    lensingUpdate(cam: THREE.PerspectiveCamera, width: number, height: number, shadowR: number): void {
      lastShadowR = shadowR;
      lensing.update(cam, width, height, shadowR);
    },
    setSize(width: number, height: number): void {
      composer.setSize(width, height);
      bloom.setSize(width, height);
      lensing.update(camera, width, height, lastShadowR);
    },
  };
}
