import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      // Bun-runtime-only suites: they exercise modules that import
      // `bun:sqlite` / `bun:test`, which Node-based vitest cannot load.
      // Run them with `bun test` instead.
      'server/lib/otto-api/messenger-opencode-bridge.test.js',
      'server/lib/git/getStatus.cap.test.js',
    ],
  },
});
