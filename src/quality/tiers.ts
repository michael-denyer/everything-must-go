// Pure quality-tier model: no DOM, no WebGL, no three.js. The conductor feeds
// renderer/UA strings and per-frame dt in; tier decisions come out. Numeric
// contract lives in the M6 plan's tier table.
import { DOWNGRADE_FPS, DOWNGRADE_SUSTAIN_SECONDS, PROBE_SECONDS } from '../config';

const TIER_NAMES = ['high', 'medium', 'low'] as const;

export type TierName = (typeof TIER_NAMES)[number];

export interface TierSpec {
  name: TierName;
  texSize: number;
  pixelRatioCap: number;
  lensing: boolean;
  bloomStrengthScale: number;
}

export const TIERS: Record<TierName, TierSpec> = {
  high: { name: 'high', texSize: 1024, pixelRatioCap: 2.0, lensing: true, bloomStrengthScale: 1 },
  medium: { name: 'medium', texSize: 512, pixelRatioCap: 1.5, lensing: true, bloomStrengthScale: 0.75 },
  low: { name: 'low', texSize: 256, pixelRatioCap: 1.0, lensing: false, bloomStrengthScale: 0.5 },
};

export function tierBelow(t: TierName): TierName | null {
  switch (t) {
    case 'high': return 'medium';
    case 'medium': return 'low';
    case 'low': return null;
  }
}

export interface ProbeInputs {
  rendererString: string;
  userAgent: string;
}

const SOFTWARE_RENDERER = /swiftshader|llvmpipe|software/i;
const MOBILE_UA = /Android|iPhone|iPad|Mobile/;
const INTEL_INTEGRATED = /Intel/;
const INTEL_INTEGRATED_FAMILY = /HD|Iris/;
const INTEL_DISCRETE = /Arc/;

export function chooseInitialTier({ rendererString, userAgent }: ProbeInputs): TierName {
  if (SOFTWARE_RENDERER.test(rendererString)) return 'low';
  if (MOBILE_UA.test(userAgent)) return 'medium';
  if (
    INTEL_INTEGRATED.test(rendererString) &&
    INTEL_INTEGRATED_FAMILY.test(rendererString) &&
    !INTEL_DISCRETE.test(rendererString)
  ) {
    return 'medium';
  }
  return 'high';
}

export function parseTierParam(v: string | null): TierName | null {
  if (v === null) return null;
  return TIER_NAMES.find((t) => t === v) ?? null;
}

export function createFpsProbe(windowSeconds: number = PROBE_SECONDS): {
  sample(dtSeconds: number): void;
  medianFps(): number | null;
  done(): boolean;
} {
  const samples: number[] = [];
  let elapsed = 0;
  const done = () => elapsed >= windowSeconds;
  return {
    sample(dtSeconds) {
      if (dtSeconds <= 0 || done()) return;
      elapsed += dtSeconds;
      samples.push(1 / dtSeconds);
    },
    done,
    medianFps() {
      if (!done()) return null;
      const sorted = [...samples].sort((a, b) => a - b);
      const upper = sorted[sorted.length >> 1];
      if (upper === undefined) return null;
      const lower = sorted[(sorted.length - 1) >> 1];
      return lower === undefined ? upper : (lower + upper) / 2;
    },
  };
}

export function createSustainedLowDetector(
  thresholdFps: number = DOWNGRADE_FPS,
  sustainSeconds: number = DOWNGRADE_SUSTAIN_SECONDS,
): { sample(dtSeconds: number): boolean; reset(): void } {
  let lowSeconds = 0;
  let fired = false;
  return {
    sample(dtSeconds) {
      if (dtSeconds <= 0 || fired) return false;
      if (1 / dtSeconds >= thresholdFps) {
        lowSeconds = 0;
        return false;
      }
      lowSeconds += dtSeconds;
      if (lowSeconds < sustainSeconds) return false;
      fired = true;
      return true;
    },
    reset() {
      lowSeconds = 0;
      fired = false;
    },
  };
}
