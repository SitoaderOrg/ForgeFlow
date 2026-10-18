import { readFileSync, existsSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { Script } from 'node:vm';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import yaml from 'js-yaml';
import testConfig from '../../vitest.config.js';

const require = createRequire(import.meta.url);
const workflow = (name) =>
  yaml.load(readFileSync(`.github/workflows/${name}.yml`, 'utf8'));
const pipeline = workflow('pr-pipeline');
const head = 'a'.repeat(40);
const base = 'b'.repeat(40);
const next = 'c'.repeat(40);
const repo = { owner: 'owner', repo: 'repo' };
const metadataHash = (pr) =>
  createHash('sha256')
    .update(JSON.stringify([pr.title, pr.body || '']))
    .digest('hex');

function pullRequest(overrides = {}) {
  return {
    number: 11,
    node_id: randomUUID(),
    state: 'open',
    title: 'feat: add streaks',
    body: 'Summary and verification',
    draft: false,
    user: { login: 'author' },
    requested_reviewers: [],
    labels: [],
    head: { sha: head, ref: 'feature', repo: { full_name: 'owner/repo' } },
    base: { sha: base, ref: 'main', repo: { full_name: 'owner/repo' } },
    ...overrides
  };
}

function cycleState(overrides = {}) {
  const pr = pullRequest();
  return {
    version: 1,
    repository: 'owner/repo',
    initial_head_sha: head,
    feature: {
      number: 11,
      head_ref: 'feature',
      head_sha: head,
      base_ref: 'main',
      base_sha: base,
      metadata_hash: metadataHash(pr)
    },
    round: 0,
    stack_number: null,
    repairs: [],
    ...overrides
  };
}

function harness(pr = pullRequest(), env = {}) {
  const outputs = {};
  const files = new Map();
  const read = (path) => {
    if (!files.has(path)) throw new Error(`Missing fixture artifact: ${path}`);
    return files.get(path);
  };
  const core = {
    setOutput: vi.fn((name, value) => {
      outputs[name] = value;
    }),
    info: vi.fn(),
    notice: vi.fn(),
    error: vi.fn(),
    summary: { addRaw: vi.fn().mockReturnThis(), write: vi.fn() }
  };
  const github = {
    rest: {
      pulls: {
        get: vi.fn().mockResolvedValue({ data: pr }),
        requestReviewers: vi.fn().mockResolvedValue({}),
        list: vi.fn(),
        listFiles: vi.fn(),
        merge: vi.fn()
      },
      issues: {
        getLabel: vi.fn().mockResolvedValue({}),
        createLabel: vi.fn().mockResolvedValue({}),
        addLabels: vi.fn().mockResolvedValue({}),
        removeLabel: vi.fn().mockResolvedValue({}),
        createComment: vi.fn().mockResolvedValue({})
      },
      checks: { create: vi.fn().mockResolvedValue({ data: { id: 123 } }) },
      actions: {
        createWorkflowDispatch: vi.fn().mockResolvedValue({}),
        getWorkflow: vi.fn().mockResolvedValue({ data: { id: 77 } }),
        getArtifact: vi.fn().mockResolvedValue({
          data: {
            id: 501,
            name: 'repair-state-1',
            expired: false,
            workflow_run: { id: 80, head_sha: head }
          }
        })
      },
      repos: {
        get: vi.fn().mockResolvedValue({ data: { allow_auto_merge: true } }),
        getContent: vi.fn(),
        getCommit: vi
          .fn()
          .mockResolvedValue({ data: { parents: [{ sha: head }] } })
      }
    },
    paginate: vi.fn().mockResolvedValue([]),
    request: vi.fn().mockResolvedValue({ data: [] }),
    graphql: vi.fn().mockResolvedValue({})
  };
  return {
    outputs,
    files,
    core,
    github,
    require: (name) =>
      name === 'node:fs'
        ? {
            readFileSync: read,
            statSync: (path) => ({ size: Buffer.byteLength(read(path)) }),
            mkdirSync: vi.fn(),
            writeFileSync: (path, contents) => files.set(path, contents)
          }
        : require(name),
    Buffer,
    context: {
      repo,
      ref: 'refs/heads/feature',
      sha: head,
      runId: 123,
      serverUrl: 'https://github.com',
      payload: {
        repository: { full_name: 'owner/repo', default_branch: 'main' },
        pull_request: pr
      }
    },
    process: {
      env: {
        PR_NUMBER: '11',
        EXPECTED_HEAD_SHA: head,
        HEAD_REF: 'feature',
        HEAD_SHA: head,
        BASE_REF: 'main',
        BASE_SHA: base,
        MERGED_SHA: '',
        REGISTERED_STATE: '',
        STATE: JSON.stringify(cycleState()),
        STATE_DIRECTORY: 'state-output',
        STATE_PATH: join('state-output', 'state.json'),
        RUN_ATTEMPT: '1',
        ALLOW_CLEAR: 'true',
        REPAIR_KIND: 'test',
        COMPARISON_BASE_SHA: base,
        METADATA_HASH: metadataHash(pullRequest()),
        REPAIR_ROUND: '0',
        ...env
      }
    }
  };
}

async function execute(job, sandbox, definition = pipeline, stepId) {
  const step = definition.jobs[job].steps.find(
    (step) => step.with?.script && (!stepId || step.id === stepId)
  );
  return new Script(
    `(async () => { ${step.with.script}\n })()`
  ).runInNewContext(sandbox, {
    timeout: 1000
  });
}

const passingGates = () =>
  Object.fromEntries(
    ['context', 'metadata', 'lint', 'build', 'test', 'security', 'docs'].map(
      (name) => [name, { result: 'success', outputs: {} }]
    )
  );

describe('artifact-bound native repair continuation', () => {
  function continuation() {
    const entry = {
      number: 22,
      head_ref: 'repair/lint',
      head_sha: next,
      base_ref: 'feature',
      base_sha: head,
      kind: 'lint',
      check_id: 44,
      validation_run_id: 80
    };
    const state = cycleState({
      round: 1,
      repairs: [entry],
      source_run_id: 80,
      source_run_attempt: 1,
      source_head_sha: head,
      transition: 'repair'
    });
    const root = pullRequest();
    const candidate = pullRequest({
      number: 22,
      user: { login: 'github-actions[bot]', type: 'Bot' },
      head: {
        ref: entry.head_ref,
        sha: next,
        repo: { full_name: 'owner/repo' }
      },
      base: { ref: 'feature', sha: head, repo: { full_name: 'owner/repo' } }
    });
    const source = {
      id: 80,
      run_attempt: 1,
      workflow_id: 77,
      event: 'workflow_dispatch',
      head_branch: 'feature',
      head_sha: head,
      status: 'completed',
      conclusion: 'failure'
    };
    const sandbox = harness(root, {
      REPAIR_ROUND: '1',
      STATE_RUN_ID: '80',
      STATE_RUN_ATTEMPT: '1',
      STATE_ARTIFACT_ID: '501',
      STATE_PATH: 'prior-state.json'
    });
    sandbox.files.set('prior-state.json', JSON.stringify(state));
    sandbox.github.rest.pulls.get.mockImplementation(
      async ({ pull_number }) => ({
        data: pull_number === 11 ? root : candidate
      })
    );
    sandbox.github.request.mockImplementation(async (route) => ({
      data: route.includes('/attempts/') ? source : []
    }));
    sandbox.github.paginate.mockImplementation(async (method) =>
      typeof method === 'string' && method.endsWith('/jobs')
        ? [
            {
              name: 'Persist verified continuation and queue the next revision',
              status: 'completed',
              conclusion: 'success',
              run_id: 80,
              run_attempt: 1
            }
          ]
        : []
    );
    return { sandbox, state, root, candidate, source, entry };
  }

  it('validates the candidate while preserving the original feature checkpoint', async () => {
    const { sandbox } = continuation();
    await execute('context', sandbox);
    expect(sandbox.outputs).toMatchObject({
      head_sha: head,
      candidate_pr_number: '22',
      candidate_head_sha: next,
      candidate_base_sha: head,
      base_sha: base,
      has_repairs: 'true',
      pending_repairs: 'false'
    });
    expect(JSON.parse(sandbox.outputs.state).initial_head_sha).toBe(head);
  });

  it('loads final parent validation from the landing receipt without resetting its budget', async () => {
    const { sandbox, state, root } = continuation();
    const merged = 'd'.repeat(40);
    root.head.sha = merged;
    state.feature.head_sha = merged;
    state.repairs = [];
    state.round = 6;
    state.transition = 'landed';
    state.last_merge_sha = merged;
    sandbox.files.set('prior-state.json', JSON.stringify(state));
    sandbox.context.sha = merged;
    sandbox.process.env.EXPECTED_HEAD_SHA = merged;
    sandbox.process.env.REPAIR_ROUND = '6';
    await execute('context', sandbox);
    expect(sandbox.outputs).toMatchObject({
      head_sha: merged,
      candidate_head_sha: merged,
      has_repairs: 'false',
      repair_round: '6'
    });
    expect(JSON.parse(sandbox.outputs.state).initial_head_sha).toBe(head);
  });

  it.each([
    { workflow_id: 99 },
    { event: 'push' },
    { head_branch: 'another-feature' },
    { conclusion: 'cancelled' },
    { status: 'in_progress' },
    { run_attempt: 2 },
    { head_sha: base }
  ])('rejects a foreign or incomplete producer attempt: %j', async (change) => {
    const { sandbox, source } = continuation();
    Object.assign(source, change);
    await expect(execute('context', sandbox)).rejects.toThrow(
      'expected completed controller attempt'
    );
  });

  it('rejects missing state instead of discovering or adopting arbitrary repair PRs', async () => {
    const { sandbox } = continuation();
    sandbox.files.clear();
    await expect(execute('context', sandbox)).rejects.toThrow(
      'Missing fixture artifact'
    );
  });

  it('does not accept a code-check upload when the trusted producer failed', async () => {
    const { sandbox } = continuation();
    sandbox.github.paginate.mockResolvedValue([
      {
        name: 'Persist verified continuation and queue the next revision',
        status: 'completed',
        conclusion: 'failure'
      }
    ]);
    await expect(execute('context', sandbox)).rejects.toThrow(
      'successful trusted controller job'
    );
  });

  it('rejects a replacement artifact with the same name but a different ID', async () => {
    const { sandbox } = continuation();
    sandbox.github.rest.actions.getArtifact.mockResolvedValue({
      data: {
        id: 502,
        name: 'repair-state-1',
        expired: false,
        workflow_run: { id: 80, head_sha: head }
      }
    });
    await expect(execute('context', sandbox)).rejects.toThrow(
      'immutable artifact'
    );
  });

  it('requires the immutable upload ID before dispatching a continuation', async () => {
    const { state } = continuation();
    const sandbox = harness(undefined, {
      REGISTERED_STATE: JSON.stringify(state)
    });
    await execute('advance', sandbox);
    await expect(
      execute('advance', sandbox, pipeline, 'dispatch')
    ).rejects.toThrow('artifact ID is missing');
    expect(
      sandbox.github.rest.actions.createWorkflowDispatch
    ).not.toHaveBeenCalled();
  });

  it('rejects a manually reset budget on a continuation', async () => {
    const { sandbox } = continuation();
    sandbox.process.env.REPAIR_ROUND = '0';
    await expect(execute('context', sandbox)).rejects.toThrow('budget');
  });

  it('rejects a stale feature base even when the candidate is unchanged', async () => {
    const { sandbox, root } = continuation();
    root.base.sha = 'd'.repeat(40);
    await expect(execute('context', sandbox)).rejects.toThrow(
      'Stale or invalid feature snapshot'
    );
  });

  it('preserves externally changed or partially merged chains for manual handling', async () => {
    const { sandbox, candidate } = continuation();
    candidate.state = 'closed';
    candidate.merged = true;
    await expect(execute('context', sandbox)).rejects.toThrow(
      'preserve it for manual handling'
    );
    expect(
      sandbox.github.rest.actions.createWorkflowDispatch
    ).not.toHaveBeenCalled();
  });

  it('blocks an unrecognized competing repair above the known tip', async () => {
    const { sandbox, candidate } = continuation();
    const original = sandbox.github.paginate.getMockImplementation();
    sandbox.github.paginate.mockImplementation(async (method, options) =>
      options.base === candidate.head.ref
        ? [pullRequest({ number: 33, user: { login: 'github-actions[bot]' } })]
        : original(method, options)
    );
    await execute('context', sandbox);
    expect(sandbox.outputs.pending_repairs).toBe('true');
  });

  it.each(['lint', 'build', 'test', 'security', 'docs'])(
    'records %s as an additional repair PR, not a direct feature push',
    async (kind) => {
      const sandbox = harness(undefined, {
        REPAIR_PR: '22',
        REPAIR_REF: 'repair/layer',
        REPAIR_SHA: next,
        CHECK_ID: '44',
        KIND: kind
      });
      await execute('stage-repair', sandbox);
      const state = JSON.parse(sandbox.outputs.state);
      expect(state).toMatchObject({
        round: 1,
        initial_head_sha: head,
        feature: { head_sha: head },
        repairs: [
          {
            number: 22,
            head_sha: next,
            base_ref: 'feature',
            base_sha: head,
            kind,
            check_id: 44
          }
        ]
      });
      expect(sandbox.github.rest.pulls.merge).not.toHaveBeenCalled();
      expect(
        sandbox.github.rest.actions.createWorkflowDispatch
      ).not.toHaveBeenCalled();
    }
  );

  it('stages the next layer on the previous repair rather than on the feature', async () => {
    const { state } = continuation();
    const sandbox = harness(undefined, {
      STATE: JSON.stringify(state),
      REPAIR_PR: '23',
      REPAIR_REF: 'repair/tests',
      REPAIR_SHA: 'd'.repeat(40),
      CHECK_ID: '45',
      KIND: 'test'
    });
    await execute('stage-repair', sandbox);
    const staged = JSON.parse(sandbox.outputs.state);
    expect(staged.round).toBe(2);
    expect(staged.repairs[1]).toMatchObject({
      number: 23,
      base_ref: 'repair/lint',
      base_sha: next
    });
    expect(staged.feature.head_sha).toBe(head);
  });

  it('continues after verified registration without moving the feature branch', async () => {
    const registered = cycleState({
      round: 1,
      repairs: [
        {
          number: 22,
          head_ref: 'repair/lint',
          head_sha: next,
          base_ref: 'feature',
          base_sha: head,
          kind: 'lint',
          check_id: 44,
          validation_run_id: 123
        }
      ]
    });
    const sandbox = harness(undefined, {
      REGISTERED_STATE: JSON.stringify(registered)
    });
    await execute('advance', sandbox);
    const saved = JSON.parse(
      sandbox.files.get(join('state-output', 'state.json'))
    );
    expect(saved).toMatchObject({
      transition: 'repair',
      round: 1,
      source_run_id: 123,
      initial_head_sha: head
    });
    expect(saved.feature.head_sha).toBe(head);
    sandbox.process.env.STATE_ARTIFACT_ID = '501';
    await execute('advance', sandbox, pipeline, 'dispatch');
    expect(
      sandbox.github.rest.actions.createWorkflowDispatch
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        ref: 'feature',
        inputs: {
          pr_number: '11',
          expected_head_sha: head,
          repair_round: '1',
          state_run_id: '123',
          state_run_attempt: '1',
          state_artifact_id: '501'
        }
      })
    );
  });

  it('blocks metadata-only continuation if its audit comment fails', async () => {
    const sandbox = harness(pullRequest({ title: 'feat: repaired metadata' }), {
      REPAIR_KIND: 'metadata'
    });
    sandbox.github.rest.issues.createComment.mockRejectedValue(
      new Error('audit unavailable')
    );
    await expect(execute('advance', sandbox)).rejects.toThrow(
      'audit unavailable'
    );
    expect(sandbox.files.size).toBe(0);
  });
});

describe('immutable PR validation', () => {
  it('resolves the current head and base without a mutable checkout', async () => {
    const sandbox = harness();
    await execute('context', sandbox);
    expect(sandbox.outputs).toMatchObject({
      head_sha: head,
      base_sha: base,
      repair_round: '0',
      metadata_hash: metadataHash(pullRequest())
    });
  });

  it.each(['-1', '7', 'NaN', '1.5', '', ' 1 ', '1e0'])(
    'rejects invalid round %s',
    async (round) => {
      await expect(
        execute('context', harness(undefined, { REPAIR_ROUND: round }))
      ).rejects.toThrow('repair_round');
    }
  );

  it.each(['0', '-11', 'bad', '1.5'])(
    'rejects invalid PR number %s',
    async (number) => {
      await expect(
        execute('context', harness(undefined, { PR_NUMBER: number }))
      ).rejects.toThrow('PR number');
    }
  );

  it('rejects a newer head, even if the branch name still matches', async () => {
    const pr = pullRequest();
    pr.head.sha = next;
    await expect(execute('context', harness(pr))).rejects.toThrow(
      'Stale validation'
    );
  });

  it('stops if the parent is retargeted to another branch at the same commit', async () => {
    const pr = pullRequest();
    pr.base.ref = 'release';
    await expect(execute('advance', harness(pr))).rejects.toThrow(
      'base changed'
    );
  });

  it('rejects a fork and the default branch as repair targets', async () => {
    const fork = pullRequest();
    fork.head.repo.full_name = 'outsider/repo';
    await expect(execute('context', harness(fork))).rejects.toThrow(
      'same-repository'
    );
    const main = pullRequest();
    main.head.ref = 'main';
    await expect(execute('context', harness(main))).rejects.toThrow(
      'same-repository'
    );
  });

  it('does not certify a retargeted PR even when its base SHA is unchanged', async () => {
    const pr = pullRequest();
    pr.base.ref = 'release';
    await expect(
      execute('ready', harness(pr, { GATES: JSON.stringify(passingGates()) }))
    ).rejects.toThrow('changed during validation');
  });

  it('does not hide failed API requests', async () => {
    const sandbox = harness();
    sandbox.github.rest.pulls.get.mockRejectedValue(
      new Error('API unavailable')
    );
    await expect(execute('context', sandbox)).rejects.toThrow(
      'API unavailable'
    );
  });

  it('blocks handoff after metadata or base changes following readiness', async () => {
    const review = workflow('pr-review-dispatcher');
    const retargeted = pullRequest();
    retargeted.base.ref = 'release';
    for (const pr of [
      retargeted,
      pullRequest({ body: 'changed after readiness' })
    ]) {
      const sandbox = harness(pr);
      await expect(execute('review', sandbox, review)).rejects.toThrow(
        'changed after validation'
      );
      expect(sandbox.github.rest.pulls.requestReviewers).not.toHaveBeenCalled();
      expect(sandbox.github.graphql).not.toHaveBeenCalled();
    }
  });

  it('records open bot repairs without using labels as control state', async () => {
    const sandbox = harness();
    sandbox.github.paginate.mockImplementation(async (method) =>
      typeof method === 'string'
        ? []
        : [pullRequest({ number: 22, user: { login: 'github-actions[bot]' } })]
    );
    await execute('context', sandbox);
    expect(sandbox.outputs.pending_repairs).toBe('true');
  });
});

describe('dependent repair event routing', () => {
  const start = workflow('pr-start');

  it.each(['open', 'closed'])(
    'routes a human event for a %s bot repair without recursive automation',
    async (state) => {
      const parent = pullRequest();
      const repair = pullRequest({
        number: 22,
        state,
        user: { login: 'github-actions[bot]' },
        base: { ref: 'feature', sha: head }
      });
      const sandbox = harness(repair);
      sandbox.github.paginate.mockResolvedValue([parent]);
      await execute('start', sandbox, start);
      if (state === 'closed') {
        expect(
          sandbox.github.rest.actions.createWorkflowDispatch
        ).toHaveBeenCalledWith({
          ...repo,
          workflow_id: 'pr-pipeline.yml',
          ref: 'feature',
          inputs: {
            pr_number: '11',
            expected_head_sha: head,
            repair_round: '0'
          }
        });
      } else {
        expect(
          sandbox.github.rest.actions.createWorkflowDispatch
        ).not.toHaveBeenCalled();
      }
    }
  );
});

describe('bounded repair planning and revalidation', () => {
  it('selects one scoped failing gate without bundling unrelated repairs', async () => {
    const gates = passingGates();
    gates.lint = {
      result: 'failure',
      outputs: { findings: 'x'.repeat(10000) }
    };
    gates.build.result = 'skipped';
    gates.test = {
      result: 'failure',
      outputs: { findings: 'unrelated test detail' }
    };
    const sandbox = harness(undefined, { GATES: JSON.stringify(gates) });
    await execute('repair-plan', sandbox);
    expect(sandbox.outputs.needed).toBe('true');
    expect(sandbox.outputs.kind).toBe('lint');
    expect(sandbox.outputs.findings.length).toBeLessThan(6500);
    expect(sandbox.outputs.findings).not.toContain('unrelated test detail');
    expect(JSON.parse(sandbox.outputs.baseline).test).toBe('failure');
  });

  it.each(['6', '7'])(
    'never repairs after exhausted round %s',
    async (round) => {
      const gates = passingGates();
      gates.test.result = 'failure';
      const sandbox = harness(undefined, {
        GATES: JSON.stringify(gates),
        REPAIR_ROUND: round
      });
      await execute('repair-plan', sandbox);
      expect(sandbox.outputs.needed).toBe('false');
      sandbox.process.env.STATE = JSON.stringify(
        cycleState({ round: Number(round) })
      );
      await expect(execute('stage-repair', sandbox)).rejects.toThrow('budget');
      expect(
        sandbox.github.rest.actions.createWorkflowDispatch
      ).not.toHaveBeenCalled();
    }
  );

  it('does not auto-repair a cancelled run', async () => {
    const gates = passingGates();
    gates.test.result = 'failure';
    gates.security.result = 'cancelled';
    const sandbox = harness(undefined, { GATES: JSON.stringify(gates) });
    await execute('repair-plan', sandbox);
    expect(sandbox.outputs.needed).toBe('false');
  });

  it('does not create duplicate repairs while a previous repair remains open', async () => {
    const gates = passingGates();
    gates.test.result = 'failure';
    gates.context.outputs.pending_repairs = 'true';
    const sandbox = harness(undefined, { GATES: JSON.stringify(gates) });
    await execute('repair-plan', sandbox);
    expect(sandbox.outputs.needed).toBe('false');
  });

  it('stops on a successful agent with no actual changes', async () => {
    const sandbox = harness(undefined, { REPAIR_KIND: 'metadata' });
    await expect(execute('advance', sandbox)).rejects.toThrow(
      'no code or metadata progress'
    );
    expect(
      sandbox.github.rest.actions.createWorkflowDispatch
    ).not.toHaveBeenCalled();
  });

  it('revalidates a landed stack without resetting or incrementing the repair budget', async () => {
    const pr = pullRequest();
    const merged = 'd'.repeat(40);
    pr.head.sha = merged;
    const state = cycleState({
      round: 2,
      repairs: [{ number: 22, head_sha: next }]
    });
    const sandbox = harness(pr, {
      STATE: JSON.stringify(state),
      MERGED_SHA: merged
    });
    await execute('advance', sandbox);
    expect(
      sandbox.github.rest.actions.createWorkflowDispatch
    ).not.toHaveBeenCalled();
    const saved = JSON.parse(
      sandbox.files.get(join('state-output', 'state.json'))
    );
    expect(saved).toMatchObject({
      round: 2,
      repairs: [],
      stack_number: null,
      initial_head_sha: head,
      transition: 'landed'
    });
    sandbox.process.env.STATE_ARTIFACT_ID = '501';
    await execute('advance', sandbox, pipeline, 'dispatch');
    expect(
      sandbox.github.rest.actions.createWorkflowDispatch
    ).toHaveBeenNthCalledWith(1, {
      ...repo,
      workflow_id: 'agentic-workflows-compilation.yml',
      ref: 'feature',
      inputs: { pr_number: '11', expected_head_sha: merged }
    });
    expect(
      sandbox.github.rest.actions.createWorkflowDispatch
    ).toHaveBeenCalledTimes(2);
    expect(
      sandbox.github.rest.actions.createWorkflowDispatch
    ).toHaveBeenCalledWith({
      ...repo,
      workflow_id: 'pr-pipeline.yml',
      ref: 'feature',
      inputs: {
        pr_number: '11',
        expected_head_sha: merged,
        repair_round: '2',
        state_run_id: '123',
        state_run_attempt: '1',
        state_artifact_id: '501'
      }
    });
  });

  it('revalidates metadata-only fixes on the same SHA', async () => {
    const sandbox = harness(
      pullRequest({ title: 'feat: corrected metadata' }),
      { REPAIR_KIND: 'metadata' }
    );
    await execute('advance', sandbox);
    expect(sandbox.github.rest.issues.createComment).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining('Metadata-only repair')
      })
    );
    sandbox.process.env.STATE_ARTIFACT_ID = '501';
    await execute('advance', sandbox, pipeline, 'dispatch');
    expect(
      sandbox.github.rest.actions.createWorkflowDispatch
    ).toHaveBeenCalledOnce();
  });

  it('reports a failed post-landing framework dispatch instead of losing the required check', async () => {
    const sandbox = harness(undefined, { STATE_ARTIFACT_ID: '501' });
    sandbox.files.set(
      join('state-output', 'state.json'),
      JSON.stringify(cycleState({ transition: 'landed' }))
    );
    sandbox.github.rest.actions.createWorkflowDispatch.mockRejectedValueOnce(
      new Error('framework dispatch unavailable')
    );
    await expect(
      execute('advance', sandbox, pipeline, 'dispatch')
    ).rejects.toThrow('framework dispatch unavailable');
    expect(
      sandbox.github.rest.actions.createWorkflowDispatch
    ).toHaveBeenCalledOnce();
  });

  it('stops when the base changes during a repair', async () => {
    const pr = pullRequest();
    pr.base.sha = next;
    await expect(execute('advance', harness(pr))).rejects.toThrow(
      'base changed'
    );
  });
});

describe('authoritative readiness', () => {
  it('blocks readiness while an unrecognized native stack remains open', async () => {
    const gates = passingGates();
    gates.context.outputs.pending_repairs = 'true';
    await expect(
      execute('ready', harness(undefined, { GATES: JSON.stringify(gates) }))
    ).rejects.toThrow('native stacks still need attention');
  });
  it('cannot certify the feature using a passing but unmerged candidate', async () => {
    const sandbox = harness(undefined, {
      GATES: JSON.stringify(passingGates()),
      HAS_REPAIRS: 'true'
    });
    await expect(execute('ready', sandbox)).rejects.toThrow(
      'unmerged repair candidate'
    );
  });
  it('passes only when all gates and the live revision agree', async () => {
    const sandbox = harness(undefined, {
      GATES: JSON.stringify(passingGates())
    });
    await execute('ready', sandbox);
    expect(sandbox.core.summary.addRaw).toHaveBeenCalledWith(
      expect.stringContaining(head)
    );
  });

  it.each(['failure', 'skipped', 'cancelled', ''])(
    'blocks a %s security gate',
    async (result) => {
      const gates = passingGates();
      gates.security.result = result;
      await expect(
        execute('ready', harness(undefined, { GATES: JSON.stringify(gates) }))
      ).rejects.toThrow('Not ready');
    }
  );

  it('blocks missing gates rather than accepting incomplete evidence', async () => {
    const gates = passingGates();
    delete gates.docs;
    await expect(
      execute('ready', harness(undefined, { GATES: JSON.stringify(gates) }))
    ).rejects.toThrow('docs=missing');
  });

  it('rejects code or metadata updated after validation', async () => {
    const pr = pullRequest();
    pr.head.sha = next;
    await expect(
      execute('ready', harness(pr, { GATES: JSON.stringify(passingGates()) }))
    ).rejects.toThrow('changed during validation');
    await expect(
      execute(
        'ready',
        harness(pullRequest({ body: 'changed' }), {
          GATES: JSON.stringify(passingGates())
        })
      )
    ).rejects.toThrow('changed during validation');
  });
});

describe('human approval and native auto-merge', () => {
  const review = workflow('pr-review-dispatcher');
  const requiredRules = () => [
    {
      type: 'pull_request',
      ruleset_id: 1,
      parameters: {
        required_approving_review_count: 1,
        dismiss_stale_reviews_on_push: true,
        require_code_owner_review: true,
        require_last_push_approval: true
      }
    },
    {
      type: 'required_status_checks',
      ruleset_id: 1,
      parameters: {
        strict_required_status_checks_policy: true,
        required_status_checks: [
          { context: 'PR Quality / Ready for review' },
          { context: 'Framework CI / Required' }
        ]
      }
    }
  ];

  it('never merges by default or claims that a reviewer was requested', async () => {
    const sandbox = harness();
    await execute('review', sandbox, review);
    expect(sandbox.github.graphql).not.toHaveBeenCalled();
    expect(sandbox.github.rest.pulls.requestReviewers).not.toHaveBeenCalled();
    expect(sandbox.core.summary.addRaw).toHaveBeenCalledWith(
      expect.stringContaining('No explicit reviewers configured')
    );
  });

  it('fails auto-merge closed when human-review rules are absent', async () => {
    const sandbox = harness(undefined, { ENABLE_AUTO_MERGE: 'true' });
    await expect(execute('review', sandbox, review)).rejects.toThrow(
      'fresh human approval'
    );
    expect(sandbox.github.graphql).not.toHaveBeenCalled();
  });

  it('propagates reviewer request errors', async () => {
    const sandbox = harness(undefined, { REVIEWERS: 'maintainer' });
    sandbox.github.rest.pulls.requestReviewers.mockRejectedValue(
      new Error('permission denied')
    );
    await expect(execute('review', sandbox, review)).rejects.toThrow(
      'permission denied'
    );
  });

  it('does not mark drafts ready or enable auto-merge', async () => {
    const sandbox = harness(pullRequest({ draft: true }), {
      ENABLE_AUTO_MERGE: 'true'
    });
    await execute('review', sandbox, review);
    expect(sandbox.github.graphql).not.toHaveBeenCalled();
    expect(sandbox.github.paginate).not.toHaveBeenCalled();
  });

  it('enables native auto-merge only behind enforced approval and checks', async () => {
    const sandbox = harness(undefined, { ENABLE_AUTO_MERGE: 'true' });
    sandbox.github.paginate.mockResolvedValue(requiredRules());
    sandbox.github.request.mockResolvedValue({
      data: { enforcement: 'active', bypass_actors: [] }
    });
    await execute('review', sandbox, review);
    expect(sandbox.github.graphql).toHaveBeenCalledWith(
      expect.stringContaining('enablePullRequestAutoMerge'),
      expect.any(Object)
    );
  });

  it.each(['code-owner review', 'framework check', 'application check'])(
    'rejects auto-merge without %s',
    async (missing) => {
      const rules = requiredRules();
      if (missing === 'code-owner review') {
        rules[0].parameters.require_code_owner_review = false;
      } else {
        const name =
          missing === 'framework check'
            ? 'Framework CI / Required'
            : 'PR Quality / Ready for review';
        rules[1].parameters.required_status_checks =
          rules[1].parameters.required_status_checks.filter(
            (check) => check.context !== name
          );
      }
      const sandbox = harness(undefined, { ENABLE_AUTO_MERGE: 'true' });
      sandbox.github.paginate.mockResolvedValue(rules);
      await expect(execute('review', sandbox, review)).rejects.toThrow(
        'Auto-merge requires'
      );
      expect(sandbox.github.graphql).not.toHaveBeenCalled();
    }
  );

  it('checks enforcement when required checks come from separate rulesets', async () => {
    const rules = requiredRules();
    rules.push({
      ...rules[1],
      ruleset_id: 2,
      parameters: {
        strict_required_status_checks_policy: true,
        required_status_checks: [{ context: 'Framework CI / Required' }]
      }
    });
    rules[1].parameters.required_status_checks.pop();
    const sandbox = harness(undefined, { ENABLE_AUTO_MERGE: 'true' });
    sandbox.github.paginate.mockResolvedValue(rules);
    sandbox.github.request.mockImplementation(
      async (_route, { ruleset_id }) => ({
        data: {
          enforcement: ruleset_id === 2 ? 'evaluate' : 'active',
          bypass_actors: []
        }
      })
    );
    await expect(execute('review', sandbox, review)).rejects.toThrow(
      'no bypass actors'
    );
    expect(sandbox.github.graphql).not.toHaveBeenCalled();
  });
  it.each([
    { enforcement: 'disabled', bypass_actors: [] },
    { enforcement: 'evaluate', bypass_actors: [] },
    {
      enforcement: 'active',
      bypass_actors: [{ actor_type: 'Integration', actor_id: 1 }]
    },
    { enforcement: 'active' }
  ])('rejects unenforced or bypassable policy: %j', async (policy) => {
    const sandbox = harness(undefined, { ENABLE_AUTO_MERGE: 'true' });
    sandbox.github.paginate.mockResolvedValue(requiredRules());
    sandbox.github.request.mockResolvedValue({ data: policy });
    await expect(execute('review', sandbox, review)).rejects.toThrow(
      'no bypass actors'
    );
    expect(sandbox.github.graphql).not.toHaveBeenCalled();
  });

  it('does not enable auto-merge after a concurrent PR change', async () => {
    const sandbox = harness(undefined, { ENABLE_AUTO_MERGE: 'true' });
    sandbox.github.paginate.mockResolvedValue(requiredRules());
    sandbox.github.request.mockResolvedValue({
      data: { enforcement: 'active', bypass_actors: [] }
    });
    const updated = pullRequest();
    updated.head.sha = next;
    sandbox.github.rest.pulls.get
      .mockResolvedValueOnce({ data: pullRequest() })
      .mockResolvedValueOnce({ data: updated });
    await expect(execute('review', sandbox, review)).rejects.toThrow(
      'changed while checking'
    );
    expect(sandbox.github.graphql).not.toHaveBeenCalled();
  });

  it('does not silently fall back when native auto-merge fails', async () => {
    const sandbox = harness(undefined, { ENABLE_AUTO_MERGE: 'true' });
    sandbox.github.paginate.mockResolvedValue(requiredRules());
    sandbox.github.request.mockResolvedValue({
      data: { enforcement: 'active', bypass_actors: [] }
    });
    sandbox.github.graphql.mockRejectedValue(new Error('auto-merge forbidden'));
    await expect(execute('review', sandbox, review)).rejects.toThrow(
      'auto-merge forbidden'
    );
    expect(sandbox.core.summary.write).not.toHaveBeenCalled();
  });
});

describe('native workflow structure', () => {
  it('keeps framework CI outside application scheduling and readiness', () => {
    expect(pipeline.jobs.compile).toBeUndefined();
    expect(pipeline.jobs.metadata.needs).toBe('context');
    for (const job of Object.values(pipeline.jobs)) {
      expect([job.needs].flat()).not.toContain('compile');
      expect(job.uses || '').not.toContain('agentic-workflows-compilation');
    }
    const status = workflow('pr-status');
    expect(status.jobs.labels.steps[0].with.script).not.toContain(
      'workflow-compilation-failed'
    );
  });

  it('uses the same separate PR path for lint and every other file repair', () => {
    expect(pipeline.jobs.repair.if).toContain(
      "needs.repair-plan.outputs.needed == 'true'"
    );
    expect(pipeline.jobs['validate-repair'].if).toContain("kind != 'metadata'");
    expect(pipeline.jobs.repair.with.head_ref).toBe(
      '${{ needs.context.outputs.candidate_head_ref }}'
    );
    expect(pipeline.jobs.repair.with.feature_pr_number).toBe(
      '${{ needs.context.outputs.pr_number }}'
    );
    expect(pipeline.jobs.land.needs).toEqual(['context', 'candidate-check']);
    expect(pipeline.jobs.land.if).toContain(
      "needs.candidate-check.result == 'success'"
    );
    expect(pipeline.jobs['register-stack'].needs).toBe('stage-repair');
    expect(
      pipeline.jobs.advance.steps.map((step) => step.id || step.uses)
    ).toEqual(['progress', 'state-artifact', 'dispatch']);
  });
  it('never runs a skipped readiness check on the PR event bootstrap', () => {
    expect(pipeline.on.pull_request).toBeUndefined();
    expect(workflow('pr-start').jobs.ready).toBeUndefined();
    expect(pipeline.jobs.ready.if).toContain('always()');
    expect(pipeline.jobs.ready.name).toBe('PR Quality / Ready for review');
  });

  it('uses native reusable repairs instead of the deleted helper and stacked merger', () => {
    expect(pipeline.jobs.repair.uses).toBe(
      './.github/workflows/pr-repair.lock.yml'
    );
    expect(existsSync('.github/scripts/remediation.cjs')).toBe(false);
    expect(existsSync('.github/workflows/pr-stacked-merge.yml')).toBe(false);
    expect(pipeline.jobs.advance.if).toContain(
      "needs.repair.result == 'success'"
    );
  });

  it('passes each project check only the immutable inputs it needs', () => {
    for (const gate of [
      'metadata',
      'lint',
      'build',
      'test',
      'security',
      'docs'
    ]) {
      expect(pipeline.jobs[gate].with.head_sha).toBe(
        gate === 'metadata'
          ? '${{ needs.context.outputs.head_sha }}'
          : '${{ needs.context.outputs.candidate_head_sha }}'
      );
      if (!['lint', 'build', 'test'].includes(gate)) {
        expect(pipeline.jobs[gate].with.base_sha).toBe(
          gate === 'docs'
            ? '${{ needs.context.outputs.candidate_base_sha }}'
            : '${{ needs.context.outputs.base_sha }}'
        );
      } else {
        expect(Object.keys(pipeline.jobs[gate].with)).toEqual(['head_sha']);
      }
    }
  });

  it('does not give normal lint, build, or test jobs repository write permissions', () => {
    expect(pipeline.permissions).toEqual({ contents: 'read' });
    for (const gate of ['lint', 'build', 'test']) {
      expect(pipeline.jobs[gate].permissions).toBeUndefined();
    }
  });

  it('pins compilation and never auto-pushes workflow edits', () => {
    const compilation = readFileSync(
      '.github/workflows/agentic-workflows-compilation.yml',
      'utf8'
    );
    expect(compilation).toContain('--pin v0.89.21');
    expect(compilation).not.toMatch(/git push|gh pr create|curl.*bash/);
  });

  it('pins the patched secret scanner and enables only Gitleaks', () => {
    const scan = workflow('pr-security').jobs['secret-scan'].steps.find(
      (step) => step.name === 'Scan Checked-Out Files for Secrets'
    );
    expect(scan.uses).toBe(
      'super-linter/super-linter/slim@47984f49b4e87383eed97890fe2dca6063bbd9c3'
    );
    expect(scan.env).toEqual({
      RUN_LOCAL: true,
      VALIDATE_ALL_CODEBASE: true,
      VALIDATE_GITLEAKS: true
    });
  });

  it.each(['pr-gatekeeper', 'pr-lint', 'pr-build', 'pr-test', 'pr-security'])(
    '%s exposes findings without dispatch or coordination helpers',
    (name) => {
      const gate = workflow(name);
      for (const input of Object.keys(gate.on.workflow_call.inputs)) {
        expect(gate.on.workflow_call.inputs[input]).toEqual({
          required: true,
          type: 'string'
        });
      }
      expect(gate.on.workflow_call.outputs.findings.value).toBeTruthy();
      const source = readFileSync(`.github/workflows/${name}.yml`, 'utf8');
      expect(source).not.toMatch(
        /remediation\.cjs|createWorkflowDispatch|addLabels|removeLabel/
      );
      for (const job of Object.values(gate.jobs)) {
        for (const permission of Object.values(
          job.permissions || gate.permissions || {}
        )) {
          expect(permission).not.toBe('write');
        }
        for (const step of job.steps || []) {
          if (step.uses?.startsWith('actions/checkout@')) {
            expect(step.with.ref).toBe('${{ inputs.head_sha }}');
            expect(step.with['persist-credentials']).toBe(false);
          }
        }
      }
    }
  );

  it('consumes a native repair PR identity rather than a direct push', () => {
    const repair = workflow('pr-repair.lock');
    expect(repair.on.workflow_call.outputs.created_pr_number).toBeDefined();
    expect(pipeline.jobs['validate-repair'].with.repair_pr_number).toBe(
      '${{ needs.repair.outputs.created_pr_number }}'
    );
  });

  it('keeps workspace commands independent of the sample app and coverage policy', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(manifest.private).toBe(true);
    expect(manifest.workspaces).toEqual(['apps/*']);
    expect(manifest.scripts['test:ci']).toBe(
      'npm run test:framework && npm run test:ci:apps --'
    );
    expect(manifest.scripts.build).toBe('npm run build --workspaces --');
    expect(manifest.scripts.lint).toBe(
      'npm run lint:framework && npm run lint:apps --'
    );
    for (const command of [
      'dev',
      'preview',
      'test:apps',
      'test:ci:apps',
      'lint:apps',
      'lint:fix'
    ]) {
      expect(manifest.scripts[command]).toMatch(/--workspaces --$/);
    }
    expect(Object.values(manifest.scripts).join('\n')).not.toMatch(
      /--if-present|ferret-heist/
    );
    expect(testConfig.test.passWithNoTests).toBe(false);
    expect(testConfig.test.include).toEqual(['tests/framework/**/*.test.js']);
    expect(testConfig.test.coverage).toBeUndefined();
    for (const [name, command] of [
      ['pr-lint', 'lint:apps'],
      ['pr-build', 'build'],
      ['pr-test', 'test:ci:apps']
    ]) {
      const source = readFileSync(`.github/workflows/${name}.yml`, 'utf8');
      expect(source).toContain(`npm run ${command}`);
      expect(source).not.toMatch(
        /pytest|cargo|gradle|dotnet|composer|junit|cobertura|numPassedTests/
      );
    }
  });

  it('grants every reusable job the permissions its compiled children require', () => {
    const rank = { none: 0, read: 1, write: 2 };
    function checkCalls(definition, inherited, trail) {
      for (const [name, job] of Object.entries(definition.jobs)) {
        const available =
          job.permissions || definition.permissions || inherited;
        if (inherited) {
          for (const [scope, level] of Object.entries(available)) {
            expect(
              rank[level],
              `${trail}/${name} requests ${scope}:${level}`
            ).toBeLessThanOrEqual(rank[inherited[scope] || 'none']);
          }
        }
        if (job.uses?.startsWith('./.github/workflows/')) {
          const child = yaml.load(readFileSync(job.uses, 'utf8'));
          checkCalls(child, available, `${trail}/${name}`);
        }
      }
    }
    checkCalls(pipeline, undefined, 'pipeline');
  });
});

describe('revision-scoped documentation gate', () => {
  const docs = workflow('pr-docs');
  const assessment = (overrides = {}) =>
    JSON.stringify({
      version: 2,
      pr_number: '11',
      head_sha: head,
      base_sha: base,
      comparison_base_sha: base,
      decision: 'sufficient',
      findings: 'The application guide documents the changed behavior.',
      ...overrides
    });

  function docHarness(overrides = {}) {
    const sandbox = harness(undefined, {
      ASSESS_RESULT: 'success',
      ASSESSMENT: assessment(),
      DOWNLOAD_RESULT: 'success',
      ...overrides
    });
    sandbox.require = (name) =>
      name === 'node:fs'
        ? { readFileSync: () => sandbox.process.env.ASSESSMENT }
        : require(name);
    return sandbox;
  }

  it.each(['not_needed', 'sufficient'])(
    'accepts an explicit %s decision for the current revision',
    async (decision) => {
      const sandbox = docHarness({ ASSESSMENT: assessment({ decision }) });
      await execute('verdict', sandbox, docs);
      expect(sandbox.outputs.findings).toContain('application guide');
    }
  );

  it.each([
    { head_sha: next },
    { base_sha: next },
    { decision: 'unknown' },
    { version: 1 },
    { pr_number: '12' },
    { findings: '' },
    { findings: ' ' },
    { findings: 42 }
  ])('rejects stale or invalid assessments: %j', async (overrides) => {
    await expect(
      execute(
        'verdict',
        docHarness({ ASSESSMENT: assessment(overrides) }),
        docs
      )
    ).rejects.toThrow('Invalid or stale');
  });

  it.each(['missing', 'uncertain'])(
    'blocks the agent decision %s with actionable findings',
    async (decision) => {
      const sandbox = docHarness({
        ASSESSMENT: assessment({
          decision,
          findings: 'Document streak expiration and the stealth bonus.'
        })
      });
      await expect(execute('verdict', sandbox, docs)).rejects.toThrow(
        'Document streak expiration'
      );
      expect(sandbox.outputs.findings).toContain('stealth bonus');
    }
  );

  it.each(['failure', 'cancelled', 'skipped'])(
    'rejects a %s assessor regardless of its output',
    async (result) => {
      await expect(
        execute('verdict', docHarness({ ASSESS_RESULT: result }), docs)
      ).rejects.toThrow('successful agent');
    }
  );

  it('fails on missing outputs instead of reusing a label waiver', async () => {
    await expect(
      execute('verdict', docHarness({ ASSESSMENT: '' }), docs)
    ).rejects.toThrow();
    const contents = readFileSync('.github/workflows/pr-docs.yml', 'utf8');
    expect(contents).not.toContain('docs-not-required');
    expect(contents).not.toContain('getLabels');
  });

  it('fails if no artifact was published, even after a successful agent job', async () => {
    await expect(
      execute('verdict', docHarness({ DOWNLOAD_RESULT: 'failure' }), docs)
    ).rejects.toThrow('assessment artifact');
  });

  it('delegates documentation need to the agent without deterministic file eligibility', () => {
    expect(docs.jobs.scope).toBeUndefined();
    expect(docs.jobs.assess.if).toBeUndefined();
    const source = readFileSync('.github/workflows/pr-doc-review.md', 'utf8');
    const frontmatter = yaml.load(source.split('---')[1]);
    expect(frontmatter.on.workflow_call.inputs.findings).toBeUndefined();
    expect(frontmatter['pre-agent-steps'][0].run).not.toContain(
      'map(select(test('
    );
    expect(
      frontmatter['safe-outputs'].jobs.docs_assessment.inputs.decision.options
    ).toEqual(['not_needed', 'sufficient', 'missing', 'uncertain']);
  });
});

describe('scoped stacked repair safety', () => {
  const validation = workflow('pr-validate-repair');
  const mergedSha = 'd'.repeat(40);

  function attempt(
    kind = 'test',
    files = [
      {
        filename: 'apps/sample/tests/streak.test.js',
        status: 'modified',
        changes: 2
      }
    ]
  ) {
    const parent = pullRequest();
    const repair = pullRequest({
      number: 22,
      user: { login: 'github-actions[bot]', type: 'Bot' },
      head: {
        sha: next,
        ref: 'gh-aw/repair-22',
        repo: { full_name: 'owner/repo' }
      },
      base: { sha: head, ref: 'feature', repo: { full_name: 'owner/repo' } }
    });
    const baseline = {
      lint: 'success',
      build: 'success',
      test: 'failure',
      security: 'failure',
      docs: 'failure'
    };
    const sandbox = harness(parent, {
      PARENT_PR: '11',
      PARENT_REF: 'feature',
      PARENT_SHA: head,
      BASE_SHA: base,
      REPAIR_PR: '22',
      REPAIR_SHA: next,
      REPAIR_REF: repair.head.ref,
      KIND: kind,
      BASELINE: JSON.stringify(baseline)
    });
    sandbox.github.rest.pulls.get.mockImplementation(
      async ({ pull_number }) => ({
        data: pull_number === 11 ? parent : repair
      })
    );
    sandbox.github.paginate.mockImplementation(async (method) =>
      method === sandbox.github.rest.pulls.listFiles ? files : []
    );
    sandbox.github.request.mockImplementation(async (route) => {
      if (route.includes('/stacks')) return { data: [] };
      if (route.includes('/compare/'))
        return { data: { status: 'ahead', merge_base_commit: { sha: head } } };
      throw new Error(`Unexpected request: ${route}`);
    });
    return { sandbox, parent, repair };
  }

  it('requires the selected gate and every previously passing project check', async () => {
    const { sandbox } = attempt();
    await execute('inspect', sandbox, validation);
    expect(sandbox.outputs).toMatchObject({
      head_sha: next,
      lint: 'true',
      build: 'true',
      test: 'true',
      security: 'false',
      docs: 'false'
    });
  });

  it('validates a higher layer against the candidate tip while binding the original feature', async () => {
    const { sandbox, parent: root } = attempt();
    const candidate = pullRequest({
      number: 22,
      user: { login: 'github-actions[bot]', type: 'Bot' },
      head: {
        ref: 'repair/lint',
        sha: next,
        repo: { full_name: 'owner/repo' }
      },
      base: { ref: 'feature', sha: head, repo: { full_name: 'owner/repo' } }
    });
    const child = pullRequest({
      number: 23,
      user: { login: 'github-actions[bot]', type: 'Bot' },
      head: {
        ref: 'repair/tests',
        sha: mergedSha,
        repo: { full_name: 'owner/repo' }
      },
      base: {
        ref: candidate.head.ref,
        sha: next,
        repo: { full_name: 'owner/repo' }
      }
    });
    const entry = {
      number: 22,
      head_ref: candidate.head.ref,
      head_sha: next,
      base_ref: 'feature',
      base_sha: head,
      kind: 'lint',
      check_id: 44,
      validation_run_id: 80
    };
    Object.assign(sandbox.process.env, {
      STATE: JSON.stringify(cycleState({ round: 1, repairs: [entry] })),
      PARENT_PR: '22',
      PARENT_REF: candidate.head.ref,
      PARENT_SHA: next,
      BASE_REF: 'feature',
      BASE_SHA: head,
      REPAIR_PR: '23'
    });
    sandbox.github.rest.pulls.get.mockImplementation(
      async ({ pull_number }) => ({
        data: { 11: root, 22: candidate, 23: child }[pull_number]
      })
    );
    sandbox.github.request.mockImplementation(async (route) => ({
      data: route.includes('/compare/')
        ? { status: 'ahead', merge_base_commit: { sha: next } }
        : []
    }));
    await execute('inspect', sandbox, validation);
    expect(sandbox.outputs.head_sha).toBe(mergedSha);
    expect(sandbox.outputs.test).toBe('true');
  });

  it('does not treat a repair label as trusted provenance', async () => {
    const { sandbox, repair } = attempt();
    repair.user = { login: 'someone', type: 'User' };
    repair.labels = [{ name: 'automated-repair' }];
    await expect(execute('inspect', sandbox, validation)).rejects.toThrow(
      'provenance'
    );
    expect(sandbox.github.rest.pulls.merge).not.toHaveBeenCalled();
  });

  it.each([
    '.github/workflows/pr-pipeline.yml',
    'vitest.config.js',
    'tests/framework/workflows.test.js',
    'apps/game/package.json',
    'apps/game/AGENTS.md',
    'apps/game/.env'
  ])('rejects protected repair path %s', async (filename) => {
    const { sandbox } = attempt('test', [
      { filename, status: 'modified', changes: 1 }
    ]);
    await expect(execute('inspect', sandbox, validation)).rejects.toThrow(
      'out-of-scope'
    );
  });

  it('rejects production changes in a documentation repair', async () => {
    const { sandbox } = attempt('docs', [
      { filename: 'apps/game/main.js', status: 'modified', changes: 1 }
    ]);
    await expect(execute('inspect', sandbox, validation)).rejects.toThrow(
      'out-of-scope'
    );
  });

  it('rejects deleted tests instead of allowing an easier green result', async () => {
    const { sandbox } = attempt('test', [
      {
        filename: 'apps/sample/tests/streak.test.js',
        status: 'removed',
        changes: 20
      }
    ]);
    await expect(execute('inspect', sandbox, validation)).rejects.toThrow(
      'out-of-scope'
    );
  });

  it('rejects renaming a failing test out of test discovery', async () => {
    const { sandbox } = attempt('test', [
      {
        filename: 'apps/game/helper.js',
        previous_filename: 'apps/sample/tests/streak.test.js',
        status: 'renamed',
        changes: 0
      }
    ]);
    await expect(execute('inspect', sandbox, validation)).rejects.toThrow(
      'out-of-scope'
    );
  });

  it('rejects policy changes disguised as a dependency repair', async () => {
    const { sandbox } = attempt('security', [
      { filename: 'package.json', status: 'modified', changes: 2 }
    ]);
    sandbox.github.rest.repos.getContent.mockImplementation(
      async ({ ref }) => ({
        data: {
          type: 'file',
          encoding: 'base64',
          size: 100,
          content: Buffer.from(
            JSON.stringify({
              scripts: { test: ref === head ? 'vitest run' : 'exit 0' },
              dependencies: { example: ref === head ? '1.0.0' : '1.0.1' }
            })
          ).toString('base64')
        }
      })
    );
    await expect(execute('inspect', sandbox, validation)).rejects.toThrow(
      'package scripts'
    );
  });

  it.each([
    { files: [] },
    {
      files: Array.from({ length: 21 }, (_, index) => ({
        filename: `apps/sample/tests/${index}.test.js`,
        status: 'added',
        changes: 1
      }))
    },
    {
      files: [
        {
          filename: 'apps/sample/tests/streak.test.js',
          status: 'modified',
          changes: 257
        }
      ]
    }
  ])('rejects empty or oversized repairs', async ({ files }) => {
    const { sandbox } = attempt('test', files);
    await expect(execute('inspect', sandbox, validation)).rejects.toThrow(
      'bounded change'
    );
  });

  it('requires a newly published layer to be standalone before registration', async () => {
    const { sandbox } = attempt();
    sandbox.github.request.mockResolvedValue({ data: [{ number: 1 }] });
    await expect(execute('inspect', sandbox, validation)).rejects.toThrow(
      'standalone'
    );
    expect(sandbox.github.rest.pulls.merge).not.toHaveBeenCalled();
  });

  it.each([null, {}, { stacks: null }])(
    'rejects unknown native stack responses',
    async (data) => {
      const { sandbox } = attempt();
      sandbox.github.request.mockResolvedValue({ data });
      await expect(execute('inspect', sandbox, validation)).rejects.toThrow(
        'standalone'
      );
    }
  );

  it.each(['cancelled', ''])(
    'rejects incomplete baseline result %s',
    async (result) => {
      const { sandbox } = attempt();
      const baseline = JSON.parse(sandbox.process.env.BASELINE);
      baseline.security = result;
      sandbox.process.env.BASELINE = JSON.stringify(baseline);
      await expect(execute('inspect', sandbox, validation)).rejects.toThrow(
        'Incomplete or cancelled baseline'
      );
    }
  );

  it('accepts the exact file and changed-line bounds', async () => {
    const files = Array.from({ length: 20 }, (_, index) => ({
      filename: `apps/sample/tests/${index}.test.js`,
      status: 'modified',
      changes: index === 0 ? 9 : 13
    }));
    const { sandbox } = attempt('test', files);
    await execute('inspect', sandbox, validation);
    expect(sandbox.outputs.head_sha).toBe(next);
  });

  it('refuses a moved parent before validation', async () => {
    const { sandbox, parent } = attempt();
    parent.head.sha = mergedSha;
    await expect(execute('inspect', sandbox, validation)).rejects.toThrow(
      'Feature snapshot changed'
    );
  });

  it('creates a failing native check when a required repair check is skipped', async () => {
    const { sandbox } = attempt();
    sandbox.process.env.HEAD_SHA = next;
    sandbox.process.env.RESULTS = JSON.stringify({
      inspect: {
        outputs: {
          lint: 'true',
          build: 'true',
          test: 'true',
          security: 'false',
          docs: 'false'
        }
      },
      lint: { result: 'success' },
      build: { result: 'success' },
      test: { result: 'skipped' }
    });
    await expect(execute('verdict', sandbox, validation)).rejects.toThrow(
      'Repair blocked'
    );
    expect(sandbox.github.rest.checks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        head_sha: next,
        conclusion: 'failure'
      })
    );
  });

  it('publishes scoped evidence without merging or clearing feature labels', async () => {
    const { sandbox } = attempt();
    sandbox.process.env.HEAD_SHA = next;
    sandbox.process.env.RESULTS = JSON.stringify({
      inspect: {
        outputs: {
          lint: 'true',
          build: 'true',
          test: 'true',
          security: 'false',
          docs: 'false'
        }
      },
      lint: { result: 'success' },
      build: { result: 'success' },
      test: { result: 'success' }
    });
    await execute('verdict', sandbox, validation);
    expect(sandbox.outputs.check_id).toBe('123');
    expect(validation.jobs.merge).toBeUndefined();
    expect(sandbox.github.rest.pulls.merge).not.toHaveBeenCalled();
    expect(sandbox.github.rest.issues.createComment).not.toHaveBeenCalled();
    expect(sandbox.github.rest.issues.removeLabel).not.toHaveBeenCalled();
  });
});

describe('failure labels are visibility, not control', () => {
  const status = workflow('pr-status');

  it('adds candidate failures but cannot clear labels from candidate-only successes', async () => {
    const gates = passingGates();
    gates.docs.result = 'failure';
    const sandbox = harness(
      pullRequest({ labels: [{ name: 'lint-failed' }] }),
      {
        GATES: JSON.stringify(gates),
        ALLOW_CLEAR: 'false'
      }
    );
    await execute('labels', sandbox, status);
    expect(sandbox.github.rest.issues.addLabels).toHaveBeenCalledWith(
      expect.objectContaining({ labels: ['docs-required'] })
    );
    expect(sandbox.github.rest.issues.removeLabel).not.toHaveBeenCalled();
  });
  it('adds failed tags and clears only current successful checks', async () => {
    const pr = pullRequest({
      labels: [
        { name: 'needs-metadata' },
        { name: 'docs-required' },
        { name: 'lint-failed' }
      ]
    });
    const gates = passingGates();
    gates.test.result = 'failure';
    gates.docs.result = 'skipped';
    gates.lint.result = 'cancelled';
    const sandbox = harness(pr, { GATES: JSON.stringify(gates) });
    await execute('labels', sandbox, status);
    expect(sandbox.github.rest.issues.addLabels).toHaveBeenCalledWith(
      expect.objectContaining({
        labels: ['test-required']
      })
    );
    expect(sandbox.github.rest.issues.removeLabel).toHaveBeenCalledTimes(1);
    expect(sandbox.github.rest.issues.removeLabel).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'needs-metadata'
      })
    );
  });

  it('never changes tags using results from an older commit', async () => {
    const pr = pullRequest();
    pr.head.sha = next;
    const sandbox = harness(pr, { GATES: JSON.stringify(passingGates()) });
    await execute('labels', sandbox, status);
    expect(sandbox.github.rest.issues.addLabels).not.toHaveBeenCalled();
    expect(sandbox.github.rest.issues.removeLabel).not.toHaveBeenCalled();
  });

  it('preserves a security alert until that scanner actually succeeds', async () => {
    const gates = passingGates();
    gates.security = {
      result: 'failure',
      outputs: {
        codeql_result: 'failure',
        dependency_result: 'success',
        secret_result: 'skipped'
      }
    };
    const pr = pullRequest({
      labels: [{ name: 'dependency-alert' }, { name: 'secret-alert' }]
    });
    const sandbox = harness(pr, { GATES: JSON.stringify(gates) });
    await execute('labels', sandbox, status);
    expect(sandbox.github.rest.issues.addLabels).toHaveBeenCalledWith(
      expect.objectContaining({
        labels: ['security-failed', 'codeql-alert']
      })
    );
    expect(sandbox.github.rest.issues.removeLabel).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'dependency-alert'
      })
    );
    expect(sandbox.github.rest.issues.removeLabel).not.toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'secret-alert'
      })
    );
  });

  it('tolerates a label created concurrently by another PR run', async () => {
    const gates = passingGates();
    gates.test.result = 'failure';
    const sandbox = harness(undefined, { GATES: JSON.stringify(gates) });
    sandbox.github.rest.issues.getLabel.mockRejectedValue({ status: 404 });
    sandbox.github.rest.issues.createLabel.mockRejectedValue({
      status: 422,
      response: { data: { errors: [{ code: 'already_exists' }] } }
    });
    await execute('labels', sandbox, status);
    expect(sandbox.github.rest.issues.addLabels).toHaveBeenCalledWith(
      expect.objectContaining({ labels: ['test-required'] })
    );
  });

  it('does not hide label publication permission failures', async () => {
    const gates = passingGates();
    gates.test.result = 'failure';
    const sandbox = harness(undefined, { GATES: JSON.stringify(gates) });
    sandbox.github.rest.issues.getLabel.mockRejectedValue({ status: 404 });
    sandbox.github.rest.issues.createLabel.mockRejectedValue(
      new Error('permission denied')
    );
    await expect(execute('labels', sandbox, status)).rejects.toThrow(
      'permission denied'
    );
  });
});
