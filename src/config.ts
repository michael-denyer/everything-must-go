export const TEX_SIZE = 1024;
export const PARTICLE_COUNT = TEX_SIZE * TEX_SIZE;

export const SHADOW_R = 0.22;
export const DISK_INNER = 0.28;
export const DISK_OUTER = 1.9;
export const DISK_THICKNESS = 0.02;
export const GM = 0.35;
export const SEED = 42;

export const CAM_POS: readonly [number, number, number] = [0, 1.05, 4.2];
export const CAM_FOV = 50;

export const STAR_COUNT = 4000;
export const STAR_SHELL: readonly [number, number] = [6, 14];

// BLOOM_THRESHOLD is an HDR-space value: the additive particle disk sums to tens of
// units pre-tonemap, so retune it if the disk emissive in diskPoints.ts is rescaled.
// STRENGTH and THRESHOLD trade frame darkness against visible glow — retune together.
export const BLOOM_STRENGTH = 0.08;
export const BLOOM_RADIUS = 0.05;
export const BLOOM_THRESHOLD = 12.0;

export const MAX_DT = 1 / 30;
