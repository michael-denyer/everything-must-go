// src/render/sky.ts
import * as THREE from 'three';
import type { CosmosSpec } from '../core/cosmosGen';
import type { Palette } from '../core/palette';
import { paletteRgb } from '../core/palette';
import { mulberry32 } from '../sim/random';

const TEX_W = 2048;
const TEX_H = 1024;
const PLANE_W = 14;
const PLANE_H = 7;
const PLANE_DIST = 10;

function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  return { canvas, ctx };
}

const rgbaCss = (r: number, g: number, b: number, a: number): string =>
  `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;

// Box-Muller gaussian off a mulberry32 stream — used for the band's dot
// scatter around its centerline (Task 2 contract: "gaussian-spread about
// the band line").
function gaussian(rand: () => number): number {
  const u1 = Math.max(rand(), 1e-6);
  const u2 = rand();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(Math.PI * 2 * u2);
}

// ---- (a) Galactic band: ~2600 dots gaussian-scattered about the line
// through the canvas center at spec.bandAngle, plus a soft linear-gradient
// glow along the same line, warm/cool white mix. ----
function paintBand(ctx: CanvasRenderingContext2D, bandAngle: number, rand: () => number): void {
  const cx = TEX_W / 2;
  const cy = TEX_H / 2;
  const dx = Math.cos(bandAngle);
  const dy = Math.sin(bandAngle);
  // Perpendicular glow strip, soft linear gradient across the band's width.
  const glowHalfWidth = TEX_H * 0.22;
  const px = -dy;
  const py = dx;
  const glowLen = Math.max(TEX_W, TEX_H) * 1.6;
  const gx0 = cx - px * glowHalfWidth;
  const gy0 = cy - py * glowHalfWidth;
  const gx1 = cx + px * glowHalfWidth;
  const gy1 = cy + py * glowHalfWidth;
  const grad = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
  grad.addColorStop(0, rgbaCss(0.5, 0.55, 0.7, 0));
  grad.addColorStop(0.5, rgbaCss(0.75, 0.78, 0.85, 0.16));
  grad.addColorStop(1, rgbaCss(0.5, 0.55, 0.7, 0));
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(bandAngle);
  ctx.fillStyle = grad;
  // Gradient axes above were built in world space along (px,py); after the
  // rotate() the local +Y axis already aligns with that perpendicular, so
  // draw the strip in local (unrotated) coordinates centered on origin.
  ctx.setTransform(1, 0, 0, 1, cx, cy);
  ctx.rotate(bandAngle);
  ctx.fillRect(-glowLen / 2, -glowHalfWidth, glowLen, glowHalfWidth * 2);
  ctx.restore();
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  const dotCount = 2600;
  for (let i = 0; i < dotCount; i++) {
    const along = (rand() * 2 - 1) * glowLen * 0.5;
    const spread = gaussian(rand) * (TEX_H * 0.045);
    const x = cx + dx * along - dy * spread;
    const y = cy + dy * along + dx * spread;
    if (x < -20 || x > TEX_W + 20 || y < -20 || y > TEX_H + 20) continue;
    const warm = rand();
    const bright = 0.35 + rand() * 0.65;
    const r = bright;
    const g = bright * (0.92 + warm * 0.06);
    const b = bright * (0.88 + (1 - warm) * 0.14);
    const s = 0.6 + rand() * 1.6;
    const a = 0.35 + rand() * 0.55;
    ctx.fillStyle = rgbaCss(r, g, b, a);
    ctx.fillRect(x, y, s, s);
  }
}

// Project a world-space anchor through the camera onto the sky canvas, once,
// at bake time. Sky-anchor parallax note (Global Constraints): the camera
// pulls back along its fixed home direction over the cycle (camDist grows),
// which changes the anchor's *true* screen projection slightly, but the sky
// texture is baked once and never re-projected — so painted nebula position
// and its live world anchor drift apart over the cycle. Acceptable at this
// background distance (plane sits far behind everything else being drawn).
function projectToCanvas(
  world: THREE.Vector3,
  camera: THREE.PerspectiveCamera,
): { x: number; y: number } {
  const ndc = world.clone().project(camera);
  return {
    x: ((ndc.x + 1) / 2) * TEX_W,
    y: ((1 - ndc.y) / 2) * TEX_H,
  };
}

// ---- (b) Nebulae: 3 layered radial gradients per nebula in hueA/hueB, plus
// 1-2 dark lanes. ----
function paintNebula(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radiusPx: number,
  hueA: number,
  hueB: number,
  palette: Palette,
  rand: () => number,
): void {
  const layers: Array<{ hue: number; scale: number; alpha: number; s: number; l: number }> = [
    { hue: hueA, scale: 1.0, alpha: 0.5, s: 0.72, l: 0.5 },
    { hue: hueB, scale: 0.68, alpha: 0.42, s: 0.65, l: 0.55 },
    { hue: hueA, scale: 0.4, alpha: 0.5, s: 0.5, l: 0.68 },
  ];
  for (const layer of layers) {
    const [r, g, b] = paletteRgb(palette, layer.hue, layer.s, layer.l);
    const ox = (rand() - 0.5) * radiusPx * 0.3;
    const oy = (rand() - 0.5) * radiusPx * 0.3;
    const rad = radiusPx * layer.scale;
    const grad = ctx.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, rad);
    grad.addColorStop(0, rgbaCss(r, g, b, layer.alpha));
    grad.addColorStop(0.55, rgbaCss(r, g, b, layer.alpha * 0.45));
    grad.addColorStop(1, rgbaCss(r, g, b, 0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx + ox, cy + oy, rad, 0, Math.PI * 2);
    ctx.fill();
  }

  const laneCount = 1 + Math.floor(rand() * 2); // 1-2
  for (let i = 0; i < laneCount; i++) {
    const laneAngle = rand() * Math.PI * 2;
    const laneLen = radiusPx * (0.9 + rand() * 0.6);
    const laneWidth = radiusPx * (0.08 + rand() * 0.1);
    const lx = Math.cos(laneAngle);
    const ly = Math.sin(laneAngle);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(laneAngle);
    const grad = ctx.createLinearGradient(-laneLen / 2, 0, laneLen / 2, 0);
    grad.addColorStop(0, rgbaCss(0, 0, 0, 0));
    grad.addColorStop(0.5, rgbaCss(0, 0, 0, 0.4));
    grad.addColorStop(1, rgbaCss(0, 0, 0, 0));
    ctx.fillStyle = grad;
    ctx.fillRect(-laneLen / 2, -laneWidth / 2, laneLen, laneWidth);
    ctx.restore();
    void lx;
    void ly;
  }
}

// ---- (c) Decor galaxies: small dot-spiral stamps, palette-tinted. ----
function paintDecorGalaxy(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radiusPx: number,
  hueIdx: number,
  palette: Palette,
  rand: () => number,
): void {
  const [r, g, b] = paletteRgb(palette, hueIdx, 0.55, 0.6);
  // Soft core glow.
  const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radiusPx * 0.5);
  coreGrad.addColorStop(0, rgbaCss(r, g, b, 0.6));
  coreGrad.addColorStop(1, rgbaCss(r, g, b, 0));
  ctx.fillStyle = coreGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, radiusPx * 0.5, 0, Math.PI * 2);
  ctx.fill();

  const armCount = 2;
  const dotsPerArm = 70;
  const turns = 1.6;
  for (let a = 0; a < armCount; a++) {
    const armOffset = (a / armCount) * Math.PI * 2;
    for (let i = 0; i < dotsPerArm; i++) {
      const t = i / dotsPerArm;
      const angle = armOffset + t * turns * Math.PI * 2 + (rand() - 0.5) * 0.3;
      const rad = radiusPx * t;
      const x = cx + Math.cos(angle) * rad;
      const y = cy + Math.sin(angle) * rad * 0.55; // flattened, viewed edge-on-ish
      const bright = 0.4 + rand() * 0.6 * (1 - t);
      const s = 0.6 + rand() * 1.2;
      ctx.fillStyle = rgbaCss(
        Math.min(1, r * bright + 0.3),
        Math.min(1, g * bright + 0.3),
        Math.min(1, b * bright + 0.3),
        0.5 + rand() * 0.4,
      );
      ctx.fillRect(x, y, s, s);
    }
  }
}

function bakeSkyTexture(spec: CosmosSpec, palette: Palette, camera: THREE.PerspectiveCamera): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(TEX_W, TEX_H);
  ctx.fillStyle = 'rgb(2,2,5)';
  ctx.fillRect(0, 0, TEX_W, TEX_H);

  const rand = mulberry32(spec.skySeed);

  paintBand(ctx, spec.bandAngle, rand);

  for (const nebula of spec.nebulae) {
    const world = new THREE.Vector3(nebula.x, nebula.y, nebula.z);
    const { x, y } = projectToCanvas(world, camera);
    const nebRand = mulberry32(nebula.seed);
    const radiusPx = TEX_W * 0.09 * nebula.scale * (1.4 + nebRand());
    paintNebula(ctx, x, y, radiusPx, nebula.hueA, nebula.hueB, palette, nebRand);
  }

  for (let i = 0; i < spec.decorGalaxyCount; i++) {
    const x = rand() * TEX_W;
    const y = rand() * TEX_H;
    const radiusPx = TEX_W * (0.012 + rand() * 0.02);
    const hueIdx = Math.floor(rand() * 1000);
    paintDecorGalaxy(ctx, x, y, radiusPx, hueIdx, palette, rand);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

const SKY_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = /* glsl */ `
  uniform sampler2D uTex;
  uniform float uFade;
  varying vec2 vUv;
  void main() {
    vec4 tex = texture2D(uTex, vUv);
    gl_FragColor = vec4(tex.rgb * uFade, tex.a);
  }
`;

export function createSky(
  spec: CosmosSpec,
  palette: Palette,
  camera: THREE.PerspectiveCamera,
): { object: THREE.Object3D; setParams(p: { fade: number; progress: number }): void; dispose(): void } {
  const texture = bakeSkyTexture(spec, palette, camera);

  const geometry = new THREE.PlaneGeometry(PLANE_W, PLANE_H);
  const material = new THREE.ShaderMaterial({
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    uniforms: {
      uTex: { value: texture },
      uFade: { value: 1 },
    },
    transparent: true,
    blending: THREE.NormalBlending,
    depthWrite: false,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = -2; // behind the starfield's -1

  // Orientation: face the camera's fixed home position, computed once — the
  // camera's direction never yaws over the cycle (only its distance grows
  // via camDist in main.ts, CAM_POS * camDist), so a single lookAt at
  // construction stays correct for the plane's whole lifetime. Position the
  // plane PLANE_DIST behind the origin along that same fixed direction, i.e.
  // further from the camera than the origin, so it always renders as a
  // distant backdrop.
  const homeDir = new THREE.Vector3(...camera.position).normalize();
  mesh.position.copy(homeDir.clone().multiplyScalar(-PLANE_DIST));
  mesh.lookAt(homeDir.clone().multiplyScalar(-PLANE_DIST * 2));

  const object = new THREE.Object3D();
  object.add(mesh);

  let disposed = false;

  return {
    object,
    setParams(p: { fade: number; progress: number }): void {
      material.uniforms.uFade!.value = p.fade;
      // uPull: drawn inward as the cosmos is consumed. Implemented as a
      // uniform scale on the object (rather than a vertex-shader uniform)
      // since the plane's geometry never needs per-vertex distortion — a
      // straight object.scale.setScalar reads the same to the eye and keeps
      // the shader simple (fade is the only thing the fragment shader does).
      const uPull = 1 - 0.25 * p.progress;
      object.scale.setScalar(uPull);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}
