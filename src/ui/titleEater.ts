// src/ui/titleEater.ts
import { mulberry32 } from '../sim/random';

// Each letter of the title is wrapped in its own span once, so the eater can
// independently collapse one letter's width/opacity while the rest of the
// line holds its layout. Spaces are wrapped too (an eaten space is a no-op
// visually but keeps the index space 1:1 with the source string).
interface LetterState {
  el: HTMLSpanElement;
  eaten: boolean; // true from the moment it's picked until it regrows
  regrowAt: number; // real-world seconds (accumulated via update's dtSeconds) to begin regrow
}

const CLONE_TRAVEL_SECONDS = 3;
const COLLAPSE_SECONDS = 1;
const REGROW_AFTER_SECONDS = 10;

export function createTitleEater(
  titleEl: HTMLElement,
  cadenceFraction: [number, number],
  seed: number,
): {
  update(dtSeconds: number, cycleSeconds: number, holeScreenXY: [number, number]): void;
  reset(castSeed: number): void;
  dispose(): void;
} {
  let rand = mulberry32(seed);
  const originalText = titleEl.textContent ?? '';

  const letters: LetterState[] = [];
  titleEl.textContent = '';
  for (const ch of originalText) {
    const span = document.createElement('span');
    span.textContent = ch;
    span.style.display = 'inline-block';
    span.style.whiteSpace = 'pre';
    span.style.transition = `width ${COLLAPSE_SECONDS}s ease, opacity ${COLLAPSE_SECONDS}s ease`;
    span.style.overflow = 'hidden';
    span.style.verticalAlign = 'top';
    titleEl.appendChild(span);
    letters.push({ el: span, eaten: false, regrowAt: 0 });
  }

  const clones: Array<{
    el: HTMLSpanElement;
    startX: number;
    startY: number;
    controlX: number;
    controlY: number;
    endX: number;
    endY: number;
    t: number; // 0..1 progress along the curve
  }> = [];

  let elapsed = 0; // cycle-progress fraction since the last firing (spec's 90-150s @ 720s cadence)
  let elapsedSeconds = 0; // real-world seconds, drives clone travel + regrow
  let nextFireAt = cadenceFraction[0] + rand() * (cadenceFraction[1] - cadenceFraction[0]);

  function pickUneatenIndex(): number {
    const candidates: number[] = [];
    for (let i = 0; i < letters.length; i++) {
      if (!letters[i]!.eaten && letters[i]!.el.textContent !== ' ') candidates.push(i);
    }
    if (candidates.length === 0) return -1;
    return candidates[Math.floor(rand() * candidates.length)]!;
  }

  function fire(holeScreenXY: [number, number]): void {
    const idx = pickUneatenIndex();
    if (idx < 0) return;
    const letter = letters[idx]!;
    const rect = letter.el.getBoundingClientRect();
    const startX = rect.left + rect.width / 2;
    const startY = rect.top + rect.height / 2;

    const clone = document.createElement('span');
    clone.textContent = letter.el.textContent;
    clone.style.position = 'fixed';
    clone.style.left = `${startX}px`;
    clone.style.top = `${startY}px`;
    clone.style.transform = 'translate(-50%, -50%) scale(1)';
    clone.style.opacity = '1';
    clone.style.pointerEvents = 'none';
    clone.style.color = getComputedStyle(letter.el).color;
    clone.style.font = getComputedStyle(letter.el).font;
    clone.style.zIndex = '9999';
    document.body.appendChild(clone);

    // Quadratic control point: bow the path slightly above the straight line
    // so the clone doesn't travel dead-straight into the hole.
    const midX = (startX + holeScreenXY[0]) / 2;
    const midY = (startY + holeScreenXY[1]) / 2 - 40;

    clones.push({
      el: clone,
      startX,
      startY,
      controlX: midX,
      controlY: midY,
      endX: holeScreenXY[0],
      endY: holeScreenXY[1],
      t: 0,
    });

    letter.eaten = true;
    letter.regrowAt = elapsedSeconds + REGROW_AFTER_SECONDS;
    // Collapse the original over COLLAPSE_SECONDS via the CSS transition set up
    // at construction time — flipping width/opacity here is what triggers it.
    letter.el.style.width = '0px';
    letter.el.style.opacity = '0';
  }

  return {
    update(dtSeconds, cycleSeconds, holeScreenXY): void {
      // Firing cadence stays a cycle-progress fraction (the spec's 90-150s @
      // 720s cadence, still testable at compressed cycles).
      elapsed += dtSeconds / cycleSeconds;
      elapsedSeconds += dtSeconds;

      if (elapsed >= nextFireAt) {
        fire(holeScreenXY);
        nextFireAt = elapsed + cadenceFraction[0] + rand() * (cadenceFraction[1] - cadenceFraction[0]);
      }

      // Advance in-flight clones along their quadratic curve — real seconds,
      // so a clone always takes CLONE_TRAVEL_SECONDS to reach the hole
      // regardless of cycle length.
      for (let i = clones.length - 1; i >= 0; i--) {
        const c = clones[i]!;
        c.t += dtSeconds / CLONE_TRAVEL_SECONDS;
        if (c.t >= 1) {
          c.el.remove();
          clones.splice(i, 1);
          continue;
        }
        const u = 1 - c.t;
        const x = u * u * c.startX + 2 * u * c.t * c.controlX + c.t * c.t * c.endX;
        const y = u * u * c.startY + 2 * u * c.t * c.controlY + c.t * c.t * c.endY;
        const scale = 1 - c.t;
        c.el.style.left = `${x}px`;
        c.el.style.top = `${y}px`;
        c.el.style.transform = `translate(-50%, -50%) scale(${scale})`;
        c.el.style.opacity = `${1 - c.t}`;
      }

      // Regrow letters whose timer has elapsed — real seconds, so a letter
      // always begins regrowing REGROW_AFTER_SECONDS after being eaten.
      for (const letter of letters) {
        if (letter.eaten && elapsedSeconds >= letter.regrowAt) {
          letter.eaten = false;
          letter.el.style.width = '';
          letter.el.style.opacity = '1';
        }
      }
    },
    reset(castSeed): void {
      rand = mulberry32(castSeed ^ 0x51ed);
      elapsed = 0;
      elapsedSeconds = 0;
      nextFireAt = cadenceFraction[0] + rand() * (cadenceFraction[1] - cadenceFraction[0]);
      for (const c of clones) c.el.remove();
      clones.length = 0;
      for (const letter of letters) {
        letter.eaten = false;
        letter.el.style.width = '';
        letter.el.style.opacity = '1';
      }
    },
    dispose(): void {
      for (const c of clones) c.el.remove();
      clones.length = 0;
      titleEl.textContent = originalText;
    },
  };
}
