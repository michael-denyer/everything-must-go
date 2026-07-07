// e2e/tiers.spec.ts
import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

type Emg = {
  tier: string;
  texSize: number;
  spec: object;
  params: { progress: number };
};

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}

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

function waitForEmg(page: Page): Promise<unknown> {
  return page.waitForFunction(() => (window as unknown as { __emg?: object }).__emg !== undefined);
}

function readEmg(page: Page): Promise<{ tier: string; texSize: number; spec: string; progress: number }> {
  return page.evaluate(() => {
    const e = (window as unknown as { __emg: Emg }).__emg;
    return { tier: e.tier, texSize: e.texSize, spec: JSON.stringify(e.spec), progress: e.params.progress };
  });
}

test('?tier=low pins the tier without touching the cosmos', async ({ page }) => {
  const errors = collectConsoleErrors(page);

  await page.goto('/?tier=low&seed=7');
  await waitForEmg(page);
  const low = await readEmg(page);
  expect(low.tier).toBe('low');
  expect(low.texSize).toBe(256);

  await page.goto('/?tier=high&seed=7');
  await waitForEmg(page);
  const high = await readEmg(page);
  expect(high.tier).toBe('high');
  expect(high.texSize).toBe(1024);

  // The tier scales the pipeline, never the cosmos: same seed, identical spec.
  expect(low.spec).toBe(high.spec);
  expect(errors).toEqual([]);
});

test('debug HUD reports the pinned tier and particle count', async ({ page }) => {
  await page.goto('/?tier=low&seed=7&debug');
  await waitForEmg(page);
  // The HUD repaints once per second — settle-poll, no wall-clock waits.
  await expect(page.locator('#debug')).toContainText('low', { timeout: 20_000 });
  await expect(page.locator('#debug')).toContainText('65536 particles');
});

test('context loss recovers at the same tier with progress preserved', async ({ page }) => {
  const errors = collectConsoleErrors(page);

  await page.goto('/?tier=high&seed=7');
  await waitForEmg(page);
  await page.waitForFunction(
    () => (window as unknown as { __emg: Emg }).__emg.params.progress > 0,
  );
  const before = await readEmg(page);

  await page.evaluate(() => {
    const gl = (document.getElementById('app') as HTMLCanvasElement).getContext('webgl2');
    if (!gl) throw new Error('no webgl2 context on #app');
    const ext = gl.getExtension('WEBGL_lose_context');
    if (!ext) throw new Error('WEBGL_lose_context unavailable');
    (window as unknown as { __lose: WEBGL_lose_context }).__lose = ext;
    ext.loseContext();
  });
  await page.waitForFunction(() =>
    (document.getElementById('app') as HTMLCanvasElement).getContext('webgl2')!.isContextLost(),
  );
  await page.evaluate(() => (window as unknown as { __lose: WEBGL_lose_context }).__lose.restoreContext());
  await page.waitForFunction(
    () => !(document.getElementById('app') as HTMLCanvasElement).getContext('webgl2')!.isContextLost(),
  );

  // The loop resumes at the same tier, and progress frozen during the loss
  // carries over (720 s cycle: normal test-time drift stays well under 0.02).
  const after = await readEmg(page);
  expect(after.tier).toBe('high');
  expect(after.texSize).toBe(1024);
  expect(Math.abs(after.progress - before.progress)).toBeLessThan(0.02);

  // ...and keeps advancing — live frames, not a stale __emg snapshot.
  await page.waitForFunction(
    (prev) => (window as unknown as { __emg: Emg }).__emg.params.progress > prev,
    after.progress,
  );

  // Still painting: the recovered frame is not black.
  const png = PNG.sync.read(await page.screenshot());
  expect(frameMean(png)).toBeGreaterThan(2);

  // The deliberate loseContext() emits browser-level CONTEXT_LOST messages;
  // anything else is a real error.
  const real = errors.filter((e) => !/context.?lost/i.test(e));
  expect(real).toEqual([]);
});
