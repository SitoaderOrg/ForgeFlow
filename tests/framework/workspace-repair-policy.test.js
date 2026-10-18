import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Script } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import yaml from 'js-yaml';

const require = createRequire(import.meta.url);
const source = readFileSync('.github/workflows/pr-repair.md', 'utf8');
const frontmatter = yaml.load(source.split(/^---\s*$/m)[1]);
const compiled = yaml.load(
  readFileSync('.github/workflows/pr-repair.lock.yml', 'utf8')
);
const validation = yaml.load(
  readFileSync('.github/workflows/pr-validate-repair.yml', 'utf8')
);
const guardName =
  'Validate the exact native repair bundle and dependency-only manifest edits';
const guard = frontmatter['safe-outputs'].steps.find(
  (step) => step.name === guardName
).with.script;
const inspect = validation.jobs.inspect.steps[0].with.script;
const original = 'a'.repeat(40);
const tip = 'b'.repeat(40);
const base = 'c'.repeat(40);
const manifestPaths = ['package.json', 'apps/sample/package.json'];
const dependencyPaths = [...manifestPaths, 'package-lock.json'];
const changed = (filename, status = 'modified', extra = {}) => ({
  filename,
  status,
  changes: 2,
  ...extra
});
const clone = (value) => JSON.parse(JSON.stringify(value));

function manifests() {
  const root = {
    name: 'workspace-project',
    private: true,
    workspaces: ['apps/*'],
    scripts: {
      lint: 'npm run lint --workspaces',
      build: 'npm run build --workspaces',
      'test:ci': 'npm run test:ci --workspaces'
    },
    devDependencies: { checker: '^1.0.0' }
  };
  const app = {
    name: '@sample/widget',
    version: '1.0.0',
    type: 'module',
    scripts: { 'test:ci': 'vitest run --coverage' },
    engines: { node: '>=22' },
    dependencies: { library: '^1.0.0' },
    devDependencies: { checker: '~1.0.0' },
    optionalDependencies: { optional: '1.0.0' },
    peerDependencies: { peer: '1.0.0' },
    coverage: { thresholds: { lines: 90 } }
  };
  return {
    'package.json': root,
    'apps/sample/package.json': app,
    'package-lock.json': {
      name: root.name,
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': clone(root),
        'apps/sample': clone(app),
        'apps/second': { name: 'second', version: '1.0.0' },
        'node_modules/@sample/widget': {
          resolved: 'apps/sample',
          link: true
        },
        'node_modules/second': { resolved: 'apps/second', link: true },
        'node_modules/library': {
          version: '1.0.0',
          resolved: 'https://registry.npmjs.org/library/-/library-1.0.0.tgz'
        }
      }
    }
  };
}

function fixture(kind, files, before = manifests(), after = clone(before)) {
  const outputs = {};
  const core = {
    info: vi.fn(),
    setOutput: vi.fn((name, value) => {
      outputs[name] = value;
    })
  };
  const repository = { full_name: 'owner/repo' };
  const parent = {
    number: 11,
    state: 'open',
    title: 'feat: sample application',
    body: 'Summary and validation',
    head: { ref: 'feature', sha: original, repo: repository },
    base: { ref: 'main', sha: base, repo: repository }
  };
  const repair = {
    number: 22,
    state: 'open',
    draft: false,
    user: { login: 'github-actions[bot]', type: 'Bot' },
    head: { ref: 'repair', sha: tip, repo: repository },
    base: parent.head
  };
  const state = {
    version: 1,
    repository: repository.full_name,
    initial_head_sha: original,
    feature: {
      number: parent.number,
      head_ref: parent.head.ref,
      head_sha: original,
      base_ref: 'main',
      base_sha: base,
      metadata_hash: createHash('sha256')
        .update(JSON.stringify([parent.title, parent.body]))
        .digest('hex')
    },
    repairs: []
  };
  const read = (ref, filename) => {
    const value = (ref === original ? before : after)[filename];
    if (value === undefined)
      throw new Error(`Missing fixture ${ref}:${filename}`);
    return JSON.stringify(value);
  };
  const git = vi.fn(async (command, args) => {
    expect(command).toBe('git');
    let stdout = '';
    if (args[0] === 'bundle' && args[1] === 'unbundle') {
      stdout = `${tip} refs/heads/repair\n`;
    } else if (args[0] === 'diff') {
      expect(args).toEqual([
        'diff',
        '--name-status',
        '-z',
        '--find-renames',
        original,
        tip
      ]);
      stdout = files
        .flatMap((file) => [
          {
            added: 'A',
            modified: 'M',
            removed: 'D',
            renamed: 'R100',
            changed: 'T'
          }[file.status],
          ...(file.previous_filename ? [file.previous_filename] : []),
          file.filename
        ])
        .join('\0');
    } else if (args[0] === 'show') {
      const [ref, filename] = args[1].split(':');
      stdout = read(ref, filename);
    } else {
      expect(['bundle', 'merge-base']).toContain(args[0]);
    }
    return { stdout };
  });
  const resolveTransportPaths = vi.fn(() => ({ bundlePath: 'native.bundle' }));
  const sandbox = {
    Buffer,
    core,
    exec: { getExecOutput: git },
    io: {},
    getOctokit: vi.fn(),
    require: (name) => {
      if (name === 'node:fs') {
        return {
          readFileSync: () =>
            JSON.stringify({ items: [{ type: 'create_pull_request' }] }),
          existsSync: () => true
        };
      }
      if (name.endsWith('setup_globals.cjs')) return { setupGlobals: vi.fn() };
      if (name.endsWith('resolve_transport_paths.cjs'))
        return { resolveTransportPaths };
      return require(name);
    },
    context: {
      repo: { owner: 'owner', repo: 'repo' },
      payload: { repository: { ...repository, default_branch: 'main' } }
    },
    process: {
      env: {
        RUNNER_TEMP: 'runner-artifacts',
        AGENT_OUTPUT: 'agent-output.json',
        GITHUB_REPOSITORY: repository.full_name,
        REPAIR_KIND: kind,
        EXPECTED_HEAD_SHA: original,
        KIND: kind,
        PARENT_PR: '11',
        REPAIR_PR: '22',
        PARENT_REF: 'feature',
        PARENT_SHA: original,
        BASE_REF: 'main',
        BASE_SHA: base,
        BASELINE: JSON.stringify({
          lint: 'success',
          build: 'failure',
          test: 'failure',
          security: 'failure',
          docs: 'failure'
        }),
        STATE: JSON.stringify(state)
      }
    },
    github: {
      rest: {
        pulls: {
          get: vi.fn(async ({ pull_number }) => ({
            data: pull_number === 11 ? parent : repair
          })),
          listFiles: vi.fn()
        },
        repos: {
          getContent: vi.fn(async ({ ref, path }) => {
            const content = read(ref, path);
            return {
              data: {
                type: 'file',
                encoding: 'base64',
                size: Buffer.byteLength(content),
                content: Buffer.from(content).toString('base64')
              }
            };
          })
        }
      },
      paginate: vi.fn(async () => files),
      request: vi.fn(async (route) => ({
        data: route.endsWith('/stacks')
          ? []
          : { status: 'ahead', merge_base_commit: { sha: original } }
      }))
    }
  };
  return { sandbox, outputs, git, resolveTransportPaths };
}

async function execute(script, kind, files, before, after) {
  const result = fixture(kind, files, before, after);
  await new Script(`(async () => { ${script}\n })()`).runInNewContext(
    result.sandbox,
    { timeout: 1000 }
  );
  return result;
}

describe.each([
  ['native bundle publisher', guard],
  ['scoped validator', inspect]
])('%s workspace policy', (_name, script) => {
  it.each([
    'apps/sample/src/main.js',
    'apps/sample/src/component.jsx',
    'apps/sample/src/main.ts',
    'apps/sample/src/component.tsx',
    'apps/sample/src/module.mjs',
    'apps/sample/src/module.cjs',
    'apps/sample/src/module.mts',
    'apps/sample/src/module.cts',
    'apps/sample/src/style.css',
    'apps/sample/index.html',
    'apps/sample/src/data.json',
    'apps/another/tests/behavior.test.js',
    'apps/sample/tests/behavior.test.ts',
    'apps/sample/src/__tests__/component.spec.tsx',
    'apps/sample/src/component.test.jsx',
    'apps/sample/test/behavior.js',
    'apps/sample/tests/fixtures/payload.txt',
    'apps/sample/tests/fixtures/settings.yaml',
    'apps/sample/tests/fixtures/image.svg',
    'apps/sample/tests/__snapshots__/behavior.test.js.snap',
    'apps/sample/src/__fixtures__/sample.json',
    'apps/sample/src/__snapshots__/behavior.snap'
  ])('allows app source and test fixtures: %s', async (filename) => {
    await execute(script, 'test', [changed(filename, 'added')]);
  });

  const frameworkFiles = readdirSync('tests/framework').map(
    (file) => `tests/framework/${file}`
  );
  it.each([
    ...frameworkFiles,
    'tests/new-governance.test.js',
    'tests/framework/fixtures/data.json',
    'tests/framework/README.md'
  ])('protects every root framework/test path: %s', async (filename) => {
    for (const kind of [
      'lint',
      'build',
      'test',
      'security',
      'docs',
      'metadata'
    ]) {
      await expect(
        execute(script, kind, [changed(filename)])
      ).rejects.toThrow();
    }
  });

  it.each([
    '.github/workflows/pr-test.yml',
    'apps/sample/.github/policy.json',
    'apps/sample/.env',
    'apps/sample/src/.hidden/settings.json',
    'apps/sample/AGENTS.md',
    'apps/sample/CLAUDE.md',
    'apps/sample/tests/SKILL.md',
    'apps/sample/copilot-instructions.md',
    'apps/sample/instructions.md',
    'apps/sample/typescript.instructions.md',
    'apps/sample/SECURITY.md',
    'apps/sample/CODEOWNERS',
    'apps/sample/vitest.config.ts',
    'apps/sample/vitest.workspace.js',
    'apps/sample/vite.config.mjs',
    'apps/sample/eslint.config.js',
    'apps/sample/prettier.config.cjs',
    'apps/sample/jest.config.ts',
    'apps/sample/playwright.config.ts',
    'apps/sample/tests/quality.config.json',
    'apps/sample/tsconfig.json',
    'apps/sample/tsconfig.build.json',
    'apps/sample/jsconfig.json',
    'apps/sample/.eslintrc.json',
    'apps/sample/tests/fixtures/package.json',
    'apps/sample/package-lock.json',
    'apps/sample/tests/fixtures/package-lock.json',
    'apps/sample/tests/fixtures/npm-shrinkwrap.json',
    'apps/sample/tests/fixtures/yarn.lock',
    'apps/sample/tests/fixtures/pnpm-lock.yaml',
    'apps/sample/tests/fixtures/bun.lock'
  ])(
    'protects app configuration, instructions, and lockfiles: %s',
    async (filename) => {
      await expect(
        execute(script, 'build', [changed(filename)])
      ).rejects.toThrow('out-of-scope');
    }
  );

  it.each([
    'apps/sample/tests/behavior.test.js',
    'apps/sample/__tests__/behavior.tsx',
    'apps/sample/src/behavior.spec.mjs',
    'apps/sample/src/behavior.test.cts',
    'apps/sample/test/behavior.js',
    'apps/sample/tests/fixtures/input.txt',
    'apps/sample/src/__fixtures__/input.json',
    'apps/sample/src/__snapshots__/behavior.snap'
  ])(
    'blocks deletion and rename test-discovery bypasses: %s',
    async (filename) => {
      await expect(
        execute(script, 'test', [changed(filename, 'removed')])
      ).rejects.toThrow('out-of-scope');
      await expect(
        execute(script, 'test', [
          changed('apps/sample/src/helper.js', 'renamed', {
            previous_filename: filename
          })
        ])
      ).rejects.toThrow('out-of-scope');
    }
  );

  it('rejects moving protected root tests into an app', async () => {
    await expect(
      execute(script, 'test', [
        changed('apps/sample/tests/governance.test.js', 'renamed', {
          previous_filename: 'tests/framework/governance.test.js'
        })
      ])
    ).rejects.toThrow('out-of-scope');
  });

  it.each(manifestPaths)(
    'allows only build/security version edits to %s',
    async (filename) => {
      const before = manifests();
      const after = clone(before);
      after[filename].devDependencies.checker = '^1.0.1';
      for (const kind of ['build', 'security']) {
        await execute(script, kind, [changed(filename)], before, after);
      }
      for (const kind of ['lint', 'test', 'docs', 'metadata']) {
        await expect(
          execute(script, kind, [changed(filename)], before, after)
        ).rejects.toThrow();
      }
    }
  );

  it.each(dependencyPaths)(
    'cannot create, remove, or rename %s',
    async (filename) => {
      for (const status of ['added', 'removed', 'renamed']) {
        await expect(
          execute(script, 'security', [
            changed(
              filename,
              status,
              status === 'renamed'
                ? { previous_filename: 'apps/another/package.json' }
                : {}
            )
          ])
        ).rejects.toThrow('out-of-scope');
      }
      await expect(
        execute(script, 'security', [
          changed('apps/sample/renamed.json', 'renamed', {
            previous_filename: filename
          })
        ])
      ).rejects.toThrow('out-of-scope');
    }
  );

  it.each([
    ['scripts', { 'test:ci': 'exit 0' }],
    ['engines', { node: '*' }],
    ['workspaces', ['apps/*', 'other/*']],
    ['name', 'different-name'],
    ['version', '2.0.0'],
    ['private', false],
    ['coverage', { thresholds: { lines: 0 } }],
    ['overrides', { checker: '0.0.1' }],
    ['packageManager', 'npm@1.0.0']
  ])(
    'rejects manifest %s tampering for both root and app',
    async (key, value) => {
      for (const filename of manifestPaths) {
        const before = manifests();
        const after = clone(before);
        after[filename][key] = value;
        await expect(
          execute(script, 'security', [changed(filename)], before, after)
        ).rejects.toThrow('package scripts');
      }
    }
  );

  it.each([
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies'
  ])(
    'rejects %s key/field tampering and non-registry replacements',
    async (field) => {
      const filename = 'apps/sample/package.json';
      const before = manifests();
      const name = Object.keys(before[filename][field])[0];
      for (const mutation of [
        (pkg) => {
          pkg[field].injected = '1.0.0';
        },
        (pkg) => {
          delete pkg[field][name];
        },
        (pkg) => {
          delete pkg[field];
        },
        (pkg) => {
          pkg[field][name] = 'file:../other';
        },
        (pkg) => {
          pkg[field][name] = 'https://example.invalid/pkg.tgz';
        },
        (pkg) => {
          pkg[field][name] = { version: '1.0.1' };
        }
      ]) {
        const after = clone(before);
        mutation(after[filename]);
        await expect(
          execute(script, 'build', [changed(filename)], before, after)
        ).rejects.toThrow();
      }
    }
  );

  it('cannot replace a local dependency with a registry package', async () => {
    const before = manifests();
    before['package.json'].devDependencies.local = 'file:apps/sample';
    const after = clone(before);
    after['package.json'].devDependencies.local = '1.0.1';
    await expect(
      execute(script, 'build', [changed('package.json')], before, after)
    ).rejects.toThrow('concrete registry version');
  });

  it.each(manifestPaths)(
    'preserves dependency keys and field shapes in %s',
    async (filename) => {
      const before = manifests();
      before[filename].dependencies = {};
      for (const mutate of [
        (pkg) => {
          pkg.devDependencies.injected = '1.0.0';
        },
        (pkg) => {
          delete pkg.devDependencies.checker;
        },
        (pkg) => {
          pkg.dependencies = null;
        },
        (pkg) => {
          pkg.dependencies = [];
        },
        (pkg) => {
          delete pkg.dependencies;
        },
        (pkg) => {
          pkg.dependencies.injected = '1.0.0';
        }
      ]) {
        const after = clone(before);
        mutate(after[filename]);
        await expect(
          execute(script, 'build', [changed(filename)], before, after)
        ).rejects.toThrow();
      }
    }
  );

  it('allows immutable JSON key reordering without weakening the checks', async () => {
    const before = manifests();
    const after = clone(before);
    after['apps/sample/package.json'] = Object.fromEntries(
      Object.entries(after['apps/sample/package.json']).reverse()
    );
    after['apps/sample/package.json'].dependencies.library = '~1.0.1';
    await execute(
      script,
      'build',
      [changed('apps/sample/package.json')],
      before,
      after
    );
  });

  it('allows version bumps and external transitive lock graph changes', async () => {
    const before = manifests();
    const after = clone(before);
    const lock = after['package-lock.json'];
    lock.packages[''].devDependencies.checker = '^1.0.1';
    lock.packages['apps/sample'].dependencies.library = '^1.0.1';
    lock.packages['node_modules/library'].version = '1.0.1';
    lock.packages['node_modules/library'].dependencies = {
      transitive: '^2.0.0'
    };
    lock.packages['node_modules/transitive'] = { version: '2.0.0' };
    for (const kind of ['build', 'security']) {
      await execute(
        script,
        kind,
        [changed('package-lock.json')],
        before,
        after
      );
    }
    for (const kind of ['lint', 'test', 'docs', 'metadata']) {
      await expect(
        execute(script, kind, [changed('package-lock.json')], before, after)
      ).rejects.toThrow();
    }
  });

  it.each([
    [
      'identity',
      (lock) => {
        lock.name = 'replacement';
      }
    ],
    [
      'format',
      (lock) => {
        lock.lockfileVersion = 2;
      }
    ],
    [
      'root entry removal',
      (lock) => {
        delete lock.packages[''];
      }
    ],
    [
      'root scripts',
      (lock) => {
        lock.packages[''].scripts.build = 'exit 0';
      }
    ],
    [
      'root workspaces',
      (lock) => {
        lock.packages[''].workspaces = ['*'];
      }
    ],
    [
      'workspace addition',
      (lock) => {
        lock.packages['apps/injected'] = {};
      }
    ],
    [
      'workspace removal',
      (lock) => {
        delete lock.packages['apps/sample'];
      }
    ],
    [
      'workspace name',
      (lock) => {
        lock.packages['apps/sample'].name = 'second';
      }
    ],
    [
      'workspace scripts',
      (lock) => {
        lock.packages['apps/sample'].scripts['test:ci'] = 'exit 0';
      }
    ],
    [
      'workspace engines',
      (lock) => {
        lock.packages['apps/sample'].engines.node = '*';
      }
    ],
    [
      'workspace dependencies',
      (lock) => {
        lock.packages['apps/sample'].dependencies.injected = '1.0.0';
      }
    ],
    [
      'link swap',
      (lock) => {
        lock.packages['node_modules/@sample/widget'].resolved = 'apps/second';
      }
    ],
    [
      'link removal',
      (lock) => {
        delete lock.packages['node_modules/@sample/widget'];
      }
    ],
    [
      'registry substitution',
      (lock) => {
        lock.packages['node_modules/@sample/widget'] = { version: '1.0.1' };
      }
    ],
    [
      'link injection',
      (lock) => {
        lock.packages['node_modules/injected'] = {
          resolved: 'apps/sample',
          link: true
        };
      }
    ],
    [
      'legacy link injection',
      (lock) => {
        lock.dependencies = { injected: { version: 'file:apps/sample' } };
      }
    ]
  ])('rejects lockfile %s tampering', async (_label, mutate) => {
    const before = manifests();
    const after = clone(before);
    mutate(after['package-lock.json']);
    await expect(
      execute(script, 'security', [changed('package-lock.json')], before, after)
    ).rejects.toThrow();
  });

  it('permits docs only without dependencies, source, or framework files', async () => {
    await execute(script, 'docs', [changed('apps/sample/README.md')]);
    await expect(
      execute(script, 'docs', [changed('apps/sample/src/main.ts')])
    ).rejects.toThrow('out-of-scope');
  });
});

describe('native publication and validator coherence', () => {
  it('keeps the embedded scope and manifest/lock policy identical', () => {
    const policy = (script) =>
      script.slice(
        script.indexOf('// Keep native publisher'),
        script.indexOf('const readJson =')
      );
    expect(policy(guard)).toBe(policy(inspect));
    const generatedGuard = compiled.jobs.safe_outputs.steps.find(
      (step) => step.name === guardName
    );
    expect(generatedGuard.with.script).toBe(guard);
    expect(generatedGuard.if).toContain("inputs.repair_kind != 'metadata'");
  });

  it('publishes app paths but never root tests and keeps native ownership', () => {
    const publisher = frontmatter['safe-outputs']['create-pull-request'];
    expect(publisher['allowed-files']).toContain('apps/**');
    expect(publisher['allowed-files']).not.toContain('tests/**');
    expect(publisher['protected-files'].exclude).toContain(
      'apps/*/package.json'
    );
    expect(publisher['patch-format']).toBe('bundle');
    expect(publisher.stacked).toBe(false);
    expect(publisher['auto-merge']).toBe(false);
    expect(publisher['base-branch']).toBe('${{ inputs.head_ref }}');
    expect(frontmatter['safe-outputs']['update-pull-request'].target).toBe(
      '${{ inputs.feature_pr_number }}'
    );
    expect(source).toContain(
      'npm run test:ci --workspace <name> -- <selectors>'
    );
    expect(source).not.toContain('apps/ferret-heist');
    expect(source).toContain('created_pr_number');
    expect(source).toContain('created_pr_url');
    expect(source).toContain('initial_head_sha');
  });

  it.each(dependencyPaths)(
    'requires security for a permitted edit to %s',
    async (filename) => {
      const result = await execute(inspect, 'build', [changed(filename)]);
      expect(result.outputs).toMatchObject({
        security: 'true',
        build: 'true',
        lint: 'true',
        head_sha: tip
      });
      expect(result.sandbox.github.rest.repos.getContent).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        path: filename,
        ref: original
      });
      expect(result.sandbox.github.rest.repos.getContent).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        path: filename,
        ref: tip
      });
    }
  );

  it('does not demand dependency security for an app-only test repair', async () => {
    const result = await execute(inspect, 'test', [
      changed('apps/sample/tests/behavior.test.ts')
    ]);
    expect(result.outputs.security).toBe('false');
    expect(result.outputs.test).toBe('true');
  });

  it('checks the exact native bundle against the parent without writing refs', async () => {
    const result = await execute(guard, 'test', [
      changed('apps/sample/tests/behavior.test.ts')
    ]);
    expect(result.resolveTransportPaths).toHaveBeenCalledWith(
      { type: 'create_pull_request' },
      'owner/repo'
    );
    expect(result.git.mock.calls.map((call) => call[1])).toEqual([
      ['bundle', 'verify', 'native.bundle'],
      ['bundle', 'unbundle', 'native.bundle'],
      ['merge-base', '--is-ancestor', original, tip],
      ['diff', '--name-status', '-z', '--find-renames', original, tip]
    ]);
  });
});
