// src/render/starfield.ts
import * as THREE from 'three';
import { mulberry32 } from '../sim/random';

const VERT = /* glsl */ `
  attribute float aSeed;
  uniform float uPlunge;
  varying float vBright;
  varying vec3 vColor;
  attribute vec3 color;

  void main() {
    float gate = clamp((uPlunge * 1.3 - aSeed * 0.3) / 1.0, 0.0, 1.0);
    float fall = pow(gate, 1.5);
    vec3 p = mix(position, position * 0.02, fall);
    vBright = 1.0 + fall * 2.5;
    vColor = color;
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = (1.6 + fall * 2.0) * (300.0 / max(-mvPosition.z, 1.0)) * 0.01 + 1.6;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const FRAG = /* glsl */ `
  uniform float uFade;
  varying float vBright;
  varying vec3 vColor;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    float alpha = smoothstep(0.5, 0.15, d) * 0.85 * uFade;
    gl_FragColor = vec4(vColor * vBright * alpha, 1.0);
  }
`;

export function createStarfield(
  count: number,
  shell: [number, number],
  seed: number,
): { points: THREE.Points; setParams(p: { plunge: number; fade: number }): void } {
  const rand = mulberry32(seed);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const [rMin, rMax] = shell;
  for (let i = 0; i < count; i++) {
    const r = rMin + rand() * (rMax - rMin);
    const theta = rand() * Math.PI * 2;
    const phi = Math.acos(rand() * 2 - 1);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi);
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    const warm = rand();
    const bright = 0.3 + rand() * 0.7;
    colors[i * 3] = bright;
    colors[i * 3 + 1] = bright * (0.9 + warm * 0.08);
    colors[i * 3 + 2] = bright * (0.85 + (1 - warm) * 0.2);
    seeds[i] = rand();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uPlunge: { value: 0 },
      uFade: { value: 1 },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = -1;
  return {
    points,
    setParams(p: { plunge: number; fade: number }): void {
      material.uniforms.uPlunge!.value = p.plunge;
      material.uniforms.uFade!.value = p.fade;
    },
  };
}
