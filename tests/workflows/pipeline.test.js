import { describe, expect, it } from 'vitest';
import {
  createContext,
  createGitHub,
  getScript,
  loadWorkflow,
  makeAgentRun,
  makePR,
  quality,
  readWorkflow,
  runScript,
  seedQualityStatus
} from './helpers/harness.js';

const FILE = 'pr-pipeline.yml';
const contextScript = getScript(FILE, 'context', 'Resolve pull request');
const verdictScript = getScript(FILE, 'verdict', 'Publish pr-quality status');

describe('pr-pipeline.yml structure', () => {
  const wf = loadWorkflow(FILE);

  it('runs on PR updates and on relay re-dispatch with an optional force flag', () => {
    expect(wf.on.pull_request.types).toEqual([
      'opened',
      'synchronize',
      'reopened',
      'ready_for_review'
    ]);
    expect(wf.on.workflow_dispatch.inputs.pr_number.required).toBe(true);
    expect(wf.on.workflow_dispatch.inputs.force).toMatchObject({
      type: 'boolean',
      default: false
    });
  });

  it('serialises runs per PR and only cancels on new pushes', () => {
    expect(wf.concurrency.group).toBe(
      'pr-pipeline-${{ github.event.pull_request.number || inputs.pr_number }}'
    );
    expect(wf.concurrency['cancel-in-progress']).toBe(
      "${{ github.event_name == 'pull_request' }}"
    );
  });

  const GATE_JOBS = ['gatekeeper', 'lint', 'build', 'test', 'security', 'docs'];

  it('auto-fixes lint first, then runs every gate in parallel', () => {
    expect(wf.jobs.autofix.needs).toEqual(['context']);
    expect(wf.jobs.autofix.if).toBe("needs.context.outputs.skip != 'true'");
    for (const job of GATE_JOBS) {
      expect(wf.jobs[job].needs).toEqual(['context', 'autofix']);
      expect(wf.jobs[job].if).toBe(
        "needs.context.outputs.skip != 'true' && needs.autofix.outputs.pushed != 'true'"
      );
      expect(wf.jobs[job].permissions.statuses).toBe('write');
      expect(wf.jobs[job].with.pr_number).toBe(
        '${{ needs.context.outputs.pr_number }}'
      );
      expect(wf.jobs[job].with.head_sha).toBe(
        '${{ needs.context.outputs.head_sha }}'
      );
    }
    expect(wf.jobs.dispatcher).toBeUndefined();
  });

  it('only pushes lint auto-fixes to same-repository branches and never fails on them', () => {
    const steps = wf.jobs.autofix.steps;
    const fix = steps.find((s) => s.id === 'fix');
    expect(fix['continue-on-error']).toBe(true);
    expect(fix.if).toBe("needs.context.outputs.same_repo == 'true'");
    expect(wf.jobs.context.outputs.same_repo).toBe(
      '${{ steps.pr.outputs.same_repo }}'
    );
    expect(fix.run).toContain('[pr-autofix]');
    expect(fix.run).toContain('npx eslint --fix');
    expect(fix.run).toContain('npx prettier --write');
    expect(fix.run).toMatch(/grep -vE '\^\(\\\.github\|docs/);
    expect(wf.jobs.autofix.permissions.contents).toBe('write');
    expect(wf.jobs.autofix.outputs.pushed).toBe(
      '${{ steps.fix.outputs.pushed }}'
    );
  });

  it('publishes a verdict after every gate, even when some failed', () => {
    const verdict = wf.jobs.verdict;
    expect(verdict.needs).toEqual(['context', 'autofix', ...GATE_JOBS]);
    expect(verdict.if).toContain('always()');
    expect(verdict.if).toContain('!cancelled()');
    expect(verdict.if).toContain("needs.context.result == 'success'");
    expect(verdict.if).toContain("needs.context.outputs.skip != 'true'");
    expect(verdict.if).toContain("needs.autofix.outputs.pushed != 'true'");
    expect(verdict.concurrency).toEqual({
      group: 'pr-quality-verdict-${{ needs.context.outputs.pr_number }}',
      'cancel-in-progress': false
    });
    expect(verdict.permissions.statuses).toBe('write');
    expect(verdict.permissions.actions).toBe('write');
  });
  it('never merges or enables auto-merge on the feature PR (human approval)', () => {
    const text = readWorkflow(FILE);
    expect(text).not.toMatch(
      /enablePullRequestAutoMerge|pulls\.merge|gh pr merge/
    );
  });
});

function setupContext({
  pr,
  statuses,
  eventName = 'workflow_dispatch',
  ref,
  sha
} = {}) {
  const github = createGitHub({ pulls: [pr], statuses });
  const context = createContext({
    eventName,
    ref: ref ?? `refs/heads/${pr.head.ref}`,
    runId: 555,
    payload:
      eventName === 'pull_request'
        ? {
            pull_request: {
              number: pr.number,
              ...(sha ? { head: { sha } } : {})
            }
          }
        : {}
  });
  if (sha && eventName !== 'pull_request') context.sha = sha;
  return { github, context };
}

async function resolve(pr, { env = {}, ...opts } = {}) {
  const { github, context } = setupContext({ pr, ...opts });
  const run = await runScript(contextScript, {
    github,
    context,
    env: { PR_INPUT: String(pr.number), FORCE: 'false', ...env }
  });
  return { ...run, outputs: run.core.outputs };
}

describe('pr-pipeline.yml context job: stale runs', () => {
  const OLD = '1'.repeat(40);

  it('skips a dispatched run whose commit is no longer the PR head and re-dispatches', async () => {
    const pr = makePR({ number: 20 });
    const { outputs, github, core } = await resolve(pr, {
      sha: OLD,
      env: { FORCE: 'true' }
    });
    expect(outputs.skip).toBe('true');
    expect(core.notices.join()).toContain('re-dispatching on the new head');
    expect(github.qualityStatuses(pr.head.sha)).toEqual([]);
    expect(github.state.dispatches).toEqual([
      {
        owner: 'octo',
        repo: 'demo',
        workflow_id: 'pr-pipeline.yml',
        ref: 'feat/sample',
        inputs: { pr_number: '20', force: 'true' }
      }
    ]);
  });

  it('runs normally when the dispatched commit is the PR head', async () => {
    const pr = makePR({ number: 20 });
    const { outputs, github } = await resolve(pr, { sha: pr.head.sha });
    expect(outputs.skip).toBe('false');
    expect(github.state.dispatches).toEqual([]);
  });

  it('skips a stale pull_request run without dispatching (the newer commit is checked)', async () => {
    const pr = makePR({ number: 20 });
    const { outputs, github } = await resolve(pr, {
      eventName: 'pull_request',
      ref: 'refs/pull/20/merge',
      sha: OLD,
      env: { PR_INPUT: '' }
    });
    expect(outputs.skip).toBe('true');
    expect(github.state.dispatches).toEqual([]);
  });

  it('never re-dispatches for, or auto-fixes, a fork PR', async () => {
    const pr = makePR({ number: 20 });
    pr.head.repo = { full_name: 'someone/demo' };
    const { outputs, github } = await resolve(pr, { sha: OLD });
    expect(outputs).toMatchObject({ skip: 'true', same_repo: 'false' });
    expect(github.state.dispatches).toEqual([]);
  });
});

describe('pr-pipeline.yml context job (Check entry point)', () => {
  it('resolves a new revision and marks it pending', async () => {
    const pr = makePR({ number: 20 });
    const { outputs, github } = await resolve(pr);
    expect(outputs).toEqual({
      pr_number: '20',
      head_ref: 'feat/sample',
      head_sha: pr.head.sha,
      base_ref: 'main',
      revision: quality.revision(pr),
      skip: 'false',
      same_repo: 'true'
    });
    const [status] = github.qualityStatuses(pr.head.sha);
    expect(status.state).toBe('pending');
    expect(quality.parseRevision(status.description)).toBe(
      quality.revision(pr)
    );
    expect(status.target_url).toBe(
      'https://github.com/octo/demo/actions/runs/555'
    );
  });

  it('uses the pull_request payload on PR events', async () => {
    const pr = makePR({ number: 21 });
    const { outputs, core } = await resolve(pr, {
      eventName: 'pull_request',
      ref: 'refs/pull/21/merge',
      env: { PR_INPUT: '' }
    });
    expect(core.failed).toEqual([]);
    expect(outputs.pr_number).toBe('21');
    expect(outputs.skip).toBe('false');
  });

  it.each(['abc', '0', '-3', '1.5', ''])(
    'fails for an invalid PR number %j',
    async (input) => {
      const pr = makePR({ number: 22 });
      const { core, outputs } = await resolve(pr, { env: { PR_INPUT: input } });
      expect(core.failed[0]).toContain('Invalid pull request number');
      expect(outputs).toEqual({});
    }
  );

  it('fails when dispatched on a ref other than the PR head branch', async () => {
    const pr = makePR({ number: 23 });
    const { core, github } = await resolve(pr, { ref: 'refs/heads/main' });
    expect(core.failed[0]).toContain('Re-run with --ref feat/sample');
    expect(github.qualityStatuses(pr.head.sha)).toEqual([]);
  });

  it('skips closed PRs without touching the status', async () => {
    const pr = makePR({ number: 24, state: 'closed' });
    const { outputs, github } = await resolve(pr);
    expect(outputs.skip).toBe('true');
    expect(github.qualityStatuses(pr.head.sha)).toEqual([]);
  });

  it.each([
    'lint-remediation',
    'test-remediation',
    'security-remediation',
    'doc-remediation'
  ])('skips stacked remediation PRs labelled %s', async (label) => {
    const pr = makePR({
      number: 25,
      branch: 'fix-1',
      base: 'feat/sample',
      labels: [label]
    });
    const { outputs, core } = await resolve(pr);
    expect(outputs.skip).toBe('true');
    expect(core.notices[0]).toContain('stacked remediation PR');
  });

  it.each(['success', 'failure', 'error'])(
    'skips a revision that already has a %s verdict',
    async (state) => {
      const pr = makePR({ number: 26 });
      const { github, context } = setupContext({ pr });
      await seedQualityStatus(github, pr, state);
      const { core } = await runScript(contextScript, {
        github,
        context,
        env: { PR_INPUT: '26', FORCE: 'false' }
      });
      expect(core.outputs.skip).toBe('true');
      expect(core.notices[0]).toContain('already has');
      expect(github.qualityStatuses(pr.head.sha)).toHaveLength(1);
    }
  );

  it('re-checks when only the pending status exists (interrupted run)', async () => {
    const pr = makePR({ number: 27 });
    const { github, context } = setupContext({ pr });
    await seedQualityStatus(github, pr, 'pending');
    const { core } = await runScript(contextScript, {
      github,
      context,
      env: { PR_INPUT: '27' }
    });
    expect(core.outputs.skip).toBe('false');
  });

  it.each([
    ['title', { title: 'fix(app): corrected title' }],
    ['body', { body: 'Rewritten description by pr-validation.' }],
    ['decision label', { labels: [{ name: 'docs-not-required' }] }]
  ])('re-checks the same commit when the %s changed', async (_, change) => {
    const pr = makePR({ number: 28 });
    const { github, context } = setupContext({ pr });
    await seedQualityStatus(github, pr, 'failure');
    Object.assign(github.pr(28), change);
    const { core } = await runScript(contextScript, {
      github,
      context,
      env: { PR_INPUT: '28' }
    });
    expect(core.outputs.skip).toBe('false');
    expect(core.outputs.revision).not.toBe(quality.revision(pr));
  });

  it('does not re-check when only a non-decision label changed', async () => {
    const pr = makePR({ number: 29 });
    const { github, context } = setupContext({ pr });
    await seedQualityStatus(github, pr, 'failure');
    github.pr(29).labels.push({ name: 'lint-failed' });
    const { core } = await runScript(contextScript, {
      github,
      context,
      env: { PR_INPUT: '29' }
    });
    expect(core.outputs.skip).toBe('true');
  });

  it.each([
    ['force=true', { FORCE: 'true' }],
    ['a manual re-run attempt', { GITHUB_RUN_ATTEMPT: '2' }]
  ])('re-checks an already judged revision for %s', async (_, env) => {
    const pr = makePR({ number: 30 });
    const { github, context } = setupContext({ pr });
    await seedQualityStatus(github, pr, 'success');
    const { core } = await runScript(contextScript, {
      github,
      context,
      env: { PR_INPUT: '30', ...env }
    });
    expect(core.outputs.skip).toBe('false');
    expect(github.qualityStatuses(pr.head.sha)[0].state).toBe('pending');
  });
});

const autofixScript = getScript(
  FILE,
  'autofix',
  'Re-check the auto-fixed commit or start the gates'
);

describe('pr-pipeline.yml autofix job', () => {
  it('re-dispatches the pipeline on the auto-fixed commit instead of checking the old one', async () => {
    const pr = makePR({ number: 40 });
    const github = createGitHub({ pulls: [pr] });
    const { core } = await runScript(autofixScript, {
      github,
      context: createContext({ runId: 600 }),
      env: {
        PR_NUMBER: '40',
        HEAD_REF: 'feat/sample',
        HEAD_SHA: pr.head.sha,
        PUSHED: 'true',
        FIX_SHA: 'f1x0000000000000000000000000000000000000'
      }
    });
    expect(github.state.dispatches).toEqual([
      {
        owner: 'octo',
        repo: 'demo',
        workflow_id: 'pr-pipeline.yml',
        ref: 'feat/sample',
        inputs: { pr_number: '40' }
      }
    ]);
    expect(github.comments(40)[0]).toContain('auto-fixed');
    expect(github.comments(40)[0]).toContain('f1x0000');
    expect(github.state.statuses[pr.head.sha]).toBeUndefined();
    expect(core.summaryText).toContain('re-dispatched');
  });

  it('marks every gate pending and clears stale passed labels when nothing was fixed', async () => {
    const pr = makePR({ number: 41, labels: ['lint-passed', 'docs-required'] });
    const github = createGitHub({ pulls: [pr] });
    await runScript(autofixScript, {
      github,
      env: {
        PR_NUMBER: '41',
        HEAD_REF: 'feat/sample',
        HEAD_SHA: pr.head.sha,
        PUSHED: 'false'
      }
    });
    const gates = await quality.getGateStatuses({
      github,
      context: createContext(),
      sha: pr.head.sha
    });
    expect(Object.keys(gates).sort()).toEqual(
      quality.GATES.map((g) => g.id).sort()
    );
    expect(Object.values(gates).every((g) => g.state === 'pending')).toBe(true);
    expect(github.labels(41)).toEqual(['docs-required']);
    expect(github.state.dispatches).toEqual([]);
  });
});

const ALL_GATES = ['gatekeeper', 'lint', 'build', 'test', 'security', 'docs'];
const JOB_GATE = {
  gatekeeper: 'metadata',
  lint: 'lint',
  build: 'build',
  test: 'tests',
  security: 'security',
  docs: 'docs'
};

/** Run the verdict job after the gates recorded `recorded` (gate id -> state). */
async function verdict({ results = {}, recorded, runs = [] } = {}) {
  const pr = makePR({ number: 50 });
  const github = createGitHub({ pulls: [pr], runs });
  const context = createContext({ runId: 777 });
  const needs = { context: { result: 'success', outputs: {} } };
  for (const job of ALL_GATES) {
    const result = results[job] ?? 'success';
    needs[job] = { result };
    const state = recorded
      ? recorded[JOB_GATE[job]]
      : { success: 'success', failure: 'failure' }[result];
    if (state) {
      await quality.setGateStatus({
        github,
        context,
        sha: pr.head.sha,
        gate: JOB_GATE[job],
        state,
        description: `${JOB_GATE[job]} ${state}`
      });
    }
  }
  const { core } = await runScript(verdictScript, {
    github,
    context,
    env: {
      NEEDS: JSON.stringify(needs),
      PR_NUMBER: '50',
      HEAD_SHA: pr.head.sha
    }
  });
  const [status] = github.qualityStatuses(pr.head.sha);
  const gates = await quality.getGateStatuses({
    github,
    context,
    sha: pr.head.sha
  });
  return { status, core, github, gates, rev: quality.revision(pr) };
}

describe('pr-pipeline.yml verdict job', () => {
  it('reports success only when every gate passed and requests review', async () => {
    const { status, core, rev, github } = await verdict();
    expect(status.state).toBe('success');
    expect(status.description).toBe(`All gates passed [rev ${rev}]`);
    expect(status.target_url).toBe(
      'https://github.com/octo/demo/actions/runs/777'
    );
    expect(core.summaryText).toContain('Ready for human review');
    expect(github.state.dispatches).toEqual([
      {
        owner: 'octo',
        repo: 'demo',
        workflow_id: 'pr-review-dispatcher.yml',
        ref: 'main',
        inputs: { pr_number: '50' }
      }
    ]);
  });

  it('stays pending while the dispatched agents repair failing gates', async () => {
    const { status, core, github } = await verdict({
      results: { lint: 'failure', test: 'failure' },
      runs: [
        makeAgentRun({
          id: 1,
          workflow: 'pr-lint-fixer.lock.yml',
          branch: 'feat/sample',
          phase: 'queued'
        })
      ]
    });
    expect(status.state).toBe('pending');
    expect(status.description).toMatch(/^Repairing: Lint, Tests \[rev /);
    expect(core.summaryText).toContain(
      'repairing the failing gates in parallel'
    );
    expect(github.state.dispatches).toEqual([]);
    expect(github.comments(50)).toEqual([]);
  });

  it('fails without commenting when no agent repairs the failing gates', async () => {
    const { status, github } = await verdict({
      results: { build: 'failure' }
    });
    expect(status.state).toBe('failure');
    expect(status.description).toMatch(/^Failed: Build \[rev /);
    expect(github.comments(50)).toEqual([]);
  });

  it.each(['skipped', 'cancelled'])(
    'marks a %s gate that never recorded a result as errored',
    async (result) => {
      const { status, gates } = await verdict({
        results: { security: result },
        recorded: {
          metadata: 'success',
          lint: 'success',
          build: 'success',
          tests: 'success',
          docs: 'success'
        }
      });
      expect(gates.security.state).toBe('error');
      expect(gates.security.description).toContain(`(${result})`);
      expect(status.state).toBe('failure');
      expect(status.description).toMatch(/^Failed: Security/);
    }
  );

  it('overrides a gate left pending by a crashed gate job', async () => {
    const { gates, status } = await verdict({
      results: { docs: 'failure' },
      recorded: {
        metadata: 'success',
        lint: 'success',
        build: 'success',
        tests: 'success',
        security: 'success',
        docs: 'pending'
      }
    });
    expect(gates.docs.state).toBe('error');
    expect(status.description).toMatch(/^Failed: Docs/);
  });
});
