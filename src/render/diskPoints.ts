// src/render/diskPoints.ts
import * as THREE from 'three';
import { blackbodyGlsl } from '../color/blackbody';
import { DISK_INNER, DISK_OUTER } from '../config';
import type { GpuSim } from '../sim/gpuSim';

const VERT = /* glsl */ `
  uniform sampler2D uPositions;
  uniform sampler2D uVelocities;
  uniform float uPixelRatio;
  varying float vHeat;
  varying float vDoppler;

  void main() {
    vec3 pos = texture2D(uPositions, uv).xyz;
    vec3 vel = texture2D(uVelocities, uv).xyz;
    float r = length(pos.xz);
    vHeat = pow(clamp(1.0 - (r - ${DISK_INNER.toFixed(3)}) / (${(DISK_OUTER - DISK_INNER).toFixed(3)}), 0.0, 1.0), 1.6);
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    vec3 velView = (modelViewMatrix * vec4(vel, 0.0)).xyz;
    vDoppler = 1.0 + 0.55 * clamp(velView.x / max(length(velView), 1e-4), -1.0, 1.0);
    gl_PointSize = clamp((2.0 + vHeat * 6.0) * uPixelRatio * (2.0 / -mvPosition.z), 1.0, 16.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const FRAG = /* glsl */ `
  varying float vHeat;
  varying float vDoppler;
  ${'$'}{blackbody}

  void main() {
    float d = length(gl_PointCoord - 0.5);
    float alpha = smoothstep(0.5, 0.08, d);
    vec3 col = blackbody(vHeat) * (0.35 + vHeat * 1.45) * vDoppler;
    gl_FragColor = vec4(col * alpha, 1.0);
  }
`;

export function createDiskPoints(texSize: number): {
  points: THREE.Points;
  update(sim: GpuSim): void;
} {
  const count = texSize * texSize;
  const geometry = new THREE.BufferGeometry();
  const refs = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    refs[i * 2] = ((i % texSize) + 0.5) / texSize;
    refs[i * 2 + 1] = (Math.floor(i / texSize) + 0.5) / texSize;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(refs, 2));
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), DISK_OUTER * 2);

  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG.replace('${blackbody}', blackbodyGlsl()),
    uniforms: {
      uPositions: { value: null },
      uVelocities: { value: null },
      uPixelRatio: { value: Math.min(devicePixelRatio, 2) },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return {
    points,
    update(sim: GpuSim): void {
      material.uniforms.uPositions!.value = sim.positionTexture;
      material.uniforms.uVelocities!.value = sim.velocityTexture;
    },
  };
}
