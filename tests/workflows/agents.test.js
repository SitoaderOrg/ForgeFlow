import { describe, expect, it } from 'vitest';
import {
  listWorkflowFiles,
  loadAgentBody,
  loadAgentFrontmatter,
  loadWorkflow,
  quality,
  readWorkflow
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

  it('hands off to the relay with the dispatch-workflow safe output', () => {
    expect(safe['dispatch-workflow']).toEqual({
      workflows: ['pr-stacked-merge'],
      'target-ref': '${{ github.event.repository.default_branch }}'
    });
    const body = loadAgentBody(md);
    const handoff = body.slice(
      body.indexOf('## Hand Off to the Remediation Relay')
    );
    expect(handoff).toContain('`dispatch_workflow` for `pr-stacked-merge`');
    const relayInputs = Object.keys(
      loadWorkflow('pr-stacked-merge.yml').on.workflow_dispatch.inputs
    );
    for (const input of relayInputs) expect(handoff).toContain(`\`${input}\``);
    // The relay excludes the dispatching run by parsing `run <id>` from the source
    const source = /`source`: `([^`]+)`/.exec(handoff)[1];
    expect(source).toBe('${{ github.workflow }} (run ${{ github.run_id }})');
    const rendered = source
      .replace('${{ github.workflow }}', fm.name)
      .replace('${{ github.run_id }}', '123456');
    expect(/run (\d+)/.exec(rendered)[1]).toBe('123456');
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
    expect(config.dispatch_workflow.workflows).toEqual(['pr-stacked-merge']);
    expect(config.dispatch_workflow.max).toBe(1);
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
