import { describe, expect, it } from 'vitest';
import {
  createContext,
  createGitHub,
  getScript,
  loadWorkflow,
  makePR,
  runScript
} from './helpers/harness.js';

const FILE = 'pr-merge-conflicts.yml';
const script = getScript(
  FILE,
  'detect',
  'Flag pull requests that conflict with their base'
);

function conflictingPR(number, extra = {}) {
  const pr = makePR({ number, ...extra });
  pr.mergeable = false;
  return pr;
}

function push(github, branch) {
  return runScript(script, {
    github,
    context: createContext({ eventName: 'push', ref: `refs/heads/${branch}` })
  });
}

describe('pr-merge-conflicts.yml structure', () => {
  const wf = loadWorkflow(FILE);

  it('runs on pushes (pull_request workflows never start for conflicting PRs)', () => {
    expect(Object.keys(wf.on)).toEqual(['push']);
    expect(wf.on.push.branches).toEqual(['**']);
    expect(wf.jobs.detect.if).toContain('!github.event.deleted');
    expect(wf.concurrency['cancel-in-progress']).toBe(true);
  });

  it('can only comment and set statuses', () => {
    expect(wf.permissions).toEqual({
      contents: 'read',
      'pull-requests': 'read',
      issues: 'write',
      statuses: 'write'
    });
  });
});

describe('pr-merge-conflicts.yml detector', () => {
  it('flags every PR into main that conflicts after main moved', async () => {
    const a = conflictingPR(21, { branch: 'feat/a' });
    const b = makePR({ number: 22, branch: 'feat/b' });
    const other = conflictingPR(23, { branch: 'feat/c', base: 'release/1.0' });
    const github = createGitHub({ pulls: [a, b, other] });
    const { core } = await push(github, 'main');
    expect(github.qualityStatuses(a.head.sha)[0].state).toBe('failure');
    expect(github.qualityStatuses(b.head.sha)).toEqual([]);
    expect(github.qualityStatuses(other.head.sha)).toEqual([]);
    expect(core.summaryText).toContain('Checked 2 PR(s)');
    expect(core.summaryText).toContain('conflicting: #21');
  });

  it('checks only the PR of a pushed feature branch', async () => {
    const a = conflictingPR(21, { branch: 'feat/a' });
    const b = conflictingPR(22, { branch: 'feat/b' });
    const github = createGitHub({ pulls: [a, b] });
    await push(github, 'feat/a');
    expect(github.comments(21)).toHaveLength(1);
    expect(github.comments(22)).toEqual([]);
  });

  it('does nothing for a branch without a PR', async () => {
    const github = createGitHub({ pulls: [conflictingPR(21)] });
    const { core } = await push(github, 'scratch');
    expect(github.state.comments).toEqual([]);
    expect(core.summaryText).toContain('none conflict');
  });
});
