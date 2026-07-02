// e2e/cycle.spec.ts
import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';

function luminanceAt(png: PNG, x: number, y: number): number {
  const i = (png.width * y + x) << 2;
  return (png.data[i]! + png.data[i + 1]! + png.data[i + 2]!) / 3;
}

function frameMean(png: PNG): number {
  let sum = 0;
  for (let y = 0; y < png.height; y += 4) {
    for (let x = 0; x < png.width; x += 4) sum += luminanceAt(png, x, y);
  }
  return sum / ((png.width / 4) * (png.height / 4));
}

test('same seed produces the same cosmos spec', async ({ page }) => {
  await page.goto('/?seed=7');
  await page.waitForFunction(() => (window as unknown as { __emg?: object }).__emg !== undefined);
  const a = await page.evaluate(() => JSON.stringify((window as unknown as { __emg: { spec: object } }).__emg.spec));
  await page.goto('/?seed=7');
  await page.waitForFunction(() => (window as unknown as { __emg?: object }).__emg !== undefined);
  const b = await page.evaluate(() => JSON.stringify((window as unknown as { __emg: { spec: object } }).__emg.spec));
  expect(a).toBe(b);
  await page.goto('/?seed=8');
  await page.waitForFunction(() => (window as unknown as { __emg?: object }).__emg !== undefined);
  const c = await page.evaluate(() => JSON.stringify((window as unknown as { __emg: { spec: object } }).__emg.spec));
  expect(c).not.toBe(a);
});

test('darkness phase is near-black with the counter reading 95%', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/?seed=7&t=0.95');
  // Fresh-load disk must drain at frozen progress before darkness is measurable
  // (settled ~7.4, mid-drain ~14), so poll until the frame settles below the gate.
  const deadline = Date.now() + 75_000;
  let mean = Number.POSITIVE_INFINITY;
  while (Date.now() < deadline) {
    await page.waitForTimeout(3000);
    mean = frameMean(PNG.sync.read(await page.screenshot()));
    if (mean < 8) break;
  }
  expect(mean).toBeLessThan(8);
  await expect(page.locator('#counter')).toContainText('95% consumed');
});

test('early cycle still passes the money-shot gates', async ({ page }) => {
  await page.goto('/?seed=7&t=0.05');
  await page.waitForTimeout(3000);
  const png = PNG.sync.read(await page.screenshot());
  const cx = Math.floor(png.width / 2);
  const cy = Math.floor(png.height / 2);
  let shadowSum = 0;
  for (let y = cy - 6; y <= cy + 6; y++)
    for (let x = cx - 6; x <= cx + 6; x++) shadowSum += luminanceAt(png, x, y);
  expect(shadowSum / 169).toBeLessThan(10);
  const mean = frameMean(png);
  expect(mean).toBeGreaterThan(2);
  expect(mean).toBeLessThan(110);
});

test('a compressed cycle survives rebirth without console errors', async ({ page }) => {
  // MAX_DT (1/30) caps per-frame dt, so on software WebGL (~8 fps here) sim time
  // runs at fps/30 ~= 0.27x wall time and the 45s cycle needs ~170s wall to reach
  // rebirth (measured: 88% consumed at 148s). Real GPUs (>=30 fps) finish in ~50s.
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/?seed=7&cycle=45');
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __emg?: { params: { progress: number } } };
      return w.__emg !== undefined && w.__emg.params.progress > 0.1;
    },
    { timeout: 60_000 },
  );
  await page.waitForFunction(
    () => document.getElementById('counter')?.textContent?.includes('cosmos no. 2') ?? false,
    { timeout: 240_000 },
  );
  expect(errors).toEqual([]);

  // Tripwire for extreme rebirth-boundary failures: a dead render or fade stuck
  // at 0 reads near-black (mean <= 2); a stuck whiteout reads blown-out (>= 110).
  // The historical stale-params corruption itself measured ~31 (inside this band);
  // the reorder in main.ts frame() is the real guard against that class — this
  // check only catches its extreme ends.
  // The rebirth whiteout (flashDecay -0.8/s of dt, with dt clamped at MAX_DT)
  // decays in wall time scaled by that clamping — ~5s at 8 fps, ~1.3s at 120 fps —
  // so poll past it before judging the reborn frame (measured 155 mid-flash at +3s).
  const rebirthDeadline = Date.now() + 30_000;
  let rebirthMean = Number.POSITIVE_INFINITY;
  while (Date.now() < rebirthDeadline) {
    await page.waitForTimeout(2000);
    rebirthMean = frameMean(PNG.sync.read(await page.screenshot()));
    if (rebirthMean < 110) break;
  }
  expect(rebirthMean).toBeGreaterThan(2);
  expect(rebirthMean).toBeLessThan(110);
});
