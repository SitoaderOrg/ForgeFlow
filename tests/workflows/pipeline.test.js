import { describe, expect, it } from 'vitest';
import {
  createContext,
  createGitHub,
  getScript,
  loadWorkflow,
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

  it('chains the gates Check stage by stage', () => {
    const needs = (job) => wf.jobs[job].needs;
    expect(wf.jobs.gatekeeper.if).toBe("needs.context.outputs.skip != 'true'");
    expect(needs('lint')).toEqual(['context', 'gatekeeper']);
    expect(needs('build')).toEqual(['context', 'lint']);
    for (const job of ['test', 'security', 'docs']) {
      expect(needs(job)).toEqual(['context', 'build']);
    }
    expect(needs('dispatcher')).toEqual([
      'context',
      'test',
      'security',
      'docs'
    ]);
  });

  it('publishes a verdict after every gate, even when some failed', () => {
    const verdict = wf.jobs.verdict;
    expect(verdict.needs).toEqual([
      'context',
      'gatekeeper',
      'lint',
      'build',
      'test',
      'security',
      'docs'
    ]);
    expect(verdict.if).toContain('always()');
    expect(verdict.if).toContain('!cancelled()');
    expect(verdict.if).toContain("needs.context.result == 'success'");
    expect(verdict.if).toContain("needs.context.outputs.skip != 'true'");
    expect(verdict.permissions.statuses).toBe('write');
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
  ref
} = {}) {
  const github = createGitHub({ pulls: [pr], statuses });
  const context = createContext({
    eventName,
    ref: ref ?? `refs/heads/${pr.head.ref}`,
    runId: 555,
    payload:
      eventName === 'pull_request'
        ? { pull_request: { number: pr.number } }
        : {}
  });
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
      skip: 'false'
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

const ALL_GATES = ['gatekeeper', 'lint', 'build', 'test', 'security', 'docs'];
async function verdict(results) {
  const pr = makePR();
  const rev = quality.revision(pr);
  const github = createGitHub({ pulls: [pr] });
  const needs = { context: { result: 'success', outputs: {} } };
  for (const job of ALL_GATES)
    needs[job] = { result: results[job] ?? 'success' };
  const { core } = await runScript(verdictScript, {
    github,
    context: createContext({ runId: 777 }),
    env: { NEEDS: JSON.stringify(needs), HEAD_SHA: pr.head.sha, REVISION: rev }
  });
  const [status] = github.qualityStatuses(pr.head.sha);
  return { status, core, rev };
}

describe('pr-pipeline.yml verdict job', () => {
  it('reports success only when every gate passed', async () => {
    const { status, core, rev } = await verdict({});
    expect(status.state).toBe('success');
    expect(status.description).toBe(`All gates passed [rev ${rev}]`);
    expect(status.target_url).toBe(
      'https://github.com/octo/demo/actions/runs/777'
    );
    expect(core.summaryText).toContain('Ready for human review');
  });

  it('lists failed gates and the gates that never ran', async () => {
    const { status, core } = await verdict({
      lint: 'failure',
      build: 'skipped',
      test: 'skipped',
      security: 'skipped',
      docs: 'skipped'
    });
    expect(status.state).toBe('failure');
    expect(status.description).toMatch(
      /^Failed: Lint; not run: Build, Tests, Security, Docs \[rev /
    );
    expect(core.summaryText).toContain('Remediation agents were dispatched');
  });

  it('fails when several gates fail in parallel', async () => {
    const { status } = await verdict({ test: 'failure', docs: 'failure' });
    expect(status.description).toMatch(/^Failed: Tests, Docs \[rev /);
  });

  it.each(['skipped', 'cancelled'])(
    'never treats a %s gate as passing',
    async (result) => {
      const { status } = await verdict({ security: result });
      expect(status.state).toBe('failure');
      expect(status.description).toMatch(/^not run: Security/);
    }
  );

  it('treats a missing gate result as not run', async () => {
    const pr = makePR();
    const github = createGitHub({ pulls: [pr] });
    await runScript(verdictScript, {
      github,
      env: {
        NEEDS: JSON.stringify({ context: { result: 'success' } }),
        HEAD_SHA: pr.head.sha,
        REVISION: quality.revision(pr)
      }
    });
    expect(github.qualityStatuses(pr.head.sha)[0].description).toMatch(
      /^not run: Metadata, Lint, Build, Tests, Security, Docs/
    );
  });
});
