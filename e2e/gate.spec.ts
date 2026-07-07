// e2e/gate.spec.ts
import { expect, test, type Page } from '@playwright/test';

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}

// Wraps window.AudioContext, before any page script runs, in a Proxy that
// records every constructed instance on window.__audioContextInstances. Used
// to prove the silent path never touches WebAudio and the sound path touches
// it exactly once.
async function installAudioContextCounter(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const win = window as unknown as {
      AudioContext?: typeof AudioContext;
      __audioContextInstances: AudioContext[];
    };
    win.__audioContextInstances = [];
    const Native = win.AudioContext;
    if (!Native) return;
    win.AudioContext = new Proxy(Native, {
      construct(target, args): AudioContext {
        const instance = Reflect.construct(target, args) as AudioContext;
        win.__audioContextInstances.push(instance);
        return instance;
      },
    });
  });
}

async function audioContextCount(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as unknown as { __audioContextInstances: AudioContext[] }).__audioContextInstances.length,
  );
}

async function audioContextStates(page: Page): Promise<AudioContextState[]> {
  return page.evaluate(() =>
    (window as unknown as { __audioContextInstances: AudioContext[] }).__audioContextInstances.map(
      (ctx) => ctx.state,
    ),
  );
}

test('gate shows on canonical entry with both buttons, toggle stays hidden', async ({ page }) => {
  const errors = collectConsoleErrors(page);

  await page.goto('/');
  await expect(page.locator('#enter-gate')).toBeVisible();
  await expect(page.locator('#enter-sound')).toBeVisible();
  await expect(page.locator('#enter-silent')).toBeVisible();
  await expect(page.locator('#sound-toggle')).toBeHidden();

  expect(errors).toEqual([]);
});

test('entering silent dismisses the gate and creates no AudioContext', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await installAudioContextCounter(page);

  await page.goto('/');
  await page.click('#enter-silent');

  await expect(page.locator('#enter-gate')).toBeHidden();
  await expect(page.locator('#sound-toggle')).toBeVisible();
  await page.waitForFunction(() => (window as unknown as { __emg?: object }).__emg !== undefined);

  expect(await audioContextCount(page)).toBe(0);
  expect(errors).toEqual([]);
});

test('entering with sound unlocks exactly one AudioContext', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await installAudioContextCounter(page);

  await page.goto('/');
  await page.click('#enter-sound');

  await expect(page.locator('#enter-gate')).toBeHidden();
  await expect.poll(() => audioContextCount(page)).toBe(1);

  // 'running', not merely not-'closed': a context stuck 'suspended' means the
  // sound chooser gets total silence — the exact regression this test guards.
  // Playwright clicks are trusted gestures, so headless Chromium resumes.
  await expect.poll(async () => (await audioContextStates(page))[0]).toBe('running');

  expect(errors).toEqual([]);
});

test('a bare cycle param keeps the gate (audition seam), seed+cycle skips it', async ({ page }) => {
  const errors = collectConsoleErrors(page);

  // The audition seam (bbd5120): ?cycle alone is a canonical-with-short-cycle
  // entry and MUST show the gate so sound can be chosen.
  await page.goto('/?cycle=60');
  await expect(page.locator('#enter-gate')).toBeVisible();

  // Any programmatic param still skips, even alongside cycle.
  await page.goto('/?seed=1&cycle=45');
  await expect(page.locator('#enter-gate')).toBeHidden();

  expect(errors).toEqual([]);
});

test('the corner toggle unlocks after silent entry and mutes after sound entry', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await installAudioContextCounter(page);

  // Silent entry: no context. Toggling ON is a gesture — it must unlock
  // (create+run exactly one context) and reflect the on state.
  await page.goto('/');
  await page.click('#enter-silent');
  expect(await audioContextCount(page)).toBe(0);

  await page.click('#sound-toggle');
  await expect.poll(() => audioContextCount(page)).toBe(1);
  await expect.poll(async () => (await audioContextStates(page))[0]).toBe('running');
  await expect(page.locator('#sound-toggle')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => localStorage.getItem('emg-sound'))).toBe('on');

  // Toggling OFF must reflect the muted state on the first click (the
  // toggledOn sync fixed in 77f10fb) — no second context, state flipped.
  await page.click('#sound-toggle');
  await expect(page.locator('#sound-toggle')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => localStorage.getItem('emg-sound'))).toBe('off');
  expect(await audioContextCount(page)).toBe(1);

  expect(errors).toEqual([]);
});

test('the corner toggle persists preference and pre-selects it on reload', async ({ page }) => {
  const errors = collectConsoleErrors(page);

  await page.goto('/');
  await page.click('#enter-sound');
  await expect(page.locator('#sound-toggle')).toBeVisible();

  await page.click('#sound-toggle');
  const stored = await page.evaluate(() => localStorage.getItem('emg-sound'));
  expect(stored).toBe('off');

  await page.reload();
  await expect(page.locator('#enter-gate')).toBeVisible();
  await expect(page.locator('#enter-silent')).toHaveClass(/preferred/);

  expect(errors).toEqual([]);
});

test('programmatic entry with ?seed skips the gate', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await installAudioContextCounter(page);

  await page.goto('/?seed=1');
  await expect(page.locator('#enter-gate')).toBeHidden();
  await page.waitForFunction(() => (window as unknown as { __emg?: object }).__emg !== undefined);

  // The skip path is silent by contract: no gesture, so no AudioContext.
  expect(await audioContextCount(page)).toBe(0);
  expect(errors).toEqual([]);
});
