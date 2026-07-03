// src/render/sky.ts
import * as THREE from 'three';
import type { CosmosSpec } from '../core/cosmosGen';
import type { Palette } from '../core/palette';
import { paletteRgb } from '../core/palette';
import { mulberry32 } from '../sim/random';

const TEX_W = 2048;
const TEX_H = 1024;
const PLANE_DIST = 10;
// Slight over-fill of the camera frustum so the plane's edges sit outside the
// view (no visible rectangle), with the fragment vignette hiding the margin.
// The anchor projection below divides NDC by this same factor so painted
// nebulae still land at their true screen positions on the larger plane.
const PLANE_FILL = 1.12;

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
  fill: number,
): { x: number; y: number } {
  const ndc = world.clone().project(camera);
  // Divide NDC by `fill`: the plane spans [-fill, +fill] of the frustum in each
  // axis, so an anchor at frustum-NDC n sits at canvas (n/fill + 1)/2.
  return {
    x: ((ndc.x / fill + 1) / 2) * TEX_W,
    y: ((1 - ndc.y / fill) / 2) * TEX_H,
  };
}

// ---- (b) Nebulae: a diffuse wispy cloud built from many small low-opacity
// puffs of varied hue and size, so overlaps accumulate into turbulent gas
// rather than one saturated blob. No straight dust lanes (they read as drawn-on
// lines); structure comes from the gaps between puffs. A few embedded stars add
// texture. hueA/hueB set the two-tone palette the puffs interpolate between. ----
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
  // Elliptical, tilted footprint so clouds aren't perfect circles.
  const tilt = rand() * Math.PI;
  const squash = 0.6 + rand() * 0.35;
  const cosT = Math.cos(tilt);
  const sinT = Math.sin(tilt);
  const place = (t: number): { x: number; y: number } => {
    // Clustered toward center (t in [0,1] radial fraction), tilted + squashed.
    const ang = rand() * Math.PI * 2;
    const rr = t * radiusPx;
    const lx = Math.cos(ang) * rr;
    const ly = Math.sin(ang) * rr * squash;
    return { x: cx + lx * cosT - ly * sinT, y: cy + lx * sinT + ly * cosT };
  };

  const puffCount = 34;
  for (let i = 0; i < puffCount; i++) {
    const { x, y } = place(Math.pow(rand(), 0.55));
    const puffR = radiusPx * (0.14 + rand() * 0.4);
    // Hue interpolates hueA<->hueB with a little jitter, so the cloud shifts
    // tone across its body instead of being one flat color.
    const mix = rand();
    const hue = Math.round(hueA * (1 - mix) + hueB * mix) + Math.floor((rand() - 0.5) * 3);
    const [r, g, b] = paletteRgb(palette, hue, 0.5 + rand() * 0.28, 0.5 + rand() * 0.22);
    const a = 0.03 + rand() * 0.075; // low — depth builds only where puffs overlap
    const grad = ctx.createRadialGradient(x, y, 0, x, y, puffR);
    grad.addColorStop(0, rgbaCss(r, g, b, a));
    grad.addColorStop(0.6, rgbaCss(r, g, b, a * 0.4));
    grad.addColorStop(1, rgbaCss(r, g, b, 0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, puffR, 0, Math.PI * 2);
    ctx.fill();
  }

  // Embedded stars: faint blue-white points scattered through the cloud.
  const starCount = 46;
  for (let i = 0; i < starCount; i++) {
    const { x, y } = place(Math.pow(rand(), 0.7));
    const a = 0.15 + rand() * 0.4;
    const s = 0.6 + rand() * 1.1;
    ctx.fillStyle = rgbaCss(0.86, 0.9, 1.0, a);
    ctx.fillRect(x, y, s, s);
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

  // Diffuse spiral: dots jittered well off the ideal arm and faded low, so the
  // galaxy reads as a soft distant smudge, not a hard-edged pinwheel drawing.
  const armCount = 2;
  const dotsPerArm = 90;
  const turns = 1.7;
  const flatten = 0.5 + rand() * 0.25;
  const spiralTilt = rand() * Math.PI;
  const ct = Math.cos(spiralTilt);
  const st = Math.sin(spiralTilt);
  for (let a = 0; a < armCount; a++) {
    const armOffset = (a / armCount) * Math.PI * 2;
    for (let i = 0; i < dotsPerArm; i++) {
      const t = i / dotsPerArm;
      const angle = armOffset + t * turns * Math.PI * 2 + (rand() - 0.5) * 0.9;
      const rad = radiusPx * t * (0.85 + rand() * 0.3); // radial scatter off the arm
      const lx = Math.cos(angle) * rad;
      const ly = Math.sin(angle) * rad * flatten;
      const x = cx + lx * ct - ly * st;
      const y = cy + lx * st + ly * ct;
      const bright = (0.3 + rand() * 0.4) * (1 - t * 0.7);
      const s = 0.5 + rand() * 1.0;
      ctx.fillStyle = rgbaCss(
        Math.min(1, r * 0.4 + bright + 0.12),
        Math.min(1, g * 0.4 + bright + 0.12),
        Math.min(1, b * 0.4 + bright + 0.12),
        0.22 + rand() * 0.28,
      );
      ctx.fillRect(x, y, s, s);
    }
  }
}

function bakeSkyTexture(spec: CosmosSpec, palette: Palette, camera: THREE.PerspectiveCamera): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(TEX_W, TEX_H);
  // Transparent canvas — NO opaque background fill. Empty regions stay
  // transparent so the plane's blank areas composite to the identical scene
  // background instead of a slightly-off navy rectangle (the visible-panel bug).
  // Only the band/nebulae/decor content below is painted.

  const rand = mulberry32(spec.skySeed);

  paintBand(ctx, spec.bandAngle, rand);

  for (const nebula of spec.nebulae) {
    const world = new THREE.Vector3(nebula.x, nebula.y, nebula.z);
    const { x, y } = projectToCanvas(world, camera, PLANE_FILL);
    const nebRand = mulberry32(nebula.seed);
    // Smaller than the original blobs: these dominated the lower view. The
    // wispy multi-puff paint reads as gas at this size instead of a solid ball.
    const radiusPx = TEX_W * 0.055 * nebula.scale * (1.1 + nebRand() * 0.7);
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
    // Edge vignette: fade alpha toward the plane borders so the boundary never
    // reads as a hard rectangle, even where baked content reaches an edge.
    float edge = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x)
               * smoothstep(0.0, 0.12, vUv.y) * smoothstep(1.0, 0.88, vUv.y);
    // Fade BOTH rgb and alpha with the cosmos: at fade->0 the sky goes fully
    // transparent (NormalBlending shows the uniform background), so the
    // darkness phase reads black instead of a lit backdrop.
    gl_FragColor = vec4(tex.rgb * uFade, tex.a * uFade * edge);
  }
`;

export function createSky(
  spec: CosmosSpec,
  palette: Palette,
  camera: THREE.PerspectiveCamera,
): { object: THREE.Object3D; setParams(p: { fade: number; progress: number }): void; dispose(): void } {
  // Force the camera's world matrices current before projecting nebula anchors.
  // On the FIRST cosmos this runs at module load, before any render or rAF, so
  // createScene's camera.lookAt has set the quaternion but NOT yet folded it
  // into matrixWorld/matrixWorldInverse — projectToCanvas would otherwise bake
  // every nebula as if the camera looked straight down -Z (~24% of frame height
  // off from where its 3D anchor and its draining wisps actually render).
  // Harmless on later reseeds (matrices already current). (Final-review finding.)
  camera.updateMatrixWorld();
  const texture = bakeSkyTexture(spec, palette, camera);

  // Frustum-fit the plane: size it to (over-)fill the camera's view at the
  // plane's distance, so it reads as a seamless backdrop rather than a floating
  // panel. Distance from camera to plane = |camera.position| + PLANE_DIST (the
  // plane sits PLANE_DIST behind the origin, opposite the camera). PLANE_FILL
  // over-sizes it slightly; the anchor projection divided NDC by the same
  // factor, so nebulae still land correctly. Baked once (like the texture) —
  // resize mid-cycle is left uncorrected, same tradeoff as the parallax note.
  const camToPlane = camera.position.length() + PLANE_DIST;
  const frustumH = 2 * camToPlane * Math.tan((camera.fov * Math.PI) / 360);
  const aspect = camera.aspect && Number.isFinite(camera.aspect) ? camera.aspect : 16 / 9;
  const planeH = frustumH * PLANE_FILL;
  const planeW = planeH * aspect;
  const geometry = new THREE.PlaneGeometry(planeW, planeH);
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
  //
  // lookAt the ORIGIN, not further out: PlaneGeometry's front normal is +Z,
  // and Object3D.lookAt aligns +Z with (target - position). The plane sits at
  // -homeDir*PLANE_DIST and the camera is on the +homeDir side, so targeting
  // the origin makes +Z = +homeDir — the front face points AT the camera.
  // Targeting further out (-homeDir*2*PLANE_DIST) would flip +Z away from the
  // camera; with the default FrontSide material that back-face-culls the whole
  // sky to nothing, and DoubleSide would instead mirror the baked texture,
  // misaligning the painted nebulae from the 3D anchors the wisps stream from.
  const homeDir = new THREE.Vector3(...camera.position).normalize();
  mesh.position.copy(homeDir.clone().multiplyScalar(-PLANE_DIST));
  mesh.lookAt(0, 0, 0);

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
