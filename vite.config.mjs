import { defineConfig } from 'vite';
import { cpSync } from 'node:fs';

// Relative base so the built UI loads from file:// inside the AppImage.
// The diagram library (mermaid) is copied as-is to dist/vendor/: it is loaded only inside
// the sandboxed diagram frame (hearth-preview://lib/), never bundled into the app window.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  plugins: [{
    name: 'hearth-copy-sandboxed-libs',
    writeBundle() { cpSync('src/vendor/mermaid', 'dist/vendor/mermaid', { recursive: true }); },
  }],
});
