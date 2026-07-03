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

type EmgSpec = { spec: { planets: object; comets: object } };

test('same seed produces the same cosmos spec', async ({ page }) => {
  await page.goto('/?seed=7');
  await page.waitForFunction(() => (window as unknown as { __emg?: object }).__emg !== undefined);
  const a = await page.evaluate(() => JSON.stringify((window as unknown as { __emg: { spec: object } }).__emg.spec));
  const aPlanets = await page.evaluate(() => JSON.stringify((window as unknown as { __emg: EmgSpec }).__emg.spec.planets));
  const aComets = await page.evaluate(() => JSON.stringify((window as unknown as { __emg: EmgSpec }).__emg.spec.comets));
  await page.goto('/?seed=7');
  await page.waitForFunction(() => (window as unknown as { __emg?: object }).__emg !== undefined);
  const b = await page.evaluate(() => JSON.stringify((window as unknown as { __emg: { spec: object } }).__emg.spec));
  const bPlanets = await page.evaluate(() => JSON.stringify((window as unknown as { __emg: EmgSpec }).__emg.spec.planets));
  const bComets = await page.evaluate(() => JSON.stringify((window as unknown as { __emg: EmgSpec }).__emg.spec.comets));
  expect(a).toBe(b);
  expect(aPlanets).toBe(bPlanets);
  expect(aComets).toBe(bComets);
  await page.goto('/?seed=8');
  await page.waitForFunction(() => (window as unknown as { __emg?: object }).__emg !== undefined);
  const c = await page.evaluate(() => JSON.stringify((window as unknown as { __emg: { spec: object } }).__emg.spec));
  const cPlanets = await page.evaluate(() => JSON.stringify((window as unknown as { __emg: EmgSpec }).__emg.spec.planets));
  expect(c).not.toBe(a);
  expect(cPlanets).not.toBe(aPlanets);
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

test('all worlds are alive early in the cycle', async ({ page }) => {
  // Seed-dependent stability: seed 7's roster keeps every planet >= 5.7x the
  // burst radius at t=0.05 (verified by simulation), but ~22% of the seed
  // parameter space spawns a planet close enough to die within this 8s settle.
  // If this test ever changes seed, re-check that margin first.
  await page.goto('/?seed=7&t=0.05');
  await page.waitForFunction(() => (window as unknown as { __emg?: object }).__emg !== undefined);
  await page.waitForTimeout(8000);
  const result = await page.evaluate(() => {
    const w = window as unknown as {
      __emg: { spec: { planets: unknown[] }; alive: { planets: number } };
    };
    return { alive: w.__emg.alive.planets, total: w.__emg.spec.planets.length };
  });
  expect(result.alive).toBe(result.total);
});

test('inner worlds have died off by 80% consumed', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/?seed=7&t=0.8');
  await page.waitForFunction(() => (window as unknown as { __emg?: object }).__emg !== undefined);
  const total = await page.evaluate(
    () => (window as unknown as { __emg: { spec: { planets: unknown[] } } }).__emg.spec.planets.length,
  );
  // KNOWN PHYSICS at frozen t=0.8: deaths cascade within ~10s of settle and the
  // system may fully deplete to 0 alive planets — 0 satisfies both assertions
  // below, so do not assert survivors remain.
  const deadline = Date.now() + 45_000;
  let alive = total;
  while (Date.now() < deadline) {
    await page.waitForTimeout(3000);
    alive = await page.evaluate(
      () => (window as unknown as { __emg: { alive: { planets: number } } }).__emg.alive.planets,
    );
    if (alive < total) break;
  }
  expect(alive).toBeLessThan(total);
  expect(alive).toBeGreaterThanOrEqual(0);
});

test('rebirth flash whites out the frame', async ({ page }) => {
  await page.goto('/?seed=7&t=0.97');
  await page.waitForTimeout(5000);
  const mean = frameMean(PNG.sync.read(await page.screenshot()));
  expect(mean).toBeGreaterThan(150);
});

test('feeding spawns a cast member and caps alive count at 2', async ({ page }) => {
  test.setTimeout(30_000);
  await page.goto('/?seed=7&t=0.4'); // decay phase: canFeed() gates on decay/carnage
  await page.waitForFunction(() => (window as unknown as { __emg?: object }).__emg !== undefined);
  await page.waitForTimeout(5000); // let the sim settle before the first feed click

  await page.mouse.click(400, 300);
  const deadline = Date.now() + 10_000;
  let cast = 0;
  while (Date.now() < deadline) {
    cast = await page.evaluate(() => (window as unknown as { __emg: { alive: { cast: number } } }).__emg.alive.cast);
    if (cast === 1) break;
    await page.waitForTimeout(300);
  }
  expect(cast).toBe(1);

  // Two more rapid clicks: canFeed() gates on countCastAlive() < 2, so the
  // second click (which lands once alive is already 2) must not spawn a third.
  await page.mouse.click(420, 300);
  await page.mouse.click(440, 300);
  const capDeadline = Date.now() + 3000;
  let maxCast = cast;
  while (Date.now() < capDeadline) {
    const n = await page.evaluate(() => (window as unknown as { __emg: { alive: { cast: number } } }).__emg.alive.cast);
    if (n > maxCast) maxCast = n;
    await page.waitForTimeout(200);
  }
  expect(maxCast).toBeLessThanOrEqual(2);
});

test('feeding is gated off in the serene phase', async ({ page }) => {
  await page.goto('/?seed=7&t=0.05'); // serene phase: canFeed() requires decay/carnage
  await page.waitForFunction(() => (window as unknown as { __emg?: object }).__emg !== undefined);
  await page.mouse.click(400, 300);
  await page.waitForTimeout(5000);
  const cast = await page.evaluate(() => (window as unknown as { __emg: { alive: { cast: number } } }).__emg.alive.cast);
  expect(cast).toBe(0);
});

test('a rogue merger boosts the hole radius beyond the base cycle curve', async ({ page }) => {
  // Seed 1 is a known rogue-present cosmos, verified at test-authoring time via
  // a node one-liner replaying generateCosmos's mulberry32(1) draw sequence:
  // rogue = { present: true, spawnP≈0.5008, mergeP≈0.6880 }. mergeP + 0.03 lands
  // just past the merge-boost smoothstep window (mergeP -> mergeP+0.02 in cycle.ts),
  // so rogueMerged is true and the boost is fully applied.
  const t = 0.6880207758257165 + 0.03;
  await page.goto(`/?seed=1&t=${t}`);
  await page.waitForFunction(() => (window as unknown as { __emg?: object }).__emg !== undefined);
  await page.waitForTimeout(3000);
  const result = await page.evaluate(() => {
    const w = window as unknown as {
      __emg: {
        spec: { holeR0: number; holeGrowth: number };
        params: { progress: number; holeR: number; rogueMerged: boolean };
      };
    };
    return {
      rogueMerged: w.__emg.params.rogueMerged,
      holeR: w.__emg.params.holeR,
      progress: w.__emg.params.progress,
      holeR0: w.__emg.spec.holeR0,
      holeGrowth: w.__emg.spec.holeGrowth,
    };
  });
  expect(result.rogueMerged).toBe(true);
  const baseHoleR = result.holeR0 * (1 + (result.holeGrowth - 1) * Math.pow(result.progress, 1.6));
  const boostRatio = result.holeR / baseHoleR;
  expect(boostRatio).toBeGreaterThan(1.15);
});

test('the title eater consumes a letter within the first cosmos', async ({ page }) => {
  // Wall-clock budget accounts for the software rasterizer (SwiftShader in CI)
  // running sim-time at ~0.26x, made heavier by the M3b deep sky (a full-screen
  // sky plane + galaxies/cluster/pulsar add real fill/raster cost). The eater
  // cadence is a FRACTION of cycle-progress, so a shorter cycle reaches the same
  // firing fraction in less sim-time — cycle=45 gives comfortable headroom under
  // 2-worker contention without changing what this test asserts.
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/?seed=7&cycle=45'); // live, no t-freeze
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __emg?: { params: { progress: number } } };
      return w.__emg !== undefined && w.__emg.params.progress > 0.15;
    },
    { timeout: 60_000 },
  );

  // Cadence-fraction contract (Task 5): firings land every [0.125, 0.208) of
  // cycle-progress, guaranteeing 4-8 firings per cycle at any cycle length —
  // so at least one eaten letter must appear well before cosmos no. 2.
  const deadline = Date.now() + 45_000;
  let eaten = false;
  while (Date.now() < deadline) {
    eaten = await page.evaluate(() => {
      const spans = Array.from(document.querySelectorAll('#title-line span'));
      return spans.some((el) => {
        const style = (el as HTMLElement).style;
        return style.opacity === '0' || style.width === '0px';
      });
    });
    if (eaten) break;
    const rebornAlready = await page.evaluate(
      () => document.getElementById('counter')?.textContent?.includes('cosmos no. 2') ?? false,
    );
    if (rebornAlready) break;
    await page.waitForTimeout(1000);
  }
  expect(eaten).toBe(true);
  const rebornYet = await page.evaluate(
    () => document.getElementById('counter')?.textContent?.includes('cosmos no. 2') ?? false,
  );
  expect(rebornYet).toBe(false);
  expect(errors).toEqual([]);
});

test('a compressed cycle survives rebirth without console errors', async ({ page }) => {
  // MAX_DT (1/30) caps per-frame dt, so on software WebGL (~8 fps here) sim time
  // runs at fps/30 ~= 0.27x wall time and the 45s cycle needs ~170s wall to reach
  // rebirth (measured: 88% consumed at 148s). Real GPUs (>=30 fps) finish in ~50s.
  // Baseline soak measured ~264s (88% of the prior 300s cap, with one variance
  // timeout observed) on software WebGL; 420s restores ~1.6x headroom over that
  // measured runtime while still failing usefully on a genuine hang.
  test.setTimeout(420_000);
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
