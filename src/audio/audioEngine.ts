// The WebAudio engine: an ominous cinematic arrangement, fully synthesized.
//
// Rather than holding static drones (which read as a foghorn, not music), this
// runs a lookahead note SCHEDULER that plays the composition model
// (composition.ts) — a moving minor-key chord progression on synth strings, a
// bass ostinato, timpani, and a melodic motif — with layers entering as the
// cycle intensity (progress) rises. The overall level is gated by fade² so
// darkness is true silence; the rebirth resolution routes around that gate.
//
// Hard rule (autoplay + headless/node): the AudioContext is constructed ONLY in
// unlock() (a user gesture), never at module load or in createAudioEngine().
// Every method is a safe no-op before unlock() (or where AudioContext is
// unavailable) and must never throw — the graceful-absence contract.

import { chirpFrequency, scoreGains, type CycleAudioParams } from './score';
import {
  STEPS_PER_BAR,
  bassHit,
  chordAtBar,
  drumHit,
  melodyNote,
  padActive,
  semitoneToFreq,
  tempoBpm,
} from './composition';

export interface AudioEngine {
  unlock(): void;
  setCycle(p: CycleAudioParams): void;
  hit(kind: 'break' | 'galaxyDeath' | 'rebirth'): void;
  setEnabled(on: boolean): void;
  suspend(): void;
  resume(): void;
  level(): number;
  dispose(): void;
}

const RAMP_TIME = 0.05; // master/chirp ramp time-constant
const SCHEDULE_AHEAD = 0.18; // s of audio scheduled ahead of the clock
const LOOKAHEAD_MS = 25; // scheduler wake interval

export function createAudioEngine(): AudioEngine {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null; // cycle-faded bus (music) — silenced in darkness
  let resolution: GainNode | null = null; // rebirth swell bus — gated by mute only, not the cycle fade
  let wet: GainNode | null = null; // reverb wet level — ramped with mute so no ~3s tail escapes it
  let comp: DynamicsCompressorNode | null = null; // catches peaks of the busy mix
  let analyser: AnalyserNode | null = null;
  let analyserBuf: Uint8Array | null = null;
  let chirp: { osc: OscillatorNode; gain: GainNode } | null = null;

  const persistentOscs: OscillatorNode[] = []; // only the chirp — the arrangement uses short-lived per-note oscillators

  let started = false;
  let enabled = true;
  let intensity = 0; // cycle progress, drives layer gating + tempo
  let masterTarget = 0; // last scoreGains().master, for setEnabled's ramp

  let schedulerTimer: ReturnType<typeof setTimeout> | null = null;
  let currentStep = 0;
  let nextStepTime = 0;

  function resetState(): void {
    if (schedulerTimer !== null) {
      clearTimeout(schedulerTimer);
      schedulerTimer = null;
    }
    ctx = null;
    master = null;
    resolution = null;
    wet = null;
    comp = null;
    analyser = null;
    analyserBuf = null;
    chirp = null;
    persistentOscs.length = 0;
    started = false;
    currentStep = 0;
    nextStepTime = 0;
  }

  // Generated impulse response for the hall reverb: decaying stereo noise.
  // Audio is exempt from the seed-determinism contract (one-shot noise bursts
  // already use Math.random), so an unseeded impulse is fine.
  function makeImpulse(audioCtx: AudioContext, seconds: number, decay: number): AudioBuffer {
    const rate = audioCtx.sampleRate;
    const len = Math.max(1, Math.floor(rate * seconds));
    const buf = audioCtx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  function buildGraph(): void {
    if (!ctx) return;
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.005;
    compressor.release.value = 0.2;
    comp = compressor;

    const an = ctx.createAnalyser();
    an.fftSize = 512;
    analyser = an;
    analyserBuf = new Uint8Array(an.fftSize);

    compressor.connect(an);
    an.connect(ctx.destination);

    // Hall reverb on a parallel wet path: dry oscillators are the "old MIDI
    // synth" tell (MD, 2026-07-03) — a hall around them is the cheapest large
    // timbre win short of sampled instruments. Both buses send into it; the
    // wet level rides into the same compressor as the dry signal.
    const convolver = ctx.createConvolver();
    convolver.buffer = makeImpulse(ctx, 3.2, 2.2);
    const wetGain = ctx.createGain();
    wetGain.gain.value = enabled ? 0.45 : 0;
    convolver.connect(wetGain);
    wetGain.connect(compressor);
    wet = wetGain;

    const masterGain = ctx.createGain();
    masterGain.gain.value = 0;
    masterGain.connect(compressor);
    masterGain.connect(convolver);
    master = masterGain;

    const resGain = ctx.createGain(); // parallel to master, not cycle-faded
    resGain.gain.value = enabled ? 1 : 0;
    resGain.connect(compressor);
    resGain.connect(convolver);
    resolution = resGain;

    const chirpOsc = ctx.createOscillator();
    chirpOsc.type = 'sine';
    chirpOsc.frequency.value = chirpFrequency(0);
    const chirpGain = ctx.createGain();
    chirpGain.gain.value = 0;
    chirpOsc.connect(chirpGain);
    chirpGain.connect(master);
    persistentOscs.push(chirpOsc);
    chirp = { osc: chirpOsc, gain: chirpGain };
  }

  // ---- Voice helpers: each creates short-lived nodes with a scheduled
  // envelope and stops them, so nothing accumulates. `dest` is master (music,
  // cycle-faded) except the rebirth swell (resolution bus). ----

  function envGain(time: number, peak: number, attack: number, hold: number, release: number): GainNode {
    const g = ctx!.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), time + attack);
    g.gain.setValueAtTime(Math.max(peak, 0.0002), time + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, time + attack + hold + release);
    return g;
  }

  function stopAt(osc: OscillatorNode, time: number, total: number): void {
    osc.start(time);
    osc.stop(time + total + 0.05);
  }

  function playChord(time: number, semis: number[], barDur: number, level: number): void {
    if (!ctx || !master) return;
    const attack = 0.35;
    const release = 0.6;
    const hold = Math.max(0.1, barDur - attack);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600 + 1500 * intensity; // opens with intensity
    filter.Q.value = 0.6;
    const g = envGain(time, level, attack, hold, release);
    filter.connect(g);
    g.connect(master);
    for (const semi of semis) {
      const base = semitoneToFreq(semi);
      for (const det of [-0.35, 0.35]) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = base;
        osc.detune.value = det * 12; // ~4 cents spread -> ensemble shimmer
        osc.connect(filter);
        stopAt(osc, time, attack + hold + release);
      }
    }
  }

  function playBass(time: number, semi: number, level: number): void {
    if (!ctx || !master) return;
    const dur = 0.34;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    const g = envGain(time, level, 0.008, 0.02, dur);
    filter.connect(g);
    g.connect(master);
    const base = semitoneToFreq(semi);
    const saw = ctx.createOscillator();
    saw.type = 'sawtooth';
    saw.frequency.value = base;
    saw.connect(filter);
    stopAt(saw, time, 0.03 + dur);
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = base / 2;
    sub.connect(filter);
    stopAt(sub, time, 0.03 + dur);
  }

  function playDrum(time: number, level: number): void {
    if (!ctx || !master) return;
    const dur = 0.3;
    // Tuned membrane: a sine dropping in pitch.
    const g = envGain(time, level, 0.004, 0.0, dur);
    g.connect(master);
    const sine = ctx.createOscillator();
    sine.type = 'sine';
    sine.frequency.setValueAtTime(78, time);
    sine.frequency.exponentialRampToValueAtTime(42, time + dur);
    sine.connect(g);
    stopAt(sine, time, dur);
    // Attack transient: a short filtered noise tick.
    const noiseDur = 0.05;
    const size = Math.max(1, Math.floor(ctx.sampleRate * noiseDur));
    const buf = ctx.createBuffer(1, size, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < size; i++) d[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const nf = ctx.createBiquadFilter();
    nf.type = 'lowpass';
    nf.frequency.value = 1800;
    const ng = envGain(time, level * 0.5, 0.002, 0.0, noiseDur);
    noise.connect(nf);
    nf.connect(ng);
    ng.connect(master);
    noise.start(time);
    noise.stop(time + noiseDur + 0.02);
  }

  function playMelody(time: number, semi: number, dur: number, level: number): void {
    if (!ctx || !master) return;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1600;
    filter.Q.value = 1.2;
    const g = envGain(time, level, 0.08, Math.max(0.05, dur - 0.4), 0.35);
    filter.connect(g);
    g.connect(master);
    const base = semitoneToFreq(semi);
    // Vibrato LFO on pitch.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.5;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = base * 0.006; // ~10 cents
    lfo.connect(lfoGain);
    for (const [type, det] of [['sawtooth', 0], ['triangle', -6]] as Array<[OscillatorType, number]>) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = base;
      osc.detune.value = det;
      lfoGain.connect(osc.frequency);
      osc.connect(filter);
      stopAt(osc, time, 0.08 + dur + 0.35);
    }
    stopAt(lfo, time, 0.08 + dur + 0.35);
  }

  function scheduleStep(step: number, time: number): void {
    if (!ctx || !master) return;
    // Muted: don't fabricate ~80 nodes/bar into a zero-gain bus. The scheduler
    // keeps advancing nextStepTime, so re-enabling resumes on the grid.
    if (!enabled) return;
    const bar = Math.floor(step / STEPS_PER_BAR);
    const s = ((step % STEPS_PER_BAR) + STEPS_PER_BAR) % STEPS_PER_BAR;
    const chord = chordAtBar(bar);
    const it = intensity;
    const beatDur = 60 / tempoBpm(it) / 4;

    if (s === 0 && padActive(it)) {
      playChord(time, chord.padSemis, beatDur * STEPS_PER_BAR, 0.05 + 0.03 * it);
    }
    const bh = bassHit(s, it);
    if (bh) playBass(time, chord.bassSemi, bh === 2 ? 0.42 : 0.26);
    const dh = drumHit(s, it);
    if (dh) playDrum(time, dh === 2 ? 0.85 : 0.5);
    const mel = melodyNote(bar, s, it);
    if (mel !== null) playMelody(time, mel, beatDur * 6, 0.13);
  }

  function scheduler(): void {
    if (!ctx) return;
    const stepDur = 60 / tempoBpm(intensity) / 4; // 16th-note duration
    while (nextStepTime < ctx.currentTime + SCHEDULE_AHEAD) {
      // Drop steps that fell into the past during a main-thread stall (>180ms
      // GC/jank while audible): back-scheduling them clamps every missed note
      // to "now" and they fire simultaneously as a flam. Skipping keeps the
      // grid — the loop still advances nextStepTime, so playback resumes on
      // the next future step.
      if (nextStepTime >= ctx.currentTime - 0.005) scheduleStep(currentStep, nextStepTime);
      nextStepTime += stepDur;
      currentStep++;
    }
    schedulerTimer = setTimeout(scheduler, LOOKAHEAD_MS);
  }

  function safeSetTarget(param: AudioParam, value: number): void {
    if (!ctx) return;
    try {
      param.setTargetAtTime(value, ctx.currentTime, RAMP_TIME);
    } catch {
      // no-op — graceful absence
    }
  }

  return {
    unlock(): void {
      try {
        if (!ctx) {
          const Ctx =
            (typeof window !== 'undefined' &&
              (window.AudioContext ||
                (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)) ||
            undefined;
          if (!Ctx) return;
          ctx = new Ctx();
          buildGraph();
        }
        if (!started && chirp) {
          try {
            chirp.osc.start();
          } catch {
            // already started
          }
          started = true;
          currentStep = 0;
          nextStepTime = ctx.currentTime + 0.1;
          scheduler();
        }
        void ctx.resume();
      } catch {
        try {
          void ctx?.close();
        } catch {
          // ignore
        }
        resetState();
      }
    },

    setCycle(p: CycleAudioParams): void {
      if (!ctx || !master || !chirp) return;
      try {
        intensity = p.progress < 0 ? 0 : p.progress > 1 ? 1 : p.progress;
        masterTarget = scoreGains(p).master; // = fade^2 (silence gate)
        safeSetTarget(master.gain, enabled ? masterTarget : 0);
        if (p.rogueActive) {
          safeSetTarget(chirp.osc.frequency, chirpFrequency(p.rogueProgress));
          safeSetTarget(chirp.gain.gain, enabled ? 0.04 + 0.16 * p.rogueProgress : 0);
        } else {
          safeSetTarget(chirp.gain.gain, 0);
        }
      } catch {
        // no-op
      }
    },

    hit(kind: 'break' | 'galaxyDeath' | 'rebirth'): void {
      if (!ctx || !master || !resolution) return;
      try {
        const now = ctx.currentTime;
        if (kind === 'break' || kind === 'galaxyDeath') {
          const long = kind === 'galaxyDeath';
          const dur = long ? 0.4 : 0.22;
          const size = Math.max(1, Math.floor(ctx.sampleRate * dur));
          const buffer = ctx.createBuffer(1, size, ctx.sampleRate);
          const data = buffer.getChannelData(0);
          for (let i = 0; i < size; i++) data[i] = Math.random() * 2 - 1;
          const noise = ctx.createBufferSource();
          noise.buffer = buffer;
          const bandpass = ctx.createBiquadFilter();
          bandpass.type = 'bandpass';
          bandpass.frequency.value = long ? 380 : 820;
          bandpass.Q.value = 0.8;
          const ng = envGain(now, long ? 0.4 : 0.5, 0.006, 0.0, dur);
          noise.connect(bandpass);
          bandpass.connect(ng);
          ng.connect(master);
          noise.start(now);
          noise.stop(now + dur + 0.02);

          const thump = ctx.createOscillator();
          thump.type = 'sine';
          thump.frequency.setValueAtTime(long ? 60 : 95, now);
          thump.frequency.exponentialRampToValueAtTime(long ? 32 : 48, now + dur);
          const tg = envGain(now, long ? 0.45 : 0.5, 0.006, 0.0, dur);
          thump.connect(tg);
          tg.connect(master);
          thump.start(now);
          thump.stop(now + dur + 0.02);
        } else {
          // rebirth: a warm D-major resolution (Picardy third) on the resolution
          // bus, so it sounds through the cycle silence as the new cosmos blooms.
          const DUR = 2.6;
          const triad = [293.66, 369.99, 440.0]; // D4, F#4, A4
          const filter = ctx.createBiquadFilter();
          filter.type = 'lowpass';
          filter.frequency.value = 1400;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.0001, now);
          g.gain.exponentialRampToValueAtTime(0.16, now + 0.7);
          g.gain.setValueAtTime(0.16, now + 1.4);
          g.gain.exponentialRampToValueAtTime(0.0001, now + DUR);
          filter.connect(g);
          g.connect(resolution);
          for (const f of triad) {
            for (const det of [-4, 4]) {
              const osc = ctx.createOscillator();
              osc.type = 'triangle';
              osc.frequency.value = f;
              osc.detune.value = det;
              osc.connect(filter);
              osc.start(now);
              osc.stop(now + DUR + 0.05);
            }
          }
        }
      } catch {
        // no-op
      }
    },

    setEnabled(on: boolean): void {
      enabled = on;
      if (!ctx || !master) return;
      safeSetTarget(master.gain, on ? masterTarget : 0);
      if (resolution) safeSetTarget(resolution.gain, on ? 1 : 0);
      // The wet path taps the buses PRE-gain-ramp target, so signal already in
      // the 3.2s impulse would ring on for seconds after a mute — ramp the wet
      // level down with the mute (and back up on re-enable).
      if (wet) safeSetTarget(wet.gain, on ? 0.45 : 0);
      if (!on && chirp) safeSetTarget(chirp.gain.gain, 0);
    },

    suspend(): void {
      if (!ctx) return;
      try {
        void ctx.suspend();
      } catch {
        // no-op
      }
    },

    resume(): void {
      if (!ctx) return;
      try {
        void ctx.resume();
      } catch {
        // no-op
      }
    },

    level(): number {
      if (!ctx || !analyser || !analyserBuf) return 0;
      try {
        analyser.getByteTimeDomainData(analyserBuf);
        let sumSquares = 0;
        for (let i = 0; i < analyserBuf.length; i++) {
          const v = (analyserBuf[i]! - 128) / 128;
          sumSquares += v * v;
        }
        return Math.sqrt(sumSquares / analyserBuf.length);
      } catch {
        return 0;
      }
    },

    dispose(): void {
      if (!ctx) {
        resetState();
        return;
      }
      try {
        for (const osc of persistentOscs) {
          try {
            osc.stop();
          } catch {
            // already stopped / never started
          }
        }
        void ctx.close();
      } catch {
        // no-op
      } finally {
        resetState();
      }
    },
  };
}
