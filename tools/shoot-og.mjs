// Reshoot the OG/poster image (public/og.jpg, 1200x630) from a running dev
// server: `node tools/shoot-og.mjs [baseUrl]`. Rerun whenever the look changes.
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:5173';
const url = `${base}/?seed=7&t=0.55&tier=high`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto(url);
await page.waitForFunction(() => '__emg' in window, undefined, { timeout: 60_000 });
// Count frames, not wall-clock: SwiftShader renders far below real time, and
// the frozen-t scene needs a stack of frames before bloom and disk settle.
await page.evaluate(
  () =>
    new Promise((resolve) => {
      let n = 0;
      const tick = () => (++n >= 90 ? resolve(undefined) : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    }),
);
mkdirSync(fileURLToPath(new URL('../public', import.meta.url)), { recursive: true });
const out = fileURLToPath(new URL('../public/og.jpg', import.meta.url));
await page.screenshot({ path: out, type: 'jpeg', quality: 90 });
await browser.close();
console.log(`wrote ${out} from ${url}`);
