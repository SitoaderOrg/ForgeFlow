import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ROOT,
  createContext,
  createGitHub,
  getScript,
  loadWorkflow,
  makePR,
  makeRun,
  makeTempDir,
  readWorkflow,
  runScript
} from './helpers/harness.js';

const BRANCH = 'feat/sample';
const tempDirs = [];
const tmp = () => {
  const dir = makeTempDir();
  tempDirs.push(dir);
  return dir;
};
afterEach(() => {
  while (tempDirs.length)
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
});

function world(prOverrides = {}, initial = {}) {
  const pr = makePR({ number: 20, branch: BRANCH, ...prOverrides });
  const github = createGitHub({ pulls: [pr], ...initial });
  return { github, pr: github.pr(20) };
}

const gateContext = (overrides = {}) =>
  createContext({ eventName: 'pull_request', runId: 321, ...overrides });

const dispatched = (github, workflow) =>
  github.state.dispatches.filter((d) => d.workflow_id === workflow);

// ---------------------------------------------------------------------------

describe('gate workflows: Resolve PR context', () => {
  const steps = [
    ['pr-lint.yml', 'lint'],
    ['pr-test.yml', 'test'],
    ['pr-docs.yml', 'docs-drift'],
    ['pr-security.yml', 'detect-environment'],
    ['pr-build.yml', 'build']
  ];

  it.each(steps)(
    '%s resolves refs from the PR when dispatched alone',
    async (file, job) => {
      const { github, pr } = world();
      const { core } = await runScript(
        getScript(file, job, 'Resolve PR context'),
        {
          github,
          context: createContext({ ref: `refs/heads/${BRANCH}` }),
          env: { PR_NUMBER: '20', HEAD_REF: '', HEAD_SHA: '', BASE_REF: '' }
        }
      );
      expect(core.failed).toEqual([]);
      if (file !== 'pr-build.yml') expect(core.outputs.head_ref).toBe(BRANCH);
      if (core.outputs.head_sha)
        expect(core.outputs.head_sha).toBe(pr.head.sha);
      if (core.outputs.base_ref) expect(core.outputs.base_ref).toBe('main');
    }
  );

  it.each(steps)(
    '%s refuses a dispatch on the wrong ref',
    async (file, job) => {
      const { github } = world();
      const { core } = await runScript(
        getScript(file, job, 'Resolve PR context'),
        {
          github,
          context: createContext({ ref: 'refs/heads/main' }),
          env: { PR_NUMBER: '20' }
        }
      );
      expect(core.failed[0]).toContain(`Re-run with --ref ${BRANCH}`);
    }
  );

  it.each(steps.filter(([file]) => file !== 'pr-build.yml'))(
    '%s prefers the refs passed by the pipeline',
    async (file, job) => {
      const { github } = world();
      const { core } = await runScript(
        getScript(file, job, 'Resolve PR context'),
        {
          github,
          context: gateContext(),
          env: {
            PR_NUMBER: '20',
            HEAD_REF: 'from-pipeline',
            HEAD_SHA: 'abc',
            BASE_REF: 'develop'
          }
        }
      );
      expect(core.outputs.head_ref).toBe('from-pipeline');
      if ('base_ref' in core.outputs)
        expect(core.outputs.base_ref).toBe('develop');
    }
  );
});

// ---------------------------------------------------------------------------

describe('pr-gatekeeper.yml (Metadata gate)', () => {
  const script = getScript(
    'pr-gatekeeper.yml',
    'gatekeeper',
    'Run Pre-Flight Checks'
  );
  const run = (github) =>
    runScript(script, {
      github,
      context: gateContext(),
      env: { PR_NUMBER: '20', HEAD_REF: BRANCH }
    });

  it('passes valid metadata and clears needs-metadata', async () => {
    const { github } = world({ labels: ['needs-metadata'] });
    const { core } = await run(github);
    expect(core.failed).toEqual([]);
    expect(github.labels(20)).toEqual([]);
    expect(github.state.dispatches).toEqual([]);
    expect(core.summaryText).toContain('✅ PASS');
  });

  it.each([
    ['a non-conventional title', { title: 'Added a sample feature' }],
    ['an empty description', { body: '' }],
    ['a short description', { body: 'too short' }],
    ['placeholder text', { body: 'TODO: describe this change properly later' }],
    [
      'template text',
      { body: 'Please fill this out before merging the change.' }
    ]
  ])(
    'fails %s, labels the PR and dispatches PR Validation',
    async (_, change) => {
      const { github } = world(change);
      const { core } = await run(github);
      expect(core.failed[0]).toContain('PR Gatekeeper failed with 1 error(s)');
      expect(github.labels(20)).toContain('needs-metadata');
      expect(dispatched(github, 'pr-validation.lock.yml')).toHaveLength(1);
      expect(dispatched(github, 'pr-validation.lock.yml')[0].ref).toBe(BRANCH);
      expect(core.summaryText).toContain('dispatch status: **dispatched**');
    }
  );

  it('fails a bad branch name without dispatching an agent (agents cannot rename branches)', async () => {
    const { github } = world({ branch: 'my_random_branch' });
    const { core } = await run(github);
    expect(core.failed[0]).toContain('Branch name');
    expect(github.state.dispatches).toEqual([]);
    expect(github.labels(20)).toEqual([]);
  });

  it.each([
    'feat/x',
    'fix/y-1',
    'user/docs/readme',
    'alice-chore-cleanup',
    'ci/pipeline.v2'
  ])('accepts the branch name %s', async (branch) => {
    const { github } = world({ branch });
    const { core } = await run(github);
    expect(core.failed).toEqual([]);
  });

  it.each([
    'feat(api): add auth',
    'fix: bug',
    'chore(deps-dev): bump',
    'revert: undo'
  ])('accepts the title %s', async (title) => {
    const { github } = world({ title });
    expect((await run(github)).core.failed).toEqual([]);
  });

  it('reports every failing check', async () => {
    const { github } = world({ branch: 'bad', title: 'bad', body: '' });
    const { core } = await run(github);
    expect(core.failed[0]).toContain('3 error(s)');
  });

  it('respects the remediation budget', async () => {
    const runs = [1, 2].map((id) =>
      makeRun({ id, workflow: 'pr-validation.lock.yml', branch: BRANCH })
    );
    const { github } = world({ title: 'bad title' }, { runs });
    const { core } = await run(github);
    expect(github.state.dispatches).toEqual([]);
    expect(core.summaryText).toContain('**exhausted**');
    expect(core.failed).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------

function lintWorkspace(files) {
  const dir = makeTempDir();
  tempDirs.push(dir);
  const out = path.join(dir, 'super-linter-output', 'super-linter');
  fs.mkdirSync(out, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    fs.writeFileSync(path.join(out, name), text);
  }
  return dir;
}

describe('pr-lint.yml (Lint gate)', () => {
  const failure = getScript(
    'pr-lint.yml',
    'lint',
    'Handle Lint Failure (Trigger Autonomous Remediation)'
  );
  const success = getScript(
    'pr-lint.yml',
    'lint',
    'Handle Lint Success (Clear Remediation Label)'
  );

  it('only runs the handlers for the matching outcome', () => {
    const steps = loadWorkflow('pr-lint.yml').jobs.lint.steps;
    const byName = (n) => steps.find((s) => s.name.startsWith(n));
    expect(byName('Handle Lint Failure').if).toBe(
      "failure() && steps.super-linter.outcome == 'failure'"
    );
    expect(byName('Handle Lint Success').if).toBe('success()');
  });

  it('labels the PR and hands the linter output to the PR Lint Fixer', async () => {
    const workspace = lintWorkspace({
      'super-linter-parallel-stdout-JAVASCRIPT_ES':
        '\x1b[31m/github/workspace/src/a.js\x1b[0m\n  1:7  error  x is unused  no-unused-vars\n✖ 1 problem',
      'super-linter-parallel-stdout-YAML': 'no errors found',
      'super-linter-parallel-stderr-JSON': '',
      'unrelated.log': 'error everywhere'
    });
    const { github } = world();
    const { core } = await runScript(failure, {
      github,
      context: gateContext(),
      env: { PR_NUMBER: '20', HEAD_REF: BRANCH, GITHUB_WORKSPACE: workspace }
    });
    expect(github.labels(20)).toEqual(['lint-failed']);
    const [d] = dispatched(github, 'pr-lint-fixer.lock.yml');
    expect(d.ref).toBe(BRANCH);
    expect(d.inputs.pr_number).toBe('20');
    expect(d.inputs.findings).toContain('### JAVASCRIPT_ES');
    expect(d.inputs.findings).toContain('src/a.js');
    expect(d.inputs.findings).not.toContain('/github/workspace/');
    expect(d.inputs.findings).not.toContain('\x1b[');
    expect(d.inputs.findings).not.toContain('YAML');
    expect(d.inputs.findings).not.toContain('unrelated');
    expect(d.inputs.findings).toContain('actions/runs/321');
    expect(core.summaryText).toContain('Stacked Pull Request');
  });

  it('still dispatches when no linter output was captured', async () => {
    const dir = makeTempDir();
    tempDirs.push(dir);
    const { github } = world();
    const { core } = await runScript(failure, {
      github,
      context: gateContext(),
      env: { PR_NUMBER: '20', HEAD_REF: BRANCH, GITHUB_WORKSPACE: dir }
    });
    expect(core.warnings.join()).toContain(
      'Could not read Super-Linter output'
    );
    expect(
      dispatched(github, 'pr-lint-fixer.lock.yml')[0].inputs.findings
    ).toContain('(no linter output captured)');
  });

  it('waits for an open stacked lint PR instead of dispatching again', async () => {
    const stacked = makePR({
      number: 21,
      branch: 'lint-fix',
      base: BRANCH,
      labels: ['lint-remediation']
    });
    const { github } = world({}, { pulls: [stacked] });
    github.state.pulls.push(makePR({ number: 20, branch: BRANCH }));
    const { core } = await runScript(failure, {
      github,
      context: gateContext(),
      env: {
        PR_NUMBER: '20',
        HEAD_REF: BRANCH,
        GITHUB_WORKSPACE: lintWorkspace({})
      }
    });
    expect(github.state.dispatches).toEqual([]);
    expect(core.summaryText).toContain('**pending-stacked-pr**');
  });

  it('clears lint-failed when the gate passes', async () => {
    const { github } = world({ labels: ['lint-failed', 'docs-required'] });
    await runScript(success, {
      github,
      context: gateContext(),
      env: { PR_NUMBER: '20' }
    });
    expect(github.labels(20)).toEqual(['docs-required']);
  });
});

// ---------------------------------------------------------------------------

describe('pr-test.yml (Tests & coverage gate)', () => {
  const failure = getScript(
    'pr-test.yml',
    'test',
    'Handle Test Failure (Trigger Autonomous Remediation)'
  );
  const success = getScript(
    'pr-test.yml',
    'test',
    'Handle Test Success (Clear Remediation Label)'
  );

  it('extracts the relevant test output for the PR Test Generator', async () => {
    const temp = makeTempDir();
    tempDirs.push(temp);
    fs.writeFileSync(
      path.join(temp, 'test-output.log'),
      [
        'RUN v5',
        '\x1b[31m FAIL tests/a.test.js > adds\x1b[0m',
        'AssertionError: expected 1 to be 2',
        'noise line',
        'ERROR: Coverage for lines (61%) does not meet threshold (80%)'
      ].join('\n')
    );
    const { github } = world();
    const { core } = await runScript(failure, {
      github,
      context: gateContext(),
      env: { PR_NUMBER: '20', HEAD_REF: BRANCH, RUNNER_TEMP: temp }
    });
    expect(github.labels(20)).toEqual(['test-required']);
    const { findings } = dispatched(github, 'pr-test-generator.lock.yml')[0]
      .inputs;
    expect(findings).toContain('FAIL tests/a.test.js');
    expect(findings).toContain('AssertionError');
    expect(findings).toContain('threshold');
    expect(findings).not.toContain('noise line');
    expect(findings).not.toContain('\x1b[');
    expect(core.summaryText).toContain('dispatch status: **dispatched**');
  });

  it('warns but still dispatches when the log is missing', async () => {
    const temp = makeTempDir();
    tempDirs.push(temp);
    const { github } = world();
    const { core } = await runScript(failure, {
      github,
      context: gateContext(),
      env: { PR_NUMBER: '20', HEAD_REF: BRANCH, RUNNER_TEMP: temp }
    });
    expect(core.warnings.join()).toContain('Could not read test output');
    expect(dispatched(github, 'pr-test-generator.lock.yml')).toHaveLength(1);
  });

  it('does not dispatch while the generator is already running', async () => {
    const runs = [
      makeRun({
        id: 5,
        workflow: 'pr-test-generator.lock.yml',
        branch: BRANCH,
        status: 'in_progress',
        conclusion: null
      })
    ];
    const { github } = world({}, { runs });
    const { core } = await runScript(failure, {
      github,
      context: gateContext(),
      env: { PR_NUMBER: '20', HEAD_REF: BRANCH, RUNNER_TEMP: tmp() }
    });
    expect(github.state.dispatches).toEqual([]);
    expect(core.summaryText).toContain('**in-progress**');
  });

  it('clears test-required when tests pass', async () => {
    const { github } = world({ labels: ['test-required'] });
    const { core } = await runScript(success, {
      github,
      context: gateContext(),
      env: { PR_NUMBER: '20' }
    });
    expect(github.labels(20)).toEqual([]);
    expect(core.summaryText).toContain('Passed');
  });
});

// ---------------------------------------------------------------------------

describe('pr-build.yml (Build gate)', () => {
  const failure = getScript(
    'pr-build.yml',
    'build',
    'Handle Build Failure (Trigger Autonomous Remediation)'
  );
  const success = getScript(
    'pr-build.yml',
    'build',
    'Handle Build Success (Clear Remediation Label)'
  );

  it('labels build-failed and fails without dispatching an agent', async () => {
    const { github } = world();
    const { core } = await runScript(failure, {
      github,
      context: gateContext(),
      env: { PR_NUMBER: '20' }
    });
    expect(github.labels(20)).toEqual(['build-failed']);
    expect(github.state.dispatches).toEqual([]);
    expect(core.failed[0]).toContain('build or compilation failed');
  });

  it('clears build-failed on success', async () => {
    const { github } = world({ labels: ['build-failed'] });
    await runScript(success, {
      github,
      context: gateContext(),
      env: { PR_NUMBER: '20' }
    });
    expect(github.labels(20)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('pr-docs.yml (Documentation drift gate)', () => {
  const script = getScript(
    'pr-docs.yml',
    'docs-drift',
    'Evaluate Gate & Trigger Documentation Agent'
  );
  const run = (github, env) =>
    runScript(script, {
      github,
      context: gateContext(),
      env: {
        PR_NUMBER: '20',
        HEAD_REF: BRANCH,
        SOURCE_FILES: 'src/app.js\nsrc/util.js',
        DOC_FILES: '',
        ...env
      }
    });

  it('fails and dispatches the PR Documentation Updater when docs are missing', async () => {
    const { github } = world();
    const { core } = await run(github, { RESULT: 'docs-missing' });
    expect(core.failed[0]).toContain('Documentation drift');
    expect(github.labels(20)).toEqual(['docs-required']);
    const [d] = dispatched(github, 'pr-doc-updater.lock.yml');
    expect(d.inputs.findings).toContain('src/app.js');
    expect(core.summaryText).toContain('docs-not-required');
  });

  it('accepts the agent decision docs-not-required and clears docs-required', async () => {
    const { github } = world({
      labels: ['docs-required', 'docs-not-required']
    });
    const { core } = await run(github, { RESULT: 'docs-missing' });
    expect(core.failed).toEqual([]);
    expect(github.labels(20)).toEqual(['docs-not-required']);
    expect(github.state.dispatches).toEqual([]);
    expect(core.summaryText).toContain(
      'determined no documentation is required'
    );
  });

  it.each([
    ['docs-present', 'Documentation updated alongside code'],
    ['no-source-changes', 'No application source changes']
  ])('passes when the result is %s', async (result, text) => {
    const { github } = world({ labels: ['docs-required'] });
    const { core } = await run(github, {
      RESULT: result,
      DOC_FILES: 'README.md'
    });
    expect(core.failed).toEqual([]);
    expect(github.labels(20)).toEqual([]);
    expect(core.summaryText).toContain(text);
  });

  it('waits for an open stacked docs PR', async () => {
    const { github } = world();
    github.state.pulls.push(
      makePR({
        number: 22,
        branch: 'docs-fix',
        base: BRANCH,
        labels: ['doc-remediation']
      })
    );
    const { core } = await run(github, { RESULT: 'docs-missing' });
    expect(github.state.dispatches).toEqual([]);
    expect(core.summaryText).toContain('**pending-stacked-pr**');
    expect(core.failed).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------

describe('pr-security.yml (Security gate)', () => {
  const script = getScript(
    'pr-security.yml',
    'security-gatekeeper',
    'Evaluate Security Results & Label PR'
  );
  const run = (github, env, workspace = ROOT) =>
    runScript(script, {
      github,
      context: gateContext(),
      env: {
        PR_NUMBER: '20',
        HEAD_REF: BRANCH,
        GITHUB_WORKSPACE: workspace,
        ...env
      }
    });

  it('only runs when the PR was resolved', () => {
    const job = loadWorkflow('pr-security.yml').jobs['security-gatekeeper'];
    expect(job.if).toBe(
      "always() && needs.detect-environment.result == 'success'"
    );
    expect(job.needs).toEqual([
      'detect-environment',
      'dependency-review',
      'codeql-analysis'
    ]);
  });

  it.each([
    ['success', 'success'],
    ['skipped', 'skipped'],
    ['success', 'skipped']
  ])(
    'passes with dependency review %s and CodeQL %s and clears alerts',
    async (dep, codeql) => {
      const { github } = world({
        labels: [
          'dependency-alert',
          'codeql-alert',
          'security-alert',
          'lint-failed'
        ]
      });
      const { core } = await run(github, {
        DEP_REVIEW_RESULT: dep,
        CODEQL_RESULT: codeql
      });
      expect(core.failed).toEqual([]);
      expect(github.labels(20)).toEqual(['lint-failed']);
      expect(github.state.dispatches).toEqual([]);
    }
  );

  it('dispatches the dependency fixer for vulnerable dependencies', async () => {
    const { github } = world();
    const { core } = await run(github, {
      DEP_REVIEW_RESULT: 'failure',
      CODEQL_RESULT: 'success'
    });
    expect(core.failed[0]).toContain('Security vulnerabilities');
    expect(github.labels(20)).toEqual(['dependency-alert']);
    expect(dispatched(github, 'pr-dependency-fixer.lock.yml')).toHaveLength(1);
    expect(dispatched(github, 'pr-codeql-fixer.lock.yml')).toHaveLength(0);
  });

  it('dispatches the CodeQL fixer with the downloaded findings', async () => {
    const workspace = makeTempDir();
    tempDirs.push(workspace);
    fs.mkdirSync(path.join(workspace, 'codeql-findings'));
    fs.writeFileSync(
      path.join(workspace, 'codeql-findings', 'javascript.txt'),
      'js/sql-injection in src/db.js:12\n'
    );
    fs.writeFileSync(
      path.join(workspace, 'codeql-findings', 'ignored.sarif'),
      'nope'
    );
    const { github } = world();
    await run(
      github,
      { DEP_REVIEW_RESULT: 'skipped', CODEQL_RESULT: 'failure' },
      workspace
    );
    expect(github.labels(20)).toEqual(['codeql-alert']);
    const { findings } = dispatched(github, 'pr-codeql-fixer.lock.yml')[0]
      .inputs;
    expect(findings).toContain('js/sql-injection in src/db.js:12');
    expect(findings).not.toContain('nope');
  });

  it('dispatches both fixers when both scans fail, sharing one stacked label', async () => {
    const { github } = world();
    const { core } = await run(
      github,
      { DEP_REVIEW_RESULT: 'failure', CODEQL_RESULT: 'failure' },
      tmp()
    );
    expect(github.state.dispatches.map((d) => d.workflow_id)).toEqual([
      'pr-dependency-fixer.lock.yml',
      'pr-codeql-fixer.lock.yml'
    ]);
    expect(core.summaryText).toContain('PR Dependency Fixer: **dispatched**');
    expect(core.summaryText).toContain('PR CodeQL Fixer: **dispatched**');
    expect(github.state.dispatches[1].inputs.findings).toContain(
      '(see run artifacts codeql-findings-*)'
    );
    expect(github.labels(20).sort()).toEqual([
      'codeql-alert',
      'dependency-alert'
    ]);
  });

  it('holds both fixers while a stacked security PR is open', async () => {
    const { github } = world();
    github.state.pulls.push(
      makePR({
        number: 23,
        branch: 'sec-fix',
        base: BRANCH,
        labels: ['security-remediation']
      })
    );
    const { core } = await run(
      github,
      { DEP_REVIEW_RESULT: 'failure', CODEQL_RESULT: 'failure' },
      tmp()
    );
    expect(github.state.dispatches).toEqual([]);
    expect(core.summaryText.match(/pending-stacked-pr/g)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------

describe('pr-review-dispatcher.yml', () => {
  const text = readWorkflow('pr-review-dispatcher.yml');

  it('blocks review on every label a gate can set', () => {
    const blocking = /BLOCKING_LABELS=\(([^)]*)\)/.exec(text)[1];
    for (const label of [
      'needs-metadata',
      'lint-failed',
      'build-failed',
      'test-required',
      'docs-required',
      'codeql-alert',
      'dependency-alert'
    ]) {
      expect(blocking).toContain(`"${label}"`);
    }
  });

  it('never merges the feature PR (final approval is human)', () => {
    expect(text).not.toMatch(
      /gh pr merge|--auto|enablePullRequestAutoMerge|pulls\/\$PR_NUM\/merge/
    );
  });
});
