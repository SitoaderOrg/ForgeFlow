import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import testConfig from '../vitest.config.js';
import buildConfig from '../vite.config.js';

describe('app-local tooling', () => {
  const appRoot = fileURLToPath(new URL('../', import.meta.url));

  it('keeps test discovery and coverage policy inside the app', () => {
    expect(testConfig.root).toBe(appRoot);
    expect(testConfig.test.include).toEqual(['tests/**/*.test.js']);
    expect(testConfig.test.passWithNoTests).toBe(false);
    expect(testConfig.test.coverage.thresholds.lines).toBe(80);
    expect(testConfig.test.coverage.reportOnFailure).toBe(true);
    expect(testConfig.test.coverage.include).toEqual(['src/game/**/*.js']);
  });

  it('builds into the app instead of a shared repository output directory', () => {
    expect(buildConfig.root).toBe(appRoot);
    expect(buildConfig.base).toBe('./');
    expect(buildConfig.build.outDir).toBe('dist');
  });
});
