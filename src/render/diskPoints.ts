// src/render/diskPoints.ts
import * as THREE from 'three';
import { blackbodyGlsl } from '../color/blackbody';
import { BEAMING_EXP, DISK_INNER, DISK_INTENSITY, DISK_OUTER, LIGHT_SPEED } from '../config';
import type { GpuSim } from '../sim/gpuSim';

const VERT = /* glsl */ `
  uniform sampler2D uPositions;
  uniform sampler2D uVelocities;
  uniform float uPixelRatio;
  uniform float uHeatInner;
  uniform float uHeatOuter;
  uniform float uLightSpeed;
  uniform float uBeamExp;
  varying float vHeat;
  varying float vBeam;
  varying float vGrav;

  void main() {
    vec3 pos = texture2D(uPositions, uv).xyz;
    if (pos.x > 50.0) {
      gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      vHeat = 0.0;
      vBeam = 0.0;
      vGrav = 0.0;
      return;
    }
    vec3 vel = texture2D(uVelocities, uv).xyz;
    float r = length(pos.xz);
    vHeat = pow(clamp(1.0 - (r - uHeatInner) / max(uHeatOuter - uHeatInner, 1e-4), 0.0, 1.0), 1.6);
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    vec3 velView = (modelViewMatrix * vec4(vel, 0.0)).xyz;
    // Relativistic beaming: β is the line-of-sight velocity fraction (view
    // space looks down -z, so velView.z > 0 approaches the camera). δ³ is the
    // bolometric beaming law — the approaching side of the disk brightens
    // several-fold, the receding side goes dark (the one-sided crescent).
    float beta = clamp(velView.z / uLightSpeed, -0.9, 0.9);
    vBeam = pow(1.0 / (1.0 - beta), uBeamExp);
    // Gravitational redshift: √(1 - rs/r). rs is derived from what the sprites
    // already receive — uHeatInner is the sim inner radius = holeR·1.27, and
    // the photon-capture shadow (≈ holeR) sits at 2.6·rs, so
    // rs = uHeatInner / (1.27 · 2.6) ≈ uHeatInner · 0.303. Applied to the heat
    // (cooler → redder blackbody) and again to the emissive in the fragment
    // (dimmer), so the inner edge reddens and dies toward the horizon.
    float rs = uHeatInner * 0.303;
    vGrav = sqrt(clamp(1.0 - rs / max(r, 1e-4), 0.0, 1.0));
    vHeat *= vGrav;
    gl_PointSize = clamp((2.0 + vHeat * 6.0) * uPixelRatio * (2.0 / -mvPosition.z), 1.0, 16.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const FRAG = /* glsl */ `
  varying float vHeat;
  varying float vBeam;
  varying float vGrav;
  uniform float uFade;
  uniform float uIntensity;
  ${'$'}{blackbody}

  void main() {
    float d = length(gl_PointCoord - 0.5);
    float alpha = smoothstep(0.5, 0.08, d);
    vec3 col = blackbody(vHeat) * (0.35 + vHeat * 1.45) * vBeam * vGrav * uFade * uIntensity;
    gl_FragColor = vec4(col * alpha, 1.0);
  }
`;

export function createDiskPoints(texSize: number, pixelRatio: number): {
  points: THREE.Points;
  update(sim: GpuSim): void;
  setParams(p: { heatInner: number; heatOuter: number; fade: number }): void;
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
      // The renderer's tier-capped ratio, passed in so point sizes track the
      // actual drawing-buffer scale rather than a hardcoded cap.
      uPixelRatio: { value: pixelRatio },
      uHeatInner: { value: DISK_INNER },
      uHeatOuter: { value: DISK_OUTER },
      uFade: { value: 1 },
      uIntensity: { value: DISK_INTENSITY },
      uLightSpeed: { value: LIGHT_SPEED },
      uBeamExp: { value: BEAMING_EXP },
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
    setParams(p: { heatInner: number; heatOuter: number; fade: number }): void {
      material.uniforms.uHeatInner!.value = p.heatInner;
      material.uniforms.uHeatOuter!.value = p.heatOuter;
      material.uniforms.uFade!.value = p.fade;
    },
  };
}
