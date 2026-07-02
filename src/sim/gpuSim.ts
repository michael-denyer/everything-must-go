// src/sim/gpuSim.ts
import * as THREE from 'three';
import { GPUComputationRenderer, type Variable } from 'three/addons/misc/GPUComputationRenderer.js';
import { seedDisk, type DiskOpts } from './diskSeeder';

const SIM_COMMON = /* glsl */ `
  uniform float uDt;
  uniform float uGm;
  uniform float uInnerR;
  uniform float uOuterR;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  bool needsRespawn(vec3 pos) {
    float r = length(pos.xz);
    return r < uInnerR * 0.9 || r > uOuterR * 1.6;
  }

  vec3 respawnPos(vec2 seed) {
    float r = mix(uOuterR * 0.75, uOuterR, hash(seed));
    float a = hash(seed.yx + 17.0) * 6.28318530718;
    return vec3(cos(a) * r, (hash(seed + 3.0) * 2.0 - 1.0) * 0.02 * (1.0 + r), sin(a) * r);
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
      gl_FragColor = vec4(respawnPos(gl_FragCoord.xy), 0.0);
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
      gl_FragColor = vec4(respawnVel(respawnPos(gl_FragCoord.xy)), 0.0);
      return;
    }
    float r2 = dot(pos, pos) + 3e-4;
    vec3 accel = -pos * (uGm / (r2 * sqrt(r2)));
    vec3 next = (vel + accel * uDt) * (1.0 - 0.012 * uDt);
    gl_FragColor = vec4(next, 0.0);
  }
`;

function buildShader(template: string): string {
  return template.replace('${common}', SIM_COMMON);
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
    }

    const err = this.compute.init();
    if (err !== null) throw new Error(`GPUComputationRenderer init failed: ${err}`);
  }

  step(dt: number): void {
    this.posVar.material.uniforms.uDt!.value = dt;
    this.velVar.material.uniforms.uDt!.value = dt;
    this.compute.compute();
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
