import { defineConfig } from 'vite';

export default defineConfig({
  root: 'apps/ferret-heist',
  base: './',
  build: {
    outDir: '../../dist',
    emptyOutDir: true
  }
});
