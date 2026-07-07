// src/boot.ts
// Entry module. Boot guards run before ANY three.js construction (M6 Global
// Constraints: "Boot guards precede construction"). main.ts does all of its
// work at module scope — renderer, sim, rAF loop, gate — so the dynamic
// import below IS the boot: skipping it (no WebGL2) or deferring it behind
// the play click (reduced motion) is what keeps those paths free of
// construction, auto-starting motion, and console errors.
import { showPoster } from './ui/poster';

if (document.createElement('canvas').getContext('webgl2') === null) {
  showPoster(null);
} else if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
  showPoster(() => void import('./main'));
} else {
  void import('./main');
}
