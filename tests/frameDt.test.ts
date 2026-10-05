// tests/frameDt.test.ts
import { describe, expect, it } from 'vitest';
import { MAX_DT } from '../src/config';
import { frameDt } from '../src/core/frameDt';

describe('frameDt', () => {
  it('passes an ordinary frame delta through', () => {
    expect(frameDt(1 / 120)).toBe(1 / 120);
  });

  it('caps a long frame at MAX_DT', () => {
    expect(frameDt(1.2)).toBe(MAX_DT);
  });

  it('never steps backwards when the first rAF timestamp precedes the boot clock', () => {
    expect(frameDt(-0.08)).toBe(1 / 60);
  });

  it('falls back to a nominal step for a zero or NaN delta', () => {
    expect(frameDt(0)).toBe(1 / 60);
    expect(frameDt(Number.NaN)).toBe(1 / 60);
  });
});
