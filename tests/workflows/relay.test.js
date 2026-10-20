import { describe, expect, it } from 'vitest';
import {
  createContext,
  createCore,
  createGitHub,
  getScript,
  loadWorkflow,
  makeAgentRun,
  makePR,
  makeRun,
  quality,
  runScript
} from './helpers/harness.js';

const FILE = 'relay.yml';
const script = getScript(
  FILE,
  'auto-merge-stacked',
  'Consolidate Stacked PRs & Recheck'
);
const BRANCH = 'feat/sample';

function world({
  parentLabels = ['lint-failed'],
  stacked = [],
  runs = [],
  ...rest
} = {}) {
  const parent = makePR({ number: 20, branch: BRANCH, labels: parentLabels });
  const github = createGitHub({ pulls: [parent, ...stacked], runs, ...rest });
  return { github, parent: github.pr(20) };
}

const stackedPR = (number, label = 'lint-remediation', extra = {}) =>
  makePR({
    number,
    branch: `${label}-${number}`,
    base: BRANCH,
    title: `style(lint): fix findings ${number}`,
    labels: label ? [label] : [],
    ...extra
  });

function relay(github, env = {}, opts = {}) {
  return runScript(script, {
    github,
    context: createContext({ runId: 4242, ...opts.context }),
    env: {
      INPUT_BRANCH: BRANCH,
      AGENT_RESULT: 'success',
      SOURCE: 'Fix: Lint & format (run 1000)',
      PIPELINE_WAIT_MINUTES: '30',
      ...env
    },
    onSleep: opts.onSleep
  });
}

const pipelineDispatches = (github) =>
  github.state.dispatches.filter((d) => d.workflow_id === 'pipeline.yml');
const gateDispatches = (github) =>
  github.state.dispatches
    .filter((d) =>
      /^gate-(metadata|lint|build|tests|security|docs)\.yml$/.test(
        d.workflow_id
      )
    )
    .map((d) => d.workflow_id);

const ALL_PASSED = {
  metadata: 'success',
  lint: 'success',
  build: 'success',
  tests: 'success',
  security: 'success',
  docs: 'success'
};

/** Record gate results on a commit, as the gate workflows do. */
async function seedGates(github, sha, states) {
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

const gatesOn = (github, sha) =>
  quality.getGateStatuses({ github, context: createContext(), sha });

describe('relay.yml structure', () => {
  const wf = loadWorkflow(FILE);

  it('names each run after the branch so the verdict can see relays in flight', () => {
    expect(wf['run-name']).toBe(
      'Relay: merge stacked fixes · ${{ inputs.branch }}'
    );
    expect(wf.permissions.statuses).toBe('write');
  });

  it('is dispatched by the agents conclusion job with branch, agent_result and source inputs', () => {
    expect(Object.keys(wf.on.workflow_dispatch.inputs)).toEqual([
      'branch',
      'agent_result',
      'source'
    ]);
    expect(wf.on.workflow_dispatch.inputs.branch.required).toBe(true);
  });

  it('runs one relay at a time per parent branch without cancelling', () => {
    expect(wf.concurrency.group).toBe('relay-${{ inputs.branch }}');
    expect(wf.concurrency['cancel-in-progress']).toBe(false);
  });

  it('is only started by agents, never by approval-held pull_request runs', () => {
    expect(Object.keys(wf.on)).toEqual(['workflow_dispatch']);
    expect(wf.jobs['auto-merge-stacked'].if).toBeUndefined();
    expect(wf.jobs['auto-merge-stacked']['timeout-minutes']).toBeGreaterThan(
      30
    );
  });
});

describe('relay.yml relay: nothing to do', () => {
  it.each(['', 'main'])('ignores branch %j', async (branch) => {
    const { github } = world();
    await relay(github, { INPUT_BRANCH: branch });
    expect(github.state.calls).toEqual([]);
  });

  it('stops when the branch has no open PR', async () => {
    const { github } = world();
    const { core } = await relay(github, { INPUT_BRANCH: 'feat/unknown' });
    expect(core.infos.join()).toContain('No open parent PR');
    expect(github.state.dispatches).toEqual([]);
  });
});

describe('relay.yml relay: Repair (stacked PR consolidation)', () => {
  it('squash-merges labelled stacked PRs and re-checks only the repaired gates', async () => {
    const { github, parent } = world({
      stacked: [
        stackedPR(31),
        stackedPR(32, 'doc-remediation', { draft: true }),
        stackedPR(33, null)
      ],
      // Another agent is still repairing: the re-check stays targeted.
      runs: [
        makeAgentRun({
          id: 2000,
          workflow: 'fix-codeql.lock.yml',
          branch: BRANCH
        })
      ]
    });
    const oldSha = parent.head.sha;
    await seedGates(github, oldSha, {
      ...ALL_PASSED,
      lint: 'failure',
      docs: 'failure'
    });

    await relay(github);

    expect(github.state.merges.map((m) => [m.number, m.merge_method])).toEqual([
      [31, 'squash'],
      [32, 'squash']
    ]);
    expect(github.state.merges[0].commit_title).toBe(
      'Merge stacked PR #31: style(lint): fix findings 31'
    );
    expect(github.pr(33).state).toBe('open');
    expect(github.state.graphql).toHaveLength(1);
    expect(github.state.graphql[0].variables.id).toBe('PR_node_32');
    expect(github.state.deletedRefs).toEqual([
      'heads/lint-remediation-31',
      'heads/doc-remediation-32'
    ]);

    const comments = github.comments(20);
    expect(comments).toHaveLength(2);
    expect(comments[0]).toContain('Autonomous Remediation Auto-Merged');
    expect(comments[0]).toContain('#31');
    expect(comments[0]).toContain(
      'the **Lint** gate re-checks this commit now'
    );
    expect(comments[1]).toContain('the **Docs** gate re-checks');

    // Gate failure labels are never cleared by the relay
    expect(github.labels(20)).toEqual(['lint-failed']);

    const newSha = github.pr(20).head.sha;
    expect(newSha).not.toBe(oldSha);
    expect(pipelineDispatches(github)).toEqual([]);
    expect(gateDispatches(github)).toEqual(['gate-lint.yml', 'gate-docs.yml']);
    expect(github.state.dispatches[0]).toEqual({
      owner: 'octo',
      repo: 'demo',
      workflow_id: 'gate-lint.yml',
      ref: BRANCH,
      inputs: { pr_number: '20' }
    });

    const gates = await gatesOn(github, newSha);
    expect(gates.lint.state).toBe('pending');
    expect(gates.docs.state).toBe('pending');
    for (const gate of ['metadata', 'build', 'tests', 'security']) {
      expect(gates[gate].state).toBe('success');
      expect(gates[gate].carriedFrom).toBe(oldSha.slice(0, 7));
    }
    expect(github.qualityStatuses(newSha)[0].description).toMatch(
      /^Checking: Lint, Docs \[rev /
    );
  });

  it('never merges into a PR other than the one for the branch', async () => {
    const elsewhere = stackedPR(40, 'lint-remediation', { base: 'feat/other' });
    const { github } = world({ stacked: [elsewhere] });
    await relay(github);
    expect(github.state.merges).toEqual([]);
  });

  it('comments and continues when a stacked PR cannot be merged', async () => {
    const { github } = world({
      stacked: [stackedPR(31), stackedPR(32)],
      mergeErrors: { 31: 'Merge conflict' }
    });
    const { core } = await relay(github);
    expect(github.state.merges.map((m) => m.number)).toEqual([32]);
    expect(core.warnings.join()).toContain('Failed to merge stacked PR #31');
    expect(github.comments(20)[0]).toContain('#31 could not be auto-merged');
    expect(github.comments(20)[0]).toContain('Merge conflict');
    expect(github.labels(31)).toContain(quality.BLOCKED_LABEL);
    expect(github.labels(32)).not.toContain(quality.BLOCKED_LABEL);
  });

  it('still reports the merge when the branch cannot be deleted', async () => {
    const { github } = world({ stacked: [stackedPR(31)] });
    github.rest.git.deleteRef = async () => {
      throw new Error('protected');
    };
    const { core } = await relay(github);
    expect(core.warnings.join()).toContain(
      "Could not delete branch 'lint-remediation-31'"
    );
    expect(github.comments(20)[0]).toContain('Auto-Merged');
  });
});

describe('relay.yml relay: parallel repairs', () => {
  it('does not wait for other agents still repairing their own gates', async () => {
    const { github, parent } = world({
      stacked: [stackedPR(31)],
      runs: [
        makeAgentRun({
          id: 2000,
          workflow: 'fix-tests.lock.yml',
          branch: BRANCH
        })
      ]
    });
    const oldSha = parent.head.sha;
    await seedGates(github, oldSha, {
      ...ALL_PASSED,
      lint: 'failure',
      tests: 'failure'
    });

    const { core } = await relay(github);

    expect(gateDispatches(github)).toEqual(['gate-lint.yml']);
    const gates = await gatesOn(github, github.pr(20).head.sha);
    expect(gates.tests).toMatchObject({
      state: 'failure',
      carriedFrom: oldSha.slice(0, 7)
    });
    expect(core.summaryText).toContain('Re-checking: Lint');
    expect(core.summaryText).toContain(
      'Carried over: Metadata, Build, Tests, Security, Docs'
    );
  });

  it('carries results across successive repairs and keeps the original commit', async () => {
    const { github, parent } = world({ stacked: [stackedPR(31)] });
    const a = parent.head.sha;
    await seedGates(github, a, {
      ...ALL_PASSED,
      lint: 'failure',
      tests: 'failure'
    });
    await relay(github);
    const b = github.pr(20).head.sha;
    // The lint gate passes on B while the test generator is still working.
    await seedGates(github, b, { lint: 'success' });

    github.state.pulls.push(stackedPR(32, 'test-remediation'));
    // The docs agent is still working, so the tests repair is not the last one.
    github.state.runs.push(
      makeAgentRun({ id: 2001, workflow: 'fix-docs.lock.yml', branch: BRANCH })
    );
    github.state.dispatches = [];
    await relay(github, { SOURCE: 'Fix: Tests (run 1001)' });

    const c = github.pr(20).head.sha;
    expect(gateDispatches(github)).toEqual(['gate-tests.yml']);
    const gates = await gatesOn(github, c);
    expect(gates.lint).toMatchObject({
      state: 'success',
      carriedFrom: b.slice(0, 7)
    });
    expect(gates.metadata.carriedFrom).toBe(a.slice(0, 7));
    expect(gates.tests.state).toBe('pending');
  });

  it('re-checks a gate whose re-check was still running on the previous commit', async () => {
    const { github, parent } = world({
      stacked: [stackedPR(32, 'doc-remediation')]
    });
    await seedGates(github, parent.head.sha, {
      ...ALL_PASSED,
      lint: 'pending',
      docs: 'failure'
    });
    await relay(github, { SOURCE: 'Fix: Docs (run 1)' });
    expect(gateDispatches(github).sort()).toEqual([
      'gate-docs.yml',
      'gate-lint.yml'
    ]);
  });

  it('re-checks every gate that has no result anywhere (e.g. a manual merge)', async () => {
    const { github } = world({ stacked: [stackedPR(31)] });
    await relay(github);
    expect(gateDispatches(github)).toHaveLength(6);
  });
});

describe('relay.yml relay: repairs without a new commit', () => {
  it('re-checks the Metadata gate after Fix: PR metadata rewrote the PR', async () => {
    const { github, parent } = world({ parentLabels: ['needs-metadata'] });
    await seedGates(github, parent.head.sha, {
      ...ALL_PASSED,
      metadata: 'failure'
    });
    parent.title = 'feat(app): add a sample feature';
    await relay(github, { SOURCE: 'Fix: PR metadata (run 1000)' });
    expect(gateDispatches(github)).toEqual(['gate-metadata.yml']);
    expect((await gatesOn(github, parent.head.sha)).metadata.state).toBe(
      'pending'
    );
  });

  it('re-checks the Docs gate after a docs-not-required decision', async () => {
    const { github, parent } = world({ parentLabels: ['docs-required'] });
    await seedGates(github, parent.head.sha, {
      ...ALL_PASSED,
      docs: 'failure'
    });
    parent.labels.push({ name: 'docs-not-required' });
    await relay(github, { SOURCE: 'Fix: Docs (run 7)' });
    expect(gateDispatches(github)).toEqual(['gate-docs.yml']);
  });

  it('keeps a gate that is already being re-checked on the head commit', async () => {
    const { github, parent } = world({
      runs: [
        makeRun({
          id: 77,
          workflow: 'gate-docs.yml',
          branch: BRANCH,
          status: 'in_progress',
          conclusion: null
        })
      ]
    });
    await seedGates(github, parent.head.sha, {
      ...ALL_PASSED,
      docs: 'pending'
    });
    await relay(github, { SOURCE: '' });
    expect(gateDispatches(github)).toEqual([]);
  });

  it('re-checks a gate stuck pending without a running gate workflow', async () => {
    const { github, parent } = world();
    await seedGates(github, parent.head.sha, {
      ...ALL_PASSED,
      docs: 'pending'
    });
    await relay(github, { SOURCE: '' });
    expect(gateDispatches(github)).toEqual(['gate-docs.yml']);
  });

  it('reports a final failure once nothing repairs a failing gate any more', async () => {
    const { github, parent } = world({ parentLabels: ['build-failed'] });
    await seedGates(github, parent.head.sha, {
      ...ALL_PASSED,
      build: 'failure'
    });
    const { core } = await relay(github, { SOURCE: '' });
    expect(gateDispatches(github)).toEqual([]);
    const [status] = github.qualityStatuses(parent.head.sha);
    expect(status.state).toBe('failure');
    const [comment] = github.comments(20);
    expect(comment).toContain(
      `<!-- pr-quality-failed:${quality.revision(parent)} -->`
    );
    expect(comment).toContain('**Build**: build failure');
    expect(comment).toContain(
      'gh workflow run pipeline.yml --ref feat/sample -f pr_number=20 -f force=true'
    );
    expect(core.summaryText).toContain('pr-quality: **failure**');
  });

  it('stays pending while another relay for the branch is still running', async () => {
    const { github, parent } = world({
      runs: [
        makeRun({
          id: 5000,
          workflow: 'relay.yml',
          branch: 'main',
          status: 'in_progress',
          conclusion: null,
          title: `Relay: merge stacked fixes · ${BRANCH}`
        }),
        makeRun({
          id: 4242,
          workflow: 'relay.yml',
          branch: 'main',
          status: 'in_progress',
          conclusion: null,
          title: `Relay: merge stacked fixes · ${BRANCH}`
        })
      ]
    });
    await seedGates(github, parent.head.sha, {
      ...ALL_PASSED,
      build: 'failure'
    });
    await relay(github, { SOURCE: '' });
    expect(github.qualityStatuses(parent.head.sha)[0].state).toBe('pending');
    expect(github.comments(20)).toEqual([]);
  });
});

describe('relay.yml relay: agent runs that repaired nothing', () => {
  it.each(['failure', 'no-changes', 'skipped', 'safe-outputs-failure'])(
    'fails pr-quality fast without re-checking the gate (agent_result %s)',
    async (agentResult) => {
      const { github, parent } = world();
      await seedGates(github, parent.head.sha, {
        ...ALL_PASSED,
        lint: 'failure'
      });
      const { core } = await relay(github, { AGENT_RESULT: agentResult });
      // Re-checking an unchanged commit would only spend another remediation attempt
      expect(gateDispatches(github)).toEqual([]);
      expect(github.qualityStatuses(parent.head.sha)[0].state).toBe('failure');
      expect(github.comments(20)[0]).toContain('**Lint**');
      expect(core.summaryText).toContain(`(${agentResult})`);
    }
  );

  it('stays pending while another agent still repairs the PR', async () => {
    const { github, parent } = world({
      runs: [
        makeAgentRun({
          id: 2000,
          workflow: 'fix-tests.lock.yml',
          branch: BRANCH
        })
      ]
    });
    await seedGates(github, parent.head.sha, {
      ...ALL_PASSED,
      lint: 'failure',
      tests: 'failure'
    });
    await relay(github, { AGENT_RESULT: 'failure' });
    expect(gateDispatches(github)).toEqual([]);
    expect(github.qualityStatuses(parent.head.sha)[0].state).toBe('pending');
    expect(github.comments(20)).toEqual([]);
  });

  it('still merges stacked PRs left by other agents and re-checks their gates', async () => {
    const { github, parent } = world({
      stacked: [stackedPR(31, 'doc-remediation')]
    });
    await seedGates(github, parent.head.sha, {
      ...ALL_PASSED,
      lint: 'failure',
      docs: 'failure'
    });
    await relay(github, { AGENT_RESULT: 'failure' });
    expect(github.state.merges.map((m) => m.number)).toEqual([31]);
    expect(github.state.merges[0].commit_message).toBe('Recheck-Gates: docs');
    expect(gateDispatches(github)).toEqual(['gate-docs.yml']);
  });

  it('re-checks the source gate for manual runs without agent_result', async () => {
    const { github, parent } = world();
    await seedGates(github, parent.head.sha, {
      ...ALL_PASSED,
      lint: 'failure'
    });
    await relay(github, { AGENT_RESULT: '' });
    expect(gateDispatches(github)).toEqual(['gate-lint.yml']);
  });
});

describe('relay.yml relay: waiting for a running pipeline', () => {
  it('waits for a running pipeline before deciding', async () => {
    const { github } = world({
      runs: [
        makeRun({
          id: 3000,
          workflow: 'pipeline.yml',
          branch: BRANCH,
          status: 'in_progress',
          conclusion: null
        })
      ]
    });
    const { sleeps } = await relay(
      github,
      {},
      {
        onSleep: (_, count) => {
          if (count === 3) github.state.runs[0].status = 'completed';
        }
      }
    );
    expect(sleeps).toEqual([30000, 30000, 30000]);
    expect(gateDispatches(github)).toContain('gate-lint.yml');
  });

  it('decides anyway when the pipeline exceeds PIPELINE_WAIT_MINUTES', async () => {
    const { github } = world({
      runs: [
        makeRun({
          id: 3000,
          workflow: 'pipeline.yml',
          branch: BRANCH,
          status: 'queued',
          conclusion: null
        })
      ]
    });
    const { core, sleeps } = await relay(github, {
      PIPELINE_WAIT_MINUTES: '-1'
    });
    expect(sleeps).toEqual([]);
    expect(core.warnings.join()).toContain('still running after -1 minutes');
    expect(gateDispatches(github)).toContain('gate-lint.yml');
  });
});

describe('relay.yml relay: lost hand-offs', () => {
  it('re-checks a docs-not-required decision whose own relay never ran', async () => {
    const { github, parent } = world({
      parentLabels: ['docs-required'],
      stacked: [stackedPR(31)]
    });
    const before = parent.head.sha;
    for (const [gate, result] of Object.entries({
      metadata: 'success',
      lint: 'failure',
      build: 'success',
      tests: 'success',
      security: 'success',
      docs: 'failure'
    })) {
      await quality.recordGate({
        github,
        context: createContext(),
        core: createCore(),
        prNumber: 20,
        sha: before,
        gate,
        result
      });
    }
    // The doc agent recorded its decision, but its relay was replaced in the queue.
    github.pr(20).labels.push({ name: 'docs-not-required' });

    await relay(github);

    expect(gateDispatches(github).sort()).toEqual([
      'gate-docs.yml',
      'gate-lint.yml',
      'gate-metadata.yml'
    ]);
    const gates = await gatesOn(github, github.pr(20).head.sha);
    expect(gates.build.carriedFrom).toBe(before.slice(0, 7));
  });
});

describe('relay.yml relay: GitHub App token', () => {
  const wf = loadWorkflow(FILE);

  it('mints the App token when configured and hands it to the relay script', () => {
    const steps = wf.jobs['auto-merge-stacked'].steps;
    const app = steps.find((s) => s.id === 'app');
    expect(app.uses).toBe('actions/create-github-app-token@v3');
    expect(app.if).toBe("vars.PR_BOT_CLIENT_ID != ''");
    expect(app['continue-on-error']).toBe(true);
    const relayStep = steps.find(
      (s) => s.name === 'Consolidate Stacked PRs & Recheck'
    );
    expect(relayStep.uses).toBe('actions/github-script@v9');
    expect(relayStep.env.APP_TOKEN).toBe('${{ steps.app.outputs.token }}');
  });

  it('merges with the App token and leaves the re-check to the pipeline run it starts', async () => {
    const { github, parent } = world({
      stacked: [stackedPR(31, 'doc-remediation')]
    });
    const oldSha = parent.head.sha;
    await seedGates(github, oldSha, { ...ALL_PASSED, docs: 'failure' });
    const { core } = await relay(github, {
      APP_TOKEN: 'app-token',
      SOURCE: 'Fix: Docs (run 1001)'
    });
    expect(github.state.merges).toMatchObject([
      {
        number: 31,
        token: 'app-token',
        commit_message: 'Recheck-Gates: docs'
      }
    ]);
    expect(github.state.dispatches).toEqual([]);
    const newSha = github.pr(20).head.sha;
    expect(github.state.statuses[newSha]).toBeUndefined();
    expect(github.comments(20)[0]).toContain('Auto-Merged');
    expect(core.summaryText).toContain('GitHub App token');
    expect(core.summaryText).toContain('re-checks docs');
  });

  it('names the dispatching agent gate in the trailer too', async () => {
    const { github } = world({ stacked: [stackedPR(31, 'test-remediation')] });
    await relay(github, { APP_TOKEN: 'app-token' });
    expect(github.state.merges[0].commit_message).toBe(
      'Recheck-Gates: tests, lint'
    );
    expect(
      quality.parseRecheckTrailer(
        github.state.commits[github.pr(20).head.sha].message
      )
    ).toEqual(['tests', 'lint']);
  });

  it('re-checks by itself when nothing was merged', async () => {
    const { github, parent } = world();
    await seedGates(github, parent.head.sha, {
      ...ALL_PASSED,
      lint: 'failure'
    });
    await relay(github, { APP_TOKEN: 'app-token' });
    expect(github.state.merges).toEqual([]);
    expect(gateDispatches(github)).toEqual(['gate-lint.yml']);
  });

  /** The full check the relay dispatches itself after the last repair (no App merge). */
  const fullCheck = {
    owner: 'octo',
    repo: 'demo',
    workflow_id: 'pipeline.yml',
    ref: BRANCH,
    inputs: { pr_number: '20', force: 'true' }
  };

  it('checks every gate by itself when the parent PR does not target the default branch', async () => {
    const { github, parent } = world({ stacked: [stackedPR(31)] });
    parent.base.ref = 'release/1.0';
    await seedGates(github, parent.head.sha, ALL_PASSED);
    await relay(github, { APP_TOKEN: 'app-token' });
    expect(github.state.merges).toMatchObject([
      { number: 31, token: 'github-token' }
    ]);
    expect(github.state.dispatches).toEqual([fullCheck]);
  });

  it('merges with GITHUB_TOKEN and checks every gate by itself after the last repair', async () => {
    const { github, parent } = world({ stacked: [stackedPR(31)] });
    await seedGates(github, parent.head.sha, ALL_PASSED);
    const { core } = await relay(github);
    expect(github.state.merges).toMatchObject([
      {
        number: 31,
        token: 'github-token',
        commit_message: 'Recheck-Gates: lint'
      }
    ]);
    expect(github.state.dispatches).toEqual([fullCheck]);
    const newSha = github.pr(20).head.sha;
    expect(github.qualityStatuses(newSha)[0]).toMatchObject({
      state: 'pending',
      description: expect.stringMatching(
        /^Final check: re-running all gates together/
      )
    });
    expect(await gatesOn(github, newSha)).toEqual({});
    expect(core.summaryText).toContain('every gate is checked together');
  });

  it('merges with GITHUB_TOKEN and re-checks only the repaired gate while another gate fails', async () => {
    const { github, parent } = world({ stacked: [stackedPR(31)] });
    await seedGates(github, parent.head.sha, {
      ...ALL_PASSED,
      build: 'failure'
    });
    await relay(github);
    expect(gateDispatches(github)).toEqual(['gate-lint.yml']);
    expect(pipelineDispatches(github)).toEqual([]);
  });
});

describe('relay.yml relay: lint auto-fix stacked PR', () => {
  const autofixPR = () =>
    makePR({
      number: 45,
      branch: 'lint-autofix/pr-20',
      base: BRANCH,
      title: 'style(lint): auto-fix lint and formatting [pr-autofix]',
      labels: ['lint-remediation']
    });
  const SOURCE = 'Lint auto-fix (run 600)';

  it('merges it with the App token; the merge keeps the [pr-autofix] marker so it is not fixed again', async () => {
    const { github } = world({ parentLabels: [], stacked: [autofixPR()] });
    await relay(github, { APP_TOKEN: 'app-token', SOURCE });
    expect(github.state.merges).toMatchObject([
      {
        number: 45,
        token: 'app-token',
        commit_message: 'Recheck-Gates: lint'
      }
    ]);
    const merged = github.state.commits[github.pr(20).head.sha].message;
    expect(merged).toContain('[pr-autofix]');
    expect(github.state.deletedRefs).toContain('heads/lint-autofix/pr-20');
    expect(github.state.dispatches).toEqual([]);
  });

  it('checks every gate on the fixed commit without the App (no gate ran before the fix)', async () => {
    const { github } = world({ parentLabels: [], stacked: [autofixPR()] });
    await relay(github, { SOURCE });
    expect(github.state.merges).toMatchObject([
      { number: 45, token: 'github-token' }
    ]);
    expect(gateDispatches(github).sort()).toEqual(
      quality.GATES.map((g) => g.workflow).sort()
    );
  });
});

describe('relay.yml relay: stacked PRs that conflict with the branch', () => {
  const conflicting = (number, label = 'lint-remediation') => {
    const pr = stackedPR(number, label);
    pr.mergeable = false;
    return pr;
  };

  it('supersedes a conflicting stacked PR and re-checks its gate instead of blocking', async () => {
    const { github, parent } = world({
      stacked: [conflicting(31), stackedPR(32, 'test-remediation')],
      // Another agent is still repairing: the re-check stays targeted.
      runs: [
        makeAgentRun({
          id: 2000,
          workflow: 'fix-docs.lock.yml',
          branch: BRANCH
        })
      ]
    });
    await seedGates(github, parent.head.sha, {
      ...ALL_PASSED,
      lint: 'failure',
      tests: 'failure'
    });
    const { core } = await relay(github, {
      SOURCE: 'Fix: Tests (run 1000)'
    });

    expect(github.state.merges.map((m) => m.number)).toEqual([32]);
    expect(github.pr(31).state).toBe('closed');
    expect(github.labels(31)).toContain(quality.SUPERSEDED_LABEL);
    expect(github.labels(31)).not.toContain(quality.BLOCKED_LABEL);
    expect(github.state.deletedRefs).toContain('heads/lint-remediation-31');
    expect(github.comments(31)[0]).toContain('Superseded');
    const superseded = github
      .comments(20)
      .find((c) => c.includes('superseded'));
    expect(superseded).toContain(
      'the **Lint** gate is re-checked on the latest commit'
    );
    expect(github.comments(20).join()).not.toContain(
      'could not be auto-merged'
    );

    // Lint is re-checked on the new head: if it still fails, the lint gate dispatches its agent again.
    expect(gateDispatches(github)).toEqual(['gate-lint.yml', 'gate-tests.yml']);
    const gates = await gatesOn(github, github.pr(20).head.sha);
    expect(gates.lint.state).toBe('pending');
    expect(core.summaryText).toContain(
      'Superseded after a merge conflict or a rebase/force-push'
    );
  });

  it('waits for GitHub to compute mergeability before deciding', async () => {
    const pr = stackedPR(31);
    pr.mergeable = null;
    const { github, parent } = world({ stacked: [pr] });
    github.state.mergeErrors[31] = 'Pull Request is not mergeable';
    await seedGates(github, parent.head.sha, {
      ...ALL_PASSED,
      lint: 'failure'
    });
    await relay(
      github,
      {},
      {
        onSleep: () => {
          github.pr(31).mergeable = false;
        }
      }
    );
    expect(github.labels(31)).toContain(quality.SUPERSEDED_LABEL);
  });

  it('blocks a stacked PR that conflicts again after its fix was regenerated once', async () => {
    const earlier = stackedPR(30, 'lint-remediation', { state: 'closed' });
    earlier.labels.push({ name: quality.SUPERSEDED_LABEL });
    const { github } = world({ stacked: [earlier, conflicting(31)] });
    await relay(github);
    expect(github.pr(31).state).toBe('open');
    expect(github.labels(31)).toContain(quality.BLOCKED_LABEL);
    expect(github.labels(31)).not.toContain(quality.SUPERSEDED_LABEL);
    expect(github.comments(20)[0]).toContain('#31 could not be auto-merged');
    expect(github.comments(20)[0]).toContain('already regenerated once');
  });

  it('only regenerates once per remediation label', async () => {
    const earlier = stackedPR(30, 'test-remediation', { state: 'closed' });
    earlier.labels.push({ name: quality.SUPERSEDED_LABEL });
    const { github } = world({ stacked: [earlier, conflicting(31)] });
    await relay(github);
    expect(github.labels(31)).toContain(quality.SUPERSEDED_LABEL);
  });

  it('re-checks superseded gates itself even when the App merged other stacked PRs', async () => {
    const { github, parent } = world({
      stacked: [conflicting(31), stackedPR(32, 'doc-remediation')]
    });
    await seedGates(github, parent.head.sha, {
      ...ALL_PASSED,
      lint: 'failure',
      docs: 'failure'
    });
    await relay(github, {
      APP_TOKEN: 'app-token',
      SOURCE: 'Fix: Docs (run 1001)'
    });
    expect(github.state.merges).toMatchObject([
      { number: 32, token: 'app-token', commit_message: 'Recheck-Gates: docs' }
    ]);
    expect(gateDispatches(github)).toEqual(['gate-lint.yml', 'gate-docs.yml']);
  });
});

describe('relay.yml relay: stacked PRs built before a rebase or force-push', () => {
  const GONE = 'f'.repeat(40);
  // gh-aw stamps its PRs with the agent run; the run's head_sha is the commit it was built on.
  const agentPR = (number, runId, label = 'lint-remediation') =>
    stackedPR(number, label, {
      body: `Fix.\n\n<!-- gh-aw-agentic-workflow: Fix: Lint & format, engine: copilot, id: ${runId}, workflow_id: fix-lint -->`
    });
  const agentRun = (id, head_sha) =>
    makeRun({
      id,
      workflow: 'fix-lint.lock.yml',
      branch: BRANCH,
      head_sha
    });

  it('merges a fix built on a commit still in the branch', async () => {
    const { github, parent } = world({ stacked: [agentPR(31, 501)] });
    github.state.runs.push(agentRun(501, parent.head.sha));
    await relay(github);
    expect(github.state.merges.map((m) => m.number)).toEqual([31]);
  });

  it('supersedes a fix built on a commit the author rebased away, even without a conflict', async () => {
    const { github, parent } = world({ stacked: [agentPR(31, 501)] });
    github.state.runs.push(agentRun(501, GONE));
    await seedGates(github, parent.head.sha, {
      ...ALL_PASSED,
      lint: 'failure'
    });
    await relay(github);

    expect(github.state.merges).toHaveLength(0);
    expect(github.pr(31).state).toBe('closed');
    expect(github.labels(31)).toContain(quality.SUPERSEDED_LABEL);
    expect(github.comments(31)[0]).toContain('rebased or force-pushed');
    expect(github.comments(20).join()).toContain(
      'superseded after a rebase or force-push'
    );
    expect(gateDispatches(github)).toEqual(['gate-lint.yml']);
  });

  it('uses the base recorded by the lint auto-fix', async () => {
    const pr = stackedPR(31, 'lint-remediation', {
      body: `Auto-fix.\n\n${quality.stackedBaseMarker(GONE)}`
    });
    const { github } = world({ stacked: [pr] });
    await relay(github, { SOURCE: 'Lint auto-fix (run 77)' });
    expect(github.labels(31)).toContain(quality.SUPERSEDED_LABEL);
  });

  it('blocks a fix built before a rebase that was already regenerated once', async () => {
    const earlier = stackedPR(30, 'lint-remediation', { state: 'closed' });
    earlier.labels.push({ name: quality.SUPERSEDED_LABEL });
    const { github } = world({ stacked: [earlier, agentPR(31, 501)] });
    github.state.runs.push(agentRun(501, GONE));
    await relay(github);
    expect(github.state.merges).toHaveLength(0);
    expect(github.pr(31).state).toBe('open');
    expect(github.labels(31)).toContain(quality.BLOCKED_LABEL);
    expect(github.comments(20)[0]).toContain('no longer in `feat/sample`');
  });

  it('merges as before when the base is unknown', async () => {
    // No marker, or the agent run is gone: nothing to compare against.
    const { github } = world({
      stacked: [agentPR(31, 999), stackedPR(32, 'doc-remediation')]
    });
    await relay(github);
    expect(github.state.merges.map((m) => m.number)).toEqual([31, 32]);
  });
});

describe('relay.yml relay: Copilot review fixes', () => {
  const SOURCE = 'Fix: Copilot review comments (run 1100)';
  const reviewPR = (extra = {}) =>
    makePR({
      number: 50,
      branch: 'review-fix/pr-20',
      base: BRANCH,
      title: 'fix(review): address Copilot review comments',
      labels: ['review-remediation'],
      body: [
        'Addresses the Copilot review.',
        '',
        '## Review decisions',
        '- applied 9001: guard against an empty list',
        '- skipped 9002: a matter of taste',
        '- applied 9999: comment that no longer exists'
      ].join('\n'),
      ...extra
    });
  const threads = () => ({
    20: [
      {
        id: 'T1',
        path: 'apps/a.js',
        line: 3,
        comments: [
          {
            databaseId: 9001,
            body: 'Empty list?',
            author: 'copilot-pull-request-reviewer'
          }
        ]
      },
      {
        id: 'T2',
        path: 'apps/b.js',
        line: 8,
        comments: [
          {
            databaseId: 9002,
            body: 'Rename this.',
            author: 'copilot-pull-request-reviewer'
          }
        ]
      }
    ]
  });

  it('merges the fix, checks every gate together and answers each Copilot thread', async () => {
    const { github, parent } = world({
      parentLabels: [],
      stacked: [reviewPR()],
      reviewThreads: threads()
    });
    await seedGates(github, parent.head.sha, ALL_PASSED);
    await relay(github, { SOURCE });

    const [merge] = github.state.merges;
    expect(merge.number).toBe(50);
    expect(merge.commit_message).toBe(
      'Recheck-Gates: metadata, lint, build, tests, security, docs'
    );
    // One full pipeline run instead of six standalone gate runs.
    expect(gateDispatches(github)).toEqual([]);
    expect(pipelineDispatches(github)).toEqual([
      {
        owner: 'octo',
        repo: 'demo',
        workflow_id: 'pipeline.yml',
        ref: BRANCH,
        inputs: { pr_number: '20', force: 'true' }
      }
    ]);
    expect(github.comments(20)[0]).toContain('**every gate** re-checks');

    const replies = github.state.reviewReplies;
    expect(replies.map((r) => r.comment_id)).toEqual([9001, 9002]);
    expect(replies[0].body).toContain(`Applied in ${merge.sha.slice(0, 7)}`);
    expect(replies[1].body).toContain('a matter of taste');
    const [t1, t2] = github.state.reviewThreads[20];
    expect(t1.isResolved).toBe(true);
    expect(t2.isResolved).toBeFalsy();
  });

  it('re-checks every gate after a review fix with the App token too', async () => {
    const { github, parent } = world({
      parentLabels: [],
      stacked: [reviewPR()],
      reviewThreads: threads()
    });
    await seedGates(github, parent.head.sha, ALL_PASSED);
    await relay(github, { SOURCE, APP_TOKEN: 'app-token' });
    expect(github.state.merges[0]).toMatchObject({
      token: 'app-token',
      commit_message:
        'Recheck-Gates: metadata, lint, build, tests, security, docs'
    });
    expect(github.state.reviewReplies).toHaveLength(2);
  });

  it('supersedes a conflicting review fix like any other stacked PR and re-checks every gate', async () => {
    const pr = reviewPR();
    pr.mergeable = false;
    const { github, parent } = world({ parentLabels: [], stacked: [pr] });
    await seedGates(github, parent.head.sha, ALL_PASSED);
    await relay(github, { SOURCE });
    expect(github.state.merges).toEqual([]);
    expect(github.pr(50).state).toBe('closed');
    expect(github.labels(50)).toContain(quality.SUPERSEDED_LABEL);
    expect(github.labels(50)).not.toContain(quality.BLOCKED_LABEL);
    expect(github.state.deletedRefs).toContain('heads/review-fix/pr-20');
    expect(gateDispatches(github).sort()).toEqual(
      quality.GATES.map((g) => g.workflow).sort()
    );
    const notice = github.comments(20).find((c) => c.includes('superseded'));
    expect(notice).toContain(
      'the Copilot comments still open are addressed again'
    );
  });

  it('blocks a review fix that conflicts again after it was regenerated once', async () => {
    const earlier = reviewPR({ number: 49, state: 'closed' });
    earlier.labels.push({ name: quality.SUPERSEDED_LABEL });
    const pr = reviewPR();
    pr.mergeable = false;
    const { github } = world({ parentLabels: [], stacked: [earlier, pr] });
    await relay(github, { SOURCE });
    expect(github.pr(50).state).toBe('open');
    expect(github.labels(50)).toContain(quality.BLOCKED_LABEL);
    expect(github.comments(20)[0]).toContain('already regenerated once');
  });
});
