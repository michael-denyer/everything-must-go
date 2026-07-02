import * as THREE from 'three';
import { CAM_POS, DISK_THICKNESS, GM, MAX_DT, SHADOW_R, TEX_SIZE } from './config';
import { createScene } from './scene';
import { generateCosmos, type CosmosSpec } from './core/cosmosGen';
import { evalCycle } from './core/cycle';
import { GpuSim } from './sim/gpuSim';
import { createDiskPoints } from './render/diskPoints';
import { createStarfield } from './render/starfield';
import { createPostChain } from './render/postChain';

const canvas = document.getElementById('app') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);

const { scene, camera } = createScene();
scene.background = new THREE.Color(0x05060b);

const q = new URLSearchParams(location.search);
const debug = q.has('debug');
const seedParam = Number.parseInt(q.get('seed') ?? '1', 10);
const cycleOverride = Number.parseFloat(q.get('cycle') ?? '');
const tFreeze = Number.parseFloat(q.get('t') ?? '');

const debugEl = document.getElementById('debug') as HTMLDivElement;
const counterEl = document.getElementById('counter') as HTMLDivElement;
if (debug) debugEl.style.display = 'block';

let cosmosNo = 0;
let spec: CosmosSpec;
let sim: GpuSim;
let disk: ReturnType<typeof createDiskPoints>;
let stars: ReturnType<typeof createStarfield>;
let cycleT = 0;
let flashDecay = 0;

const disposables: Array<{ points: THREE.Points }> = [];

function seedCosmos(seed: number): void {
  cosmosNo++;
  spec = generateCosmos(seed);
  if (Number.isFinite(cycleOverride) && cycleOverride > 0) spec.cycleSeconds = cycleOverride;
  cycleT = 0;
  if (sim) sim.dispose();
  sim = new GpuSim(renderer, {
    texSize: TEX_SIZE,
    innerR: spec.diskInner0,
    outerR: spec.diskOuter0,
    gm: GM,
    thickness: DISK_THICKNESS,
    seed: spec.diskSeed,
  });
  for (const d of disposables) {
    scene.remove(d.points);
    d.points.geometry.dispose();
    (d.points.material as THREE.Material).dispose();
  }
  disposables.length = 0;
  disk = createDiskPoints(TEX_SIZE);
  stars = createStarfield(spec.starCount, spec.starShell, spec.starSeed);
  scene.add(stars.points);
  scene.add(disk.points);
  disposables.push({ points: disk.points }, { points: stars.points });
}

seedCosmos(Number.isFinite(seedParam) ? seedParam : 1);
const post = createPostChain(renderer, scene, camera);
post.lensingUpdate(camera, innerWidth, innerHeight, SHADOW_R);

function onResize(): void {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  post.setSize(innerWidth, innerHeight);
}
addEventListener('resize', onResize);

let last = performance.now();
let frames = 0;
let fpsWindowStart = performance.now();

function frame(now: number): void {
  const dt = Math.min(MAX_DT, (now - last) / 1000) || 1 / 60;
  last = now;

  cycleT += dt;
  const effT = Number.isFinite(tFreeze)
    ? Math.min(Math.max(tFreeze, 0), 1) * spec.cycleSeconds
    : cycleT;
  const p = evalCycle(spec, effT);

  if (!Number.isFinite(tFreeze) && cycleT >= spec.cycleSeconds) {
    flashDecay = 1;
    seedCosmos(spec.seed + 1);
  }

  const innerR = Math.max(spec.diskInner0, p.holeR * 1.27);
  sim.setParams({ gm: p.gm, innerR, outerR: spec.diskOuter0, drag: p.drag, respawnOn: p.diskRespawn });
  sim.step(dt);
  disk.update(sim);
  disk.setParams({ heatInner: innerR, heatOuter: spec.diskOuter0, fade: p.fade });
  stars.setParams({ plunge: p.starPlunge, fade: p.fade });

  camera.position.set(CAM_POS[0] * p.camDist, CAM_POS[1] * p.camDist, CAM_POS[2] * p.camDist);
  camera.lookAt(0, 0, 0);

  flashDecay = Math.max(0, flashDecay - dt * 0.8);
  post.lensingUpdate(camera, innerWidth, innerHeight, p.holeR);
  post.lensing.setFlash(Math.max(p.flash, flashDecay));
  post.lensing.setFade(p.fade);
  post.composer.render();

  counterEl.textContent = `cosmos no. ${cosmosNo} · ${Math.round(p.progress * 100)}% consumed`;
  (window as unknown as { __emg: object }).__emg = { spec, params: p };

  if (debug) {
    frames++;
    if (now - fpsWindowStart >= 1000) {
      debugEl.textContent = `${frames} fps · ${p.phase}`;
      frames = 0;
      fpsWindowStart = now;
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
