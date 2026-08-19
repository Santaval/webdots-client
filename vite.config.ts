import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig(({ command }) => {
  const isServe = command === 'serve';

  return {
    // Dev server serves the demo page as its root; the demo imports straight
    // from ../src/index.ts via a relative import, no aliasing needed.
    root: isServe ? resolve(__dirname, 'demo') : __dirname,
    publicDir: false,
    build: {
      outDir: resolve(__dirname, 'dist'),
      emptyOutDir: true,
      // Force all CSS (imported via `?inline` in src/ui/ShadowHost.ts) to be
      // bundled as a string inside the JS output rather than emitted as a
      // separate .css asset — the whole point is a single embeddable script.
      cssCodeSplit: false,
      lib: {
        entry: resolve(__dirname, 'src/index.ts'),
        name: 'Webdots',
        formats: ['es', 'umd', 'cjs'],
        fileName: (format) => `webdots.${format}.js`,
      },
      rollupOptions: {
        output: {
          // Ensure the UMD build exposes { init, destroy, version } on window.Webdots
          exports: 'named',
        },
      },
    },
    server: {
      open: true,
    },
  };
});
