// The musical model: a pure, WebAudio-free description of an ominous cinematic
// arrangement in D minor, sequenced in 16th-note steps. The engine's scheduler
// (audioEngine.ts) reads these functions to decide which notes to synthesize at
// each step; nothing here touches AudioContext or the DOM, so it is fully
// unit-testable and deterministic.
//
// The arrangement is a dark loop — i – VI – iv – V (Dm – Bb – Gm – A) — ending
// on the major dominant (A, with a C# leading tone) so the loop never fully
// resolves: it keeps pulling back to the tonic, which reads as unease. Layers
// enter with cycle intensity: pad chords from the start, a bass ostinato from
// decay, timpani building through carnage, a melodic motif at full carnage.

// ---- Pitch: equal-tempered frequency from a semitone offset above A4 (440). --
export function semitoneToFreq(semitonesAboveA4: number): number {
  return 440 * Math.pow(2, semitonesAboveA4 / 12);
}

// Semitone offsets above A4 for the notes we use. D minor natural scale
// (D E F G A Bb C) plus the C# leading tone from the dominant A-major chord.
// A4 = 0. D4 = -7, so we name everything relative to A4.
const N = {
  D2: -31, A2: -24, Bb1: -35, G1: -38, A1: -36, D3: -19, F3: -16, A3: -12,
  Bb3: -11, G3: -14, Csharp4: -8, E4: -5, D4: -7, F4: -4, A4: 0, G4: -2,
  Bb4: 1, C5: 3, D5: 5,
} as const;

export interface Chord {
  name: string;
  bassSemi: number; // low root for the bass ostinato
  padSemis: number[]; // string-section voicing (mid register)
}

// One chord per bar, looping. Voicings kept close in the mid register so the
// synth "strings" blend; the bass carries the root an octave+ below.
export const PROGRESSION: Chord[] = [
  { name: 'Dm', bassSemi: N.D2, padSemis: [N.D3, N.F3, N.A3, N.D4] }, // i
  { name: 'Bb', bassSemi: N.Bb1, padSemis: [N.D3, N.F3, N.Bb3, N.D4] }, // VI
  { name: 'Gm', bassSemi: N.G1, padSemis: [N.D3, N.G3, N.Bb3, N.D4] }, // iv
  { name: 'A', bassSemi: N.A1, padSemis: [N.Csharp4, N.E4, N.A3, N.A4] }, // V (major — tension)
];

export const STEPS_PER_BAR = 16; // 16th-note resolution

// Tempo rises with intensity for a sense of acceleration into carnage.
export function tempoBpm(intensity: number): number {
  return 50 + 16 * clamp01(intensity);
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function chordAtBar(bar: number): Chord {
  const i = ((bar % PROGRESSION.length) + PROGRESSION.length) % PROGRESSION.length;
  return PROGRESSION[i]!;
}

// ---- Layer gating by intensity (0..1, driven by cycle progress). ----
export function padActive(intensity: number): boolean {
  return intensity > 0.02; // present almost from the start (serene atmosphere)
}
export function bassActive(intensity: number): boolean {
  return intensity >= 0.25; // enters at decay
}
export function drumsActive(intensity: number): boolean {
  return intensity >= 0.42; // mid-decay
}
export function melodyActive(intensity: number): boolean {
  return intensity >= 0.6; // carnage
}

// Bass ostinato: a driving pulse. Eighth notes (every other 16th) once active,
// with the downbeats accented. Returns 0 (no hit), 1 (normal), 2 (accent).
export function bassHit(step: number, intensity: number): number {
  if (!bassActive(intensity)) return 0;
  if (step % 4 === 0) return 2; // quarter-note accents
  if (intensity >= 0.6 && step % 2 === 0) return 1; // eighths fill in at carnage
  return 0;
}

// Timpani/war-drum: downbeat and backbeat, denser with intensity.
export function drumHit(step: number, intensity: number): number {
  if (!drumsActive(intensity)) return 0;
  if (step === 0) return 2; // strong downbeat
  if (step === 8) return 1; // backbeat
  if (intensity >= 0.75 && (step === 4 || step === 12)) return 1; // fill at high carnage
  return 0;
}

// Melody motif: a slow, sparse ominous line over the 4-bar loop. Returns a
// semitone offset (above A4) to play at this (bar,step), or null. One note per
// bar, landing on a chord/scale tone, descending then lifting — deliberately
// simple so it reads as a theme, not noodling.
const MOTIF: Array<number | null> = [N.A4, N.F4, N.G4, N.E4]; // per bar, over Dm/Bb/Gm/A
export function melodyNote(bar: number, step: number, intensity: number): number | null {
  if (!melodyActive(intensity)) return null;
  if (step !== 2) return null; // land just after the downbeat, once per bar
  const i = ((bar % MOTIF.length) + MOTIF.length) % MOTIF.length;
  return MOTIF[i]!;
}
