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

const FILE = 'pipeline.yml';
const contextScript = getScript(FILE, 'context', 'Resolve pull request');
const verdictScript = getScript(FILE, 'verdict', 'Publish pr-quality status');

describe('pipeline.yml structure', () => {
  const wf = loadWorkflow(FILE);

  it('runs on PR updates and on relay re-dispatch with an optional force flag', () => {
    // Stacked remediation PRs target a feature branch: they must not start held runs.
    expect(wf.on.pull_request.branches).toEqual(['main']);
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

  it('serialises runs per PR and only cancels on new human pushes', () => {
    expect(wf.concurrency.group).toBe(
      'pipeline-${{ github.event.pull_request.number || inputs.pr_number }}'
    );
    // Bot pushes (auto-fix, relay merges) queue so the pushing run finishes and results carry over.
    expect(wf.concurrency['cancel-in-progress']).toBe(
      "${{ github.event_name == 'pull_request' && github.event.sender.type != 'Bot' }}"
    );
  });

  const GATE_JOBS = ['metadata', 'lint', 'build', 'tests', 'security', 'docs'];

  it('auto-fixes lint first, then runs every gate in parallel', () => {
    expect(wf.jobs.autofix.needs).toEqual(['context']);
    expect(wf.jobs.autofix.if).toBe("needs.context.outputs.skip != 'true'");
    for (const job of GATE_JOBS) {
      expect(wf.jobs[job].needs).toEqual(['context', 'autofix']);
      expect(wf.jobs[job].if).toBe(
        "needs.context.outputs.skip != 'true' && needs.autofix.outputs.stacked != 'true'"
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

  it('commits lint auto-fixes to a stacked branch, never to the feature branch, and never fails on them', () => {
    const steps = wf.jobs.autofix.steps;
    const fix = steps.find((s) => s.id === 'fix');
    expect(fix['continue-on-error']).toBe(true);
    expect(fix.if).toBe("needs.context.outputs.same_repo == 'true'");
    expect(wf.jobs.context.outputs.same_repo).toBe(
      '${{ steps.pr.outputs.same_repo }}'
    );
    expect(fix.env.FIX_BRANCH).toBe(
      'lint-autofix/pr-${{ needs.context.outputs.pr_number }}'
    );
    expect(fix.env.HEAD_REF).toBeUndefined();
    expect(fix.run).toContain('[pr-autofix]');
    expect(fix.run).toContain('npx eslint --fix');
    expect(fix.run).toContain('npx prettier --write');
    expect(fix.run).toMatch(/grep -vE '\^\(\\\.github\|docs/);
    expect(fix.run).toContain('git switch -c "$FIX_BRANCH"');
    expect(fix.run).toContain(
      'git push --force origin "HEAD:refs/heads/$FIX_BRANCH"'
    );
    expect(fix.run).not.toContain('HEAD_REF');
    expect(wf.jobs.autofix.permissions.contents).toBe('write');
    expect(wf.jobs.autofix.outputs).toEqual({
      stacked: '${{ steps.fix.outputs.stacked }}'
    });
  });

  it('publishes a verdict after every gate, even when some failed', () => {
    const verdict = wf.jobs.verdict;
    expect(verdict.needs).toEqual(['context', 'autofix', ...GATE_JOBS]);
    expect(verdict.if).toContain('always()');
    expect(verdict.if).toContain('!cancelled()');
    expect(verdict.if).toContain("needs.context.result == 'success'");
    expect(verdict.if).toContain("needs.context.outputs.skip != 'true'");
    expect(verdict.if).toContain("needs.autofix.outputs.stacked != 'true'");
    expect(verdict.concurrency).toEqual({
      group: 'verdict-${{ needs.context.outputs.pr_number }}',
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

describe('pipeline.yml context job: stale runs', () => {
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
        workflow_id: 'pipeline.yml',
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

describe('pipeline.yml context job (Check entry point)', () => {
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
      same_repo: 'true',
      mode: 'full',
      recheck_before: '',
      recheck_gates: ''
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
    ['body', { body: 'Rewritten description by fix-metadata.' }],
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
  'Propose the auto-fix as a stacked PR or start the gates'
);

const autofixEnv = (pr, extra = {}) => ({
  PR_NUMBER: String(pr.number),
  HEAD_REF: pr.head.ref,
  HEAD_SHA: pr.head.sha,
  REVISION: quality.revision(pr),
  STACKED: 'true',
  FIX_BRANCH: `lint-autofix/pr-${pr.number}`,
  FIX_SHA: 'f1x0000000000000000000000000000000000000',
  FIX_FILES: 'src/a.js,src/b.css',
  ...extra
});

describe('pipeline.yml autofix job', () => {
  it('proposes the auto-fix as a stacked lint PR and hands off to the relay', async () => {
    const pr = makePR({ number: 40 });
    const github = createGitHub({ pulls: [pr] });
    const { core } = await runScript(autofixScript, {
      github,
      context: createContext({ runId: 600 }),
      env: autofixEnv(pr)
    });

    const stacked = github.state.pulls.find(
      (p) => p.head.ref === 'lint-autofix/pr-40'
    );
    expect(stacked).toMatchObject({
      state: 'open',
      base: { ref: 'feat/sample' },
      title: 'style(lint): auto-fix lint and formatting [pr-autofix]'
    });
    expect(stacked.body).toContain('- `src/a.js`');
    expect(stacked.body).toContain('relay.yml');
    // The relay checks this commit is still in the branch before merging.
    expect(stacked.body).toContain(quality.stackedBaseMarker(pr.head.sha));
    expect(github.labels(stacked.number)).toEqual(['lint-remediation']);

    // Same hand-off as the agents' conclusion job; the gates wait for the merged fix.
    expect(github.state.dispatches).toEqual([
      {
        owner: 'octo',
        repo: 'demo',
        workflow_id: 'relay.yml',
        ref: 'main',
        inputs: {
          branch: 'feat/sample',
          agent_result: 'success',
          source: 'Lint auto-fix (run 600)'
        }
      }
    ]);
    expect(quality.repairedGate('Lint auto-fix (run 600)')).toBe('lint');
    expect(github.comments(40)[0]).toContain(`stacked PR #${stacked.number}`);
    const [status] = github.qualityStatuses(pr.head.sha);
    expect(status.state).toBe('pending');
    expect(status.description).toContain(
      `Repairing: Lint (auto-fix stacked PR #${stacked.number})`
    );
    expect(status.description).toContain(`[rev ${quality.revision(pr)}]`);
    expect(
      Object.keys(
        await quality.getGateStatuses({
          github,
          context: createContext(),
          sha: pr.head.sha
        })
      )
    ).toEqual([]);
    expect(github.calls('pulls.merge')).toEqual([]);
    expect(core.summaryText).toContain('stacked PR');
  });

  it('reuses an open stacked auto-fix PR that the force-push updated', async () => {
    const pr = makePR({ number: 43 });
    const previous = makePR({
      number: 44,
      branch: 'lint-autofix/pr-43',
      base: 'feat/sample',
      labels: ['lint-remediation']
    });
    const github = createGitHub({ pulls: [pr, previous] });
    await runScript(autofixScript, {
      github,
      context: createContext({ runId: 601 }),
      env: autofixEnv(pr)
    });
    expect(github.calls('pulls.create')).toEqual([]);
    expect(github.comments(43)[0]).toContain('stacked PR #44');
    // The force-push rebuilt the fix on the new head; its recorded base follows.
    expect(github.pr(44).body).toContain(
      quality.stackedBaseMarker(pr.head.sha)
    );
    expect(github.state.dispatches.map((d) => d.workflow_id)).toEqual([
      'relay.yml'
    ]);
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
        STACKED: 'false'
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

const ALL_GATES = ['metadata', 'lint', 'build', 'tests', 'security', 'docs'];
const JOB_GATE = {
  metadata: 'metadata',
  lint: 'lint',
  build: 'build',
  tests: 'tests',
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

describe('pipeline.yml verdict job', () => {
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
        workflow_id: 'review-request.yml',
        ref: 'main',
        inputs: { pr_number: '50' }
      }
    ]);
  });

  it('stays pending while the dispatched agents repair failing gates', async () => {
    const { status, core, github } = await verdict({
      results: { lint: 'failure', tests: 'failure' },
      runs: [
        makeAgentRun({
          id: 1,
          workflow: 'fix-lint.lock.yml',
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

describe('pipeline.yml GitHub App token (no approval-held runs)', () => {
  const wf = loadWorkflow(FILE);

  it('never pushes to the feature branch from the autofix job (the relay merges the fix)', () => {
    const steps = wf.jobs.autofix.steps;
    expect(steps.find((s) => s.id === 'app')).toBeUndefined();
    const checkout = steps.find((s) => s.name === 'Checkout PR branch');
    expect(checkout.with.token).toBeUndefined();
    expect(readWorkflow(FILE)).not.toContain('HEAD:$HEAD_REF');
  });

  it('runs a repair re-check job instead of the gates for relay merges', () => {
    const job = wf.jobs.recheck;
    expect(job.needs).toEqual(['context']);
    expect(job.if).toBe("needs.context.outputs.mode == 'recheck'");
    expect(job.concurrency).toEqual({
      group: 'verdict-${{ needs.context.outputs.pr_number }}',
      'cancel-in-progress': false
    });
    expect(job.permissions).toMatchObject({
      actions: 'write',
      statuses: 'write'
    });
    expect(wf.jobs.context.outputs).toMatchObject({
      mode: '${{ steps.pr.outputs.mode }}',
      recheck_before: '${{ steps.pr.outputs.recheck_before }}',
      recheck_gates: '${{ steps.pr.outputs.recheck_gates }}'
    });
  });
});

const recheckScript = getScript(
  FILE,
  'recheck',
  'Re-check repaired gates and publish pr-quality'
);
const ALL_PASSED_GATES = Object.fromEntries(
  quality.GATES.map((g) => [g.id, 'success'])
);

/** A PR whose `before` commit has gate results and whose head is a chain of `commits`. */
function repairWorld({ commits, beforeGates = ALL_PASSED_GATES }) {
  const before = 'b'.repeat(40);
  const pr = makePR({ number: 60 });
  const github = createGitHub({ pulls: [pr] });
  let parent = before;
  for (const { sha, message } of commits) {
    github.state.commits[sha] = { message, parents: [parent] };
    parent = sha;
  }
  github.pr(60).head.sha = parent;
  return { github, pr: github.pr(60), before, beforeGates };
}

async function seedGateResults(github, sha, states) {
  for (const [gate, state] of Object.entries(states)) {
    await quality.setGateStatus({
      github,
      context: createContext(),
      sha,
      gate,
      state,
      description: `${gate} ${state}`,
      targetUrl: `https://github.com/octo/demo/actions/runs/${gate}`
    });
  }
}

async function resolvePush(
  world,
  { senderType = 'Bot', action = 'synchronize' } = {}
) {
  const { github, pr, before } = world;
  const context = createContext({
    eventName: 'pull_request',
    ref: `refs/pull/${pr.number}/merge`,
    runId: 556,
    payload: {
      action,
      before,
      sender: { login: 'pr-lifecycle-gh-app[bot]', type: senderType },
      pull_request: { number: pr.number, head: { sha: pr.head.sha } }
    }
  });
  const run = await runScript(contextScript, {
    github,
    context,
    env: { PR_INPUT: '', FORCE: 'false' }
  });
  return { ...run, outputs: run.core.outputs };
}

const MERGE_1 = '1'.repeat(40);
const MERGE_2 = '2'.repeat(40);
const relayMerge = (n, gates) =>
  `Merge stacked PR #${n}: fix\n\n${quality.recheckTrailer(gates)}`;

describe('pipeline.yml context job: relay merge pushes', () => {
  it('re-checks only the repaired gates of a relay merge pushed by the App', async () => {
    const world = repairWorld({
      commits: [{ sha: MERGE_1, message: relayMerge(31, ['docs']) }]
    });
    await seedGateResults(world.github, world.before, {
      ...ALL_PASSED_GATES,
      docs: 'failure'
    });
    const { outputs, github, core } = await resolvePush(world);
    expect(outputs).toMatchObject({
      skip: 'true',
      mode: 'recheck',
      recheck_before: world.before,
      recheck_gates: 'docs',
      head_sha: MERGE_1
    });
    expect(core.notices.join()).toContain('re-checking docs');
    expect(github.qualityStatuses(MERGE_1)).toEqual([]);
  });

  it('folds in an earlier relay merge whose own run never recorded the gates', async () => {
    const world = repairWorld({
      commits: [
        { sha: MERGE_1, message: relayMerge(31, ['lint']) },
        { sha: MERGE_2, message: relayMerge(32, ['docs']) }
      ]
    });
    await seedGateResults(world.github, world.before, ALL_PASSED_GATES);
    world.before = MERGE_1;
    const { outputs } = await resolvePush(world);
    expect(outputs).toMatchObject({
      mode: 'recheck',
      recheck_before: 'b'.repeat(40),
      recheck_gates: 'lint,docs'
    });
  });

  it('runs the full check when the merged auto-fix landed before any gate ran', async () => {
    const world = repairWorld({
      commits: [
        {
          sha: MERGE_1,
          message: `Merge stacked PR #45: style(lint): auto-fix lint and formatting [pr-autofix]\n\n${quality.recheckTrailer(['lint'])}`
        }
      ]
    });
    world.github.state.commits[world.before] = {
      message: 'feat(heist): add combo meter',
      parents: ['c'.repeat(40)]
    };
    const { outputs, github } = await resolvePush(world);
    expect(outputs).toMatchObject({
      skip: 'false',
      mode: 'full',
      recheck_gates: ''
    });
    expect(github.qualityStatuses(MERGE_1)[0].state).toBe('pending');
  });

  it.each([
    [
      'a human pushes a commit with the trailer',
      { senderType: 'User' },
      [{ sha: MERGE_1, message: relayMerge(31, ['docs']) }]
    ],
    [
      'the App pushes a commit that is not a relay merge',
      {},
      [
        {
          sha: MERGE_1,
          message: 'style: reformat'
        }
      ]
    ],
    [
      'a relay merge lands together with another commit',
      {},
      [
        { sha: MERGE_1, message: 'feat: more work' },
        { sha: MERGE_2, message: relayMerge(32, ['docs']) }
      ]
    ]
  ])('runs the full check when %s', async (_, opts, commits) => {
    const world = repairWorld({ commits });
    await seedGateResults(world.github, world.before, ALL_PASSED_GATES);
    const { outputs, github } = await resolvePush(world, opts);
    expect(outputs).toMatchObject({ skip: 'false', mode: 'full' });
    expect(github.qualityStatuses(world.pr.head.sha)[0].state).toBe('pending');
  });

  it('runs the full check after a force-push (history not ahead of before)', async () => {
    const world = repairWorld({
      commits: [{ sha: MERGE_1, message: relayMerge(31, ['docs']) }]
    });
    world.before = 'f'.repeat(40);
    const { outputs } = await resolvePush(world);
    expect(outputs.mode).toBe('full');
  });
});

describe('pipeline.yml recheck job', () => {
  it('re-checks the repaired gate, carries the others over and keeps pr-quality pending', async () => {
    const world = repairWorld({
      commits: [{ sha: MERGE_1, message: relayMerge(31, ['docs']) }]
    });
    const { github, before } = world;
    await seedGateResults(github, before, {
      ...ALL_PASSED_GATES,
      docs: 'failure'
    });
    const { core } = await runScript(recheckScript, {
      github,
      context: createContext({ runId: 557 }),
      env: {
        PR_NUMBER: '60',
        HEAD_REF: 'feat/sample',
        HEAD_SHA: MERGE_1,
        BEFORE: before,
        GATES: 'docs'
      }
    });
    expect(github.state.dispatches.map((d) => d.workflow_id)).toEqual([
      'gate-docs.yml'
    ]);
    const gates = await quality.getGateStatuses({
      github,
      context: createContext(),
      sha: MERGE_1
    });
    expect(gates.docs.state).toBe('pending');
    expect(gates.lint).toMatchObject({
      state: 'success',
      carriedFrom: before.slice(0, 7)
    });
    expect(github.qualityStatuses(MERGE_1)[0].state).toBe('pending');
    expect(core.summaryText).toContain('Re-checking: Docs');
    expect(core.summaryText).toContain('Carried over: Metadata, Lint');
  });
});

describe('pipeline.yml context job: merge conflicts with main', () => {
  it('fails pr-quality and checks nothing for a PR that conflicts with its base', async () => {
    const pr = makePR({ number: 20 });
    pr.mergeable = false;
    const { outputs, github } = await resolve(pr);
    expect(outputs).toMatchObject({ skip: 'true', mode: 'conflict' });
    const [status] = github.qualityStatuses(pr.head.sha);
    expect(status.state).toBe('failure');
    expect(status.description).toMatch(/^Merge conflict with main/);
    expect(github.comments(20)[0]).toContain('git merge origin/main');
    expect(github.state.dispatches).toEqual([]);
  });

  it('runs normally while GitHub is still computing mergeability', async () => {
    const pr = makePR({ number: 20 });
    pr.mergeable = null;
    const { outputs } = await resolve(pr);
    expect(outputs).toMatchObject({ skip: 'false', mode: 'full' });
  });

  it('re-checks a revision whose only verdict is a resolved merge conflict', async () => {
    const pr = makePR({ number: 20 });
    const rev = quality.revision(pr);
    const { github } = setupContext({ pr });
    await quality.setQualityStatus({
      github,
      context: createContext(),
      sha: pr.head.sha,
      state: 'failure',
      summary: 'Merge conflict with main: merge main into the branch and push',
      rev,
      targetUrl: 'https://github.com/octo/demo/actions/runs/1'
    });
    const { outputs } = await resolve(pr, { statuses: github.state.statuses });
    expect(outputs.skip).toBe('false');
  });

  it('may comment from the context job', () => {
    expect(loadWorkflow(FILE).jobs.context.permissions.issues).toBe('write');
  });
});
