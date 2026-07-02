import * as THREE from 'three';
import { CAM_POS, DISK_THICKNESS, GM, MAX_DT, SHADOW_R, TEX_SIZE, WELL_STRENGTH } from './config';
import { createScene } from './scene';
import { generateCosmos, type CosmosSpec } from './core/cosmosGen';
import { evalCycle } from './core/cycle';
import { generatePalette, paletteRgb } from './core/palette';
import { GpuSim } from './sim/gpuSim';
import { mulberry32 } from './sim/random';
import { createDiskPoints } from './render/diskPoints';
import { createStarfield } from './render/starfield';
import { createPostChain } from './render/postChain';
import { createDebrisPool } from './render/debris';
import { createBelt } from './render/belt';
import { createPlanet, type PlanetBody } from './render/planet';
import { createComet, type CometBody } from './render/comet';
import { createCast, setCastCamera, type CastBody } from './render/cast';
import { createTitleEater } from './ui/titleEater';
import castManifest from './assets/cast/manifest.json';
import whaleUrl from './assets/cast/whale.png';
import pianoUrl from './assets/cast/piano.png';
import trexUrl from './assets/cast/trex.png';
import teacupUrl from './assets/cast/teacup.png';
import bicycleUrl from './assets/cast/bicycle.png';
import duckUrl from './assets/cast/duck.png';

const CAST_URLS: Record<string, string> = {
  whale: whaleUrl,
  piano: pianoUrl,
  trex: trexUrl,
  teacup: teacupUrl,
  bicycle: bicycleUrl,
  duck: duckUrl,
};

const ROGUE_SPAWN_R = 1.7;
// Rogue orbital rate: an angular-velocity constant (radians per cycle-progress
// unit) applied uniformly across the spawn->merge window. Deterministic from
// (spec, p) alone — no integration, per contract.
const ROGUE_ANGULAR_RATE = 14;
const WELL_IDLE_SECONDS = 1.5; // decay-to-off window after the last pointer move

const canvas = document.getElementById('app') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);

const { scene, camera } = createScene();
scene.background = new THREE.Color(0x05060b);
setCastCamera(camera);

const q = new URLSearchParams(location.search);
const debug = q.has('debug');
const seedParam = Number.parseInt(q.get('seed') ?? '1', 10);
const cycleOverride = Number.parseFloat(q.get('cycle') ?? '');
const tFreeze = Number.parseFloat(q.get('t') ?? '');

const debugEl = document.getElementById('debug') as HTMLDivElement;
const counterEl = document.getElementById('counter') as HTMLDivElement;
const titleLineEl = document.getElementById('title-line') as HTMLSpanElement;
if (debug) debugEl.style.display = 'block';

let cosmosNo = 0;
let spec: CosmosSpec;
let sim: GpuSim;
let disk: ReturnType<typeof createDiskPoints>;
let stars: ReturnType<typeof createStarfield>;
let debris: ReturnType<typeof createDebrisPool>;
let belt: ReturnType<typeof createBelt>;
let bodies: Array<PlanetBody | CometBody | CastBody> = [];
let cycleT = 0;
let flashDecay = 0;
let latestPhase: string = 'serene'; // set once per frame; pointerdown reads this rather than recomputing off raw cycleT (which ignores the t= freeze)

// ---- Cast feeding state: reset per cosmos in seedCosmos(). ----------------
let castOrder: Array<{ name: string; url: string; aspect: number }> = [];
let castNextIdx = 0;
let castOrdinalSeed = 0;
let castFeedRand: () => number = mulberry32(1);
let castAutoAccum = 0; // cycle-time seconds since the last auto-feed

// ---- Rogue visual state: lazily created, disposed on merge/reseed. --------
let rogueVisual: { group: THREE.Group; dispose(): void } | null = null;
let rogueX = 0;
let rogueZ = 0;
let rogueRadius = 0;

// ---- Pointer well state. ----------------------------------------------
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const pointerNdc = new THREE.Vector2();
let wellActive = false;
let wellX = 0;
let wellZ = 0;
let wellIdleTimer = 0; // seconds since the last pointer move

const disposables: Array<{ object: THREE.Object3D; dispose(): void }> = [];

let titleEater: ReturnType<typeof createTitleEater> | null = null;

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
  // Captured into function-local consts so each closure below is bound to
  // *this* cosmos's instance, not whatever the module-level `let` holds when
  // the sweep eventually runs. Bodies already do this via their loop-local
  // `b` (see the disposables.push in the loop further down) — this removes
  // the same ordering dependency from disk/stars/debris/belt, which used to
  // be correct only because the sweep always ran before reassignment.
  const dp = createDiskPoints(TEX_SIZE);
  disk = dp;
  const st = createStarfield(spec.starCount, spec.starShell, spec.starSeed);
  stars = st;
  scene.add(st.points);
  scene.add(dp.points);
  disposables.push(
    { object: dp.points, dispose: () => { dp.points.geometry.dispose(); (dp.points.material as THREE.Material).dispose(); } },
    { object: st.points, dispose: () => { st.points.geometry.dispose(); (st.points.material as THREE.Material).dispose(); } },
  );

  const palette = generatePalette(spec.paletteSeed);
  const de = createDebrisPool();
  debris = de;
  const bl = createBelt({
    count: spec.beltCount,
    inner: spec.beltInner,
    rgb: paletteRgb(palette, spec.beltHueIdx, 0.5, 0.55),
    seed: spec.seed + 7,
  });
  belt = bl;
  scene.add(de.points);
  scene.add(bl.points);
  disposables.push(
    { object: de.points, dispose: () => de.dispose() },
    { object: bl.points, dispose: () => bl.dispose() },
  );

  const planetBodies = spec.planets.map((ps) => createPlanet(ps, palette, GM));
  const cometBodies = spec.comets.map((cs, i) => createComet(cs, GM, spec.cometSeeds[i]!));
  bodies = [...planetBodies, ...cometBodies];
  for (const b of bodies) {
    scene.add(b.object);
    disposables.push({ object: b.object, dispose: () => b.dispose() });
  }

  // Cast manifest order shuffled by mulberry32(spec.castSeed) — a Fisher-Yates
  // shuffle driven by the seeded stream, so the roster order is deterministic
  // per cosmos and independent of the feed-angle stream below.
  const shuffleRand = mulberry32(spec.castSeed);
  const manifest = castManifest as Array<{ name: string; file: string; aspect: number }>;
  castOrder = manifest.map((m) => ({ name: m.name, url: CAST_URLS[m.name]!, aspect: m.aspect }));
  for (let i = castOrder.length - 1; i > 0; i--) {
    const j = Math.floor(shuffleRand() * (i + 1));
    [castOrder[i], castOrder[j]] = [castOrder[j]!, castOrder[i]!];
  }
  castNextIdx = 0;
  castOrdinalSeed = spec.castSeed;
  // Entry-angle stream: seeded separately (offset from castSeed) so the feed
  // angle sequence doesn't consume from the same stream as the shuffle above.
  castFeedRand = mulberry32((spec.castSeed ^ 0x51ed270b) >>> 0);
  castAutoAccum = 0;

  if (rogueVisual) {
    scene.remove(rogueVisual.group);
    rogueVisual.dispose();
    rogueVisual = null;
  }
  rogueX = 0;
  rogueZ = 0;
  rogueRadius = 0;

  if (!titleEater) {
    titleEater = createTitleEater(titleLineEl, [0.125, 0.208], spec.castSeed ^ 0x9e3779b9);
  } else {
    titleEater.reset();
  }
}

function spawnCastMember(entryAngle: number): void {
  if (castOrder.length === 0) return;
  const pick = castOrder[castNextIdx % castOrder.length]!;
  castNextIdx++;
  const ordinal = (castOrdinalSeed + castNextIdx * 0x1000193) >>> 0;
  const cast = createCast(pick.name, pick.url, pick.aspect, entryAngle, GM, ordinal);
  // Render-order fix: diskPoints.ts's material runs depthTest:false, so its
  // particles paint over anything in the same (default 0) render-order bucket
  // regardless of actual depth once THREE's transparent-object sort places the
  // disk after the cast mesh. debris/comet/belt already dodge this at
  // renderOrder 1 (see debris.ts, comet.ts, belt.ts) — cast's silhouette needs
  // the same treatment or it renders invisible against the disk (verified via
  // pixel sampling: no darkening signature at the cast body's projected screen
  // position without this).
  for (const child of cast.object.children) child.renderOrder = 1;
  bodies.push(cast);
  scene.add(cast.object);
  disposables.push({ object: cast.object, dispose: () => cast.dispose() });
}

function countCastAlive(): number {
  let n = 0;
  for (const b of bodies) if (b.kind === 'cast') n++;
  return n;
}

function canFeed(phase: string): boolean {
  return (phase === 'decay' || phase === 'carnage') && countCastAlive() < 2;
}

// ---- Rogue visual: small black circle mesh + thin ring sprite. ------------
function createRogueVisual(): { group: THREE.Group; dispose(): void } {
  const group = new THREE.Group();
  const circleGeo = new THREE.CircleGeometry(1.6, 32);
  const circleMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const circle = new THREE.Mesh(circleGeo, circleMat);
  circle.rotation.x = -Math.PI / 2;
  group.add(circle);

  const ringGeo = new THREE.RingGeometry(1.15, 1.45, 48);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xf5f7ff,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  group.add(ring);

  return {
    group,
    dispose(): void {
      circleGeo.dispose();
      circleMat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
    },
  };
}

function updatePointer(clientX: number, clientY: number): number | null {
  pointerNdc.x = (clientX / innerWidth) * 2 - 1;
  pointerNdc.y = -(clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointerNdc, camera);
  const hit = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(groundPlane, hit)) return null;
  wellX = hit.x;
  wellZ = hit.z;
  wellActive = true;
  wellIdleTimer = 0;
  return Math.atan2(hit.z, hit.x);
}

function isUiElement(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest('a, button, #debug, #counter') !== null;
}

function onPointerMove(e: PointerEvent): void {
  updatePointer(e.clientX, e.clientY);
}

function onPointerDown(e: PointerEvent): void {
  if (isUiElement(e.target)) return;
  const angle = updatePointer(e.clientX, e.clientY);
  if (angle === null) return;
  if (canFeed(latestPhase)) {
    spawnCastMember(angle);
  }
}

addEventListener('pointermove', onPointerMove);
addEventListener('pointerdown', onPointerDown);

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
  latestPhase = p.phase;

  // Pointer well: decays to off WELL_IDLE_SECONDS after the last move.
  if (wellActive) {
    wellIdleTimer += dt;
    if (wellIdleTimer >= WELL_IDLE_SECONDS) wellActive = false;
  }
  const wellStrength = wellActive ? WELL_STRENGTH : 0;
  sim.setWell(wellX, 0, wellZ, wellStrength);

  // Feeding: auto-feed accumulator, gated by phase + cast-alive same as the
  // pointerdown path.
  if (canFeed(p.phase)) {
    castAutoAccum += dt;
    if (castAutoAccum >= spec.castCadence) {
      castAutoAccum = 0;
      const angle = castFeedRand() * Math.PI * 2;
      spawnCastMember(angle);
    }
  } else {
    castAutoAccum = 0;
  }

  // Rogue visual: deterministic inward drift from spawn radius to the hole,
  // arriving at merge time. No integration — position is a pure function of
  // (spec, p.progress).
  if (p.rogueActive) {
    if (!rogueVisual) {
      rogueVisual = createRogueVisual();
      scene.add(rogueVisual.group);
    }
    // Deterministic inward drift, no integration: radius interpolates spawn
    // (1.7) -> holeR by normalized progress through the [spawnP, mergeP]
    // window; angle advances at a fixed local rate over that same window.
    const { spawnP, mergeP } = spec.rogue;
    const t = (p.progress - spawnP) / (mergeP - spawnP);
    const radius = ROGUE_SPAWN_R + (p.holeR - ROGUE_SPAWN_R) * t;
    const angle = (spawnP + t * (mergeP - spawnP)) * ROGUE_ANGULAR_RATE * Math.PI * 2;
    rogueX = radius * Math.cos(angle);
    rogueZ = radius * Math.sin(angle);
    rogueRadius = 0.45 * p.holeR;
    rogueVisual.group.position.set(rogueX, 0, rogueZ);
    rogueVisual.group.scale.setScalar(Math.max(0.04, rogueRadius));
    sim.setRogue(rogueX, 0, rogueZ, rogueRadius);
  } else {
    rogueRadius = 0;
    sim.setRogue(0, 0, 0, 0);
    if (p.rogueMerged && rogueVisual) {
      flashDecay = Math.max(flashDecay, 0.5);
      scene.remove(rogueVisual.group);
      rogueVisual.dispose();
      rogueVisual = null;
    }
  }

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
    // Pruned bodies stay in `disposables` (pushed at construction, swept only
    // on the next seedCosmos()) so dispose() runs again there. Safe only
    // because dispose() is idempotent by design — guards live in planet.ts
    // and comet.ts.
    b.dispose();
    return false;
  });
  belt.setParams({ progress: p.progress, time: cycleT });
  debris.update(
    dt,
    p.gm,
    p.drag * 2,
    p.holeR,
    { x: wellX, y: 0, z: wellZ, strength: wellStrength },
    { x: rogueX, y: 0, z: rogueZ, radius: rogueRadius },
  );

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

  titleEater?.update(dt / spec.cycleSeconds, post.holeScreen());

  counterEl.textContent = `cosmos no. ${cosmosNo} · ${Math.round(p.progress * 100)}% consumed`;
  let alivePlanets = 0;
  let aliveComets = 0;
  let aliveCast = 0;
  for (const b of bodies) {
    if (b.kind === 'planet') alivePlanets++;
    else if (b.kind === 'comet') aliveComets++;
    else if (b.kind === 'cast') aliveCast++;
  }
  const aliveCounts = { planets: alivePlanets, comets: aliveComets, cast: aliveCast };
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
