import * as THREE from 'three';
import { MAX_DT } from './config';
import { createScene } from './scene';

const canvas = document.getElementById('app') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);

const { scene, camera } = createScene();
scene.background = new THREE.Color(0x05060b);

const debugEl = document.getElementById('debug') as HTMLDivElement;
const debug = new URLSearchParams(location.search).has('debug');
if (debug) debugEl.style.display = 'block';
let frames = 0;
let fpsWindowStart = performance.now();

function onResize(): void {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', onResize);

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(MAX_DT, (now - last) / 1000) || 1 / 60;
  last = now;
  void dt;
  renderer.render(scene, camera);
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
