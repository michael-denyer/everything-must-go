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
    // The poster stays up while the main chunk loads — boot.ts hides it on
    // import success. Hiding here would flash black for the whole download.
    playBtn?.addEventListener('click', () => play());
  }
  poster?.classList.remove('hidden');
}

export function hidePoster(): void {
  document.getElementById('poster')?.classList.add('hidden');
}

// Terminal boot failure: ES module maps cache a module-scope evaluation error,
// so re-importing can never succeed — hide the dead Play affordance and say so.
export function showPosterFailure(): void {
  document.getElementById('poster-play')?.classList.add('hidden');
  const line = document.getElementById('poster-line');
  if (line) line.textContent = 'the live piece could not start on this device — reload to retry';
  document.getElementById('poster')?.classList.remove('hidden');
}
