import { defineConfig } from 'vitest/config';

// Framework tests only; each app under apps/ has its own test config.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js']
  }
});
