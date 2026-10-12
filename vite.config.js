import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base, so the build works from any folder, such as the family arcade's
  // /buildagon/ path, and when opened from disk.
  base: './',
  server: { port: 5199, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
