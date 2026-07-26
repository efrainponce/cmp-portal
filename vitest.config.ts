import { defineConfig } from 'vitest/config';

// Tests de lógica pura (sin DOM ni red): hash/canon del write path a Monday,
// encoding de columnas, whitelist de visibilidad, índice de catálogo.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['{src,worker,shared}/**/*.test.ts'],
  },
});
