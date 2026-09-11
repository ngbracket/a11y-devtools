import angular from '@analogjs/vite-plugin-angular';
import { defineConfig } from 'vitest/config';

// Config for the living console demo only (src/testing/console-demo.ts), which
// the default `vitest.config.ts` deliberately excludes from `npm test`.
// Invoked via `npm run demo:console`.
export default defineConfig({
  plugins: [angular({ tsconfig: 'tsconfig.spec.json' })],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['src/testing/test-setup.ts'],
    include: ['src/testing/console-demo.ts'],
  },
});
