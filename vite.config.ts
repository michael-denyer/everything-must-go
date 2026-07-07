import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: process.env.EMG_BASE ?? '/',
  build: { target: 'es2022' },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
