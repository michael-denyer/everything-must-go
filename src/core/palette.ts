import { mulberry32 } from '../sim/random';

export type Rgb = [number, number, number];

export function hslToRgb(h: number, s: number, l: number): Rgb {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (hue < 60) { r = c; g = x; }
  else if (hue < 120) { r = x; g = c; }
  else if (hue < 180) { g = c; b = x; }
  else if (hue < 240) { g = x; b = c; }
  else if (hue < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return [r + m, g + m, b + m];
}

export interface Palette {
  scheme: 'analogous' | 'triad' | 'clash';
  hues: number[];
}

export function generatePalette(seed: number): Palette {
  const rand = mulberry32(seed);
  const h0 = rand() * 360;
  const pick = rand();
  const scheme: Palette['scheme'] = pick < 1 / 3 ? 'analogous' : pick < 2 / 3 ? 'triad' : 'clash';
  const count = 5 + Math.floor(rand() * 3);
  const hues: number[] = [];
  for (let i = 0; i < count; i++) {
    const jitter = (rand() - 0.5) * 14;
    if (scheme === 'analogous') hues.push(h0 - 30 + i * (90 / count) + jitter);
    else if (scheme === 'triad') hues.push(h0 + (i % 3) * 120 + Math.floor(i / 3) * 18 + jitter);
    else hues.push(h0 + (i % 2) * 180 + (i % 3) * 24 + jitter);
  }
  return { scheme, hues };
}

export function paletteRgb(p: Palette, idx: number, s: number, l: number): Rgb {
  return hslToRgb(p.hues[idx % p.hues.length]!, s, l);
}
