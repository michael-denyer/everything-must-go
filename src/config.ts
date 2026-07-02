export const TEX_SIZE = 1024;

export const DRAG_BASE = 0.012;
export const CYCLE_SECONDS = 720;

export const SHADOW_R = 0.22;
export const DISK_INNER = 0.28;
export const DISK_OUTER = 1.9;
export const DISK_THICKNESS = 0.02;
export const GM = 0.35;

export const CAM_POS: readonly [number, number, number] = [0, 1.05, 4.2];
export const CAM_FOV = 50;

// BLOOM_THRESHOLD is an HDR-space value measured AFTER the lensing pass (bloom now
// runs post-lensing, not on the raw disk render): the lensed photon ring's emissive
// peaks around 2.4 HDR (see the `ring * 2.4 * uFade` term in lensing.ts), so the
// base threshold is tuned relative to that peak, not the raw disk particle sum.
// This is the EARLY-cycle value only: postChain.setCycleFade raises the effective
// threshold by up to +24 as the cycle's fade drops, so bloom retires with the
// cosmos (the drained disk's lensed additive overdraw still sums to 4-8 HDR at
// t=0.95, above any workable static threshold — see main.ts's setCycleFade call).
// STRENGTH and THRESHOLD trade frame darkness against visible glow — retune together.
// STRENGTH 0.16 was chosen by MD from an A/B (0.16 vs 0.28): the subtle halo, which
// keeps the pre-halo brightness gates valid (0.28 washed the early frame past them).
// The shadow horizon is no longer at risk from bloom refill: shadowRecarve.ts runs
// last and re-masks the shadow radius regardless of how strong bloom gets.
export const BLOOM_STRENGTH = 0.16;
export const BLOOM_RADIUS = 0.02;
export const BLOOM_THRESHOLD = 1.5;

export const MAX_DT = 1 / 30;
