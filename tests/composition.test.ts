import { describe, expect, it } from 'vitest';
import {
  PROGRESSION,
  STEPS_PER_BAR,
  bassHit,
  chordAtBar,
  drumHit,
  melodyNote,
  semitoneToFreq,
  tempoBpm,
} from '../src/audio/composition';

describe('composition model', () => {
  it('is a four-chord dark minor loop ending on the dominant', () => {
    expect(PROGRESSION.map((c) => c.name)).toEqual(['Dm', 'Bb', 'Gm', 'A']);
    expect(STEPS_PER_BAR).toBe(16);
  });

  it('wraps chords per bar in both directions', () => {
    expect(chordAtBar(0).name).toBe('Dm');
    expect(chordAtBar(3).name).toBe('A');
    expect(chordAtBar(4).name).toBe('Dm'); // loops
    expect(chordAtBar(-1).name).toBe('A'); // negative wraps
  });

  it('maps semitones to equal-tempered frequencies (A4 = 440)', () => {
    expect(semitoneToFreq(0)).toBeCloseTo(440, 6);
    expect(semitoneToFreq(12)).toBeCloseTo(880, 6);
    expect(semitoneToFreq(-12)).toBeCloseTo(220, 6);
  });

  it('accelerates tempo with intensity', () => {
    expect(tempoBpm(0)).toBeCloseTo(50, 6);
    expect(tempoBpm(1)).toBeCloseTo(66, 6);
    expect(tempoBpm(0.5)).toBeGreaterThan(tempoBpm(0));
    expect(tempoBpm(1)).toBeGreaterThan(tempoBpm(0.5));
  });

  it('gates the bass ostinato to decay onward, accenting downbeats', () => {
    // Inactive in serene (intensity < 0.25).
    for (let s = 0; s < STEPS_PER_BAR; s++) expect(bassHit(s, 0.1)).toBe(0);
    // Decay: quarter-note accents on 0/4/8/12, nothing between.
    expect(bassHit(0, 0.3)).toBe(2);
    expect(bassHit(4, 0.3)).toBe(2);
    expect(bassHit(1, 0.3)).toBe(0);
    expect(bassHit(2, 0.3)).toBe(0);
    // Carnage fills the eighths.
    expect(bassHit(2, 0.6)).toBe(1);
  });

  it('gates the timpani to mid-decay, denser at high carnage', () => {
    for (let s = 0; s < STEPS_PER_BAR; s++) expect(drumHit(s, 0.3)).toBe(0); // before 0.42
    expect(drumHit(0, 0.5)).toBe(2); // downbeat
    expect(drumHit(8, 0.5)).toBe(1); // backbeat
    expect(drumHit(4, 0.5)).toBe(0);
    expect(drumHit(4, 0.8)).toBe(1); // fill at high carnage
  });

  it('plays the motif only in carnage, once per bar, wrapping', () => {
    expect(melodyNote(0, 2, 0.5)).toBeNull(); // before carnage
    expect(melodyNote(0, 0, 0.7)).toBeNull(); // only on step 2
    const n0 = melodyNote(0, 2, 0.7);
    const n1 = melodyNote(1, 2, 0.7);
    expect(n0).not.toBeNull();
    expect(n1).not.toBeNull();
    expect(n0).not.toBe(n1); // the motif moves bar to bar
    expect(melodyNote(4, 2, 0.7)).toBe(n0); // wraps every 4 bars
  });
});
