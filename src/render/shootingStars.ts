// src/render/shootingStars.ts
import * as THREE from 'three';
import { mulberry32 } from '../sim/random';

// NOT a Body: pure decor, never dies, no gm/holeR/debris. One reusable
// streak activates on a seeded interval, sweeps a seeded far-field path, and
// deactivates until the next interval.

const INTERVAL_MIN = 10; // seconds, sim-time
const INTERVAL_MAX = 18;
const SWEEP_SECONDS = 0.7; // sim-time duration of one streak's traversal
const FAR_FIELD_R = 4.5; // path radius band, well beyond ESCAPE_R (3.4) used by dynamic bodies
const STREAK_LENGTH = 0.35; // world units, along the direction of travel

const STREAK_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const STREAK_FRAG = /* glsl */ `
  uniform float uAlpha;
  uniform float uFade;
  varying vec2 vUv;
  void main() {
    // Fade along the streak's length (vUv.x: 0 = tail, 1 = head) and across
    // its width (vUv.y) so it reads as a bright head with a dissolving tail.
    // uFade is the cosmos-death fade (squared, driven by the conductor) so
    // meteors go dark through the darkness phase like the rest of the deep sky
    // — additive white streaks would otherwise flash across a frame meant to be
    // black.
    float along = smoothstep(0.0, 1.0, vUv.x);
    float across = 1.0 - abs(vUv.y - 0.5) * 2.0;
    float a = along * across * uAlpha * uFade;
    gl_FragColor = vec4(vec3(1.0, 0.98, 0.92) * a, a);
  }
`;

// One seeded occurrence: next-interval delay plus a start/end path pair, both
// drawn from the same sequential mulberry32 stream so the Nth meteor depends
// only on (seed, N) — never on frame cadence or wall-clock.
function drawOccurrence(rand: () => number): {
  delay: number;
  start: THREE.Vector3;
  end: THREE.Vector3;
} {
  const delay = INTERVAL_MIN + rand() * (INTERVAL_MAX - INTERVAL_MIN);

  // Path: a short chord across a far-field sphere shell, so the streak always
  // reads as sweeping past rather than radiating from/toward the origin.
  const theta1 = rand() * Math.PI * 2;
  const phi1 = Math.acos(rand() * 2 - 1);
  const theta2 = rand() * Math.PI * 2;
  const phi2 = Math.acos(rand() * 2 - 1);
  const r = FAR_FIELD_R * (0.85 + rand() * 0.3);

  const start = new THREE.Vector3(
    r * Math.sin(phi1) * Math.cos(theta1),
    r * Math.cos(phi1) * 0.6, // flatten vertically so streaks stay near the horizon band
    r * Math.sin(phi1) * Math.sin(theta1),
  );
  const end = new THREE.Vector3(
    r * Math.sin(phi2) * Math.cos(theta2),
    r * Math.cos(phi2) * 0.6,
    r * Math.sin(phi2) * Math.sin(theta2),
  );

  return { delay, start, end };
}

export function createShootingStars(seed: number): {
  object: THREE.Object3D;
  update(dtSeconds: number): void;
  setFade(fade: number): void;
  dispose(): void;
} {
  const rand = mulberry32(seed);

  const geometry = new THREE.PlaneGeometry(STREAK_LENGTH, STREAK_LENGTH * 0.06);
  const material = new THREE.ShaderMaterial({
    vertexShader: STREAK_VERT,
    fragmentShader: STREAK_FRAG,
    uniforms: { uAlpha: { value: 0 }, uFade: { value: 1 } },
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide, // same invisibility guard as pulsar.ts's beams: never let orientation cull it
    depthWrite: false,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.visible = false;
  const object = new THREE.Object3D();
  object.add(mesh);

  let disposed = false;

  // Ordinal state: clockToNext counts down (sim-time seconds) to the next
  // occurrence; when it elapses, the next occurrence's path/delay are drawn
  // from the shared `rand` stream — ordinal N's draw depends only on how many
  // occurrences have been drawn before it, never on when in wall-clock time
  // update() happened to be called.
  let occurrence = drawOccurrence(rand);
  let clockToNext = occurrence.delay;
  let active = false;
  let sweepTime = 0;

  function activate(): void {
    active = true;
    sweepTime = 0;
    mesh.visible = true;
  }

  function deactivate(): void {
    active = false;
    mesh.visible = false;
    material.uniforms.uAlpha!.value = 0;
    // Draw the next occurrence now, so its delay starts counting from this
    // deactivation — sequential ordinal draws, one occurrence fully consumed
    // (delay + path) before the next is rolled.
    occurrence = drawOccurrence(rand);
    clockToNext = occurrence.delay;
  }

  return {
    object,
    update(dtSeconds: number): void {
      if (!active) {
        clockToNext -= dtSeconds;
        if (clockToNext <= 0) activate();
        return;
      }

      sweepTime += dtSeconds;
      const t = Math.min(1, sweepTime / SWEEP_SECONDS);

      const pos = occurrence.start.clone().lerp(occurrence.end, t);
      mesh.position.copy(pos);

      // Orient the quad along its direction of travel: build a basis from the
      // path direction so the streak's local +X (its length axis) points
      // along the sweep. DoubleSide on the material (declared above) means
      // this orientation can never cull the quad to invisibility regardless
      // of which way the sweep direction ends up facing the camera.
      const dir = occurrence.end.clone().sub(occurrence.start).normalize();
      const up = Math.abs(dir.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      const quat = new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().lookAt(new THREE.Vector3(0, 0, 0), dir, up),
      );
      // lookAt aligns +Z with dir; rotate an extra 90 degrees about Y-ish so
      // the plane's local +X (its length axis, per PlaneGeometry's default UV
      // layout) tracks dir instead of +Z.
      const alignX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
      mesh.quaternion.copy(quat).multiply(alignX);

      // Fade in over the first 15% of the sweep, hold, fade out over the
      // last 25% — reads as a brief flare rather than a hard on/off blink.
      const fadeIn = Math.min(1, t / 0.15);
      const fadeOut = t > 0.75 ? Math.max(0, 1 - (t - 0.75) / 0.25) : 1;
      material.uniforms.uAlpha!.value = Math.min(fadeIn, fadeOut);

      if (t >= 1) deactivate();
    },
    setFade(fade: number): void {
      material.uniforms.uFade!.value = fade;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      geometry.dispose();
      material.dispose();
    },
  };
}
