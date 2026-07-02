export const BLACKBODY_STOPS = [
  [0.0, [0.51, 0.098, 0.071]],
  [0.3, [0.921, 0.392, 0.098]],
  [0.6, [1.0, 0.686, 0.235]],
  [0.85, [1.0, 0.878, 0.639]],
  [1.0, [1.0, 0.98, 0.941]],
] as const;

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

export function blackbody(t: number): [number, number, number] {
  const x = clamp01(t);
  for (let i = 0; i < BLACKBODY_STOPS.length - 1; i++) {
    const [t0, c0] = BLACKBODY_STOPS[i]!;
    const [t1, c1] = BLACKBODY_STOPS[i + 1]!;
    if (x <= t1) {
      const f = (x - t0) / (t1 - t0);
      return [
        c0[0] + (c1[0] - c0[0]) * f,
        c0[1] + (c1[1] - c0[1]) * f,
        c0[2] + (c1[2] - c0[2]) * f,
      ];
    }
  }
  const last = BLACKBODY_STOPS[BLACKBODY_STOPS.length - 1]![1];
  return [last[0], last[1], last[2]];
}

const f3 = (n: number): string => n.toFixed(3);

export function blackbodyGlsl(): string {
  const s = BLACKBODY_STOPS;
  let body = `vec3 blackbody(float t) {\n  t = clamp(t, 0.0, 1.0);\n`;
  for (let i = 0; i < s.length - 1; i++) {
    const [t0, c0] = s[i]!;
    const [t1, c1] = s[i + 1]!;
    body += `  if (t <= ${f3(t1)}) return mix(vec3(${f3(c0[0])}, ${f3(c0[1])}, ${f3(c0[2])}), vec3(${f3(c1[0])}, ${f3(c1[1])}, ${f3(c1[2])}), (t - ${f3(t0)}) / ${f3(t1 - t0)});\n`;
  }
  const last = s[s.length - 1]![1];
  body += `  return vec3(${f3(last[0])}, ${f3(last[1])}, ${f3(last[2])});\n}\n`;
  return body;
}
