import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  WORKFLOWS_DIR,
  createContext,
  createCore,
  createGitHub,
  makeAgentRun,
  makePR,
  makeRun,
  quality,
  seedQualityStatus
} from './helpers/harness.js';

describe('pr-quality.cjs revision', () => {
  const base = makePR({ sha: 'abcdef1234567890abcdef1234567890abcdef12' });

  it('is <sha7>.<8 hex metadata hash>', () => {
    expect(quality.revision(base)).toMatch(/^abcdef1\.[0-9a-f]{8}$/);
  });

  it('changes when the head commit, title or body changes', () => {
    const rev = quality.revision(base);
    expect(
      quality.revision({
        ...base,
        head: { sha: 'bbbbbbb' + base.head.sha.slice(7) }
      })
    ).not.toBe(rev);
    expect(quality.revision({ ...base, title: 'fix: other' })).not.toBe(rev);
    expect(quality.revision({ ...base, body: 'new body' })).not.toBe(rev);
  });

  it('changes when a decision label is added, but not for other labels', () => {
    const rev = quality.revision(base);
    expect(
      quality.revision({
        ...base,
        labels: [{ name: 'lint-failed' }, { name: 'docs-required' }]
      })
    ).toBe(rev);
    expect(
      quality.revision({ ...base, labels: [{ name: 'docs-not-required' }] })
    ).not.toBe(rev);
  });

  it('accepts string labels and ignores label order', () => {
    expect(
      quality.revision({ ...base, labels: ['docs-not-required', 'x'] })
    ).toBe(
      quality.revision({
        ...base,
        labels: [{ name: 'x' }, { name: 'docs-not-required' }]
      })
    );
  });

  it('treats missing title/body as empty strings', () => {
    expect(
      quality.revision({ head: base.head, title: null, body: undefined })
    ).toBe(quality.revision({ head: base.head, title: '', body: '' }));
  });
});

describe('pr-quality.cjs parseRevision', () => {
  it.each([
    ['All gates passed [rev abcdef1.0123abcd]', 'abcdef1.0123abcd'],
    ['no revision here', null],
    ['[rev ABCDEF1.0123ABCD]', null],
    ['', null],
    [undefined, null]
  ])('parses %j', (description, expected) => {
    expect(quality.parseRevision(description)).toBe(expected);
  });
});

describe('pr-quality.cjs commit status', () => {
  it('round-trips state, revision and target URL', async () => {
    const pr = makePR();
    const github = createGitHub({ pulls: [pr] });
    const rev = await seedQualityStatus(github, pr, 'failure', 'Failed: Lint');
    const status = await quality.getQualityStatus({
      github,
      context: createContext(),
      sha: pr.head.sha
    });
    expect(status).toMatchObject({
      state: 'failure',
      revision: rev,
      final: true,
      description: `Failed: Lint [rev ${rev}]`
    });
  });

  it('marks pending as not final and returns the newest status', async () => {
    const pr = makePR();
    const github = createGitHub({ pulls: [pr] });
    await seedQualityStatus(github, pr, 'failure');
    await seedQualityStatus(github, pr, 'pending');
    const status = await quality.getQualityStatus({
      github,
      context: createContext(),
      sha: pr.head.sha
    });
    expect(status.state).toBe('pending');
    expect(status.final).toBe(false);
  });

  it('ignores statuses with another context and returns null when absent', async () => {
    const pr = makePR();
    const github = createGitHub({
      statuses: {
        [pr.head.sha]: [
          { context: 'ci/other', state: 'success', description: 'x' }
        ]
      }
    });
    expect(
      await quality.getQualityStatus({
        github,
        context: createContext(),
        sha: pr.head.sha
      })
    ).toBeNull();
  });

  it('keeps descriptions within 140 characters without losing the revision', async () => {
    const pr = makePR();
    const github = createGitHub();
    const rev = quality.revision(pr);
    await quality.setQualityStatus({
      github,
      context: createContext(),
      sha: pr.head.sha,
      state: 'failure',
      summary: 'Failed: '.padEnd(400, 'x'),
      rev,
      targetUrl: 'u'
    });
    const [status] = github.qualityStatuses(pr.head.sha);
    expect(status.description.length).toBeLessThanOrEqual(140);
    expect(quality.parseRevision(status.description)).toBe(rev);
    expect(status.context).toBe('pr-quality');
  });
});

describe('pr-quality.cjs pendingRemediationRuns', () => {
  const branch = 'feat/sample';
  const pending = (github, excludeRunId) =>
    quality.pendingRemediationRuns({
      github,
      context: createContext(),
      branch,
      excludeRunId
    });

  it('returns nothing when no agent is running', async () => {
    const github = createGitHub({
      runs: [makeRun({ id: 1, workflow: 'fix-lint.lock.yml', branch })]
    });
    expect(await pending(github)).toEqual([]);
  });

  it('reports queued agents and agents still working', async () => {
    const github = createGitHub({
      runs: [
        makeAgentRun({
          id: 1,
          workflow: 'fix-lint.lock.yml',
          branch,
          phase: 'queued'
        }),
        makeAgentRun({
          id: 2,
          workflow: 'fix-tests.lock.yml',
          branch,
          phase: 'agent'
        })
      ]
    });
    expect((await pending(github)).map((p) => [p.workflow, p.id])).toEqual([
      ['fix-lint.lock.yml', 1],
      ['fix-tests.lock.yml', 2]
    ]);
  });

  it('treats an agent whose conclusion job started as handed off', async () => {
    const github = createGitHub({
      runs: [
        makeAgentRun({
          id: 1,
          workflow: 'fix-docs.lock.yml',
          branch,
          phase: 'conclusion'
        })
      ]
    });
    expect(await pending(github)).toEqual([]);
  });

  it('excludes the run that dispatched the relay', async () => {
    const github = createGitHub({
      runs: [
        makeAgentRun({ id: 42, workflow: 'fix-metadata.lock.yml', branch })
      ]
    });
    expect(await pending(github, 42)).toEqual([]);
    expect(await pending(github, 43)).toHaveLength(1);
  });

  it('ignores agents on other branches and non-dispatch runs', async () => {
    const github = createGitHub({
      runs: [
        makeAgentRun({
          id: 1,
          workflow: 'fix-lint.lock.yml',
          branch: 'other'
        }),
        {
          ...makeAgentRun({
            id: 2,
            workflow: 'fix-lint.lock.yml',
            branch
          }),
          event: 'push'
        }
      ]
    });
    expect(await pending(github)).toEqual([]);
  });

  it('skips agent workflows that do not exist on the branch (404)', async () => {
    const github = createGitHub({
      missingWorkflows: ['fix-secrets.lock.yml'],
      runs: [makeAgentRun({ id: 1, workflow: 'fix-lint.lock.yml', branch })]
    });
    expect(await pending(github)).toHaveLength(1);
  });

  it('lists every remediation agent workflow', () => {
    expect(quality.REMEDIATION_WORKFLOWS).toHaveLength(8);
    expect(quality.DECISION_LABELS).toEqual(['docs-not-required']);
  });
});

// ---------------------------------------------------------------------------
// Per-gate statuses and the verdict
// ---------------------------------------------------------------------------

const BRANCH = 'feat/sample';
const ALL_PASSED = Object.fromEntries(
  quality.GATES.map((g) => [g.id, 'success'])
);

function gateWorld({ labels = [], runs = [], pulls = [] } = {}) {
  const pr = makePR({ number: 20, branch: BRANCH, labels });
  const github = createGitHub({ pulls: [pr, ...pulls], runs });
  return { github, pr, context: createContext(), core: createCore() };
}

async function seedGates(
  github,
  sha,
  states,
  describe = (g, s) => `${g} ${s}`
) {
  for (const [gate, state] of Object.entries(states)) {
    await quality.setGateStatus({
      github,
      context: createContext(),
      sha,
      gate,
      state,
      description: describe(gate, state),
      targetUrl: `https://github.com/octo/demo/actions/runs/${gate}`
    });
  }
}

const dispatched = (github) =>
  github.state.dispatches.map((d) => d.workflow_id);

describe('pr-quality.cjs repairedGate', () => {
  it.each([
    ['lint-remediation', 'lint'],
    ['test-remediation', 'tests'],
    ['security-remediation', 'security'],
    ['doc-remediation', 'docs'],
    ['Lint auto-fix (run 7)', 'lint'],
    ['Fix: PR metadata (run 12)', 'metadata'],
    ['Fix: Lint & format (run 3)', 'lint'],
    ['Fix: Tests', 'tests'],
    ['Fix: CodeQL alerts (run 1)', 'security'],
    ['Fix: Dependencies (run 1)', 'security'],
    ['Fix: Secrets (run 1)', 'security'],
    ['Fix: Docs (run 9)', 'docs']
  ])('maps %s to the %s gate', (source, gate) => {
    expect(quality.repairedGate(source)).toBe(gate);
  });

  it('returns null for unknown or empty sources', () => {
    expect(quality.repairedGate('')).toBeNull();
    expect(quality.repairedGate(undefined)).toBeNull();
    expect(quality.repairedGate('PR Review (run 1)')).toBeNull();
  });

  it('maps Copilot review fixes to every gate (they can touch anything)', () => {
    const all = quality.GATES.map((g) => g.id);
    expect(quality.repairedGates('review-remediation')).toEqual(all);
    expect(
      quality.repairedGates('Fix: Copilot review comments (run 5)')
    ).toEqual(all);
    expect(quality.repairedGate('review-remediation')).toBeNull();
    expect(quality.repairedGates('lint-remediation')).toEqual(['lint']);
    expect(quality.repairedGates('PR Review (run 1)')).toEqual([]);
  });

  it('has a gate workflow file for every gate', () => {
    for (const gate of quality.GATES) {
      expect(fs.existsSync(path.join(WORKFLOWS_DIR, gate.workflow))).toBe(true);
    }
  });
});

describe('pr-quality.cjs gate statuses', () => {
  it('returns the latest status per gate and parses carried results', async () => {
    const { github, pr, context } = gateWorld();
    const sha = pr.head.sha;
    await seedGates(github, sha, { lint: 'pending' });
    await seedGates(
      github,
      sha,
      { lint: 'failure', docs: 'success' },
      (g, s) =>
        g === 'docs' ? 'carried from abcdef1: Docs passed' : `${g} ${s}`
    );
    const gates = await quality.getGateStatuses({ github, context, sha });
    expect(gates.lint).toMatchObject({ state: 'failure', carriedFrom: null });
    expect(gates.docs).toMatchObject({
      state: 'success',
      carriedFrom: 'abcdef1',
      description: 'carried from abcdef1: Docs passed'
    });
    expect(gates.build).toBeUndefined();
  });

  it('mirrors the result as a <gate>-passed label on the PR head only', async () => {
    const { github, pr, context, core } = gateWorld();
    const set = (sha, state) =>
      quality.setGateStatus({
        github,
        context,
        core,
        prNumber: 20,
        sha,
        gate: 'lint',
        state,
        description: 'x'
      });
    await set(pr.head.sha, 'success');
    expect(github.labels(20)).toEqual(['lint-passed']);
    await set('0'.repeat(40), 'failure');
    expect(github.labels(20)).toEqual(['lint-passed']);
    await set(pr.head.sha, 'failure');
    expect(github.labels(20)).toEqual([]);
  });

  it('truncates long descriptions to the 140 characters GitHub accepts', async () => {
    const { github, pr, context } = gateWorld();
    await quality.setGateStatus({
      github,
      context,
      sha: pr.head.sha,
      gate: 'docs',
      state: 'failure',
      description: 'x'.repeat(300)
    });
    const [status] = github.state.statuses[pr.head.sha];
    expect(status.context).toBe('gate/docs');
    expect(status.description).toHaveLength(140);
  });

  it.each([
    ['success', 'success', 'Lint passed'],
    ['failure', 'failure', 'Lint failed'],
    ['cancelled', 'error', 'Lint did not finish (cancelled)']
  ])('records job.status %s as %s', async (result, state, description) => {
    const { github, pr, context, core } = gateWorld();
    expect(
      await quality.recordGate({
        github,
        context,
        core,
        prNumber: 20,
        sha: pr.head.sha,
        gate: 'lint',
        result
      })
    ).toBe(state);
    const gates = await quality.getGateStatuses({
      github,
      context,
      sha: pr.head.sha
    });
    expect(gates.lint).toMatchObject({
      state,
      description,
      targetUrl: 'https://github.com/octo/demo/actions/runs/9000'
    });
  });
});

describe('pr-quality.cjs remediationInProgress', () => {
  const inProgress = (github, excludeRunIds) =>
    quality.remediationInProgress({
      github,
      context: createContext(),
      branch: BRANCH,
      excludeRunIds
    });

  it('is empty when nothing is repairing the branch', async () => {
    const { github } = gateWorld();
    expect(await inProgress(github)).toEqual([]);
  });

  it('counts running agents, open stacked PRs and relays for the branch', async () => {
    const stacked = makePR({
      number: 31,
      branch: 'lint-remediation-31',
      base: BRANCH,
      labels: ['lint-remediation']
    });
    const unlabelled = makePR({ number: 32, branch: 'other', base: BRANCH });
    const { github } = gateWorld({
      pulls: [stacked, unlabelled],
      runs: [
        makeAgentRun({
          id: 1,
          workflow: 'fix-tests.lock.yml',
          branch: BRANCH
        }),
        makeRun({
          id: 2,
          workflow: 'relay.yml',
          branch: 'main',
          status: 'in_progress',
          conclusion: null,
          title: `Relay: merge stacked fixes · ${BRANCH}`
        }),
        makeRun({
          id: 3,
          workflow: 'relay.yml',
          branch: 'main',
          status: 'in_progress',
          conclusion: null,
          title: 'Relay: merge stacked fixes · feat/sample-2'
        })
      ]
    });
    expect((await inProgress(github)).map((w) => [w.workflow, w.id])).toEqual([
      ['fix-tests.lock.yml', 1],
      ['stacked PR #31', 31],
      ['relay.yml', 2]
    ]);
    expect((await inProgress(github, [1, 2])).map((w) => w.id)).toEqual([31]);
  });
});

describe('pr-quality.cjs evaluateVerdict', () => {
  const verdict = (w, extra = {}) =>
    quality.evaluateVerdict({
      github: w.github,
      context: w.context,
      core: w.core,
      prNumber: 20,
      ...extra
    });

  it('succeeds when every gate passed on the head commit and hands off to review', async () => {
    const w = gateWorld();
    await seedGates(w.github, w.pr.head.sha, ALL_PASSED);
    const result = await verdict(w);
    expect(result.state).toBe('success');
    const [status] = w.github.qualityStatuses(w.pr.head.sha);
    expect(status.state).toBe('success');
    expect(status.description).toMatch(/^All gates passed \[rev /);
    expect(w.github.state.dispatches).toEqual([
      {
        owner: 'octo',
        repo: 'demo',
        workflow_id: 'review-request.yml',
        ref: 'main',
        inputs: { pr_number: '20' }
      }
    ]);
  });

  it('stays pending while a gate is still checking', async () => {
    const w = gateWorld();
    await seedGates(w.github, w.pr.head.sha, {
      ...ALL_PASSED,
      tests: 'pending',
      lint: 'failure'
    });
    const result = await verdict(w);
    expect(result.state).toBe('pending');
    expect(result.summary).toBe('Checking: Tests; failed: Lint');
    expect(dispatched(w.github)).toEqual([]);
  });

  it('treats gates without any status as still checking', async () => {
    const w = gateWorld();
    await seedGates(w.github, w.pr.head.sha, { lint: 'success' });
    expect((await verdict(w)).waiting).toEqual([
      'Metadata',
      'Build',
      'Tests',
      'Security',
      'Docs'
    ]);
  });

  it('marks gates that finished without reporting as errored', async () => {
    const w = gateWorld();
    await seedGates(w.github, w.pr.head.sha, {
      ...ALL_PASSED,
      build: 'pending'
    });
    const result = await verdict(w, {
      reported: {
        sha: w.pr.head.sha,
        results: { lint: 'success', build: 'cancelled' }
      }
    });
    const gates = await quality.getGateStatuses({
      github: w.github,
      context: w.context,
      sha: w.pr.head.sha
    });
    expect(gates.build).toMatchObject({
      state: 'error',
      description: 'Build did not report a result (cancelled)'
    });
    expect(gates.lint.state).toBe('success');
    expect(result.state).toBe('failure');
  });

  it('stays pending while remediation is repairing a failed gate', async () => {
    const w = gateWorld({
      runs: [
        makeAgentRun({
          id: 1,
          workflow: 'fix-lint.lock.yml',
          branch: BRANCH
        })
      ]
    });
    await seedGates(w.github, w.pr.head.sha, {
      ...ALL_PASSED,
      lint: 'failure'
    });
    const result = await verdict(w);
    expect(result).toMatchObject({
      state: 'pending',
      summary: 'Repairing: Lint'
    });
    expect(w.github.comments(20)).toEqual([]);
  });

  it('ignores the calling run and excluded runs when looking for repairs', async () => {
    const w = gateWorld({
      runs: [
        makeAgentRun({
          id: 1,
          workflow: 'fix-lint.lock.yml',
          branch: BRANCH
        })
      ]
    });
    await seedGates(w.github, w.pr.head.sha, {
      ...ALL_PASSED,
      lint: 'failure'
    });
    expect(
      (await verdict(w, { excludeRunIds: [1], announce: false })).state
    ).toBe('failure');
    expect(w.github.comments(20)).toEqual([]);
  });

  it('fails and comments once per revision when nothing is repairing', async () => {
    const w = gateWorld();
    await seedGates(w.github, w.pr.head.sha, {
      ...ALL_PASSED,
      lint: 'failure',
      security: 'error'
    });
    const result = await verdict(w);
    await verdict(w);
    expect(result).toMatchObject({
      state: 'failure',
      summary: 'Failed: Lint, Security'
    });
    const comments = w.github.comments(20);
    expect(comments).toHaveLength(1);
    expect(comments[0]).toContain(
      `<!-- pr-quality-failed:${quality.revision(w.pr)} -->`
    );
    expect(comments[0]).toContain(
      '- **Lint**: lint failure ([run](https://github.com/octo/demo/actions/runs/lint))'
    );
    expect(comments[0]).toContain('- **Security**: security error');
    expect(dispatched(w.github)).toEqual([]);
  });

  it('dispatches one final full check when passing results were carried over', async () => {
    const w = gateWorld();
    await seedGates(w.github, w.pr.head.sha, ALL_PASSED, (g) =>
      g === 'lint' ? 'Lint passed' : `carried from abcdef1: ${g} passed`
    );
    const result = await verdict(w);
    expect(result.state).toBe('pending');
    expect(result.carried).toEqual([
      'Metadata',
      'Build',
      'Tests',
      'Security',
      'Docs'
    ]);
    expect(w.github.state.dispatches).toEqual([
      {
        owner: 'octo',
        repo: 'demo',
        workflow_id: 'pipeline.yml',
        ref: BRANCH,
        inputs: { pr_number: '20', force: 'true' }
      }
    ]);
  });

  it('does not dispatch the final check while a pipeline already runs', async () => {
    const w = gateWorld({
      runs: [
        makeRun({
          id: 5,
          workflow: 'pipeline.yml',
          branch: BRANCH,
          status: 'queued',
          conclusion: null
        })
      ]
    });
    await seedGates(
      w.github,
      w.pr.head.sha,
      ALL_PASSED,
      (g) => `carried from abcdef1: ${g}`
    );
    expect((await verdict(w)).state).toBe('pending');
    expect(dispatched(w.github)).toEqual([]);
  });

  it('does nothing for a closed PR', async () => {
    const w = gateWorld();
    w.github.pr(20).state = 'closed';
    expect((await verdict(w)).state).toBe('closed');
    expect(w.github.qualityStatuses(w.pr.head.sha)).toEqual([]);
  });
});

describe('pr-quality.cjs recheckGates', () => {
  it('re-checks repaired gates and carries the rest from the previous commit', async () => {
    const w = gateWorld();
    const before = 'a'.repeat(40);
    await seedGates(w.github, before, { ...ALL_PASSED, lint: 'failure' });
    const plan = await quality.recheckGates({
      github: w.github,
      context: w.context,
      core: w.core,
      prNumber: 20,
      branch: BRANCH,
      before,
      sha: w.pr.head.sha,
      repaired: ['lint']
    });
    expect(plan).toEqual({
      recheck: ['lint'],
      carried: ['metadata', 'build', 'tests', 'security', 'docs'],
      kept: []
    });
    expect(dispatched(w.github)).toEqual(['gate-lint.yml']);
    const gates = await quality.getGateStatuses({
      github: w.github,
      context: w.context,
      sha: w.pr.head.sha
    });
    expect(gates.lint.description).toBe('Lint: re-checking after remediation');
    expect(gates.docs.description).toBe('carried from aaaaaaa: docs success');
  });

  it('keeps the original origin when carrying an already-carried result', async () => {
    const w = gateWorld();
    const before = 'b'.repeat(40);
    await seedGates(
      w.github,
      before,
      { docs: 'success' },
      () => 'carried from aaaaaaa: Docs passed'
    );
    await quality.recheckGates({
      github: w.github,
      context: w.context,
      core: w.core,
      prNumber: 20,
      branch: BRANCH,
      before,
      sha: w.pr.head.sha
    });
    const gates = await quality.getGateStatuses({
      github: w.github,
      context: w.context,
      sha: w.pr.head.sha
    });
    expect(gates.docs.carriedFrom).toBe('aaaaaaa');
  });
});

describe('pr-quality.cjs gate revisions', () => {
  it('records the PR revision checked and strips it from the description', async () => {
    const { github, pr, context, core } = gateWorld();
    await quality.recordGate({
      github,
      context,
      core,
      prNumber: 20,
      sha: pr.head.sha,
      gate: 'metadata',
      result: 'failure'
    });
    const [status] = github.state.statuses[pr.head.sha];
    expect(status.description).toBe(
      `Metadata failed [rev ${quality.revision(pr)}]`
    );
    const gates = await quality.getGateStatuses({
      github,
      context,
      sha: pr.head.sha
    });
    expect(gates.metadata).toMatchObject({
      description: 'Metadata failed',
      revision: quality.revision(pr)
    });
  });

  it('keeps the revision when a long description is truncated', async () => {
    const { github, pr, context } = gateWorld();
    await quality.setGateStatus({
      github,
      context,
      sha: pr.head.sha,
      gate: 'docs',
      state: 'failure',
      description: 'x'.repeat(300),
      rev: quality.revision(pr)
    });
    const [status] = github.state.statuses[pr.head.sha];
    expect(status.description).toHaveLength(140);
    expect(quality.parseRevision(status.description)).toBe(
      quality.revision(pr)
    );
  });

  const recheck = (w, extra = {}) =>
    quality.recheckGates({
      github: w.github,
      context: w.context,
      core: w.core,
      prNumber: 20,
      branch: BRANCH,
      sha: w.pr.head.sha,
      ...extra
    });

  async function recordAll(w, sha, pr, states) {
    for (const [gate, state] of Object.entries(states)) {
      await quality.setGateStatus({
        github: w.github,
        context: w.context,
        sha,
        gate,
        state,
        description: `${gate} ${state}`,
        rev: quality.revision({ ...pr, head: { ...pr.head, sha } })
      });
    }
  }

  it('re-checks Metadata and Docs when the PR metadata changed since they ran', async () => {
    const w = gateWorld();
    await recordAll(w, w.pr.head.sha, w.pr, {
      ...ALL_PASSED,
      metadata: 'failure'
    });
    w.github.pr(20).title = 'feat(app): a better title';
    const plan = await recheck(w);
    expect(plan.recheck).toEqual(['metadata', 'docs']);
    expect(dispatched(w.github)).toEqual([
      'gate-metadata.yml',
      'gate-docs.yml'
    ]);
  });

  it('re-checks Docs after a docs-not-required decision even without a relay source', async () => {
    const w = gateWorld({ labels: ['docs-required'] });
    const before = 'c'.repeat(40);
    await recordAll(w, before, w.pr, { ...ALL_PASSED, docs: 'failure' });
    w.github.pr(20).labels.push({ name: 'docs-not-required' });
    const plan = await recheck(w, { before, repaired: ['lint'] });
    expect(plan.recheck).toEqual(['metadata', 'lint', 'docs']);
    expect(plan.carried).toEqual(['build', 'tests', 'security']);
  });

  it('carries results with the revision they were recorded for', async () => {
    const w = gateWorld();
    const before = 'd'.repeat(40);
    await recordAll(w, before, w.pr, ALL_PASSED);
    const plan = await recheck(w, { before, repaired: ['lint'] });
    expect(plan.carried).toEqual([
      'metadata',
      'build',
      'tests',
      'security',
      'docs'
    ]);
    const gates = await quality.getGateStatuses({
      github: w.github,
      context: w.context,
      sha: w.pr.head.sha
    });
    expect(gates.metadata.revision).toBe(
      quality.revision({ ...w.pr, head: { ...w.pr.head, sha: before } })
    );
    expect(gates.metadata.description).toBe(
      'carried from ddddddd: metadata success'
    );
  });

  it('keeps gates whose results predate revisions in statuses', async () => {
    const w = gateWorld();
    await seedGates(w.github, w.pr.head.sha, ALL_PASSED);
    w.github.pr(20).title = 'feat(app): renamed';
    expect((await recheck(w)).recheck).toEqual([]);
  });
});

describe('pr-quality.cjs blocked stacked PRs', () => {
  it('does not count a stacked PR the relay could not merge as repair in progress', async () => {
    const blocked = makePR({
      number: 31,
      branch: 'lint-remediation-31',
      base: BRANCH,
      labels: ['lint-remediation', quality.BLOCKED_LABEL]
    });
    const w = gateWorld({ pulls: [blocked] });
    expect(
      await quality.remediationInProgress({
        github: w.github,
        context: w.context,
        branch: BRANCH
      })
    ).toEqual([]);
    await seedGates(w.github, w.pr.head.sha, {
      ...ALL_PASSED,
      lint: 'failure'
    });
    const result = await quality.evaluateVerdict({
      github: w.github,
      context: w.context,
      core: w.core,
      prNumber: 20
    });
    expect(result.state).toBe('failure');
  });
});

describe('pr-quality.cjs sweepStalled (watchdog)', () => {
  const NOW = Date.parse('2030-01-01T12:00:00Z');
  const ago = (minutes) => new Date(NOW - minutes * 60000).toISOString();

  async function stalled(
    w,
    { minutes = 45, state = 'pending', summary = 'Repairing: Lint' } = {}
  ) {
    await seedQualityStatus(w.github, w.pr, state, summary);
    for (const s of w.github.state.statuses[w.pr.head.sha])
      s.updated_at = ago(minutes);
  }
  const sweep = (w) =>
    quality.sweepStalled({
      github: w.github,
      context: w.context,
      core: w.core,
      staleMinutes: 30,
      now: NOW
    });

  it('fails a PR whose repair ended without handing off to the relay', async () => {
    const w = gateWorld();
    await seedGates(w.github, w.pr.head.sha, {
      ...ALL_PASSED,
      lint: 'failure'
    });
    await stalled(w);
    const swept = await sweep(w);
    expect(swept).toEqual([
      { number: 20, recheck: [], state: 'failure', summary: 'Failed: Lint' }
    ]);
    expect(w.github.comments(20)[0]).toContain('Quality gates still failing');
  });

  it('re-checks gates stuck pending without a running gate workflow', async () => {
    const w = gateWorld();
    await seedGates(w.github, w.pr.head.sha, {
      ...ALL_PASSED,
      tests: 'pending'
    });
    await stalled(w, { summary: 'Checking: Tests' });
    const [result] = await sweep(w);
    expect(result).toMatchObject({ recheck: ['tests'], state: 'pending' });
    expect(dispatched(w.github)).toEqual(['gate-tests.yml']);
  });

  it('leaves recent, final, busy, fork and stacked PRs alone', async () => {
    const recent = gateWorld();
    await stalled(recent, { minutes: 5 });
    expect(await sweep(recent)).toEqual([]);

    const final = gateWorld();
    await stalled(final, { state: 'failure' });
    expect(await sweep(final)).toEqual([]);

    const busy = gateWorld({
      runs: [
        makeRun({
          id: 7,
          workflow: 'pipeline.yml',
          branch: BRANCH,
          status: 'in_progress',
          conclusion: null
        })
      ]
    });
    await stalled(busy);
    expect(await sweep(busy)).toEqual([]);

    const fork = gateWorld();
    fork.github.pr(20).head.repo = { full_name: 'someone/demo' };
    await stalled(fork);
    expect(await sweep(fork)).toEqual([]);

    const stacked = gateWorld({ labels: ['lint-remediation'] });
    await stalled(stacked);
    expect(await sweep(stacked)).toEqual([]);
  });

  it('keeps going when one PR cannot be re-evaluated', async () => {
    const w = gateWorld();
    await stalled(w);
    w.github.rest.actions.createWorkflowDispatch = async () => {
      throw new Error('boom');
    };
    expect(await sweep(w)).toEqual([]);
    expect(w.core.warnings.join()).toContain(
      'watchdog could not re-evaluate: boom'
    );
  });
});

describe('pr-quality.cjs Recheck-Gates trailer', () => {
  it('names known gates once, in the given order', () => {
    expect(quality.recheckTrailer(['docs', 'lint', 'docs', 'bogus'])).toBe(
      'Recheck-Gates: docs, lint'
    );
  });

  it('parses the trailer from a commit message and ignores unknown gates', () => {
    expect(
      quality.parseRecheckTrailer(
        'Merge stacked PR #3: fix\r\n\r\nRecheck-Gates: tests, nope ,security\r\n'
      )
    ).toEqual(['tests', 'security']);
    expect(quality.parseRecheckTrailer('Recheck-Gates:')).toEqual([]);
  });

  it.each([undefined, '', 'feat: add thing', 'style: auto-fix [pr-autofix]'])(
    'returns null for a commit that is not a relay merge (%j)',
    (message) => {
      expect(quality.parseRecheckTrailer(message)).toBeNull();
    }
  );

  it('treats a new branch (zero before SHA) as a full check', async () => {
    const github = createGitHub();
    expect(
      await quality.repairPush({
        github,
        context: createContext(),
        before: '0'.repeat(40),
        after: '1'.repeat(40)
      })
    ).toBeNull();
    expect(github.calls('repos.compareCommitsWithBasehead')).toEqual([]);
  });
});

describe('pr-quality.cjs merge conflicts with the base branch', () => {
  const noSleep = async () => {};

  it('polls mergeability while GitHub is still computing it', async () => {
    const w = gateWorld();
    w.github.pr(20).mergeable = null;
    let polls = 0;
    const sleep = async () => {
      if (++polls === 2) w.github.pr(20).mergeable = false;
    };
    const result = await quality.mergeability({ ...w, prNumber: 20, sleep });
    expect(result.state).toBe('conflict');
    expect(polls).toBe(2);
  });

  it('reports unknown after the attempts and clean when mergeable', async () => {
    const w = gateWorld();
    w.github.pr(20).mergeable = null;
    expect(
      (
        await quality.mergeability({
          ...w,
          prNumber: 20,
          sleep: noSleep,
          attempts: 3
        })
      ).state
    ).toBe('unknown');
    expect(w.github.calls('pulls.get')).toHaveLength(3);
    w.github.pr(20).mergeable = true;
    expect((await quality.mergeability({ ...w, prNumber: 20 })).state).toBe(
      'clean'
    );
  });

  it('never hands a PR that conflicts with its base to review', async () => {
    const w = gateWorld();
    w.github.pr(20).mergeable = false;
    await seedGates(w.github, w.pr.head.sha, ALL_PASSED);
    const result = await quality.evaluateVerdict({ ...w, prNumber: 20 });
    expect(result).toMatchObject({ state: 'failure', conflict: true });
    const [status] = w.github.qualityStatuses(w.pr.head.sha);
    expect(status.state).toBe('failure');
    expect(status.description).toMatch(
      /^Merge conflict with main: merge main into the branch and push \[rev /
    );
    expect(
      quality.isBaseConflict(
        await quality.getQualityStatus({ ...w, sha: w.pr.head.sha })
      )
    ).toBe(true);
    expect(dispatched(w.github)).toEqual([]);
    const [comment] = w.github.comments(20);
    expect(comment).toContain(`<!-- base-conflict:${w.pr.head.sha} -->`);
    expect(comment).toContain('git merge origin/main');
  });

  it('does not duplicate conflict instructions when the verdict is re-evaluated', async () => {
    const w = gateWorld();
    w.github.pr(20).mergeable = false;
    await seedGates(w.github, w.pr.head.sha, ALL_PASSED);

    await quality.evaluateVerdict({ ...w, prNumber: 20 });
    const result = await quality.evaluateVerdict({ ...w, prNumber: 20 });

    expect(result).toMatchObject({ state: 'failure', conflict: true });
    expect(w.github.comments(20)).toHaveLength(1);
    expect(dispatched(w.github)).toEqual([]);
  });

  it('does not treat other failures as conflicts', () => {
    expect(
      quality.isBaseConflict({
        state: 'failure',
        description: 'Failed: Lint [rev x]'
      })
    ).toBe(false);
    expect(
      quality.isBaseConflict({
        state: 'pending',
        description: 'Merge conflict with main'
      })
    ).toBe(false);
    expect(quality.isBaseConflict(null)).toBe(false);
  });
});

describe('pr-quality.cjs stackedBase', () => {
  const A = 'a'.repeat(40);
  const B = 'b'.repeat(40);
  const C = 'c'.repeat(40);
  // A <- B is the branch; C is a commit the author rebased away.
  const setup = (body, runs = []) => {
    const github = createGitHub({
      commits: { [B]: { message: 'next', parents: [A] } },
      runs
    });
    const pr = { number: 31, body };
    return { github, context: createContext(), pr, head: B };
  };
  const agentBody = (id) =>
    `<!-- gh-aw-agentic-workflow: Fix: Lint & format, engine: copilot, id: ${id}, workflow_id: x -->`;

  it('reads the base from the remediation-base marker', async () => {
    const w = setup(quality.stackedBaseMarker(A));
    expect(await quality.stackedBase(w)).toEqual({ state: 'intact', base: A });
    expect(w.github.calls('actions.getWorkflowRun')).toEqual([]);
  });

  it('reads the base from the gh-aw agent run', async () => {
    const run = { ...makeRun({ id: 501, workflow: 'x' }), head_sha: C };
    const w = setup(agentBody(501), [run]);
    expect(await quality.stackedBase(w)).toEqual({
      state: 'rebased',
      base: C
    });
  });

  it('is unknown without a marker or when the agent run is gone', async () => {
    expect((await quality.stackedBase(setup('plain body'))).state).toBe(
      'unknown'
    );
    expect((await quality.stackedBase(setup(agentBody(999)))).state).toBe(
      'unknown'
    );
  });

  it('is intact when the base is the branch head', async () => {
    const w = setup(quality.stackedBaseMarker(B));
    expect((await quality.stackedBase(w)).state).toBe('intact');
  });
});
