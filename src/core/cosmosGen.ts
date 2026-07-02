import { CYCLE_SECONDS } from '../config';
import { mulberry32 } from '../sim/random';

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
    planets.push({ orbitR, size, kind, ringed: false, moons: [], hueIdx, phase, texSeed });
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
  };
}
