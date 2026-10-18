import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    passWithNoTests: false,
    coverage: {
      provider: 'v8',
      thresholds: { lines: 80 },
      reportOnFailure: true,
      reporter: ['text', 'json', 'html'],
      include: ['src/game/**/*.js'],
      exclude: ['src/game/render.js', 'src/game/audio.js', 'src/main.js']
    }
  }
});
