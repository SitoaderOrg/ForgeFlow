import { describe, expect, it } from 'vitest';
import {
  createCore,
  createGitHub,
  DEFAULT_BRANCH,
  listWorkflowFiles,
  loadAgentBody,
  loadAgentFrontmatter,
  loadWorkflow,
  quality,
  readWorkflow,
  runScript
} from './helpers/harness.js';

// Contract tests for the gh-aw remediation agents (Repair stage): what they may do,
// that they stay declarative (natural-language prompt + gh-aw features, no scripts),
// how they hand off to the relay, and that compiled lock files match their sources.

const AGENTS = listWorkflowFiles((f) => f.endsWith('.md'));
const GATE_LABELS = [
  'needs-metadata',
  'lint-failed',
  'build-failed',
  'test-required',
  'docs-required',
  'codeql-alert',
  'dependency-alert',
  'security-alert'
];
const STACKED_LABELS = [
  'lint-remediation',
  'test-remediation',
  'security-remediation',
  'doc-remediation'
];

const lockFile = (md) => md.replace(/\.md$/, '.lock.yml');

// Escapes all regex metacharacters (including backslashes) so arbitrary
// strings can be safely embedded in a `new RegExp(...)` pattern.
const escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Shared import whose conclusion-job step hands every agent run off to the relay.
const HANDOFF = 'shared/remediation-handoff.md';
const HANDOFF_STEP = 'Hand off to the remediation relay';
const handoffJob = loadAgentFrontmatter(HANDOFF).jobs.conclusion;
const handoffStep = handoffJob['pre-steps'].find(
  (s) => s.name === HANDOFF_STEP
);

function findEnv(node, key) {
  if (!node || typeof node !== 'object') return undefined;
  if (typeof node[key] === 'string') return node[key];
  for (const value of Object.values(node)) {
    const found = findEnv(value, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

function lockSafeOutputs(md) {
  const raw = findEnv(loadWorkflow(lockFile(md)), 'GH_AW_SAFE_OUTPUTS_CONFIG');
  if (!raw) throw new Error(`No GH_AW_SAFE_OUTPUTS_CONFIG in ${lockFile(md)}`);
  return JSON.parse(raw);
}

it('the agent list matches REMEDIATION_WORKFLOWS used by the relay', () => {
  expect(AGENTS.map(lockFile).sort()).toEqual(
    [...quality.REMEDIATION_WORKFLOWS].sort()
  );
});

describe.each(AGENTS)('%s', (md) => {
  const fm = loadAgentFrontmatter(md);
  const safe = fm['safe-outputs'];

  it('is only started by workflow_dispatch with pr_number and findings', () => {
    expect(Object.keys(fm.on)).toEqual(
      expect.arrayContaining(['workflow_dispatch'])
    );
    expect(fm.on.pull_request).toBeUndefined();
    expect(fm.on.workflow_dispatch.inputs.pr_number.required).toBe(true);
    expect(fm.on.workflow_dispatch.inputs.findings).toBeDefined();
  });

  it('never pushes to the feature branch directly', () => {
    expect(safe['push-to-pull-request-branch']).toBeUndefined();
    expect(fm.permissions.contents).toBe('read');
  });

  it('cannot clear gate labels (only a passing gate can)', () => {
    expect(safe['remove-labels']).toBeUndefined();
    for (const label of safe['add-labels']?.allowed || []) {
      expect(GATE_LABELS).not.toContain(label);
    }
  });

  it('opens stacked PRs with a remediation label the relay merges', () => {
    const create = safe['create-pull-request'];
    if (!create) {
      expect(safe['update-pull-request']).toBeDefined();
      return;
    }
    expect(create.labels).toHaveLength(1);
    expect(STACKED_LABELS).toContain(create.labels[0]);
    expect(create['allowed-base-branches']).toEqual(['*']);
    expect(create.draft).toBe(false);
    expect(create['title-prefix']).toMatch(
      /^(style|fix|docs|test)(\([\w-]+\))?: $/
    );
    // gh-aw rejects a stacked PR whose branch is its own base ("circular dependency")
    const body = loadAgentBody(md);
    expect(body).toMatch(
      /git switch -c [\w-]+\/pr-\$\{\{ github\.event\.inputs\.pr_number \}\}/
    );
    expect(body).toContain(
      "Never use the pull request's head branch as `branch`"
    );
  });

  it('is declarative: no scripted steps or custom jobs in the frontmatter', () => {
    for (const key of [
      'steps',
      'pre-steps',
      'pre-agent-steps',
      'post-steps',
      'jobs'
    ]) {
      expect(fm[key], `${md} must not define ${key}`).toBeUndefined();
    }
  });

  it('is skipped when dispatched on the default branch', () => {
    const condition =
      'github.ref_name != github.event.repository.default_branch';
    expect(fm.if).toBe(condition);
    expect(loadWorkflow(lockFile(md)).jobs.activation.if).toBe(condition);
  });

  it('tells the agent to verify the PR before changing anything', () => {
    const body = loadAgentBody(md);
    expect(body).toContain('## Before You Start');
    expect(body).toContain(
      'gh pr view ${{ github.event.inputs.pr_number }} --json state,headRefName'
    );
    expect(body).toMatch(/call `noop`[^\n]*and stop/);
  });

  it('hands off to the relay from its conclusion job, whatever the agent result', () => {
    expect(fm.imports).toEqual([HANDOFF]);
    // No LLM-driven hand-off: the agent cannot dispatch workflows itself
    expect(safe['dispatch-workflow']).toBeUndefined();
    expect(loadAgentBody(md)).not.toContain('dispatch_workflow');
    expect(loadAgentBody(md)).toContain(
      'the remediation relay is dispatched automatically when this run ends'
    );
    const conclusion = loadWorkflow(lockFile(md)).jobs.conclusion;
    // Runs after the agent and its safe outputs, also when the agent failed
    expect(conclusion.needs).toEqual(
      expect.arrayContaining(['agent', 'safe_outputs'])
    );
    expect(conclusion.if).toMatch(/^always\(\) && /);
    expect(conclusion.permissions.actions).toBe('write');
    const step = conclusion.steps.find((s) => s.name === HANDOFF_STEP);
    expect(step, `${md} conclusion job hands off`).toBeDefined();
    expect(step.if).toBe(handoffStep.if);
    expect(step.env).toEqual(handoffStep.env);
    expect(step.with.script).toBe(handoffStep.with.script);
  });
  it('has a compiled lock file whose safe outputs match the source', () => {
    const config = lockSafeOutputs(md);
    expect(config.push_to_pull_request_branch).toBeUndefined();
    expect(config.remove_labels).toBeUndefined();
    if (safe['create-pull-request']) {
      expect(config.create_pull_request.labels).toEqual(
        safe['create-pull-request'].labels
      );
    } else {
      expect(config.create_pull_request).toBeUndefined();
    }
    if (safe['add-labels']) {
      expect(config.add_labels.allowed).toEqual(safe['add-labels'].allowed);
    } else {
      expect(config.add_labels).toBeUndefined();
    }
    expect(config.dispatch_workflow).toBeUndefined();
  });
});

describe('agent / gate wiring', () => {
  const gateDispatches = {
    'pr-gatekeeper.yml': ['pr-validation.lock.yml'],
    'pr-lint.yml': ['pr-lint-fixer.lock.yml'],
    'pr-test.yml': ['pr-test-generator.lock.yml'],
    'pr-docs.yml': ['pr-doc-updater.lock.yml'],
    'pr-security.yml': [
      'pr-dependency-fixer.lock.yml',
      'pr-codeql-fixer.lock.yml'
    ]
  };

  it.each(Object.entries(gateDispatches))(
    '%s dispatches its agents with the stacked label the agent uses',
    (gate, workflows) => {
      const text = readWorkflow(gate);
      for (const workflow of workflows) {
        const re = new RegExp(
          `workflow: '${escapeRegExp(workflow)}',(?:\\s*stackedLabel: '([\\w-]+)')?`
        );
        const match = re.exec(text);
        expect(match, `${gate} dispatches ${workflow}`).not.toBeNull();
        const safe = loadAgentFrontmatter(workflow.replace('.lock.yml', '.md'))[
          'safe-outputs'
        ];
        const agentLabel = safe['create-pull-request']?.labels[0];
        expect(match[1]).toBe(agentLabel);
      }
    }
  );

  it.each([
    'pr-gatekeeper.yml',
    'pr-lint.yml',
    'pr-test.yml',
    'pr-docs.yml',
    'pr-security.yml'
  ])(
    '%s defaults to a remediation budget of 1 (fail after one repair)',
    (gate) => {
      expect(loadWorkflow(gate).env.MAX_REMEDIATION_ATTEMPTS).toBe(
        "${{ vars.MAX_REMEDIATION_ATTEMPTS || '1' }}"
      );
    }
  );

  it('only the relay merges pull requests, and only stacked ones', () => {
    const mergers = listWorkflowFiles(
      (f) => f.endsWith('.yml') && !f.endsWith('.lock.yml')
    ).filter((f) =>
      /pulls\.merge\(|gh pr merge|enablePullRequestAutoMerge/.test(
        readWorkflow(f)
      )
    );
    expect(mergers).toEqual(['pr-stacked-merge.yml']);
  });

  it('relay, pipeline and dispatcher agree on the stacked remediation labels', () => {
    for (const file of ['pr-stacked-merge.yml', 'pr-pipeline.yml']) {
      const text = readWorkflow(file);
      for (const label of STACKED_LABELS) expect(text).toContain(`'${label}'`);
    }
  });
});

describe('shared remediation hand-off', () => {
  const RELAY_SOURCE = 'PR Lint Fixer (run 123456)';
  const handoff = async (env) => {
    const github = createGitHub();
    const core = createCore();
    await runScript(handoffStep.with.script, {
      github,
      core,
      env: {
        BRANCH: 'feat/sample',
        SOURCE: RELAY_SOURCE,
        AGENT_RESULT: 'success',
        SAFE_OUTPUTS_RESULT: 'success',
        OUTPUT_TYPES: 'create_pull_request, add_comment',
        ...env
      }
    });
    return { dispatches: github.state.dispatches, core };
  };

  it.each([
    ['applied a stacked PR', {}, 'success'],
    [
      'edited the PR metadata',
      { OUTPUT_TYPES: 'update_pull_request, add_comment' },
      'success'
    ],
    ['added a decision label', { OUTPUT_TYPES: 'add_labels' }, 'success'],
    [
      'only commented',
      { OUTPUT_TYPES: 'add_comment', SAFE_OUTPUTS_RESULT: 'success' },
      'no-changes'
    ],
    [
      'called noop',
      { OUTPUT_TYPES: '', SAFE_OUTPUTS_RESULT: 'skipped' },
      'no-changes'
    ],
    [
      'crashed (e.g. HTTP 429)',
      {
        AGENT_RESULT: 'failure',
        OUTPUT_TYPES: '',
        SAFE_OUTPUTS_RESULT: 'skipped'
      },
      'failure'
    ],
    [
      'was skipped (e.g. AI credits exceeded)',
      {
        AGENT_RESULT: 'skipped',
        OUTPUT_TYPES: '',
        SAFE_OUTPUTS_RESULT: 'skipped'
      },
      'skipped'
    ],
    [
      'could not apply its stacked PR',
      { SAFE_OUTPUTS_RESULT: 'failure' },
      'safe-outputs-failure'
    ]
  ])('dispatches the relay when the agent %s', async (_, env, agentResult) => {
    const { dispatches, core } = await handoff(env);
    expect(dispatches).toEqual([
      expect.objectContaining({
        workflow_id: 'pr-stacked-merge.yml',
        ref: DEFAULT_BRANCH,
        inputs: {
          branch: 'feat/sample',
          agent_result: agentResult,
          source: RELAY_SOURCE
        }
      })
    ]);
    expect(core.notices[0]).toContain(`agent_result: ${agentResult}`);
  });

  it('matches the relay inputs and its source parsing', () => {
    expect(handoffStep.env.SOURCE).toBe(
      '${{ github.workflow }} (run ${{ github.run_id }})'
    );
    expect(handoffStep.env.BRANCH).toBe('${{ github.ref_name }}');
    expect(quality.repairedGate(RELAY_SOURCE)).toBe('lint');
    expect(
      Object.keys(
        loadWorkflow('pr-stacked-merge.yml').on.workflow_dispatch.inputs
      )
    ).toEqual(['branch', 'agent_result', 'source']);
  });

  it('never hands off from the default branch and cannot fail the agent run', () => {
    expect(handoffStep.if).toBe(
      'github.ref_name != github.event.repository.default_branch'
    );
    expect(handoffStep['continue-on-error']).toBe(true);
    expect(handoffJob.permissions).toEqual({ actions: 'write' });
  });
});
