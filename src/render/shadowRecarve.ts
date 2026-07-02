// src/render/shadowRecarve.ts
import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec2 uHoleUv;
  uniform float uShadowUv;
  uniform float uAspect;
  uniform float uFlash;
  varying vec2 vUv;

  void main() {
    vec2 o = vUv - uHoleUv;
    o.x *= uAspect;
    float d = length(o);
    vec3 col = texture2D(tDiffuse, vUv).rgb;
    col *= smoothstep(uShadowUv * 0.985, uShadowUv * 1.015, d);
    col = mix(col, vec3(1.0, 0.98, 0.94), uFlash);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createShadowRecarve(): {
  pass: ShaderPass;
  update(centerUv: [number, number], radiusUv: number, aspect: number): void;
  setFlash(f: number): void;
} {
  const pass = new ShaderPass({
    name: 'ShadowRecarvePass',
    uniforms: {
      tDiffuse: { value: null },
      uHoleUv: { value: new THREE.Vector2(0.5, 0.5) },
      uShadowUv: { value: 0.1 },
      uAspect: { value: 16 / 9 },
      uFlash: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: FRAG,
  });
  return {
    pass,
    update(centerUv, radiusUv, aspect): void {
      (pass.uniforms.uHoleUv!.value as THREE.Vector2).set(centerUv[0], centerUv[1]);
      pass.uniforms.uShadowUv!.value = radiusUv;
      pass.uniforms.uAspect!.value = aspect;
    },
    setFlash(f: number): void {
      pass.uniforms.uFlash!.value = f;
    },
  };
}
