// The adaptive score, expressed as a pure function of cycle state.
//
// No WebAudio, no DOM, no Math.random, no Date — scoreGains/chirpFrequency/rebirthEnvelope
// are deterministic maps from (progress, phase, fade, rogue state) or elapsed time to
// gains/frequencies in [0,1]/[40,320] Hz. audioEngine.ts (Task 2) applies these numbers to
// real oscillators; this module only decides what the numbers should be.

export interface CycleAudioParams {
  progress: number;
  phase: string;
  fade: number;
  rogueActive: boolean;
  rogueProgress: number; // 0..1 through [spawnP, mergeP], else 0
}

export interface LayerGains {
  master: number;
  drone: number;
  pad: number;
  tension: number;
  sub: number;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Base master level before the fade-squared silence gate is applied.
const MASTER_BASE = 1;

// Layer envelopes over progress, per the plan's numeric contract (Global Constraints):
// - drone: present from serene at ~0.12, rising to ~0.22 by carnage (progress 0.9).
// - pad: ~0 before 0.25, ramping to ~0.18 by 0.6.
// - tension: ~0 before 0.55, high (~0.3) by 0.9.
// - sub: low sine boom that grows through carnage (mirrors drone's late rise, floored at 0
//   until decay so it doesn't hum under a silent serene opening).
function droneGain(progress: number): number {
  return lerp(0.12, 0.22, smoothstep(0, 0.9, progress));
}

function padGain(progress: number): number {
  return lerp(0, 0.18, smoothstep(0.25, 0.6, progress));
}

function tensionGain(progress: number): number {
  return lerp(0, 0.3, smoothstep(0.55, 0.9, progress));
}

function subGain(progress: number): number {
  return lerp(0, 0.16, smoothstep(0.4, 0.9, progress));
}

/**
 * Compute the per-layer gains for a moment in the cycle.
 *
 * All layers (and master) are multiplied by fade² so darkness (fade -> 0) yields true
 * silence, mirroring the visual's squared-fade emissive falloff.
 *
 * Args:
 *   p: Current cycle audio params (progress, phase, fade, rogue state).
 *
 * Returns:
 *   Layer gains, each clamped to [0,1].
 */
export function scoreGains(p: CycleAudioParams): LayerGains {
  const silence = p.fade * p.fade;
  const progress = clamp01(p.progress);
  return {
    master: clamp01(MASTER_BASE * silence),
    drone: clamp01(droneGain(progress) * silence),
    pad: clamp01(padGain(progress) * silence),
    tension: clamp01(tensionGain(progress) * silence),
    sub: clamp01(subGain(progress) * silence),
  };
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

const REBIRTH_DURATION_S = 2.5;

/**
 * Compute the rebirth resolution swell envelope at an elapsed time since trigger.
 *
 * A raised-cosine window: 0 at t=0, peak (1) at the midpoint, back to 0 at
 * REBIRTH_DURATION_S, and exactly 0 outside [0, REBIRTH_DURATION_S].
 *
 * Args:
 *   tSeconds: Elapsed time since the rebirth event, in seconds.
 *
 * Returns:
 *   Envelope value in [0,1].
 */
export function rebirthEnvelope(tSeconds: number): number {
  if (tSeconds < 0 || tSeconds > REBIRTH_DURATION_S) return 0;
  const t = tSeconds / REBIRTH_DURATION_S; // 0..1
  return 0.5 * (1 - Math.cos(2 * Math.PI * t));
}
