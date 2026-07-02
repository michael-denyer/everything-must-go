// src/render/postChain.ts
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { BLOOM_RADIUS, BLOOM_STRENGTH, BLOOM_THRESHOLD } from '../config';
import { createLensingPass } from './lensing';

export function createPostChain(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
): {
  composer: EffectComposer;
  lensing: ReturnType<typeof createLensingPass>;
  setSize(width: number, height: number): void;
} {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const lensing = createLensingPass();
  composer.addPass(lensing.pass);

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(innerWidth, innerHeight),
    BLOOM_STRENGTH,
    BLOOM_RADIUS,
    BLOOM_THRESHOLD,
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  return {
    composer,
    lensing,
    setSize(width: number, height: number): void {
      composer.setSize(width, height);
      bloom.setSize(width, height);
      lensing.update(camera, width, height);
    },
  };
}
