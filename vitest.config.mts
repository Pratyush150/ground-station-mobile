import { defineConfig } from 'vitest/config';

/**
 * The test suite covers `src/core` only.
 *
 * That is the whole point of keeping the logic framework-free: it runs in a
 * plain Node process with no React Native, no simulator and no device.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      include: ['src/core/**/*.ts'],
      reporter: ['text', 'lcov'],
    },
  },
});
