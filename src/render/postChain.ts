// src/render/postChain.ts
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { BLOOM_RADIUS, BLOOM_STRENGTH, BLOOM_THRESHOLD, EXPOSURE, KERR_SPIN, SHADOW_R } from '../config';
import { createLensingPass } from './lensing';
import { createShadowRecarve } from './shadowRecarve';
import { projectHole, uvToPixels } from './projectHole';

export function createPostChain(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  quality: { lensing: boolean; bloomStrengthScale: number },
): {
  composer: EffectComposer;
  lensing: ReturnType<typeof createLensingPass>;
  lensingUpdate(camera: THREE.PerspectiveCamera, width: number, height: number, shadowR: number): void;
  setFlash(f: number): void;
  setCycleFade(f: number): void;
  setSize(width: number, height: number): void;
  holeScreen(): [number, number];
  dispose(): void;
} {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = EXPOSURE;

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  // quality.lensing=false keeps this pass (it also paints the fold bands +
  // photon ring and feeds recarve alignment) but drops the ray-bend inside it.
  const lensing = createLensingPass(quality.lensing);
  composer.addPass(lensing.pass);

  // Bloom now runs AFTER lensing (reverses the M2 order): the lensed photon
  // ring and fold bands can bloom outward into a halo. This reopens the M1
  // problem (bloom's wide coarse-mip kernels refill the shadow interior from
  // the bright ring at any strength) — the fix is the recarve pass below,
  // which is the final multiply against the shadow radius and restores a
  // pitch-black horizon by construction regardless of bloom strength.
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(innerWidth, innerHeight),
    BLOOM_STRENGTH * quality.bloomStrengthScale,
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
    // Kerr fake: a spinning hole's shadow sits off-center, displaced toward
    // the APPROACHING, Doppler-brightened side of the disk — the lensing pass
    // brightens screen-left (-dir.x), so the shift is negative x. (Real Kerr
    // images, e.g. Chael/Johnson/Lupsasca 2021, put the shadow displacement on
    // the same side as the bright crescent, shadow crowding the bright arc with
    // the wider dark gap on the receding side.) Applied HERE, once, so the
    // lensing and recarve masks shift together and stay aligned — shifting one
    // shader but not the other would leave a visible crescent of un-carved
    // bloom. The x shift is in UV units, so the aspect-corrected distance the
    // shaders use comes out as KERR_SPIN·0.12 shadow radii.
    const shifted: [number, number] = [
      centerUv[0] - (KERR_SPIN * 0.12 * radiusUv) / aspect,
      centerUv[1],
    ];
    lensing.update(shifted, radiusUv, aspect);
    recarve.update(shifted, radiusUv, aspect);
    lastCenterUv = shifted;
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
    dispose(): void {
      // EffectComposer.dispose() only covers its own render targets + copy
      // pass; the added passes are ours to release (Pass's base dispose is a
      // no-op, so RenderPass is safe to include in the sweep).
      for (const pass of composer.passes) pass.dispose();
      // r172 UnrealBloomPass.dispose() skips materialHighPassFilter (created
      // in its constructor but missing from its dispose sweep) — release it
      // here or every rebuild leaks one ShaderMaterial.
      bloom.materialHighPassFilter.dispose();
      composer.dispose();
    },
    holeScreen(): [number, number] {
      // Convention boundary: centerUv comes from projectHole() as NDC-derived
      // (bottom-up, y=0 at the bottom) — correct as-is for the lensing/recarve
      // shaders, which share that convention. DOM pixel space is top-down
      // (y=0 at the top), so this getter is the one place that must flip y
      // before handing the coordinate to CSS/DOM consumers (e.g. titleEater).
      return uvToPixels(lastCenterUv, lastWidth, lastHeight);
    },
  };
}
