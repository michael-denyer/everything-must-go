import * as THREE from 'three';
import { CAM_POS, DISK_THICKNESS, GM, MAX_DT, SHADOW_R, TEX_SIZE } from './config';
import { createScene } from './scene';
import { generateCosmos, type CosmosSpec } from './core/cosmosGen';
import { evalCycle } from './core/cycle';
import { generatePalette, paletteRgb } from './core/palette';
import { GpuSim } from './sim/gpuSim';
import { createDiskPoints } from './render/diskPoints';
import { createStarfield } from './render/starfield';
import { createPostChain } from './render/postChain';
import { createDebrisPool } from './render/debris';
import { createBelt } from './render/belt';
import { createPlanet, type PlanetBody } from './render/planet';
import { createComet, type CometBody } from './render/comet';

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
let debris: ReturnType<typeof createDebrisPool>;
let belt: ReturnType<typeof createBelt>;
let bodies: Array<PlanetBody | CometBody> = [];
// PlanetBody/CometBody share an identical structural shape (object/update/alive/
// dispose) with no runtime discriminant field, so __emg's per-kind alive counts
// need a side channel — set once per cosmos from the construction site below,
// read (never mutated) when the frame loop tallies alive bodies each frame.
let cometSet: Set<PlanetBody | CometBody> = new Set();
let cycleT = 0;
let flashDecay = 0;

const disposables: Array<{ object: THREE.Object3D; dispose(): void }> = [];

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
    scene.remove(d.object);
    d.dispose();
  }
  disposables.length = 0;
  disk = createDiskPoints(TEX_SIZE);
  stars = createStarfield(spec.starCount, spec.starShell, spec.starSeed);
  scene.add(stars.points);
  scene.add(disk.points);
  disposables.push(
    { object: disk.points, dispose: () => { disk.points.geometry.dispose(); (disk.points.material as THREE.Material).dispose(); } },
    { object: stars.points, dispose: () => { stars.points.geometry.dispose(); (stars.points.material as THREE.Material).dispose(); } },
  );

  const palette = generatePalette(spec.paletteSeed);
  debris = createDebrisPool();
  belt = createBelt({
    count: spec.beltCount,
    inner: spec.beltInner,
    rgb: paletteRgb(palette, spec.beltHueIdx, 0.5, 0.55),
    seed: spec.seed + 7,
  });
  scene.add(debris.points);
  scene.add(belt.points);
  disposables.push(
    { object: debris.points, dispose: () => debris.dispose() },
    { object: belt.points, dispose: () => belt.dispose() },
  );

  const planetBodies = spec.planets.map((ps) => createPlanet(ps, palette, GM));
  const cometBodies = spec.comets.map((cs) => createComet(cs, GM));
  bodies = [...planetBodies, ...cometBodies];
  cometSet = new Set(cometBodies);
  for (const b of bodies) {
    scene.add(b.object);
    disposables.push({ object: b.object, dispose: () => b.dispose() });
  }
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
  if (!Number.isFinite(tFreeze) && cycleT >= spec.cycleSeconds) {
    flashDecay = 1;
    seedCosmos(spec.seed + 1);
  }
  const effT = Number.isFinite(tFreeze)
    ? Math.min(Math.max(tFreeze, 0), 1) * spec.cycleSeconds
    : cycleT;
  const p = evalCycle(spec, effT);

  // Contract with gpuSim.ts SIM_COMMON respawn margins: effective cull radius here
  // is holeR*1.143 (1.27 * 0.9 needsRespawn threshold); cosmosGen keeps diskInner0
  // >= 1.2*holeR0, above that cull at cycle start, so freshly seeded particles survive.
  const innerR = Math.max(spec.diskInner0, p.holeR * 1.27);
  sim.setParams({ gm: p.gm, innerR, outerR: spec.diskOuter0, drag: p.drag, respawnOn: p.diskRespawn });
  sim.step(dt);
  disk.update(sim);
  disk.setParams({ heatInner: innerR, heatOuter: spec.diskOuter0, fade: p.fade });
  stars.setParams({ plunge: p.starPlunge, fade: p.fade });

  for (const b of bodies) {
    if (!b.alive) continue;
    b.update(dt, p.gm, p.drag, p.holeR, debris.spawn);
  }
  bodies = bodies.filter((b) => {
    if (b.alive) return true;
    scene.remove(b.object);
    b.dispose();
    return false;
  });
  belt.setParams({ progress: p.progress, time: cycleT });
  debris.update(dt, p.gm, p.drag * 2, p.holeR);

  camera.position.set(CAM_POS[0] * p.camDist, CAM_POS[1] * p.camDist, CAM_POS[2] * p.camDist);
  camera.lookAt(0, 0, 0);

  flashDecay = Math.max(0, flashDecay - dt * 0.8);
  post.lensingUpdate(camera, innerWidth, innerHeight, p.holeR);
  post.setFlash(Math.max(p.flash, flashDecay));
  // Bloom retires with the cosmos — in darkness nothing should glow. This
  // closes the scalar-threshold inversion between the ring halo (needs a low
  // threshold early) and the darkness gate (needs bloom silent late): the
  // drained disk's additive overdraw still sums to 4-8 HDR units at t=0.95
  // when lensed around the shadow edge, above the ring emissive's own 2.4.
  post.setCycleFade(p.fade);
  // Squared: ACES compression keeps linearly-faded HDR emissive visually bright
  // (linear measured 11.2/255 at t=0.95 vs the <8 darkness gate; squared 7.39).
  // Exponent 2 is an empirical fit against the ACES output, not a derived inverse.
  post.lensing.setFade(p.fade * p.fade);
  post.composer.render();

  counterEl.textContent = `cosmos no. ${cosmosNo} · ${Math.round(p.progress * 100)}% consumed`;
  let aliveComets = 0;
  for (const b of bodies) if (cometSet.has(b)) aliveComets++;
  const aliveCounts = { planets: bodies.length - aliveComets, comets: aliveComets };
  (window as unknown as { __emg: object }).__emg = { spec, params: p, alive: aliveCounts };

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
