// src/sim/gpuSim.ts
import * as THREE from 'three';
import { GPUComputationRenderer, type Variable } from 'three/addons/misc/GPUComputationRenderer.js';
import { DRAG_BASE, WELL_RADIUS } from '../config';
import { seedDisk, type DiskOpts } from './diskSeeder';

const SIM_COMMON = /* glsl */ `
  uniform float uDt;
  uniform float uGm;
  uniform float uInnerR;
  uniform float uOuterR;
  uniform float uDrag;
  uniform float uRespawnOn;
  uniform float uThickness;
  // xyz world pos, w strength (well) / consume radius (rogue); w=0 means off.
  uniform vec4 uWell;
  uniform vec4 uRogue;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  // Contract with main.ts's innerR = holeR*1.27: this 0.9 margin makes the
  // effective cull radius holeR*1.143; cosmosGen's diskInner0 >= 1.2*holeR0 floor
  // stays above that so freshly seeded particles don't immediately cull.
  bool needsRespawn(vec3 pos) {
    float r = length(pos.xz);
    return r < uInnerR * 0.9 || r > uOuterR * 1.6;
  }

  vec3 respawnPos(vec2 seed) {
    float r = mix(uOuterR * 0.75, uOuterR, hash(seed));
    float a = hash(seed.yx + 17.0) * 6.28318530718;
    return vec3(cos(a) * r, (hash(seed + 3.0) * 2.0 - 1.0) * uThickness * (1.0 + r), sin(a) * r);
  }

  vec3 respawnVel(vec3 pos) {
    float r = max(length(pos.xz), 1e-4);
    float v = sqrt(uGm / r);
    return vec3(pos.z / r * v, 0.0, -pos.x / r * v);
  }
`;

const POSITION_SHADER = /* glsl */ `
  ${'$'}{common}
  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec3 pos = texture2D(texturePosition, uv).xyz;
    vec3 vel = texture2D(textureVelocity, uv).xyz;
    if (needsRespawn(pos)) {
      if (uRespawnOn < 0.5) {
        gl_FragColor = vec4(99.0, 99.0, 99.0, 0.0);
        return;
      }
      gl_FragColor = vec4(respawnPos(gl_FragCoord.xy), 0.0);
      return;
    }
    // Rogue consumption: same texel condition as the velocity shader's park
    // branch below, so the position/velocity pair cannot desync (M2 park-pair
    // discipline — see needsRespawn's uRespawnOn<0.5 branch above for the
    // precedent of parking at 99s with zero velocity).
    if (uRogue.w > 0.0 && distance(pos, uRogue.xyz) < uRogue.w) {
      gl_FragColor = vec4(99.0, 99.0, 99.0, 0.0);
      return;
    }
    gl_FragColor = vec4(pos + vel * uDt, 0.0);
  }
`;

const VELOCITY_SHADER = /* glsl */ `
  ${'$'}{common}
  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec3 pos = texture2D(texturePosition, uv).xyz;
    vec3 vel = texture2D(textureVelocity, uv).xyz;
    if (needsRespawn(pos)) {
      if (uRespawnOn < 0.5) {
        gl_FragColor = vec4(0.0);
        return;
      }
      gl_FragColor = vec4(respawnVel(respawnPos(gl_FragCoord.xy)), 0.0);
      return;
    }
    // Mirrors the rogue-consumption park branch in the position shader above:
    // same texel condition (distance to uRogue.xyz < uRogue.w), zero velocity,
    // so the pair reads the same previous position texture and cannot desync.
    if (uRogue.w > 0.0 && distance(pos, uRogue.xyz) < uRogue.w) {
      gl_FragColor = vec4(0.0);
      return;
    }
    float r2 = dot(pos, pos) + 3e-4;
    vec3 accel = -pos * (uGm / (r2 * sqrt(r2)));
    // Rogue attractor: extra pull toward uRogue.xyz, independent of the
    // consumption radius check above (particles outside uRogue.w still feel it).
    // Folded into accel (like the main gravity term) so it scales by uDt below.
    if (uRogue.w > 0.0) {
      vec3 toRogue = uRogue.xyz - pos;
      float d2r = dot(toRogue, toRogue);
      vec3 dirR = toRogue / max(sqrt(d2r), 1e-4);
      accel += dirR * (0.2 * uGm / (d2r + 3e-4));
    }
    vec3 next = (vel + accel * uDt) * (1.0 - uDrag * uDt);
    // Cursor well: attracts particles within WELL_RADIUS (WELL_RADIUS² baked
    // in below at build time, since GLSL uniforms can't be squared at compile
    // time). Added directly to next (not folded into accel) per contract —
    // this term already bakes in uDt itself, applied post-drag like a direct nudge.
    if (uWell.w > 0.0) {
      vec3 toWell = uWell.xyz - pos;
      float d2 = dot(toWell, toWell);
      if (d2 < ${'$'}{wellRadiusSq}) {
        vec3 dir = toWell / max(sqrt(d2), 1e-4);
        next += dir * (uWell.w * uDt / (d2 + 0.006));
      }
    }
    gl_FragColor = vec4(next, 0.0);
  }
`;

function buildShader(template: string): string {
  // .toFixed(6): if WELL_RADIUS² ever lands on a whole number, plain string
  // interpolation would emit a GLSL *int* literal (e.g. "4") into a float
  // comparison (`d2 < 4`), which fails to compile under strict GLSL. Forcing
  // a decimal point guarantees a float literal regardless of the value.
  return template
    .replace('${common}', SIM_COMMON)
    .replace('${wellRadiusSq}', (WELL_RADIUS * WELL_RADIUS).toFixed(6));
}

export class GpuSim {
  readonly texSize: number;
  private readonly compute: GPUComputationRenderer;
  private readonly posVar: Variable;
  private readonly velVar: Variable;
  private readonly renderer: THREE.WebGLRenderer;

  constructor(renderer: THREE.WebGLRenderer, opts: DiskOpts & { texSize: number }) {
    this.renderer = renderer;
    this.texSize = opts.texSize;
    this.compute = new GPUComputationRenderer(opts.texSize, opts.texSize, renderer);

    const posTex = this.compute.createTexture();
    const velTex = this.compute.createTexture();
    const seeded = seedDisk(opts.texSize * opts.texSize, opts);
    (posTex.image.data as Float32Array).set(seeded.positions);
    (velTex.image.data as Float32Array).set(seeded.velocities);

    this.posVar = this.compute.addVariable('texturePosition', buildShader(POSITION_SHADER), posTex);
    this.velVar = this.compute.addVariable('textureVelocity', buildShader(VELOCITY_SHADER), velTex);
    this.compute.setVariableDependencies(this.posVar, [this.posVar, this.velVar]);
    this.compute.setVariableDependencies(this.velVar, [this.posVar, this.velVar]);

    for (const v of [this.posVar, this.velVar]) {
      v.material.uniforms.uDt = { value: 0 };
      v.material.uniforms.uGm = { value: opts.gm };
      v.material.uniforms.uInnerR = { value: opts.innerR };
      v.material.uniforms.uOuterR = { value: opts.outerR };
      v.material.uniforms.uDrag = { value: DRAG_BASE };
      v.material.uniforms.uRespawnOn = { value: 1 };
      v.material.uniforms.uThickness = { value: opts.thickness };
      v.material.uniforms.uWell = { value: new THREE.Vector4(0, 0, 0, 0) };
      v.material.uniforms.uRogue = { value: new THREE.Vector4(0, 0, 0, 0) };
    }

    const err = this.compute.init();
    if (err !== null) throw new Error(`GPUComputationRenderer init failed: ${err}`);
  }

  step(dt: number): void {
    this.posVar.material.uniforms.uDt!.value = dt;
    this.velVar.material.uniforms.uDt!.value = dt;
    this.compute.compute();
  }

  setParams(p: { gm: number; innerR: number; outerR: number; drag: number; respawnOn: boolean }): void {
    for (const v of [this.posVar, this.velVar]) {
      v.material.uniforms.uGm!.value = p.gm;
      v.material.uniforms.uInnerR!.value = p.innerR;
      v.material.uniforms.uOuterR!.value = p.outerR;
      v.material.uniforms.uDrag!.value = p.drag;
      v.material.uniforms.uRespawnOn!.value = p.respawnOn ? 1 : 0;
    }
  }

  setWell(x: number, y: number, z: number, strength: number): void {
    for (const v of [this.posVar, this.velVar]) {
      (v.material.uniforms.uWell!.value as THREE.Vector4).set(x, y, z, strength);
    }
  }

  setRogue(x: number, y: number, z: number, radius: number): void {
    for (const v of [this.posVar, this.velVar]) {
      (v.material.uniforms.uRogue!.value as THREE.Vector4).set(x, y, z, radius);
    }
  }

  dispose(): void {
    // compute.dispose() covers the fullscreen quad, each variable's
    // initialValueTexture, and iterates variable.renderTargets disposing them —
    // it does not touch variable.material, so that stays our responsibility.
    this.compute.dispose();
    for (const v of [this.posVar, this.velVar]) {
      v.material.dispose();
    }
  }

  get positionTexture(): THREE.Texture {
    return this.compute.getCurrentRenderTarget(this.posVar).texture;
  }

  get velocityTexture(): THREE.Texture {
    return this.compute.getCurrentRenderTarget(this.velVar).texture;
  }

  debugSampleRadii(sampleCount = 512): { min: number; max: number; finite: boolean } {
    const rt = this.compute.getCurrentRenderTarget(this.posVar) as THREE.WebGLRenderTarget;
    const w = Math.min(this.texSize, sampleCount);
    const buf = new Float32Array(w * 4);
    this.renderer.readRenderTargetPixels(rt, 0, 0, w, 1, buf);
    let min = Infinity;
    let max = -Infinity;
    let finite = true;
    for (let i = 0; i < w; i++) {
      const x = buf[i * 4]!, z = buf[i * 4 + 2]!;
      if (!Number.isFinite(x) || !Number.isFinite(z)) finite = false;
      const r = Math.hypot(x, z);
      min = Math.min(min, r);
      max = Math.max(max, r);
    }
    return { min, max, finite };
  }
}
