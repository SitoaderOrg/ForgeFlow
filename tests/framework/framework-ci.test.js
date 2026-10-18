import {
  readFileSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  rmSync
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Script } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import yaml from 'js-yaml';

const definition = yaml.load(
  readFileSync('.github/workflows/agentic-workflows-compilation.yml', 'utf8')
);
const job = definition.jobs['validate-compilation'];
const head = 'a'.repeat(40);
const base = 'b'.repeat(40);

function harness(files = []) {
  const pr = {
    number: 11,
    state: 'open',
    head: { sha: head, ref: 'feature', repo: { full_name: 'owner/repo' } },
    base: { sha: base, ref: 'main', repo: { full_name: 'owner/repo' } }
  };
  const outputs = {};
  const git = vi.fn().mockReturnValue(files.join('\0'));
  return {
    pr,
    outputs,
    git,
    require: () => ({ execFileSync: git }),
    github: {
      rest: {
        pulls: { get: vi.fn().mockResolvedValue({ data: pr }) }
      }
    },
    core: {
      setOutput: (name, value) => {
        outputs[name] = value;
      },
      info: vi.fn(),
      summary: { addRaw: vi.fn().mockReturnThis(), write: vi.fn() }
    },
    context: {
      eventName: 'pull_request',
      ref: 'refs/pull/11/merge',
      sha: 'c'.repeat(40),
      repo: { owner: 'owner', repo: 'repo' },
      payload: {
        repository: { full_name: 'owner/repo' },
        pull_request: structuredClone(pr)
      }
    },
    process: {
      env: {
        PR_NUMBER: '11',
        HEAD_SHA: head,
        BASE_SHA: base,
        HEAD_REF: 'feature',
        BASE_REF: 'main',
        COMPARISON: 'pr',
        COMPILE: 'false',
        TESTS: 'false'
      }
    }
  };
}

function run(id, sandbox) {
  const step = job.steps.find((step) => step.id === id);
  return new Script(
    `(async () => { ${step.with.script}\n })()`
  ).runInNewContext(sandbox, { timeout: 1000 });
}

describe('independent framework change classification', () => {
  it('always emits a required job without PR path-filter gaps or a pipeline caller', () => {
    expect(definition.on.pull_request.paths).toBeUndefined();
    expect(definition.on.pull_request.types).toContain('edited');
    expect(definition.on.workflow_call).toBeUndefined();
    expect(definition.on.workflow_dispatch.inputs.pr_number.required).toBe(
      true
    );
    expect(job.name).toBe('Framework CI / Required');
    expect(job.if).toBeUndefined();
    expect(definition.permissions).toEqual({
      contents: 'read',
      'pull-requests': 'read'
    });
    expect(definition.concurrency['cancel-in-progress']).toBe(true);
    for (const step of job.steps) {
      if (
        step.run?.includes('gh ') ||
        step.run?.includes('git diff --exit-code')
      ) {
        expect(step.if).toBe("steps.changes.outputs.compile == 'true'");
      }
      if (
        step.run?.includes('npm ') ||
        step.uses?.startsWith('actions/setup-node@')
      ) {
        expect(step.if).toBe("steps.changes.outputs.tests == 'true'");
      }
      if (step.uses?.startsWith('actions/setup-node@')) {
        expect(step.with.cache).toBeUndefined();
      }
    }
    const tests = job.steps.find((step) => step.run?.includes('npm ci'));
    expect(tests.run).toContain('npm ci --ignore-scripts');
    expect(tests.run).toContain('npm run test:framework');
    expect(tests.run).toContain('npm run lint:framework');
    expect(tests.run).not.toContain('npm run test:ci');
  });

  it.each(
    [
      [],
      ['apps/game/src/feature.js'],
      ['apps/game/tests/feature.test.js', 'apps/game/README.md'],
      ['apps/new-app/package.json', 'apps/new-app/vitest.config.js'],
      ['docs/pr-build.md', 'readme.md'],
      ['apps/game/src/a\n.github/workflows/not-a-workflow.js']
    ].map((files) => [files])
  )(
    'does not compile or run framework tests for app/document changes: %j',
    async (files) => {
      const sandbox = harness(files);
      await run('changes', sandbox);
      expect(sandbox.outputs).toEqual({ compile: 'false', tests: 'false' });
      expect(sandbox.git).toHaveBeenCalledWith(
        'git',
        [
          'diff',
          '--name-only',
          '--no-renames',
          '-z',
          `${base}...${head}`,
          '--'
        ],
        { encoding: 'utf8' }
      );
    }
  );

  it.each([
    '.github/workflows/pr-repair.md',
    '.github/workflows/pr-repair.lock.yml',
    '.github/workflows/pr-pipeline.yml',
    '.github/workflows/shared/prompt.md',
    '.github/aw/actions-lock.json',
    '.github/shared/instructions.md',
    '.github/CODEOWNERS',
    '.gitattributes'
  ])(
    'validates compiler inputs and framework regressions for %s',
    async (path) => {
      const sandbox = harness([path]);
      await run('changes', sandbox);
      expect(sandbox.outputs).toEqual({ compile: 'true', tests: 'true' });
    }
  );

  it.each([
    'tests/framework/workflows.test.js',
    'package.json',
    'package-lock.json',
    'vitest.config.js',
    '.eslintrc.json',
    '.prettierrc',
    '.npmrc'
  ])(
    'runs framework regressions without compiling workflows for %s',
    async (path) => {
      const sandbox = harness([path]);
      await run('changes', sandbox);
      expect(sandbox.outputs).toEqual({ compile: 'false', tests: 'true' });
    }
  );

  it('detects deletion or moving an input out of the framework tree', async () => {
    const sandbox = harness([
      '.github/workflows/deleted.md',
      'apps/game/moved.md'
    ]);
    await run('changes', sandbox);
    expect(sandbox.outputs.compile).toBe('true');
    expect(sandbox.git.mock.calls[0][1]).toContain('--no-renames');
  });

  it('classifies real Git app-only and renamed-workflow diffs', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'framework-ci-'));
    const git = (...args) =>
      execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
    try {
      git('init', '--quiet');
      git('config', 'user.name', 'Framework CI fixture');
      git('config', 'user.email', 'ci-fixture@example.invalid');
      git('config', 'commit.gpgsign', 'false');
      git('config', 'core.autocrlf', 'false');
      git('config', 'core.hooksPath', join(directory, 'no-hooks'));
      mkdirSync(join(directory, '.github', 'workflows'), { recursive: true });
      mkdirSync(join(directory, 'apps', 'sample'), { recursive: true });
      const source = join(directory, '.github', 'workflows', 'example.md');
      writeFileSync(source, 'fixture workflow\n');
      writeFileSync(
        join(directory, 'apps', 'sample', 'src.js'),
        'export const value = 1;\n'
      );
      git('add', '.');
      git('commit', '--quiet', '-m', 'fixture base');
      const initial = git('rev-parse', 'HEAD');
      writeFileSync(
        join(directory, 'apps', 'sample', 'src.js'),
        'export const value = 2;\n'
      );
      git('add', '.');
      git('commit', '--quiet', '-m', 'app-only fixture');
      const appHead = git('rev-parse', 'HEAD');
      const sandbox = harness();
      sandbox.git.mockImplementation((program, args, options) =>
        execFileSync(program, args, { ...options, cwd: directory })
      );
      sandbox.process.env.BASE_SHA = initial;
      sandbox.process.env.HEAD_SHA = appHead;
      await run('changes', sandbox);
      expect(sandbox.outputs).toEqual({ compile: 'false', tests: 'false' });

      renameSync(source, join(directory, 'apps', 'sample', 'moved.md'));
      git('add', '--all');
      git('commit', '--quiet', '-m', 'moved-workflow fixture');
      sandbox.process.env.BASE_SHA = appHead;
      sandbox.process.env.HEAD_SHA = git('rev-parse', 'HEAD');
      await run('changes', sandbox);
      expect(sandbox.outputs).toEqual({ compile: 'true', tests: 'true' });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('compares both push snapshots and handles an initial push explicitly', async () => {
    const sandbox = harness(['.github/workflows/pr-repair.md']);
    sandbox.process.env.COMPARISON = 'push';
    await run('changes', sandbox);
    expect(sandbox.git.mock.calls[0][1]).toEqual([
      'diff',
      '--name-only',
      '--no-renames',
      '-z',
      base,
      head,
      '--'
    ]);
    sandbox.process.env.BASE_SHA = '0'.repeat(40);
    await run('changes', sandbox);
    expect(sandbox.git.mock.calls[1][1]).toEqual([
      'ls-tree',
      '-r',
      '--name-only',
      '-z',
      head
    ]);
  });

  it('fails on a Git comparison error rather than certifying no changes', async () => {
    const sandbox = harness();
    sandbox.git.mockImplementation(() => {
      throw new Error('missing base object');
    });
    await expect(run('changes', sandbox)).rejects.toThrow(
      'missing base object'
    );
    expect(sandbox.outputs).toEqual({});
  });

  it.each(['', 'main', 'a; echo unsafe'])(
    'rejects an invalid comparison SHA: %s',
    async (sha) => {
      const sandbox = harness();
      sandbox.process.env.BASE_SHA = sha;
      await expect(run('changes', sandbox)).rejects.toThrow(
        'Invalid framework diff'
      );
      expect(sandbox.git).not.toHaveBeenCalled();
    }
  );
});

describe('framework check revision binding', () => {
  it('checks the PR head rather than the synthetic merge commit', async () => {
    const sandbox = harness();
    await run('revision', sandbox);
    expect(sandbox.outputs).toMatchObject({
      head_sha: head,
      base_sha: base,
      pr_number: '11',
      comparison: 'pr',
      head_ref: 'feature',
      base_ref: 'main'
    });
    const checkout = job.steps.find((step) =>
      step.uses?.startsWith('actions/checkout@')
    );
    expect(checkout.with.ref).toBe('${{ steps.revision.outputs.head_sha }}');
    expect(checkout.with['persist-credentials']).toBe(false);
  });

  it('accepts an exact same-repository dispatch after bot landing', async () => {
    const sandbox = harness();
    sandbox.context.eventName = 'workflow_dispatch';
    sandbox.context.ref = 'refs/heads/feature';
    sandbox.context.sha = head;
    sandbox.process.env.EXPECTED_HEAD_SHA = head;
    await run('revision', sandbox);
    expect(sandbox.outputs.head_sha).toBe(head);
  });

  it.each(['head', 'base'])(
    'rejects an event whose %s changed before it started',
    async (part) => {
      const sandbox = harness();
      sandbox.pr[part].sha = 'd'.repeat(40);
      await expect(run('revision', sandbox)).rejects.toThrow('Superseded');
    }
  );

  it('rejects dispatch from an unrelated branch even at the same SHA', async () => {
    const sandbox = harness();
    sandbox.context.eventName = 'workflow_dispatch';
    sandbox.context.sha = head;
    sandbox.context.ref = 'refs/heads/unrelated';
    await expect(run('revision', sandbox)).rejects.toThrow(
      'Stale framework dispatch'
    );
  });

  it('rejects a stale expected dispatch SHA', async () => {
    const sandbox = harness();
    sandbox.context.eventName = 'workflow_dispatch';
    sandbox.context.sha = head;
    sandbox.context.ref = 'refs/heads/feature';
    sandbox.process.env.EXPECTED_HEAD_SHA = base;
    await expect(run('revision', sandbox)).rejects.toThrow(
      'Stale framework dispatch'
    );
  });

  it.each(['closed', 'foreign repository', 'invalid PR'])(
    'rejects %s',
    async (condition) => {
      const sandbox = harness();
      if (condition === 'closed') sandbox.pr.state = 'closed';
      if (condition === 'foreign repository')
        sandbox.pr.base.repo.full_name = 'foreign/repo';
      if (condition === 'invalid PR')
        sandbox.context.payload.pull_request.number = 0;
      await expect(run('revision', sandbox)).rejects.toThrow();
    }
  );

  it('propagates API errors instead of passing an unverified revision', async () => {
    const sandbox = harness();
    sandbox.github.rest.pulls.get.mockRejectedValue(
      new Error('API unavailable')
    );
    await expect(run('revision', sandbox)).rejects.toThrow('API unavailable');
  });

  it('reports app-only success without claiming compiler execution', async () => {
    const sandbox = harness();
    await run('freshness', sandbox);
    expect(sandbox.core.summary.addRaw).toHaveBeenCalledWith(
      expect.stringContaining('were not needed')
    );
  });

  it.each(['head', 'base'])(
    'rejects a moved %s at completion',
    async (part) => {
      const sandbox = harness();
      sandbox.pr[part].sha = 'd'.repeat(40);
      await expect(run('freshness', sandbox)).rejects.toThrow(
        'results are stale'
      );
    }
  );

  it('rejects retargeting at the same base SHA and missing classification', async () => {
    const sandbox = harness();
    sandbox.pr.base.ref = 'release';
    await expect(run('freshness', sandbox)).rejects.toThrow(
      'results are stale'
    );
    sandbox.process.env.COMPILE = '';
    await expect(run('freshness', sandbox)).rejects.toThrow(
      'classification evidence'
    );
  });

  it('assigns the specified owner to compiler inputs, policy, and shared tooling', () => {
    const owners = readFileSync('.github/CODEOWNERS', 'utf8');
    for (const path of [
      '/.github/',
      '/tests/framework/',
      '/package.json',
      '/package-lock.json',
      '/vitest.config.js',
      '/.gitattributes'
    ]) {
      expect(owners).toContain(`${path} @sitoader`);
    }
  });
});
