// e2e/smoke.spec.ts
import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';

function luminanceAt(png: PNG, x: number, y: number): number {
  const i = (png.width * y + x) << 2;
  return (png.data[i]! + png.data[i + 1]! + png.data[i + 2]!) / 3;
}

function regionStats(
  png: PNG,
  cx: number,
  cy: number,
  half: number,
): { mean: number; max: number } {
  let sum = 0;
  let max = 0;
  let n = 0;
  for (let y = cy - half; y <= cy + half; y++) {
    for (let x = cx - half; x <= cx + half; x++) {
      const l = luminanceAt(png, x, y);
      sum += l;
      max = Math.max(max, l);
      n++;
    }
  }
  return { mean: sum / n, max };
}

test('money shot renders: webgl2, no errors, shadow + ring pixels', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.goto('/?tier=high');
  await page.waitForFunction(() => (window as unknown as { __emg?: object }).__emg !== undefined);
  // Bare `/` shows the enter gate (the canonical-entry path) — dismiss it via
  // "Enter silent" before the money-shot pixel assertions below, exercising
  // the real gate path while keeping the assertions against the live scene.
  await page.click('#enter-silent');
  await page.waitForTimeout(3000);

  const hasWebgl2 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    return c.getContext('webgl2') !== null;
  });
  expect(hasWebgl2).toBe(true);
  expect(errors).toEqual([]);

  const png = PNG.sync.read(await page.screenshot());
  const cx = Math.floor(png.width / 2);
  const cy = Math.floor(png.height / 2);

  const shadow = regionStats(png, cx, cy, 6);
  expect(shadow.mean).toBeLessThan(10);

  let ringMax = 0;
  for (let a = 0; a < 64; a++) {
    const ang = (a / 64) * Math.PI * 2;
    for (const rr of [0.04, 0.05, 0.06, 0.07, 0.08]) {
      const x = Math.round(cx + Math.cos(ang) * png.height * rr);
      const y = Math.round(cy + Math.sin(ang) * png.height * rr);
      ringMax = Math.max(ringMax, luminanceAt(png, x, y));
    }
  }
  expect(ringMax).toBeGreaterThan(180);

  const whole = regionStats(png, cx, cy, Math.floor(png.height / 2) - 2);
  expect(whole.mean).toBeGreaterThan(2);
  // Guards against the bloom-washout failure mode from Task 7 tuning (whole frame
  // flooding white): a healthy frame measures ~66 here, a washout reads 200+.
  expect(whole.mean).toBeLessThan(110);
});

test('sustains at least 30 fps locally', async ({ page }) => {
  test.skip(!!process.env.CI, 'headless CI GPUs are not representative');
  await page.goto('/?tier=high');
  await page.waitForFunction(() => (window as unknown as { __emg?: object }).__emg !== undefined);
  await page.click('#enter-silent');
  const renderer = await page.evaluate(() => {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return 'no webgl2 context';
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return dbg
      ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL))
      : String(gl.getParameter(gl.RENDERER));
  });
  test.skip(
    /swiftshader|software|llvmpipe/i.test(renderer),
    `software rasterizer (${renderer}): fps is not representative of a real GPU`,
  );
  await page.waitForTimeout(2000);
  const fps = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let frames = 0;
        const start = performance.now();
        function tick(): void {
          frames++;
          if (performance.now() - start >= 2000) resolve(frames / 2);
          else requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      }),
  );
  expect(fps).toBeGreaterThan(30);
});
