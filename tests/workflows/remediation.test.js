import { describe, expect, it } from 'vitest';
import {
  createContext,
  createCore,
  createGitHub,
  makePR,
  makeRun,
  remediation
} from './helpers/harness.js';

const WF = 'fix-lint.lock.yml';

function setup({ pr = makePR({ number: 7 }), runs = [], pulls = [] } = {}) {
  const github = createGitHub({ pulls: [pr, ...pulls], runs });
  return { github, pr, context: createContext(), core: createCore() };
}

function dispatch(env, overrides = {}) {
  return remediation.dispatchRemediation({
    github: env.github,
    context: env.context,
    core: env.core,
    prNumber: env.pr.number,
    headRef: env.pr.head.ref,
    workflow: WF,
    findings: 'eslint: no-unused-vars',
    ...overrides
  });
}

describe('remediation.cjs label helpers', () => {
  it('adds a label once and removes it again', async () => {
    const env = setup();
    const args = { ...env, prNumber: 7, label: 'lint-failed' };
    await remediation.addLabel(args);
    await remediation.addLabel(args);
    expect(env.github.labels(7)).toEqual(['lint-failed']);
    expect(env.github.calls('issues.addLabels')).toHaveLength(1);

    await remediation.removeLabel(args);
    await remediation.removeLabel(args);
    expect(env.github.labels(7)).toEqual([]);
    expect(env.github.calls('issues.removeLabel')).toHaveLength(1);
  });

  it('turns label API errors into warnings instead of failing the gate', async () => {
    const env = setup();
    env.github.state.addLabelError = 'label service down';
    await remediation.addLabel({ ...env, prNumber: 7, label: 'x' });
    expect(env.core.warnings[0]).toContain('label service down');
    expect(env.core.failed).toEqual([]);
  });
});

describe('remediation.cjs commentOnce', () => {
  it('posts a marked comment only once', async () => {
    const env = setup();
    const args = { ...env, prNumber: 7, marker: '<!-- m -->', body: 'hello' };
    expect(await remediation.commentOnce(args)).toBe(true);
    expect(await remediation.commentOnce(args)).toBe(false);
    expect(env.github.comments(7)).toEqual(['<!-- m -->\nhello']);
  });
});

describe('remediation.cjs dispatchRemediation', () => {
  it('dispatches the agent on the PR head branch with the findings', async () => {
    const env = setup();
    expect(await dispatch(env)).toBe('dispatched');
    expect(env.github.state.dispatches).toEqual([
      {
        owner: 'octo',
        repo: 'demo',
        workflow_id: WF,
        ref: 'feat/sample',
        inputs: { pr_number: '7', findings: 'eslint: no-unused-vars' }
      }
    ]);
  });

  it.each(['queued', 'in_progress', 'waiting', 'pending', 'requested'])(
    'does not dispatch while a run is %s',
    async (status) => {
      const env = setup({
        runs: [
          makeRun({
            id: 1,
            workflow: WF,
            branch: 'feat/sample',
            status,
            conclusion: null
          })
        ]
      });
      expect(await dispatch(env)).toBe('in-progress');
      expect(env.github.state.dispatches).toEqual([]);
    }
  );

  it('ignores runs on other branches and of other workflows', async () => {
    const env = setup({
      runs: [
        makeRun({
          id: 1,
          workflow: WF,
          branch: 'other',
          status: 'in_progress'
        }),
        makeRun({
          id: 2,
          workflow: 'fix-tests.lock.yml',
          branch: 'feat/sample',
          status: 'in_progress'
        }),
        makeRun({
          id: 3,
          workflow: WF,
          branch: 'feat/sample',
          event: 'push',
          status: 'in_progress'
        })
      ]
    });
    expect(await dispatch(env)).toBe('dispatched');
  });

  it('waits for an open stacked remediation PR before dispatching again', async () => {
    const stacked = makePR({
      number: 8,
      branch: 'lint-fix-1',
      base: 'feat/sample',
      labels: ['lint-remediation']
    });
    const env = setup({ pulls: [stacked] });
    expect(await dispatch(env, { stackedLabel: 'lint-remediation' })).toBe(
      'pending-stacked-pr'
    );
    expect(env.github.state.dispatches).toEqual([]);
  });

  it('is not blocked by unrelated PRs targeting the branch', async () => {
    const other = makePR({
      number: 8,
      branch: 'x',
      base: 'feat/sample',
      labels: ['test-remediation']
    });
    const env = setup({ pulls: [other] });
    expect(await dispatch(env, { stackedLabel: 'lint-remediation' })).toBe(
      'dispatched'
    );
  });

  it('stops after the default budget of 2 attempts and comments once', async () => {
    const runs = [1, 2].map((id) =>
      makeRun({
        id,
        workflow: WF,
        branch: 'feat/sample',
        conclusion: 'success'
      })
    );
    const env = setup({ runs });
    expect(await dispatch(env)).toBe('exhausted');
    expect(await dispatch(env)).toBe('exhausted');
    expect(env.github.state.dispatches).toEqual([]);
    const comments = env.github.comments(7);
    expect(comments).toHaveLength(1);
    expect(comments[0]).toContain(`<!-- remediation-exhausted:${WF} -->`);
    expect(comments[0]).toContain('MAX_REMEDIATION_ATTEMPTS');
  });

  it('allows a second attempt when only one run happened', async () => {
    const env = setup({
      runs: [
        makeRun({
          id: 1,
          workflow: WF,
          branch: 'feat/sample',
          conclusion: 'failure'
        })
      ]
    });
    expect(await dispatch(env)).toBe('dispatched');
  });

  it('does not count cancelled or skipped runs against the budget', async () => {
    const env = setup({
      runs: [
        makeRun({
          id: 1,
          workflow: WF,
          branch: 'feat/sample',
          conclusion: 'cancelled'
        }),
        makeRun({
          id: 2,
          workflow: WF,
          branch: 'feat/sample',
          conclusion: 'skipped'
        }),
        makeRun({
          id: 3,
          workflow: WF,
          branch: 'feat/sample',
          conclusion: 'success'
        })
      ]
    });
    expect(await dispatch(env)).toBe('dispatched');
  });

  it('honours MAX_REMEDIATION_ATTEMPTS from the environment and the maxAttempts argument', async () => {
    const runs = [1, 2].map((id) =>
      makeRun({ id, workflow: WF, branch: 'feat/sample' })
    );
    const saved = process.env.MAX_REMEDIATION_ATTEMPTS;
    process.env.MAX_REMEDIATION_ATTEMPTS = '3';
    try {
      expect(await dispatch(setup({ runs }))).toBe('dispatched');
    } finally {
      if (saved === undefined) delete process.env.MAX_REMEDIATION_ATTEMPTS;
      else process.env.MAX_REMEDIATION_ATTEMPTS = saved;
    }
    expect(await dispatch(setup({ runs }), { maxAttempts: '1' })).toBe(
      'exhausted'
    );
  });

  it('truncates very long findings', async () => {
    const env = setup();
    await dispatch(env, { findings: `  ${'x'.repeat(7000)}  ` });
    const { findings } = env.github.state.dispatches[0].inputs;
    expect(findings.startsWith('x'.repeat(6000))).toBe(true);
    expect(findings.endsWith('...[truncated]')).toBe(true);
    expect(findings.length).toBe(6000 + '\n...[truncated]'.length);
  });

  it('reports API errors as "error" with a warning', async () => {
    const env = setup();
    env.github.state.dispatchError = 'workflow not found on ref';
    expect(await dispatch(env)).toBe('error');
    expect(env.core.warnings[0]).toContain('workflow not found on ref');
  });
});

describe('remediation.cjs dispatchRemediation after a superseded stacked PR', () => {
  const ran = () =>
    makeRun({
      id: 1,
      workflow: WF,
      branch: 'feat/sample',
      conclusion: 'success'
    });
  const closedStacked = (labels) =>
    makePR({
      number: 8,
      branch: 'lint-fix-1',
      base: 'feat/sample',
      labels,
      state: 'closed'
    });

  it('gives the attempt of a superseded stacked PR back, so the fix is regenerated once', async () => {
    const env = setup({
      runs: [ran()],
      pulls: [closedStacked(['lint-remediation', remediation.SUPERSEDED_LABEL])]
    });
    expect(
      await dispatch(env, { stackedLabel: 'lint-remediation', maxAttempts: 1 })
    ).toBe('dispatched');
  });

  it('still counts merged (or otherwise closed) stacked PRs', async () => {
    const env = setup({
      runs: [ran()],
      pulls: [closedStacked(['lint-remediation'])]
    });
    expect(
      await dispatch(env, { stackedLabel: 'lint-remediation', maxAttempts: 1 })
    ).toBe('exhausted');
  });

  it('only refunds superseded PRs of the same remediation label', async () => {
    const env = setup({
      runs: [ran()],
      pulls: [closedStacked(['test-remediation', remediation.SUPERSEDED_LABEL])]
    });
    expect(
      await dispatch(env, { stackedLabel: 'lint-remediation', maxAttempts: 1 })
    ).toBe('exhausted');
  });
});
