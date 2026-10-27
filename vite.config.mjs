import { defineConfig } from 'vite';

// Relative base so the built UI loads from file:// inside the AppImage.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
