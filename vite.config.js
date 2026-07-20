import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Single-page Vite app. `base: './'` makes the production build path-relative, so
// the contents of `dist/` can be dropped onto any static host (Netlify, GitHub
// Pages, itch.io, a plain folder) and just work — no server config required.
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        stairRuleTest: fileURLToPath(new URL('./stair-rule-test.html', import.meta.url)),
      },
    },
  },
});
