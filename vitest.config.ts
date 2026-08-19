import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts'],
    // Without this, Vite hands back an empty string for `?inline` CSS imports
    // and ShadowHost mounts a blank <style> under test — which would let a
    // broken stylesheet pipeline pass CI while the real build works fine.
    css: true,
  },
});
