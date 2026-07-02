import * as THREE from 'three';
import {
  DISK_INNER,
  DISK_OUTER,
  DISK_THICKNESS,
  GM,
  MAX_DT,
  SEED,
  SHADOW_R,
  STAR_COUNT,
  STAR_SHELL,
  TEX_SIZE,
} from './config';
import { createDiskPoints } from './render/diskPoints';
import { createPostChain } from './render/postChain';
import { createStarfield } from './render/starfield';
import { createScene } from './scene';
import { GpuSim } from './sim/gpuSim';

const canvas = document.getElementById('app') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);

const { scene, camera } = createScene();
scene.background = new THREE.Color(0x05060b);

const sim = new GpuSim(renderer, {
  texSize: TEX_SIZE,
  innerR: DISK_INNER,
  outerR: DISK_OUTER,
  gm: GM,
  thickness: DISK_THICKNESS,
  seed: SEED,
});

const disk = createDiskPoints(TEX_SIZE);
scene.add(disk.points);
const starfield = createStarfield(STAR_COUNT, [...STAR_SHELL], SEED + 1);
scene.add(starfield.points);

const post = createPostChain(renderer, scene, camera);
post.lensingUpdate(camera, innerWidth, innerHeight, SHADOW_R);

const debugEl = document.getElementById('debug') as HTMLDivElement;
const debug = new URLSearchParams(location.search).has('debug');
if (debug) debugEl.style.display = 'block';
let frames = 0;
let fpsWindowStart = performance.now();
let probed = false;

function onResize(): void {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  post.setSize(innerWidth, innerHeight);
}
addEventListener('resize', onResize);

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(MAX_DT, (now - last) / 1000) || 1 / 60;
  last = now;
  sim.step(dt);
  disk.update(sim);
  if (debug && !probed) {
    probed = true;
    const probe = sim.debugSampleRadii();
    console.log(
      `sim ok: finite=${probe.finite} r=[${probe.min.toFixed(2)}, ${probe.max.toFixed(2)}]`,
    );
  }
  post.lensingUpdate(camera, innerWidth, innerHeight, SHADOW_R);
  post.composer.render();
  if (debug) {
    frames++;
    if (now - fpsWindowStart >= 1000) {
      debugEl.textContent = `${frames} fps`;
      frames = 0;
      fpsWindowStart = now;
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
