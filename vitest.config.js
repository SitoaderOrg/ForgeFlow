import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/framework/**/*.test.js'],
    passWithNoTests: false
  }
});
