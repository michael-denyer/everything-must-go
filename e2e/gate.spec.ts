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

  const states = await audioContextStates(page);
  expect(states.length).toBe(1);
  expect(states[0]).not.toBe('closed');

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

  await page.goto('/?seed=1');
  await expect(page.locator('#enter-gate')).toBeHidden();
  await page.waitForFunction(() => (window as unknown as { __emg?: object }).__emg !== undefined);

  expect(errors).toEqual([]);
});
