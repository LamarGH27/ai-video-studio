import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
      // See tests/stubs/server-only.ts: the real package throws outside a React
      // Server Component, which is its whole purpose and not something the test
      // runner can satisfy. Next.js still resolves the genuine package at build
      // time, and tests/notification-config.test.ts asserts the guards remain.
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
    },
  },
  test: {
    // Node by default — most of the suite is pure business logic. Component
    // tests opt into jsdom with a `@vitest-environment jsdom` docblock.
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**'],
  },
});
