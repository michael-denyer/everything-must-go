// Bakes the cast roster into committed silhouette masks.
//
// Run manually: node tools/bake-cast.mjs
//
// For each emoji in the roster, launches headless chromium, rasterizes the
// glyph onto an in-page canvas at 256x256, and reads back raw pixel data.
// A second in-page canvas pass computes a 6px erosion of the alpha channel;
// alpha-minus-eroded gives a thin edge band used for the rim-light effect
// at runtime. The final PNG carries the silhouette in the ALPHA channel and
// the edge band in the RED channel (green/blue channels are unused, left 0).
//
// The runtime never rasterizes text or touches a font — these PNGs are the
// only place the glyphs are used, and they are committed to the repo.

import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SIZE = 256;
const ERODE_RADIUS = 6;
const MIN_ALPHA_PIXELS = 500;

const ROSTER = [
  { glyph: '🐋', name: 'whale', file: 'whale.png' },
  { glyph: '🎹', name: 'piano', file: 'piano.png' },
  { glyph: '🦖', name: 'trex', file: 'trex.png' },
  { glyph: '☕', name: 'teacup', file: 'teacup.png' },
  { glyph: '🚲', name: 'bicycle', file: 'bicycle.png' },
  { glyph: '🦆', name: 'duck', file: 'duck.png' },
];

const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'assets', 'cast');

// Runs inside the page via page.evaluate — no access to anything in the
// node-side closure. Rasterizes `glyph` onto a SIZE x SIZE canvas, then
// computes a second canvas pass: the eroded alpha (min filter over a
// square window of radius `erodeRadius`). Returns both raw pixel buffers.
function rasterizeGlyph({ glyph, size, erodeRadius }) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, size, size);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.round(size * 0.82)}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
  ctx.fillText(glyph, size / 2, size / 2 + size * 0.03);

  const srcImageData = ctx.getImageData(0, 0, size, size);
  const srcAlpha = srcImageData.data;

  // Extract the alpha channel into a flat Uint8Array for the erosion pass.
  const alpha = new Uint8ClampedArray(size * size);
  for (let i = 0; i < size * size; i++) {
    alpha[i] = srcAlpha[i * 4 + 3];
  }

  // 6px erosion: min filter over a square window. This is a silhouette
  // shrink — every pixel becomes the darkest (lowest-alpha) pixel within
  // erodeRadius, which pulls the mask inward from every edge uniformly.
  const eroded = new Uint8ClampedArray(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let min = 255;
      for (let dy = -erodeRadius; dy <= erodeRadius; dy++) {
        const sy = y + dy;
        if (sy < 0 || sy >= size) {
          min = 0;
          continue;
        }
        for (let dx = -erodeRadius; dx <= erodeRadius; dx++) {
          const sx = x + dx;
          if (sx < 0 || sx >= size) {
            min = 0;
            continue;
          }
          const v = alpha[sy * size + sx];
          if (v < min) min = v;
        }
      }
      eroded[y * size + x] = min;
    }
  }

  return {
    alpha: Array.from(alpha),
    eroded: Array.from(eroded),
  };
}

function computeBBox(alpha, size) {
  let minX = size;
  let minY = size;
  let maxX = -1;
  let maxY = -1;
  let alphaCount = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = alpha[y * size + x];
      if (a > 0) {
        alphaCount++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (alphaCount === 0) {
    return { alphaCount, bbox: null, aspect: null };
  }
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  return {
    alphaCount,
    bbox: { minX, minY, maxX, maxY, width, height },
    aspect: width / height,
  };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });

  const manifest = [];
  const statsRows = [];

  try {
    for (const { glyph, name, file } of ROSTER) {
      const { alpha, eroded } = await page.evaluate(rasterizeGlyph, {
        glyph,
        size: SIZE,
        erodeRadius: ERODE_RADIUS,
      });

      const { alphaCount, bbox, aspect } = computeBBox(alpha, SIZE);

      if (alphaCount <= MIN_ALPHA_PIXELS) {
        throw new Error(
          `${name} (${glyph}): only ${alphaCount} alpha pixels, need > ${MIN_ALPHA_PIXELS}. ` +
            `Emoji font likely missing or glyph failed to rasterize.`
        );
      }

      let edgeBandCount = 0;
      let edgeBandSum = 0;
      const png = new PNG({ width: SIZE, height: SIZE });
      for (let i = 0; i < SIZE * SIZE; i++) {
        const a = alpha[i];
        const e = eroded[i];
        const edge = Math.max(0, a - e);
        if (edge > 0) {
          edgeBandCount++;
          edgeBandSum += edge;
        }
        const o = i * 4;
        png.data[o] = edge; // RED: edge band
        png.data[o + 1] = 0; // GREEN: unused
        png.data[o + 2] = 0; // BLUE: unused
        png.data[o + 3] = a; // ALPHA: silhouette
      }

      if (edgeBandCount === 0) {
        throw new Error(`${name} (${glyph}): edge band is all zero — erosion produced no boundary.`);
      }

      const outPath = path.join(OUT_DIR, file);
      const buffer = PNG.sync.write(png);
      await writeFile(outPath, buffer);

      manifest.push({ name, file, aspect });

      statsRows.push({
        name,
        glyph,
        alphaPixels: alphaCount,
        bbox: `${bbox.width}x${bbox.height} @ (${bbox.minX},${bbox.minY})`,
        aspect: aspect.toFixed(4),
        edgeBandPixels: edgeBandCount,
        edgeBandMeanIntensity: (edgeBandSum / edgeBandCount).toFixed(2),
      });
    }
  } finally {
    await browser.close();
  }

  const manifestPath = path.join(OUT_DIR, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  console.log('\nBaked cast masks:\n');
  console.table(statsRows);
  console.log(`\nWrote ${manifest.length} PNGs + manifest.json to ${OUT_DIR}`);
}

main().catch((err) => {
  console.error('bake-cast failed:', err);
  process.exitCode = 1;
});
