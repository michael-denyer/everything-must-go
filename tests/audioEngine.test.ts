import { describe, expect, it } from 'vitest';
import { createAudioEngine } from '../src/audio/audioEngine';
import type { CycleAudioParams } from '../src/audio/score';

// WebAudio is NOT available in node/vitest (no jsdom, no AudioContext global).
// These tests assert the graceful-absence contract from the plan: every method
// is a safe no-op before unlock() (and unlock() itself is a safe no-op when
// window/AudioContext is undefined, which is always true in this node env) —
// nothing here ever throws, and level() reports 0 with no context.

function realisticParams(): CycleAudioParams {
  return {
    progress: 0.62,
    phase: 'decay',
    fade: 1,
    rogueActive: true,
    rogueProgress: 0.4,
  };
}

describe('createAudioEngine graceful-absence contract', () => {
  it('constructs without throwing and without a real AudioContext', () => {
    expect(() => createAudioEngine()).not.toThrow();
  });

  it('level() returns 0 before unlock (no context)', () => {
    const engine = createAudioEngine();
    expect(engine.level()).toBe(0);
  });

  it('unlock() itself is a safe no-op when window/AudioContext is unavailable', () => {
    expect(typeof window).toBe('undefined');
    const engine = createAudioEngine();
    expect(() => engine.unlock()).not.toThrow();
    // Still no context afterwards in this environment.
    expect(engine.level()).toBe(0);
  });

  it('setCycle is a safe no-op before unlock with a realistic params object', () => {
    const engine = createAudioEngine();
    expect(() => engine.setCycle(realisticParams())).not.toThrow();
  });

  it('setCycle handles a full progress/phase/rogue sweep without throwing', () => {
    const engine = createAudioEngine();
    const phases = ['serene', 'decay', 'carnage', 'darkness'];
    for (let i = 0; i <= 10; i++) {
      const progress = i / 10;
      const phase = phases[i % phases.length]!;
      const rogueActive = i % 3 === 0;
      const params: CycleAudioParams = {
        progress,
        phase,
        fade: phase === 'darkness' ? 0 : 1,
        rogueActive,
        rogueProgress: rogueActive ? progress : 0,
      };
      expect(() => engine.setCycle(params)).not.toThrow();
    }
  });

  it('hit() is a safe no-op before unlock for every kind', () => {
    const engine = createAudioEngine();
    expect(() => engine.hit('break')).not.toThrow();
    expect(() => engine.hit('galaxyDeath')).not.toThrow();
    expect(() => engine.hit('rebirth')).not.toThrow();
  });

  it('setEnabled(true/false) is a safe no-op before unlock', () => {
    const engine = createAudioEngine();
    expect(() => engine.setEnabled(true)).not.toThrow();
    expect(() => engine.setEnabled(false)).not.toThrow();
  });

  it('suspend/resume are safe no-ops before unlock', () => {
    const engine = createAudioEngine();
    expect(() => engine.suspend()).not.toThrow();
    expect(() => engine.resume()).not.toThrow();
  });

  it('dispose is a safe, idempotent no-op before unlock', () => {
    const engine = createAudioEngine();
    expect(() => engine.dispose()).not.toThrow();
    expect(() => engine.dispose()).not.toThrow();
  });

  it('every method remains safe to call after dispose (no context ever existed)', () => {
    const engine = createAudioEngine();
    engine.dispose();
    expect(() => engine.unlock()).not.toThrow();
    expect(() => engine.setCycle(realisticParams())).not.toThrow();
    expect(() => engine.hit('break')).not.toThrow();
    expect(() => engine.setEnabled(true)).not.toThrow();
    expect(() => engine.suspend()).not.toThrow();
    expect(() => engine.resume()).not.toThrow();
    expect(engine.level()).toBe(0);
  });

  it('a long sequence of mixed calls in arbitrary order never throws', () => {
    const engine = createAudioEngine();
    engine.setEnabled(false);
    engine.setCycle(realisticParams());
    engine.hit('galaxyDeath');
    engine.unlock();
    engine.suspend();
    engine.hit('rebirth');
    engine.resume();
    engine.setEnabled(true);
    engine.setCycle({ progress: 0, phase: 'serene', fade: 1, rogueActive: false, rogueProgress: 0 });
    expect(engine.level()).toBe(0);
    engine.dispose();
  });
});
