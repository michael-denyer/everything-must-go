// src/ui/enterGate.ts
// The enter gate, corner sound toggle, and about overlay — pure DOM, no
// WebAudio. Fires injected callbacks on the gate-button click (the user
// gesture the audio engine needs to unlock) and on the corner toggle; the
// conductor (main.ts, Task 4) wires those callbacks to createAudioEngine().

const STORAGE_KEY = 'emg-sound';

function readStoredPreference(): 'on' | 'off' | null {
  // localStorage access is ALWAYS guarded — Safari private mode throws on
  // getItem/setItem, and that must never break the gate.
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'on' || v === 'off' ? v : null;
  } catch {
    return null;
  }
}

function writeStoredPreference(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    // private-mode / storage-disabled — silently drop the preference.
  }
}

export function createEnterGate(opts: {
  onEnter: (withSound: boolean) => void; // fired on a gate-button click (the user gesture)
  onToggleSound: (on: boolean) => void; // fired on the corner toggle
}): {
  shouldSkip(): boolean;
  showIfNeeded(): void;
  setSoundState(on: boolean): void;
} {
  const gate = document.getElementById('enter-gate');
  const enterSoundBtn = document.getElementById('enter-sound');
  const enterSilentBtn = document.getElementById('enter-silent');
  const aboutLink = document.getElementById('about-link');
  const about = document.getElementById('about');
  const aboutClose = document.getElementById('about-close');
  const soundToggle = document.getElementById('sound-toggle');

  // Current sound state as reflected by the corner toggle. Kept in sync by
  // enter() so the toggle's first click after entry flips from the true state
  // (entering with sound then clicking the toggle must MUTE, not re-enable).
  let toggledOn = false;

  function applyToggleGlyph(on: boolean): void {
    if (soundToggle) {
      soundToggle.textContent = on ? '🔊' : '🔈';
      soundToggle.setAttribute('aria-label', on ? 'sound: on' : 'sound: off');
      soundToggle.setAttribute('aria-pressed', String(on));
    }
  }

  function hideGate(): void {
    gate?.classList.add('hidden');
  }

  function revealToggle(): void {
    soundToggle?.classList.remove('hidden');
  }

  function openAbout(): void {
    about?.classList.remove('hidden');
  }

  function closeAbout(): void {
    about?.classList.add('hidden');
  }

  function enter(withSound: boolean): void {
    writeStoredPreference(withSound);
    hideGate();
    revealToggle();
    toggledOn = withSound; // sync the toggle state so the first mute-click isn't inverted
    applyToggleGlyph(withSound);
    opts.onEnter(withSound);
  }

  enterSoundBtn?.addEventListener('click', () => enter(true));
  enterSilentBtn?.addEventListener('click', () => enter(false));
  aboutLink?.addEventListener('click', (e) => {
    e.preventDefault();
    openAbout();
  });
  aboutClose?.addEventListener('click', () => closeAbout());

  soundToggle?.addEventListener('click', () => {
    toggledOn = !toggledOn;
    writeStoredPreference(toggledOn);
    applyToggleGlyph(toggledOn);
    opts.onToggleSound(toggledOn);
  });

  return {
    shouldSkip(): boolean {
      // The enter-gate / e2e SEAM (see .planning/superpowers/plans/2026-07-03-milestone-5-sound.md,
      // "Global Constraints"): the 15 existing e2e tests + the dev workflow
      // load `/?seed=...&t=...&debug=...` and expect the scene to render
      // immediately, silent, with no gate in the way. Any of these params
      // present means a programmatic/dev entry, not a canonical visitor —
      // skip the gate entirely and start silent.
      const params = new URLSearchParams(location.search);
      return (
        params.has('seed') || params.has('t') || params.has('cycle') || params.has('debug')
      );
    },
    showIfNeeded(): void {
      if (this.shouldSkip()) return;
      // Pre-select/emphasize a stored preference on the buttons, but the
      // gate is still shown on every canonical entry (per spec: everyone
      // arrives at the gate).
      const stored = readStoredPreference();
      if (stored === 'on') {
        enterSoundBtn?.classList.add('preferred');
      } else if (stored === 'off') {
        enterSilentBtn?.classList.add('preferred');
      }
      gate?.classList.remove('hidden');
    },
    setSoundState(on: boolean): void {
      toggledOn = on;
      applyToggleGlyph(on);
    },
  };
}
