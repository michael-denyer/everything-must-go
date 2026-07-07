// src/boot.ts
// Entry module. Boot guards run before ANY three.js construction (M6 Global
// Constraints: "Boot guards precede construction"). main.ts does all of its
// work at module scope — renderer, sim, rAF loop, gate — so the dynamic
// import below IS the boot: skipping it (no WebGL2) or deferring it behind
// the play click (reduced motion) is what keeps those paths free of
// construction, auto-starting motion, and console errors.
import { showPoster } from './ui/poster';

// A rejected chunk fetch or a module-scope throw in main.ts (including a
// WebGLRenderer that fails where the scratch probe passed) must never leave
// a black page: fall back to the poster. On the reduced-motion path the play
// button stays wired, so clicking it retries the import.
function boot(): void {
  import('./main').catch((err: unknown) => {
    console.error('[emg] boot failed', err);
    showPoster(null);
  });
}

if (document.createElement('canvas').getContext('webgl2') === null) {
  showPoster(null);
} else if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
  showPoster(boot);
} else {
  boot();
}
