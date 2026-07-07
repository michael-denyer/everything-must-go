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

// Global tone-mapping exposure, MD-tuned by eye on the live view ("brightness
// needs turning down slightly", 2026-07-02). Scales everything uniformly
// before ACES; pixel gates were re-run at this value.
export const EXPOSURE = 0.85;

// Disk-only emissive scale ("still way too bright — it hides all the cool
// detail", 2026-07-03). The disk is ~1M additive sprites; hundreds overlap per
// pixel near the core, summing to tens of HDR units that clip flat white under
// ACES at any exposure. Scaling the per-sprite emissive compresses that sum
// back under the tonemap shoulder WITHOUT dimming planets, stars, or cast —
// which a global EXPOSURE cut would. MD feel-tunes this on the live view; the
// full Playwright pixel suite (money-shot ring/shadow gates + washout ceiling)
// was re-run green at 0.12 (2026-07-03). The min-brightness gates ride on the
// lensed photon ring, which is NOT scaled by this knob, so dimming the disk
// only relaxes the washout ceiling — it cannot make a gate pass for being dim.
export const DISK_INTENSITY = 0.12;

// Relativistic shading (2026-07-03 physics pass, MD-requested). LIGHT_SPEED is
// c in scene units, chosen so the inner-edge Keplerian speed (√(GM/DISK_INNER)
// ≈ 1.12) lands at β ≈ 0.55 — the regime of gas near a real ISCO. Emissive is
// multiplied by δ^BEAMING_EXP with δ = 1/(1 − β_los); exponent 3 is the
// bolometric relativistic-beaming law, and it produces the one-sided crescent
// of every real black-hole image. GRAV_REDSHIFT_ON gates the √(1 − rs/r)
// dimming/cooling of the inner edge (rs derived from the shadow radius: the
// photon-capture shadow sits at √27/2 ≈ 2.6 rs). KERR_SPIN (0..1) shifts the
// shadow + photon ring off-center toward the receding side and skews ring
// brightness — a spinning-hole fake, not a Kerr geodesic solve.
export const LIGHT_SPEED = 2.0;
export const BEAMING_EXP = 3.0;
export const KERR_SPIN = 0.45;

// ISCO plunge band. Inside the innermost stable circular orbit no bound orbit
// exists: gas loses rotational support and plunges radially to the horizon,
// leaving a lower-density (darker) gap between the bright disk edge and the
// photon ring — visible in every real accretion image. ISCO_FACTOR sets the
// band's outer edge as a multiple of the sim inner radius (uInnerR); below it,
// the velocity shader fades the tangential component to zero toward the center
// so support vanishes smoothly (no discontinuity at the band edge, no energy
// added — it can only thin the disk, never destabilize it).
export const ISCO_FACTOR = 1.35;

export const MAX_DT = 1 / 30;

// Cursor well: radius and pull strength of the gas disk's response to pointer
// position. MD feel-tunes these at acceptance (single config constants, per
// the milestone's tactile sign-off).
export const WELL_RADIUS = 0.5;
export const WELL_STRENGTH = 0.05;

// Quality-tier thresholds (M6 plan, "Probe & downgrade thresholds"). The fps
// probe samples for PROBE_SECONDS behind the enter gate; a median below
// PROBE_MIN_FPS drops one tier before entry. After entry, fps below
// DOWNGRADE_FPS sustained for DOWNGRADE_SUSTAIN_SECONDS of accumulated frame
// time drops one tier (any frame at/above the threshold resets the clock).
// Downgrade-only: the piece never upgrades mid-cycle.
export const PROBE_SECONDS = 3;
export const PROBE_MIN_FPS = 30;
export const DOWNGRADE_FPS = 24;
export const DOWNGRADE_SUSTAIN_SECONDS = 5;
