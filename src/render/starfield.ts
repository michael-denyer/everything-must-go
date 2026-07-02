// src/render/starfield.ts
import * as THREE from 'three';
import { SEED, STAR_COUNT, STAR_SHELL } from '../config';
import { mulberry32 } from '../sim/random';

export function createStarfield(): THREE.Points {
  const rand = mulberry32(SEED + 1);
  const positions = new Float32Array(STAR_COUNT * 3);
  const colors = new Float32Array(STAR_COUNT * 3);
  const [rMin, rMax] = STAR_SHELL;
  for (let i = 0; i < STAR_COUNT; i++) {
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
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size: 1.6,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });
  return new THREE.Points(geometry, material);
}
