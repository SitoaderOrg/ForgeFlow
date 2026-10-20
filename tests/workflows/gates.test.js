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
  quality,
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
    ['gate-lint.yml', 'lint'],
    ['gate-tests.yml', 'test'],
    ['gate-docs.yml', 'docs-drift'],
    ['gate-security.yml', 'detect-environment'],
    ['gate-build.yml', 'build']
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
      if (file !== 'gate-build.yml') expect(core.outputs.head_ref).toBe(BRANCH);
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

  it.each(steps.filter(([file]) => file !== 'gate-build.yml'))(
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

describe('gate-metadata.yml (Metadata gate)', () => {
  const script = getScript(
    'gate-metadata.yml',
    'metadata',
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
    'fails %s, labels the PR and dispatches Fix: PR metadata',
    async (_, change) => {
      const { github } = world(change);
      const { core } = await run(github);
      expect(core.failed[0]).toContain(
        'Gate: PR metadata failed with 1 error(s)'
      );
      expect(github.labels(20)).toContain('needs-metadata');
      expect(dispatched(github, 'fix-metadata.lock.yml')).toHaveLength(1);
      expect(dispatched(github, 'fix-metadata.lock.yml')[0].ref).toBe(BRANCH);
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
      makeRun({ id, workflow: 'fix-metadata.lock.yml', branch: BRANCH })
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

describe('gate-lint.yml (Lint gate)', () => {
  const failure = getScript(
    'gate-lint.yml',
    'lint',
    'Handle Lint Failure (Trigger Autonomous Remediation)'
  );
  const success = getScript(
    'gate-lint.yml',
    'lint',
    'Handle Lint Success (Clear Remediation Label)'
  );

  it('only runs the handlers for the matching outcome', () => {
    const steps = loadWorkflow('gate-lint.yml').jobs.lint.steps;
    const byName = (n) => steps.find((s) => s.name.startsWith(n));
    expect(byName('Handle Lint Failure').if).toBe(
      "failure() && steps.super-linter.outcome == 'failure'"
    );
    expect(byName('Handle Lint Success').if).toBe('success()');
  });

  it('labels the PR and hands the linter output to the lint fixer', async () => {
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
    const [d] = dispatched(github, 'fix-lint.lock.yml');
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
      dispatched(github, 'fix-lint.lock.yml')[0].inputs.findings
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

describe('gate-tests.yml (Tests & coverage gate)', () => {
  const failure = getScript(
    'gate-tests.yml',
    'test',
    'Handle Test Failure (Trigger Autonomous Remediation)'
  );
  const success = getScript(
    'gate-tests.yml',
    'test',
    'Handle Test Success (Clear Remediation Label)'
  );

  it('extracts the relevant test output for the tests fixer', async () => {
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
    const { findings } = dispatched(github, 'fix-tests.lock.yml')[0].inputs;
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
    expect(dispatched(github, 'fix-tests.lock.yml')).toHaveLength(1);
  });

  it('does not dispatch while the generator is already running', async () => {
    const runs = [
      makeRun({
        id: 5,
        workflow: 'fix-tests.lock.yml',
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
    expect(core.summaryText).toContain('passed');
  });
});

// ---------------------------------------------------------------------------

describe('gate-build.yml (Build gate)', () => {
  const failure = getScript(
    'gate-build.yml',
    'build',
    'Handle Build Failure (Trigger Autonomous Remediation)'
  );
  const success = getScript(
    'gate-build.yml',
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

describe('gate-docs.yml (Documentation drift gate)', () => {
  const script = getScript(
    'gate-docs.yml',
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

  it('fails and dispatches the docs fixer when docs are missing', async () => {
    const { github } = world();
    const { core } = await run(github, { RESULT: 'docs-missing' });
    expect(core.failed[0]).toContain('Documentation drift');
    expect(github.labels(20)).toEqual(['docs-required']);
    const [d] = dispatched(github, 'fix-docs.lock.yml');
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

describe('gate-security.yml (Security gate)', () => {
  const script = getScript(
    'gate-security.yml',
    'security-status',
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
    const job = loadWorkflow('gate-security.yml').jobs['security-status'];
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
        labels: ['dependency-alert', 'codeql-alert', 'lint-failed']
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
    expect(dispatched(github, 'fix-dependencies.lock.yml')).toHaveLength(1);
    expect(dispatched(github, 'fix-codeql.lock.yml')).toHaveLength(0);
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
    const { findings } = dispatched(github, 'fix-codeql.lock.yml')[0].inputs;
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
      'fix-dependencies.lock.yml',
      'fix-codeql.lock.yml'
    ]);
    expect(core.summaryText).toContain('Dependency fixer: **dispatched**');
    expect(core.summaryText).toContain('CodeQL fixer: **dispatched**');
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

describe('scan-codeql.yml (the only CodeQL configuration)', () => {
  const scan = loadWorkflow('scan-codeql.yml');
  const steps = scan.jobs.analyze.steps;
  const step = (name) => steps.find((s) => s.name === name);

  it('is the CodeQL job of the security gate, which fails on its findings', () => {
    const job = loadWorkflow('gate-security.yml').jobs['codeql-analysis'];
    expect(job.uses).toBe('./.github/workflows/scan-codeql.yml');
    expect(job.with).toEqual({
      sha: '${{ needs.detect-environment.outputs.head_sha }}',
      upload_ref: 'refs/pull/${{ inputs.pr_number }}/head',
      gate: true
    });
    expect(job.permissions['security-events']).toBe('write');
    expect(step('Fail on CodeQL Findings').if).toMatch(/^inputs\.gate && /);
    expect(step('Upload Findings').with.name).toBe(
      'codeql-findings-${{ matrix.language }}'
    );
  });

  it('also scans main on push and on a schedule', () => {
    expect(scan.on.push.branches).toEqual(['main']);
    expect(scan.on.schedule).toHaveLength(1);
    expect(scan.on.workflow_call.inputs.gate.default).toBe(false);
  });

  it('uploads the results of the head it analyzed, to the PR', () => {
    const analyze = step('Perform CodeQL Analysis').with;
    expect(analyze.upload).toBe(
      "${{ github.event.pull_request.head.repo.fork && 'never' || 'always' }}"
    );
    expect(analyze.ref).toBe('${{ inputs.upload_ref }}');
    expect(analyze.sha).toBe("${{ inputs.upload_ref && inputs.sha || '' }}");
    expect(step('Checkout Code').with.ref).toBe(
      '${{ inputs.sha || github.sha }}'
    );
  });

  it('keeps the coverage of the former default setup', () => {
    expect(step('Initialize CodeQL').with.queries).toBe('security-extended');
    const detect = scan.jobs.languages.steps.find(
      (s) => s.name === 'Detect languages'
    ).run;
    expect(detect).toContain('add_lang actions none');
    expect(detect).toContain('add_lang javascript-typescript none');
    expect(detect).toContain('add_lang rust none');
  });

  it('builds Kotlin, which CodeQL cannot analyze without a build', () => {
    const detect = scan.jobs.languages.steps.find(
      (s) => s.name === 'Detect languages'
    ).run;
    expect(detect).toMatch(
      /if has '\\\.kt\$'; then\s+add_lang java-kotlin autobuild\s+elif has '\\\.java\$'; then\s+add_lang java-kotlin none/
    );
  });

  it('reports source files CodeQL cannot analyze instead of passing silently', () => {
    const detect = scan.jobs.languages.steps.find(
      (s) => s.name === 'Detect languages'
    ).run;
    expect(detect).toContain('::notice title=Not scanned by CodeQL::');
    expect(detect).toMatch(/\\\.\(php\|scala\|.*\|sh\|.*\|sql\|/);
  });

  it('uses CodeQL Action v4', () => {
    for (const s of steps.filter((s) => s.uses?.includes('codeql-action')))
      expect(s.uses).toMatch(/@v4$/);
  });
});

// ---------------------------------------------------------------------------

describe('review-request.yml', () => {
  const text = readWorkflow('review-request.yml');

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

describe('gate workflows: per-gate status and verdict', () => {
  const GATE_JOBS = [
    ['gate-metadata.yml', 'metadata', 'metadata'],
    ['gate-lint.yml', 'lint', 'lint'],
    ['gate-build.yml', 'build', 'build'],
    ['gate-tests.yml', 'test', 'tests'],
    ['gate-security.yml', 'security-status', 'security'],
    ['gate-docs.yml', 'docs-drift', 'docs']
  ];

  it('covers every gate listed in pr-quality.cjs', () => {
    expect(GATE_JOBS.map(([file, , gate]) => [gate, file])).toEqual(
      quality.GATES.map((g) => [g.id, g.workflow])
    );
  });

  describe.each(GATE_JOBS)('%s', (file, job, gate) => {
    const wf = loadWorkflow(file);

    it('knows whether it runs inside the pipeline', () => {
      expect(wf.on.workflow_call.inputs.from_pipeline).toEqual(
        expect.objectContaining({ type: 'boolean', default: true })
      );
      expect(wf.on.workflow_call.inputs.head_sha).toBeDefined();
      expect(wf.on.workflow_dispatch.inputs.pr_number).toBeDefined();
      expect((wf.jobs[job].permissions || wf.permissions).statuses).toBe(
        'write'
      );
    });

    it(`records the gate/${gate} status as the last step, whatever the outcome`, () => {
      const steps = wf.jobs[job].steps;
      const record = steps[steps.length - 1];
      expect(record.name).toBe('Record gate result');
      expect(record.if).toMatch(/^always\(\)/);
      expect(record.env).toEqual(
        expect.objectContaining({
          HEAD_SHA: '${{ inputs.head_sha || github.sha }}',
          GATE_RESULT: '${{ job.status }}'
        })
      );
      expect(record.with.script).toContain(`gate: '${gate}'`);
    });

    it('publishes the verdict only when re-checked alone', () => {
      const verdict = wf.jobs.verdict;
      expect(verdict.needs).toEqual([job]);
      expect(verdict.if).toBe('${{ always() && !inputs.from_pipeline }}');
      expect(verdict.uses).toBe('./.github/workflows/verdict.yml');
      expect(verdict.with).toEqual({
        pr_number: '${{ inputs.pr_number }}',
        gate,
        gate_result: `\${{ needs.${job}.result }}`,
        sha: '${{ github.sha }}'
      });
      expect(verdict.permissions).toEqual(
        expect.objectContaining({
          statuses: 'write',
          actions: 'write',
          issues: 'write',
          'pull-requests': 'write'
        })
      );
    });

    it('records the job result for the checked commit', async () => {
      const pr = makePR({ number: 20, branch: BRANCH });
      const github = createGitHub({ pulls: [pr] });
      await runScript(getScript(file, job, 'Record gate result'), {
        github,
        env: { PR_NUMBER: '20', HEAD_SHA: pr.head.sha, GATE_RESULT: 'failure' }
      });
      const gates = await quality.getGateStatuses({
        github,
        context: createContext(),
        sha: pr.head.sha
      });
      expect(gates[gate].state).toBe('failure');
    });
  });
});

describe('verdict.yml', () => {
  const wf = loadWorkflow('verdict.yml');
  const script = getScript(
    'verdict.yml',
    'verdict',
    'Publish pr-quality status'
  );

  it('serializes verdicts per PR without cancelling', () => {
    expect(wf.jobs.verdict.concurrency).toEqual({
      group: "verdict-${{ inputs.pr_number || 'watchdog' }}",
      'cancel-in-progress': false
    });
    expect(Object.keys(wf.on.workflow_call.inputs)).toEqual([
      'pr_number',
      'gate',
      'gate_result',
      'sha'
    ]);
    expect(wf.on.workflow_dispatch.inputs.pr_number.required).toBe(true);
    expect(wf.permissions.statuses).toBe('write');
  });

  it('marks the reporting gate as errored when it never recorded a result', async () => {
    const pr = makePR({ number: 20, branch: BRANCH });
    const github = createGitHub({ pulls: [pr] });
    const { core } = await runScript(script, {
      github,
      env: {
        PR_NUMBER: '20',
        GATE: 'lint',
        GATE_RESULT: 'cancelled',
        GATE_SHA: pr.head.sha
      }
    });
    const gates = await quality.getGateStatuses({
      github,
      context: createContext(),
      sha: pr.head.sha
    });
    expect(gates.lint.state).toBe('error');
    expect(github.qualityStatuses(pr.head.sha)[0].state).toBe('pending');
    expect(core.summaryText).toContain('### pr-quality: pending');
  });

  it('works when dispatched by hand without a gate', async () => {
    const pr = makePR({ number: 20, branch: BRANCH });
    const github = createGitHub({ pulls: [pr] });
    for (const g of quality.GATES) {
      await quality.setGateStatus({
        github,
        context: createContext(),
        sha: pr.head.sha,
        gate: g.id,
        state: 'success',
        description: 'ok'
      });
    }
    await runScript(script, {
      github,
      env: { PR_NUMBER: '20', GATE: '', GATE_RESULT: '', GATE_SHA: '' }
    });
    expect(github.qualityStatuses(pr.head.sha)[0].state).toBe('success');
  });
});

describe('verdict.yml watchdog', () => {
  const wf = loadWorkflow('verdict.yml');
  const script = getScript(
    'verdict.yml',
    'verdict',
    'Publish pr-quality status'
  );

  it('runs on a schedule with a configurable staleness', () => {
    expect(wf.on.schedule).toEqual([{ cron: '*/15 * * * *' }]);
    expect(wf.jobs.verdict.steps[1].env.STALE_VERDICT_MINUTES).toBe(
      "${{ vars.STALE_VERDICT_MINUTES || '30' }}"
    );
  });

  it('sweeps stalled PRs when started without a PR number', async () => {
    const pr = makePR({ number: 20, branch: BRANCH });
    const github = createGitHub({ pulls: [pr] });
    const { core } = await runScript(script, {
      github,
      context: createContext({ eventName: 'schedule' }),
      env: {
        PR_NUMBER: '',
        GATE: '',
        GATE_RESULT: '',
        GATE_SHA: '',
        STALE_VERDICT_MINUTES: '30'
      }
    });
    expect(core.summaryText).toContain('### pr-quality watchdog');
    expect(core.summaryText).toContain('No stalled PRs.');
  });
});
