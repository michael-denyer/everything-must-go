// src/render/lensing.ts
import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { blackbodyGlsl } from '../color/blackbody';

const FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec2 uHoleUv;
  uniform float uShadowUv;
  uniform float uAspect;
  uniform float uFade;
  varying vec2 vUv;
  ${'$'}{blackbody}

  void main() {
    vec2 o = vUv - uHoleUv;
    o.x *= uAspect;
    float d = length(o);
    float rs = uShadowUv;
    vec2 dir = o / max(d, 1e-5);

    float bend = 1.6 * rs * rs / max(d, 1e-4);
    vec2 srcO = o - dir * bend;
    srcO.x /= uAspect;
    vec3 col = texture2D(tDiffuse, clamp(uHoleUv + srcO, 0.0, 1.0)).rgb;

    float heat = clamp(1.0 - (d - rs) / (rs * 2.2), 0.0, 1.0);
    // Relativistic beaming on the lensed emissive: cubed (bolometric law) to
    // match the disk sprites — the approaching (screen-left) side flares, the
    // receding side goes nearly dark. Same crescent as the real images.
    float doppler = pow(1.0 + 0.55 * clamp(-dir.x, -1.0, 1.0), 3.0);
    float topBand = exp(-pow((d - rs * 2.0) / (rs * 0.55), 2.0)) * smoothstep(0.05, 0.55, dir.y);
    float botBand = exp(-pow((d - rs * 1.45) / (rs * 0.28), 2.0)) * smoothstep(0.05, 0.55, -dir.y);
    // uFade fades only the lensed emissive (fold bands + photon ring).
    col += blackbody(heat) * (topBand * 1.5 + botBand * 0.9) * doppler * 1.8 * uFade;

    // Photon ring, beamed the same way: prograde photons pile up on the
    // approaching side of a spinning hole, so the ring is bright-left and
    // faint-right rather than a uniform halo.
    float ring = exp(-pow((d - rs * 1.12) / (rs * 0.045), 2.0));
    float ringBeam = mix(0.35, 1.9, smoothstep(-1.0, 1.0, -dir.x));
    col += vec3(1.0, 0.98, 0.94) * ring * 2.4 * ringBeam * uFade;

    col *= smoothstep(rs * 0.985, rs * 1.015, d);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createLensingPass(): {
  pass: ShaderPass;
  update(centerUv: [number, number], radiusUv: number, aspect: number): void;
  setFade(f: number): void;
} {
  const pass = new ShaderPass({
    name: 'LensingPass',
    uniforms: {
      tDiffuse: { value: null },
      uHoleUv: { value: new THREE.Vector2(0.5, 0.5) },
      uShadowUv: { value: 0.1 },
      uAspect: { value: 16 / 9 },
      uFade: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: FRAG.replace('${blackbody}', blackbodyGlsl()),
  });

  return {
    pass,
    update(centerUv, radiusUv, aspect): void {
      (pass.uniforms.uHoleUv!.value as THREE.Vector2).set(centerUv[0], centerUv[1]);
      pass.uniforms.uShadowUv!.value = radiusUv;
      pass.uniforms.uAspect!.value = aspect;
    },
    setFade(f: number): void {
      pass.uniforms.uFade!.value = f;
    },
  };
}
