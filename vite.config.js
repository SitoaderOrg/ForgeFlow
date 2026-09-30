import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'apps/ferret-heist',
  base: './',
  build: {
    outDir: '../../dist',
    emptyOutDir: true
  }
});
