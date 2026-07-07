import { describe, expect, it } from 'vitest';
import {
  TIERS,
  chooseInitialTier,
  createFpsProbe,
  createSustainedLowDetector,
  parseTierParam,
  tierBelow,
} from '../src/quality/tiers';

describe('TIERS', () => {
  it('matches the numeric contract from the milestone plan', () => {
    expect(TIERS.high).toEqual({
      name: 'high', texSize: 1024, pixelRatioCap: 2.0, lensing: true, bloomStrengthScale: 1,
    });
    expect(TIERS.medium).toEqual({
      name: 'medium', texSize: 512, pixelRatioCap: 1.5, lensing: true, bloomStrengthScale: 0.75,
    });
    expect(TIERS.low).toEqual({
      name: 'low', texSize: 256, pixelRatioCap: 1.0, lensing: false, bloomStrengthScale: 0.5,
    });
  });

  it('keeps particle counts inside the spec ranges', () => {
    expect(TIERS.high.texSize ** 2).toBeGreaterThanOrEqual(600_000);
    expect(TIERS.high.texSize ** 2).toBeLessThanOrEqual(1_100_000);
    expect(TIERS.medium.texSize ** 2).toBeGreaterThanOrEqual(150_000);
    expect(TIERS.medium.texSize ** 2).toBeLessThanOrEqual(300_000);
    expect(TIERS.low.texSize ** 2).toBeGreaterThanOrEqual(40_000);
    expect(TIERS.low.texSize ** 2).toBeLessThanOrEqual(80_000);
  });
});

describe('tierBelow', () => {
  it('steps high -> medium -> low -> null', () => {
    expect(tierBelow('high')).toBe('medium');
    expect(tierBelow('medium')).toBe('low');
    expect(tierBelow('low')).toBeNull();
  });
});

const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

describe('chooseInitialTier', () => {
  it('classifies software renderers as low, case-insensitively', () => {
    for (const rendererString of [
      'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))',
      'llvmpipe (LLVM 15.0.7, 256 bits)',
      'Google SwiftShader',
      'Microsoft Software Renderer',
      'SWIFTSHADER',
    ]) {
      expect(chooseInitialTier({ rendererString, userAgent: DESKTOP_UA })).toBe('low');
    }
  });

  it('classifies mobile user agents as medium', () => {
    const rendererString = 'Apple GPU';
    expect(chooseInitialTier({ rendererString, userAgent: IPHONE_UA })).toBe('medium');
    expect(chooseInitialTier({ rendererString, userAgent: ANDROID_UA })).toBe('medium');
  });

  it('prefers the software-renderer verdict over the mobile one', () => {
    expect(
      chooseInitialTier({ rendererString: 'SwiftShader', userAgent: ANDROID_UA }),
    ).toBe('low');
  });

  it('classifies integrated Intel desktop GPUs as medium', () => {
    for (const rendererString of [
      'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'Intel(R) HD Graphics 4000',
      'Intel Iris Plus Graphics 655',
    ]) {
      expect(chooseInitialTier({ rendererString, userAgent: DESKTOP_UA })).toBe('medium');
    }
  });

  it('does not treat Intel Arc as integrated', () => {
    expect(
      chooseInitialTier({ rendererString: 'Intel(R) Arc(TM) A770 Graphics', userAgent: DESKTOP_UA }),
    ).toBe('high');
  });

  it('classifies discrete and unknown desktop GPUs as high', () => {
    for (const rendererString of [
      'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'Apple M3',
      '',
      'Some Future GPU 9000',
    ]) {
      expect(chooseInitialTier({ rendererString, userAgent: DESKTOP_UA })).toBe('high');
    }
  });
});

describe('parseTierParam', () => {
  it('accepts exactly the three tier names', () => {
    expect(parseTierParam('high')).toBe('high');
    expect(parseTierParam('medium')).toBe('medium');
    expect(parseTierParam('low')).toBe('low');
  });

  it('rejects junk, casing variants, and null', () => {
    for (const junk of [null, '', 'ultra', 'High', 'LOW', 'medium ', '1', 'lowest']) {
      expect(parseTierParam(junk)).toBeNull();
    }
  });
});

// Steady synthetic streams use power-of-two dts (1/64, 1/16, 1/8): exactly
// representable, so accumulated time hits window boundaries with no FP drift.
describe('createFpsProbe', () => {
  it('reports null and not-done before the window fills', () => {
    const probe = createFpsProbe(3);
    for (let i = 0; i < 60; i++) probe.sample(1 / 64);
    expect(probe.done()).toBe(false);
    expect(probe.medianFps()).toBeNull();
  });

  it('completes at the window and reports the median of a steady stream', () => {
    const probe = createFpsProbe(3);
    for (let i = 0; i < 192; i++) probe.sample(1 / 64);
    expect(probe.done()).toBe(true);
    expect(probe.medianFps()).toBeCloseTo(64, 6);
  });

  it('takes the middle sample of an odd-length mixed stream', () => {
    // dts cumulate to 0.1, 0.12, 0.153, 0.203, 0.228: the fifth frame crosses 0.21.
    const probe = createFpsProbe(0.21);
    for (const fps of [10, 50, 30, 20, 40]) probe.sample(1 / fps);
    expect(probe.done()).toBe(true);
    expect(probe.medianFps()).toBeCloseTo(30, 6);
  });

  it('averages the two middle samples of an even-length stream', () => {
    // dts cumulate to 0.017, 0.067, 0.092, 0.125: the fourth frame crosses 0.1.
    const probe = createFpsProbe(0.1);
    for (const fps of [60, 20, 40, 30]) probe.sample(1 / fps);
    expect(probe.done()).toBe(true);
    expect(probe.medianFps()).toBeCloseTo(35, 6);
  });

  it('ignores non-positive dt', () => {
    const probe = createFpsProbe(3);
    probe.sample(0);
    probe.sample(-1);
    expect(probe.done()).toBe(false);
    for (let i = 0; i < 192; i++) probe.sample(1 / 64);
    expect(probe.medianFps()).toBeCloseTo(64, 6);
  });

  it('freezes the median once done', () => {
    const probe = createFpsProbe(0.125);
    for (let i = 0; i < 8; i++) probe.sample(1 / 64);
    expect(probe.done()).toBe(true);
    const median = probe.medianFps();
    for (let i = 0; i < 100; i++) probe.sample(1 / 4);
    expect(probe.medianFps()).toBe(median);
  });
});

describe('createSustainedLowDetector', () => {
  const lowDt = 1 / 16; // exact dt; 16 fps, below the 24 fps threshold

  it('fires exactly once after sustained low fps', () => {
    const detector = createSustainedLowDetector(24, 5);
    const fired: number[] = [];
    for (let i = 0; i < 160; i++) {
      if (detector.sample(lowDt)) fired.push(i);
    }
    // 5 s / (1/16 s per frame) = 80 frames; index 79 crosses the line.
    expect(fired).toEqual([79]);
  });

  it('resets the accumulator on a fast frame', () => {
    const detector = createSustainedLowDetector(24, 5);
    for (let i = 0; i < 79; i++) expect(detector.sample(lowDt)).toBe(false);
    expect(detector.sample(1 / 64)).toBe(false);
    for (let i = 0; i < 79; i++) expect(detector.sample(lowDt)).toBe(false);
    expect(detector.sample(lowDt)).toBe(true);
  });

  it('resets on a frame exactly at the threshold', () => {
    const detector = createSustainedLowDetector(16, 1);
    for (let i = 0; i < 7; i++) expect(detector.sample(1 / 8)).toBe(false);
    expect(detector.sample(1 / 16)).toBe(false); // exactly 16 fps: at threshold, resets
    for (let i = 0; i < 7; i++) expect(detector.sample(1 / 8)).toBe(false);
    expect(detector.sample(1 / 8)).toBe(true);
  });

  it('re-arms after reset()', () => {
    const detector = createSustainedLowDetector(24, 5);
    for (let i = 0; i < 79; i++) detector.sample(lowDt);
    expect(detector.sample(lowDt)).toBe(true);
    expect(detector.sample(lowDt)).toBe(false);
    detector.reset();
    for (let i = 0; i < 79; i++) expect(detector.sample(lowDt)).toBe(false);
    expect(detector.sample(lowDt)).toBe(true);
  });

  it('ignores non-positive dt without resetting the accumulator', () => {
    const detector = createSustainedLowDetector(24, 5);
    for (let i = 0; i < 79; i++) detector.sample(lowDt);
    expect(detector.sample(0)).toBe(false);
    expect(detector.sample(-0.5)).toBe(false);
    expect(detector.sample(lowDt)).toBe(true);
  });
});
