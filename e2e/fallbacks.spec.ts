// e2e/fallbacks.spec.ts
import { expect, test, type Page } from '@playwright/test';

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}

function hasEmg(page: Page): Promise<boolean> {
  return page.evaluate(() => '__emg' in window);
}

test('missing webgl2 shows the poster and constructs nothing', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.addInitScript(() => {
    const native = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      ...args: Parameters<typeof native>
    ) {
      if (args[0] === 'webgl2') return null;
      return native.apply(this, args);
    } as typeof native;
  });

  await page.goto('/?tier=high');
  await expect(page.locator('#poster')).toBeVisible();
  await expect(page.locator('#poster-about')).toBeVisible();
  await expect(page.locator('#poster-play')).toBeHidden();

  // Not just a visible <img> element — a decoded image, proving og.jpg
  // resolved from this page's base (the relative-src seam).
  await expect
    .poll(() => page.evaluate(() => document.querySelector<HTMLImageElement>('#poster img')?.naturalWidth ?? 0))
    .toBeGreaterThan(0);

  // The pre-boot about overlay is live DOM, not decoration: open and close it
  // (review-caught — visibility alone was code-verified, never exercised).
  await page.click('#poster-about');
  await expect(page.locator('#about')).toBeVisible();
  await page.click('#about-close');
  await expect(page.locator('#about')).toBeHidden();

  // Settled module graph (no fetch still about to boot main), then: no boot.
  await page.waitForLoadState('networkidle');
  expect(await hasEmg(page)).toBe(false);
  expect(errors).toEqual([]);
});

test.describe('prefers-reduced-motion', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('poster pauses the piece; play boots it and the gate appears', async ({ page }) => {
    const errors = collectConsoleErrors(page);

    await page.goto('/?tier=high');
    await expect(page.locator('#poster')).toBeVisible();
    await expect(page.locator('#poster-play')).toBeVisible();

    // No auto-starting motion: main.ts stays un-imported until the click.
    await page.waitForLoadState('networkidle');
    expect(await hasEmg(page)).toBe(false);

    await page.click('#poster-play');
    await expect(page.locator('#poster')).toBeHidden();
    await page.waitForFunction(() => '__emg' in window);
    // Canonical URL (?tier never skips the gate): entry still flows through it.
    await expect(page.locator('#enter-gate')).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test('programmatic entry boots straight past the poster', async ({ page }) => {
  const errors = collectConsoleErrors(page);

  await page.goto('/?seed=7&tier=high');
  await page.waitForFunction(() => '__emg' in window);
  await expect(page.locator('#poster')).toBeHidden();
  expect(errors).toEqual([]);
});

test('meta and OG tags carry absolute Pages URLs', async ({ page }) => {
  await page.goto('/?tier=high');
  const content = (sel: string): Promise<string | null> => page.locator(sel).getAttribute('content');

  expect(await content('meta[name="description"]')).toContain('black hole');
  expect(await content('meta[property="og:title"]')).toBe('Everything Must Go');
  expect(await content('meta[property="og:description"]')).toContain('black hole');
  expect(await content('meta[property="og:type"]')).toBe('website');
  expect(await content('meta[name="twitter:card"]')).toBe('summary_large_image');
  // Social scrapers do not resolve relative URLs: both must be absolute.
  expect(await content('meta[property="og:url"]')).toBe('https://michael-denyer.github.io/everything-must-go/');
  expect(await content('meta[property="og:image"]')).toBe('https://michael-denyer.github.io/everything-must-go/og.jpg');
});
