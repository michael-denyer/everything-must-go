// src/boot.ts
// Entry module. Boot guards run before ANY three.js construction (M6 Global
// Constraints: "Boot guards precede construction"). main.ts does all of its
// work at module scope — renderer, sim, rAF loop, gate — so the dynamic
// import below IS the boot: skipping it (no WebGL2) or deferring it behind
// the play click (reduced motion) is what keeps those paths free of
// construction, auto-starting motion, and console errors.
import { hidePoster, showPoster, showPosterFailure } from './ui/poster';

// A rejected chunk fetch or a module-scope throw in main.ts (including a
// WebGLRenderer that fails where the scratch probe passed) must never leave
// a black page. Failure is terminal — the module map caches the evaluation
// error, so a re-import cannot succeed — so the poster drops its Play button
// and says reload. On success the poster (if shown) comes down only once the
// chunk is live, so the reduced-motion path never flashes black mid-download.
function boot(): void {
  import('./main')
    .then(() => hidePoster())
    .catch((err: unknown) => {
      console.error('[emg] boot failed', err);
      showPosterFailure();
    });
}

if (document.createElement('canvas').getContext('webgl2') === null) {
  showPoster(null);
} else if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
  showPoster(boot);
} else {
  boot();
}
