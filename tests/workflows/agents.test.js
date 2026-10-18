import { describe, expect, it } from 'vitest';
import {
  createContext,
  createGitHub,
  listWorkflowFiles,
  loadAgentFrontmatter,
  loadWorkflow,
  quality,
  readWorkflow,
  runScript
} from './helpers/harness.js';

// Contract tests for the gh-aw remediation agents (Repair stage): what they may do,
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

function relayHandoffStep(md) {
  const steps = loadWorkflow(lockFile(md)).jobs.conclusion.steps;
  return steps.find((s) => s.name === 'Hand off to remediation relay');
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
  });

  it('hands off to the relay from its conclusion job', () => {
    const handoff = fm.jobs.conclusion['pre-steps'].find(
      (s) => s.name === 'Hand off to remediation relay'
    );
    expect(handoff.env.AGENT_RESULT).toBe('${{ needs.agent.result }}');
    expect(fm.jobs.conclusion.permissions.actions).toBe('write');
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
  });

  it('compiles the relay hand-off into the lock file', () => {
    const step = relayHandoffStep(md);
    expect(step).toBeDefined();
    expect(step.with.script).toContain("workflow_id: 'pr-stacked-merge.yml'");
  });

  it('dispatches the relay on the default branch with a parsable source', async () => {
    const github = createGitHub();
    await runScript(relayHandoffStep(md).with.script, {
      github,
      context: createContext({ runId: 123456, ref: 'refs/heads/feat/sample' }),
      env: {
        AGENT_RESULT: 'success',
        GITHUB_REF_NAME: 'feat/sample',
        GITHUB_WORKFLOW: fm.name
      }
    });
    const [dispatch] = github.state.dispatches;
    expect(dispatch).toMatchObject({
      workflow_id: 'pr-stacked-merge.yml',
      ref: 'main',
      inputs: { branch: 'feat/sample', agent_result: 'success' }
    });
    // The relay excludes the dispatching run by parsing `run <id>` from the source
    expect(/run (\d+)/.exec(dispatch.inputs.source)[1]).toBe('123456');
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
          `workflow: '${workflow.replace(/\./g, '\\.')}',(?:\\s*stackedLabel: '([\\w-]+)')?`
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
  ])('%s defaults to a remediation budget of 2', (gate) => {
    expect(loadWorkflow(gate).env.MAX_REMEDIATION_ATTEMPTS).toBe(
      "${{ vars.MAX_REMEDIATION_ATTEMPTS || '2' }}"
    );
  });

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
