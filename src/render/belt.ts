// src/render/belt.ts
import * as THREE from 'three';
import type { Rgb } from '../core/palette';
import { mulberry32 } from '../sim/random';
import { GM } from '../config';

// Each grain self-orbits at a fixed angular rate baked from GM (config's gm0)
// at seed time — the belt is a visual orbit, not a physical one: it never
// reads the live, decaying gm the disk/planets integrate against, so grains
// keep circling at their original rate even as the hole's gm climbs through
// the cycle. That's intentional: a physically-coupled belt would need a
// per-frame integration pass this module doesn't do.
const GRAIN_SPAN = 0.18; // radius in [inner, inner + GRAIN_SPAN]
const Y_JITTER = 0.012;
const POINT_SIZE_PX = 1.8;
const ALPHA = 0.75;

// Vertex shader: bakes angle0 + speed*uTime per grain, then parks (discards)
// grains whose drainSeed has fallen under the drain front. Park idiom matches
// debris.ts/diskPoints.ts exactly: gl_Position pushed off-frustum (w=1, z=2),
// gl_PointSize zeroed.
const VERT = /* glsl */ `
  attribute float aRadius;
  attribute float aAngle0;
  attribute float aSpeed;
  attribute float aYJitter;
  attribute float aDrainSeed;
  uniform float uTime;
  uniform float uProgress;

  void main() {
    float drainAmount = smoothstep(0.25, 0.88, uProgress);
    if (aDrainSeed < drainAmount) {
      gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }
    float angle = aAngle0 + aSpeed * uTime;
    vec3 pos = vec3(aRadius * cos(angle), aYJitter, aRadius * sin(angle));
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = ${POINT_SIZE_PX.toFixed(1)};
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uColor;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    float alpha = smoothstep(0.5, 0.15, d) * ${ALPHA.toFixed(2)};
    gl_FragColor = vec4(uColor * alpha, 1.0);
  }
`;

export function createBelt(spec: {
  count: number;
  inner: number;
  rgb: Rgb;
  seed: number;
}): { points: THREE.Points; setParams(p: { progress: number; time: number }): void; dispose(): void } {
  const rand = mulberry32(spec.seed);
  const { count, inner } = spec;

  const radii = new Float32Array(count);
  const angle0s = new Float32Array(count);
  const speeds = new Float32Array(count);
  const yJitters = new Float32Array(count);
  const drainSeeds = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const r = inner + rand() * GRAIN_SPAN;
    radii[i] = r;
    angle0s[i] = rand() * Math.PI * 2;
    // Angular rate: speed = sqrt(gm0/r) / r, baked once from config's GM.
    speeds[i] = Math.sqrt(GM / r) / r;
    yJitters[i] = (rand() * 2 - 1) * Y_JITTER;
    drainSeeds[i] = rand();
  }

  const geometry = new THREE.BufferGeometry();
  // position attribute is required by THREE.Points' bounding-sphere/frustum
  // machinery even though the shader recomputes it from the per-grain
  // attributes below; frustumCulled is disabled so its (unused) values never
  // matter for visibility.
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute('aRadius', new THREE.BufferAttribute(radii, 1));
  geometry.setAttribute('aAngle0', new THREE.BufferAttribute(angle0s, 1));
  geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
  geometry.setAttribute('aYJitter', new THREE.BufferAttribute(yJitters, 1));
  geometry.setAttribute('aDrainSeed', new THREE.BufferAttribute(drainSeeds, 1));

  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime: { value: 0 },
      uProgress: { value: 0 },
      uColor: { value: new THREE.Vector3(spec.rgb[0], spec.rgb[1], spec.rgb[2]) },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  // Additive point field alongside starfield (-1) and debris (1): the belt
  // sits with the debris/foreground layer, not the background starfield.
  points.renderOrder = 1;

  let disposed = false;

  return {
    points,
    setParams(p: { progress: number; time: number }): void {
      material.uniforms.uProgress!.value = p.progress;
      material.uniforms.uTime!.value = p.time;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      geometry.dispose();
      material.dispose();
    },
  };
}
