// The WebAudio engine: builds real oscillators/gains from the pure score model
// (score.ts) and applies them via smoothed parameter ramps.
//
// Hard rule (autoplay policy + headless/node environments): the AudioContext is
// constructed ONLY inside unlock(), never at module load or inside
// createAudioEngine(). Every method is a safe no-op before unlock() (or if
// construction fails / AudioContext is unavailable) and must never throw — this
// is the graceful-absence contract the visual piece depends on.

import { chirpFrequency, rebirthEnvelope, scoreGains, type CycleAudioParams } from './score';

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

const RAMP_TIME = 0.05; // setTargetAtTime time-constant, per the plan's numeric contract

// Voice tuning: detuned clusters per the plan's "Graph" description.
const DRONE_FREQS = [55, 55 * 1.005, 55 * 0.993]; // low A, lightly detuned trio
const PAD_FREQS = [220, 220 * 1.5]; // a fifth apart, slow filter LFO on top
const TENSION_FREQS = [233.08, 220 * Math.SQRT2]; // minor-second-ish / tritone dissonant pair
const SUB_FREQ = 32.7; // low sine boom

interface Voice {
  gain: GainNode;
}

export function createAudioEngine(): AudioEngine {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let analyser: AnalyserNode | null = null;
  let analyserBuf: Uint8Array | null = null;

  let drone: Voice | null = null;
  let pad: Voice | null = null;
  let tension: Voice | null = null;
  let sub: Voice | null = null;
  let chirp: { osc: OscillatorNode; gain: GainNode } | null = null;

  const oscillators: OscillatorNode[] = [];

  let started = false;
  let enabled = true;
  let lastMasterLevel = 0; // last scoreGains().master seen, for setEnabled's ramp target

  function getCtx(): AudioContext {
    if (!ctx) throw new Error('no audio context');
    return ctx;
  }

  function makeDetunedVoice(
    audioCtx: AudioContext,
    dest: AudioNode,
    freqs: number[],
    type: OscillatorType,
    filterHz: number | null,
  ): Voice {
    const gain = audioCtx.createGain();
    gain.gain.value = 0;
    let target: AudioNode = gain;
    if (filterHz !== null) {
      const filter = audioCtx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = filterHz;
      filter.connect(dest);
      target = filter;
      gain.connect(target);
    } else {
      gain.connect(dest);
    }
    for (const f of freqs) {
      const osc = audioCtx.createOscillator();
      osc.type = type;
      osc.frequency.value = f;
      osc.connect(gain);
      oscillators.push(osc);
    }
    return { gain };
  }

  function buildGraph(): void {
    if (!ctx) return;
    master = ctx.createGain();
    master.gain.value = 0;
    analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyserBuf = new Uint8Array(analyser.fftSize);
    master.connect(analyser);
    analyser.connect(ctx.destination);

    drone = makeDetunedVoice(ctx, master, DRONE_FREQS, 'sawtooth', 500);
    pad = makeDetunedVoice(ctx, master, PAD_FREQS, 'triangle', 900);
    tension = makeDetunedVoice(ctx, master, TENSION_FREQS, 'sawtooth', 1200);
    sub = makeDetunedVoice(ctx, master, [SUB_FREQ], 'sine', null);

    const chirpOsc = ctx.createOscillator();
    chirpOsc.type = 'sine';
    chirpOsc.frequency.value = chirpFrequency(0);
    const chirpGain = ctx.createGain();
    chirpGain.gain.value = 0;
    chirpOsc.connect(chirpGain);
    chirpGain.connect(master);
    oscillators.push(chirpOsc);
    chirp = { osc: chirpOsc, gain: chirpGain };
  }

  function startOscillators(): void {
    if (started || !ctx) return;
    for (const osc of oscillators) {
      try {
        osc.start();
      } catch {
        // already started / invalid state — stay silent, never throw outward
      }
    }
    started = true;
  }

  function safeSetTarget(param: AudioParam, value: number): void {
    if (!ctx) return;
    try {
      param.setTargetAtTime(value, ctx.currentTime, RAMP_TIME);
    } catch {
      // no-op — graceful absence contract
    }
  }

  return {
    unlock(): void {
      try {
        if (!ctx) {
          const Ctx =
            (typeof window !== 'undefined' &&
              (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)) ||
            undefined;
          if (!Ctx) return; // no AudioContext available — silent no-op
          ctx = new Ctx();
          buildGraph();
        }
        startOscillators();
        void getCtx().resume();
      } catch {
        // construction/resume failed — stay silent, no context, no throw
        ctx = null;
      }
    },

    setCycle(p: CycleAudioParams): void {
      if (!ctx || !master || !drone || !pad || !tension || !sub || !chirp) return;
      try {
        const g = scoreGains(p);
        lastMasterLevel = g.master;
        safeSetTarget(master.gain, enabled ? g.master : 0);
        safeSetTarget(drone.gain.gain, g.drone);
        safeSetTarget(pad.gain.gain, g.pad);
        safeSetTarget(tension.gain.gain, g.tension);
        safeSetTarget(sub.gain.gain, g.sub);

        if (p.rogueActive) {
          safeSetTarget(chirp.osc.frequency, chirpFrequency(p.rogueProgress));
          safeSetTarget(chirp.gain.gain, 0.05 + 0.2 * p.rogueProgress);
        } else {
          safeSetTarget(chirp.gain.gain, 0);
        }
      } catch {
        // no-op
      }
    },

    hit(kind: 'break' | 'galaxyDeath' | 'rebirth'): void {
      if (!ctx || !master) return;
      try {
        const audioCtx = ctx;
        const now = audioCtx.currentTime;
        if (kind === 'break' || kind === 'galaxyDeath') {
          const long = kind === 'galaxyDeath';
          const dur = long ? 0.4 : 0.22;
          const thumpFreq = long ? 55 : 90;

          // Filtered white-noise burst.
          const noiseDur = dur;
          const bufferSize = Math.max(1, Math.floor(audioCtx.sampleRate * noiseDur));
          const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
          const data = buffer.getChannelData(0);
          for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
          const noise = audioCtx.createBufferSource();
          noise.buffer = buffer;
          const bandpass = audioCtx.createBiquadFilter();
          bandpass.type = 'bandpass';
          bandpass.frequency.value = long ? 400 : 900;
          bandpass.Q.value = 0.8;
          const noiseGain = audioCtx.createGain();
          noiseGain.gain.setValueAtTime(0.0001, now);
          noiseGain.gain.linearRampToValueAtTime(long ? 0.5 : 0.6, now + 0.01);
          noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
          noise.connect(bandpass);
          bandpass.connect(noiseGain);
          noiseGain.connect(master);
          noise.start(now);
          noise.stop(now + dur + 0.02);

          // Low sine thump.
          const thump = audioCtx.createOscillator();
          thump.type = 'sine';
          thump.frequency.setValueAtTime(thumpFreq, now);
          thump.frequency.exponentialRampToValueAtTime(Math.max(20, thumpFreq * 0.5), now + dur);
          const thumpGain = audioCtx.createGain();
          thumpGain.gain.setValueAtTime(0.0001, now);
          thumpGain.gain.linearRampToValueAtTime(long ? 0.45 : 0.5, now + 0.01);
          thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
          thump.connect(thumpGain);
          thumpGain.connect(master);
          thump.start(now);
          thump.stop(now + dur + 0.02);
        } else {
          // rebirth: a soft resolution swell — a couple of sine partials enveloped
          // by rebirthEnvelope's raised-cosine shape, sampled at schedule time and
          // laid down as WebAudio ramp automation (no frame loop available here).
          const REBIRTH_DURATION = 2.5;
          const partials = [220, 330]; // a soft, consonant fifth
          const steps = 24;
          for (const freq of partials) {
            const osc = audioCtx.createOscillator();
            osc.type = 'sine';
            osc.frequency.value = freq;
            const g = audioCtx.createGain();
            g.gain.setValueAtTime(0, now);
            for (let i = 0; i <= steps; i++) {
              const t = (i / steps) * REBIRTH_DURATION;
              const env = rebirthEnvelope(t);
              g.gain.linearRampToValueAtTime(0.001 + env * 0.18, now + t);
            }
            osc.connect(g);
            g.connect(master);
            osc.start(now);
            osc.stop(now + REBIRTH_DURATION + 0.05);
          }
        }
      } catch {
        // no-op — a failed one-shot must never throw outward
      }
    },

    setEnabled(on: boolean): void {
      enabled = on;
      if (!ctx || !master) return;
      safeSetTarget(master.gain, on ? lastMasterLevel : 0);
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
      if (!ctx) return;
      try {
        for (const osc of oscillators) {
          try {
            osc.stop();
          } catch {
            // may already be stopped/never started — ignore
          }
        }
        void ctx.close();
      } catch {
        // no-op
      } finally {
        ctx = null;
        master = null;
        analyser = null;
        analyserBuf = null;
        drone = null;
        pad = null;
        tension = null;
        sub = null;
        chirp = null;
        oscillators.length = 0;
        started = false;
      }
    },
  };
}
