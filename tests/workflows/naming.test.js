import { describe, expect, it } from 'vitest';
import { listWorkflowFiles, loadWorkflow } from './helpers/harness.js';

// Role prefix of the file name -> prefix of the display name (see readme "Naming convention").
const ROLES = [
  [/^gate-[a-z-]+\.yml$/, 'Gate: '],
  [/^fix-[a-z-]+\.lock\.yml$/, 'Fix: '],
  [/^review-[a-z-]+\.yml$/, 'Review: '],
  [/^relay\.yml$/, 'Relay: '],
  [/^pipeline\.yml$/, 'Pipeline'],
  [/^verdict\.yml$/, 'Verdict & watchdog']
];
const WORKFLOWS = listWorkflowFiles((f) => f.endsWith('.yml')).filter(
  (f) => f !== 'agentic-workflows-compilation.yml'
);

describe('workflow naming', () => {
  it.each(WORKFLOWS)('%s follows the role naming convention', (file) => {
    const role = ROLES.find(([pattern]) => pattern.test(file));
    expect(role, `${file} has no role prefix`).toBeDefined();
    expect(loadWorkflow(file).name.startsWith(role[1])).toBe(true);
  });

  it.each(WORKFLOWS)('%s has a complete run-name naming its target', (file) => {
    const runName = loadWorkflow(file)['run-name'];
    expect(runName).toEqual(expect.any(String));
    // An unquoted ` #` starts a YAML comment and silently truncates the expression.
    expect(runName.split('${{').length).toBe(runName.split('}}').length);
    expect(runName).toMatch(/PR #|inputs\.branch|github\.ref_name/);
  });
});
