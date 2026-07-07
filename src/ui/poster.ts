// src/ui/poster.ts
// The failure-path poster: the pre-rendered money shot shown instead of (no
// WebGL2) or ahead of (reduced motion) the live piece. Pure DOM — it must work
// when nothing else can, so it never imports three.js or main.ts.

export function showPoster(play: (() => void) | null): void {
  const poster = document.getElementById('poster');
  const playBtn = document.getElementById('poster-play');
  const aboutLink = document.getElementById('poster-about');
  const about = document.getElementById('about');
  const aboutClose = document.getElementById('about-close');

  aboutLink?.addEventListener('click', () => about?.classList.remove('hidden'));
  // enterGate.ts wires this same close button once main.ts boots (the
  // reduced-motion path); both handlers add the class, so stacking is harmless.
  aboutClose?.addEventListener('click', () => about?.classList.add('hidden'));

  if (play !== null) {
    playBtn?.classList.remove('hidden');
    playBtn?.addEventListener('click', () => {
      poster?.classList.add('hidden');
      play();
    });
  }
  poster?.classList.remove('hidden');
}
