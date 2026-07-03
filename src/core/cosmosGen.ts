import { CYCLE_SECONDS } from '../config';
import { mulberry32 } from '../sim/random';
import { BURST } from './tidal';

// dist/size/speed are raw [0,1) rolls — scaled into world units downstream by render/planet.ts.
export interface MoonSpec {
  dist: number;
  size: number;
  speed: number;
  phase: number;
}

export interface PlanetSpec {
  orbitR: number;
  size: number;
  kind: 'giant' | 'rocky' | 'ice';
  ringed: boolean;
  moons: MoonSpec[];
  hueIdx: number;
  phase: number;
  texSeed: number;
}

export interface NebulaSpec {
  x: number;
  z: number;
  y: number;
  scale: number;
  hueA: number;
  hueB: number;
  seed: number;
}

export interface GalaxySpec {
  orbitR: number;
  size: number;
  hueIdx: number;
  phase: number;
  seed: number;
}

export interface ClusterSpec {
  orbitR: number;
  size: number;
  pointCount: number;
  phase: number;
  seed: number;
}

export interface PulsarSpec {
  present: boolean;
  orbitR: number;
  phase: number;
}

export interface CosmosSpec {
  seed: number;
  cycleSeconds: number;
  holeR0: number;
  holeGrowth: number;
  diskInner0: number;
  diskOuter0: number;
  starCount: number;
  starShell: [number, number];
  diskSeed: number;
  starSeed: number;
  paletteSeed: number;
  planets: PlanetSpec[];
  beltCount: number;
  beltInner: number;
  beltHueIdx: number;
  comets: Array<{ aphelion: number; perihelion: number; phase: number }>;
  rogue: { present: boolean; spawnP: number; mergeP: number };
  castSeed: number;
  castCadence: number;
  cometSeeds: number[];
  nebulae: NebulaSpec[];
  galaxies: GalaxySpec[];
  decorGalaxyCount: number;
  clusters: ClusterSpec[];
  pulsar: PulsarSpec;
  bandAngle: number;
  skySeed: number;
  shootingStarSeed: number;
}

export function generateCosmos(seed: number): CosmosSpec {
  const rand = mulberry32(seed);
  const lerp = (a: number, b: number): number => a + (b - a) * rand();
  const holeR0 = lerp(0.19, 0.25);
  const shellMin = lerp(5, 8);
  // starShell's upper bound is shellMin + lerp(5,8): both terms draw from [5,8),
  // so the supremum 16 is approached but never reached — the test cap of 16 is
  // exact, not slack. Change either lerp range and the cap must move with it.
  const cycleSeconds = Math.round(CYCLE_SECONDS * lerp(0.9, 1.1));
  const holeGrowth = lerp(2.6, 3.4);
  const diskInner0 = Math.max(holeR0 * 1.2, lerp(0.26, 0.32));
  const diskOuter0 = lerp(1.7, 2.1);
  const starCount = Math.round(lerp(3200, 4800));
  const starShell: [number, number] = [shellMin, shellMin + lerp(5, 8)];
  const diskSeed = Math.floor(rand() * 2 ** 31);
  const starSeed = Math.floor(rand() * 2 ** 31);

  // --- Everything below this line is appended after starSeed. No existing
  // draw above may be reordered, skipped, or made conditional: the roster
  // extension only ever reads further from the same mulberry32 stream. ---

  const paletteSeed = Math.floor(rand() * 2 ** 31);

  // Planets: count first, then a fixed 7-draw sequence per planet
  // (orbitR, size, kind, ringed-candidate, phase, texSeed, hueIdx) so the
  // per-planet draw count never depends on what was rolled for that planet.
  const planetCount = 7 + Math.floor(rand() * 4); // 7-10
  const ringCandidates: number[] = [];
  const planets: PlanetSpec[] = [];
  for (let i = 0; i < planetCount; i++) {
    const orbitR = 0.55 + rand() * (1.9 - 0.55);
    const sizeRoll = rand();
    const kindRoll = rand();
    const kind: PlanetSpec['kind'] = kindRoll < 1 / 3 ? 'giant' : kindRoll < 2 / 3 ? 'rocky' : 'ice';
    const ringCandidate = rand();
    const phase = rand() * Math.PI * 2;
    const texSeed = Math.floor(rand() * 2 ** 31);
    const hueIdx = Math.floor(rand() * 1000);
    // Giants draw sizes from the upper half of the range, rocky/ice from the
    // lower half — a bucketing of sizeRoll, not an extra draw.
    const size =
      kind === 'giant'
        ? 0.0335 + sizeRoll * (0.055 - 0.0335)
        : 0.012 + sizeRoll * (0.0335 - 0.012);
    ringCandidates.push(ringCandidate);
    // Floor: a post-draw VALUE transform only — no draw added, removed, or
    // conditioned. Keeps every planet clear of the burst radius (holeR0 *
    // BURST) with margin, so a planet can never spawn already inside the
    // eventual burst shell. Pre-launch: existing seeds' orbitR values may
    // shift where this floor binds; the seed-42 PINNED test above covers
    // only M2 fields and is unaffected.
    const flooredOrbitR = Math.max(orbitR, holeR0 * BURST * 1.35);
    planets.push({ orbitR: flooredOrbitR, size, kind, ringed: false, moons: [], hueIdx, phase, texSeed });
  }

  // Ring assignment: one more draw for the ring count, then a pure sort
  // (giants first, then by the ringCandidate already drawn per-planet above)
  // — no additional RNG draws are spent choosing who gets rings.
  const ringCount = 2 + (rand() < 0.5 ? 0 : 1); // 2-3
  const ringOrder = planets
    .map((p, idx) => idx)
    .sort((a, b) => {
      const giantDiff = (planets[b]!.kind === 'giant' ? 1 : 0) - (planets[a]!.kind === 'giant' ? 1 : 0);
      if (giantDiff !== 0) return giantDiff;
      return ringCandidates[b]! - ringCandidates[a]!;
    });
  for (let i = 0; i < ringCount; i++) {
    planets[ringOrder[i]!]!.ringed = true;
  }

  // Moons: total drawn once (0-4), then distributed one at a time — each
  // moon draws its target planet plus its four fields, so the number of
  // draws is fixed by moonTotal and never branches within a moon.
  const moonTotal = Math.min(4, Math.floor(rand() * 5)); // 0-4
  for (let i = 0; i < moonTotal; i++) {
    const target = Math.floor(rand() * planetCount);
    const dist = rand();
    const size = rand();
    const speed = rand();
    const phase = rand() * Math.PI * 2;
    planets[target]!.moons.push({ dist, size, speed, phase });
  }

  const beltCount = Math.round(600 + rand() * 300); // 600-900
  const beltInner = 0.78 + rand() * 0.06; // 0.78-0.84
  const beltHueIdx = Math.floor(rand() * 1000);

  // Comets: count first, then a fixed 3-draw sequence per comet
  // (perihelion, aphelion, phase) so the per-comet draw count is fixed too.
  const cometCount = 4 + Math.floor(rand() * 3); // 4-6
  const comets: Array<{ aphelion: number; perihelion: number; phase: number }> = [];
  for (let i = 0; i < cometCount; i++) {
    const perihelion = 0.2 + rand() * 0.3; // 0.2-0.5
    const aphelion = perihelion + 0.1 + rand() * (2.4 - (perihelion + 0.1)); // > perihelion, <= 2.4
    const phase = rand() * Math.PI * 2;
    comets.push({ aphelion, perihelion, phase });
  }

  // --- Milestone 4 additions: appended strictly after the comet loop above.
  // rogue present/spawnP/mergeP are drawn unconditionally — even when
  // present is false, spawnP and mergeP are still rolled and stored, so the
  // per-cosmos draw count never branches on the presence roll. ---
  const roguePresent = rand() < 0.25;
  const rogueSpawnP = 0.45 + rand() * (0.55 - 0.45);
  const rogueMergeP = 0.62 + rand() * (0.75 - 0.62);
  const castSeed = Math.floor(rand() * 2 ** 31);
  const castCadence = 45 + rand() * (75 - 45);
  const cometSeeds: number[] = [];
  for (let i = 0; i < cometCount; i++) {
    cometSeeds.push(Math.floor(rand() * 2 ** 31));
  }

  // --- Milestone 3b additions: appended strictly after the cometSeeds loop
  // above. Same discipline as the M4 block: counts are rolled before their
  // loops, every per-item draw is unconditional (fixed draw count per item
  // regardless of what's rolled), and the pulsar's fields are drawn even
  // when it turns out absent — so the draw count downstream never branches
  // on any roster roll made here. ---

  // Nebulae: count first, then a fixed 7-draw sequence per nebula (angle,
  // radius, y, scale, hueA, hueB, seed).
  const nebulaCount = 3 + Math.floor(rand() * 3); // 3-5
  const nebulae: NebulaSpec[] = [];
  for (let i = 0; i < nebulaCount; i++) {
    const angle = rand() * Math.PI * 2;
    const radius = 1.2 + rand() * (2.2 - 1.2);
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const y = -0.25 + rand() * (0.35 - -0.25);
    const scale = 0.35 + rand() * (0.7 - 0.35);
    const hueA = Math.floor(rand() * 1000);
    const hueB = Math.floor(rand() * 1000);
    const nebSeed = Math.floor(rand() * 2 ** 31);
    nebulae.push({ x, z, y, scale, hueA, hueB, seed: nebSeed });
  }

  // Galaxies: exactly 2 dynamic satellites — no count draw, a fixed 4-draw
  // sequence per galaxy (orbitR, size, hueIdx, phase) plus a seed draw.
  const galaxies: GalaxySpec[] = [];
  for (let i = 0; i < 2; i++) {
    const orbitR = 1.9 + rand() * (2.3 - 1.9);
    const size = 0.1 + rand() * 0.15;
    const hueIdx = Math.floor(rand() * 1000);
    const phase = rand() * Math.PI * 2;
    const galSeed = Math.floor(rand() * 2 ** 31);
    galaxies.push({ orbitR, size, hueIdx, phase, seed: galSeed });
  }

  const decorGalaxyCount = 3 + Math.floor(rand() * 3); // 3-5

  // Clusters: count first (0-2), then a fixed 5-draw sequence per cluster
  // (orbitR, pointCount, size, phase, seed).
  const clusterCount = Math.floor(rand() * 3); // 0-2
  const clusters: ClusterSpec[] = [];
  for (let i = 0; i < clusterCount; i++) {
    const orbitR = 1.3 + rand() * (1.7 - 1.3);
    const pointCount = 220 + Math.floor(rand() * (320 - 220 + 1));
    const size = 0.09 + rand() * (0.13 - 0.09);
    const phase = rand() * Math.PI * 2;
    const clSeed = Math.floor(rand() * 2 ** 31);
    clusters.push({ orbitR, pointCount, size, phase, seed: clSeed });
  }

  // Pulsar: present/orbitR/phase are all drawn unconditionally, even when
  // present is false — mirrors the rogue's present/spawnP/mergeP discipline.
  const pulsarPresent = rand() < 0.6;
  const pulsarOrbitR = 0.7 + rand() * (0.9 - 0.7);
  const pulsarPhase = rand() * Math.PI * 2;

  const bandAngle = rand() * Math.PI * 2;
  const skySeed = Math.floor(rand() * 2 ** 31);
  const shootingStarSeed = Math.floor(rand() * 2 ** 31);

  return {
    seed,
    cycleSeconds,
    holeR0,
    holeGrowth,
    diskInner0,
    diskOuter0,
    starCount,
    starShell,
    diskSeed,
    starSeed,
    paletteSeed,
    planets,
    beltCount,
    beltInner,
    beltHueIdx,
    comets,
    rogue: { present: roguePresent, spawnP: rogueSpawnP, mergeP: rogueMergeP },
    castSeed,
    castCadence,
    cometSeeds,
    nebulae,
    galaxies,
    decorGalaxyCount,
    clusters,
    pulsar: { present: pulsarPresent, orbitR: pulsarOrbitR, phase: pulsarPhase },
    bandAngle,
    skySeed,
    shootingStarSeed,
  };
}
