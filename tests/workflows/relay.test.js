import { describe, expect, it } from 'vitest';
import {
  createContext,
  createGitHub,
  getScript,
  loadWorkflow,
  makeAgentRun,
  makePR,
  makeRun,
  quality,
  runScript,
  seedQualityStatus
} from './helpers/harness.js';

const FILE = 'pr-stacked-merge.yml';
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
      SOURCE: 'PR Lint Fixer (run 1000)',
      PIPELINE_WAIT_MINUTES: '30',
      ...env
    },
    onSleep: opts.onSleep
  });
}

const pipelineDispatches = (github) =>
  github.state.dispatches.filter((d) => d.workflow_id === 'pr-pipeline.yml');

describe('pr-stacked-merge.yml structure', () => {
  const wf = loadWorkflow(FILE);

  it('is dispatched by agents with branch, agent_result and source inputs', () => {
    expect(Object.keys(wf.on.workflow_dispatch.inputs)).toEqual([
      'branch',
      'agent_result',
      'source'
    ]);
    expect(wf.on.workflow_dispatch.inputs.branch.required).toBe(true);
  });

  it('runs one relay at a time per parent branch without cancelling', () => {
    expect(wf.concurrency.group).toBe(
      'pr-stacked-merge-${{ inputs.branch || github.event.pull_request.base.ref }}'
    );
    expect(wf.concurrency['cancel-in-progress']).toBe(false);
  });

  it('only reacts to pull_request events of labelled remediation PRs', () => {
    const condition = wf.jobs['auto-merge-stacked'].if;
    expect(condition).toContain("github.event_name != 'pull_request'");
    for (const label of ['lint', 'test', 'security', 'doc']) {
      expect(condition).toContain(`'${label}-remediation'`);
    }
    expect(wf.jobs['auto-merge-stacked']['timeout-minutes']).toBeGreaterThan(
      30
    );
  });
});

describe('pr-stacked-merge.yml relay: nothing to do', () => {
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

describe('pr-stacked-merge.yml relay: Repair (stacked PR consolidation)', () => {
  it('squash-merges labelled stacked PRs and re-checks the new commit', async () => {
    const { github, parent } = world({
      stacked: [
        stackedPR(31),
        stackedPR(32, 'doc-remediation', { draft: true }),
        stackedPR(33, null)
      ]
    });
    const oldSha = parent.head.sha;
    await seedQualityStatus(github, parent, 'failure', 'Failed: Lint');

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
    expect(comments[0]).toContain('not trusted until the gates pass');

    // Gate labels are never cleared by the relay
    expect(github.labels(20)).toEqual(['lint-failed']);

    expect(github.pr(20).head.sha).not.toBe(oldSha);
    expect(pipelineDispatches(github)).toEqual([
      {
        owner: 'octo',
        repo: 'demo',
        workflow_id: 'pr-pipeline.yml',
        ref: BRANCH,
        inputs: { pr_number: '20' }
      }
    ]);
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

describe('pr-stacked-merge.yml relay: waiting for the repair round', () => {
  it('defers to the last agent while another agent is still working', async () => {
    const { github } = world({
      runs: [
        makeAgentRun({
          id: 2000,
          workflow: 'pr-test-generator.lock.yml',
          branch: BRANCH
        })
      ]
    });
    const { core } = await relay(github);
    expect(pipelineDispatches(github)).toEqual([]);
    expect(core.summaryText).toContain('deferred');
    expect(core.summaryText).toContain('pr-test-generator.lock.yml');
  });

  it('does not wait for the agent that dispatched it', async () => {
    const { github } = world({
      runs: [
        makeAgentRun({
          id: 1000,
          workflow: 'pr-lint-fixer.lock.yml',
          branch: BRANCH
        })
      ]
    });
    await relay(github, { SOURCE: 'PR Lint Fixer (run 1000)' });
    expect(pipelineDispatches(github)).toHaveLength(1);
  });

  it('does not wait for agents that are already in their conclusion job', async () => {
    const { github } = world({
      runs: [
        makeAgentRun({
          id: 2000,
          workflow: 'pr-doc-updater.lock.yml',
          branch: BRANCH,
          phase: 'conclusion'
        })
      ]
    });
    await relay(github);
    expect(pipelineDispatches(github)).toHaveLength(1);
  });

  it('waits for a running pipeline before deciding', async () => {
    const { github } = world({
      runs: [
        makeRun({
          id: 3000,
          workflow: 'pr-pipeline.yml',
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
    expect(pipelineDispatches(github)).toHaveLength(1);
  });

  it('defers when the pipeline it waited for dispatched another agent', async () => {
    const { github } = world({
      runs: [
        makeRun({
          id: 3000,
          workflow: 'pr-pipeline.yml',
          branch: BRANCH,
          status: 'in_progress',
          conclusion: null
        })
      ]
    });
    await relay(
      github,
      {},
      {
        onSleep: () => {
          github.state.runs[0].status = 'completed';
          github.state.runs.push(
            makeAgentRun({
              id: 2001,
              workflow: 'pr-validation.lock.yml',
              branch: BRANCH,
              phase: 'queued'
            })
          );
        }
      }
    );
    expect(pipelineDispatches(github)).toEqual([]);
  });

  it('decides anyway when the pipeline exceeds PIPELINE_WAIT_MINUTES', async () => {
    const { github } = world({
      runs: [
        makeRun({
          id: 3000,
          workflow: 'pr-pipeline.yml',
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
    expect(pipelineDispatches(github)).toHaveLength(1);
  });
});

describe('pr-stacked-merge.yml relay: Recheck decision', () => {
  it('re-dispatches when the revision has no verdict yet', async () => {
    const { github } = world();
    const { core } = await relay(github);
    expect(pipelineDispatches(github)).toHaveLength(1);
    expect(core.summaryText).toContain('Recheck: dispatched');
  });

  it('re-dispatches when only a pending status exists', async () => {
    const { github, parent } = world();
    await seedQualityStatus(github, parent, 'pending');
    await relay(github);
    expect(pipelineDispatches(github)).toHaveLength(1);
  });

  it('re-dispatches when the agent changed PR metadata on the same commit', async () => {
    const { github, parent } = world({
      parentLabels: ['pr-validation-failed']
    });
    await seedQualityStatus(github, parent, 'failure', 'Failed: Metadata');
    parent.title = 'feat(app): add a sample feature';
    await relay(github, { SOURCE: 'PR Validation (run 1000)' });
    expect(pipelineDispatches(github)).toHaveLength(1);
  });

  it('re-dispatches when the agent recorded a docs-not-required decision', async () => {
    const { github, parent } = world({ parentLabels: ['docs-required'] });
    await seedQualityStatus(github, parent, 'failure', 'Failed: Docs');
    parent.labels.push({ name: 'docs-not-required' });
    await relay(github);
    expect(pipelineDispatches(github)).toHaveLength(1);
  });

  it('does nothing when the revision already passed', async () => {
    const { github, parent } = world({ parentLabels: [] });
    const rev = await seedQualityStatus(
      github,
      parent,
      'success',
      'All gates passed'
    );
    const { core } = await relay(github);
    expect(github.state.dispatches).toEqual([]);
    expect(github.comments(20)).toEqual([]);
    expect(core.summaryText).toContain(`revision \`${rev}\` already passed`);
  });

  it('stops the loop with one comment when the round changed nothing', async () => {
    const { github, parent } = world();
    const rev = await seedQualityStatus(
      github,
      parent,
      'failure',
      'Failed: Lint'
    );

    const first = await relay(github);
    await relay(github);

    expect(github.state.dispatches).toEqual([]);
    const comments = github.comments(20);
    expect(comments).toHaveLength(1);
    expect(comments[0]).toContain(`<!-- remediation-stalled:${rev} -->`);
    expect(comments[0]).toContain('Failed: Lint');
    expect(comments[0]).toContain('did not change the code');
    expect(comments[0]).toContain(
      'gh workflow run pr-pipeline.yml --ref feat/sample -f pr_number=20 -f force=true'
    );
    expect(first.core.summaryText).toContain('Recheck: stopped');
  });

  it.each(['failure', 'cancelled'])(
    'explains that the agent finished with %s',
    async (agentResult) => {
      const { github, parent } = world();
      await seedQualityStatus(github, parent, 'failure', 'Failed: Tests');
      await relay(github, {
        AGENT_RESULT: agentResult,
        SOURCE: 'PR Test Generator (run 1000)'
      });
      expect(github.comments(20)[0]).toContain(
        `\`PR Test Generator (run 1000)\` finished with **${agentResult}**`
      );
    }
  );

  it('comments again once a new failing revision also stalls', async () => {
    const { github, parent } = world();
    await seedQualityStatus(github, parent, 'failure', 'Failed: Lint');
    await relay(github);
    parent.head.sha = 'b'.repeat(40);
    await seedQualityStatus(github, parent, 'failure', 'Failed: Lint');
    await relay(github);
    expect(github.comments(20)).toHaveLength(2);
  });

  it('uses the base branch of the stacked PR on pull_request events', async () => {
    const { github } = world({ stacked: [stackedPR(31)] });
    await relay(
      github,
      { INPUT_BRANCH: '' },
      {
        context: {
          eventName: 'pull_request',
          payload: { pull_request: { number: 31, base: { ref: BRANCH } } }
        }
      }
    );
    expect(github.state.merges.map((m) => m.number)).toEqual([31]);
    expect(pipelineDispatches(github)).toHaveLength(1);
  });

  it('dispatches once per round even with several stacked PRs', async () => {
    const { github } = world({
      stacked: [stackedPR(31), stackedPR(32, 'test-remediation')]
    });
    const { core } = await relay(github);
    expect(pipelineDispatches(github)).toHaveLength(1);
    expect(core.summaryText).toContain('Stacked PRs merged: 2');
    expect(quality.revision(github.pr(20))).toContain(
      github.pr(20).head.sha.slice(0, 7)
    );
  });
});
