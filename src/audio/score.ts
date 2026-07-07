// The adaptive score's pure numeric layer.
//
// No WebAudio, no DOM, no Math.random, no Date — masterGain/chirpFrequency are
// deterministic maps from cycle state to a gain in [0,1] / a frequency in [40,320] Hz.
// audioEngine.ts applies these numbers to real nodes; the note-by-note arrangement
// lives in composition.ts. This module only decides the master silence gate and the
// rogue-merger chirp curve.

export interface CycleAudioParams {
  progress: number;
  phase: string;
  fade: number;
  rogueActive: boolean;
  rogueProgress: number; // 0..1 through [spawnP, mergeP], else 0
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Compute the master gain for a moment in the cycle.
 *
 * fade² so darkness (fade -> 0) yields true silence, mirroring the visual's
 * squared-fade emissive falloff.
 *
 * Args:
 *   p: Current cycle audio params.
 *
 * Returns:
 *   Master gain in [0,1].
 */
export function masterGain(p: CycleAudioParams): number {
  return clamp01(p.fade * p.fade);
}

const CHIRP_MIN_HZ = 40;
const CHIRP_MAX_HZ = 320;

/**
 * Map rogue-merger progress to the gravitational-wave chirp frequency.
 *
 * Linear lerp 40 -> 320 Hz over rogueProgress [0,1] (a log sweep would front-load the
 * pitch rise; a plain linear ramp keeps the climb audibly steady right up to merger,
 * which better matches "rising ... to a climax at merge" in the plan). Clamped outside.
 *
 * Args:
 *   rogueProgress: Normalized position through [spawnP, mergeP], 0 outside that window.
 *
 * Returns:
 *   Frequency in Hz, clamped to [40, 320].
 */
export function chirpFrequency(rogueProgress: number): number {
  return lerp(CHIRP_MIN_HZ, CHIRP_MAX_HZ, clamp01(rogueProgress));
}
