import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['apps/ferret-heist/src/game/**/*.js'],
      exclude: [
        'apps/ferret-heist/src/game/render.js',
        'apps/ferret-heist/src/game/audio.js',
        'apps/ferret-heist/src/main.js'
      ]
    }
  }
});
