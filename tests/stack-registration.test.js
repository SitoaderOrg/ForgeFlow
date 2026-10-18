import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { Script } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import yaml from 'js-yaml';

const require = createRequire(import.meta.url);
const definition = yaml.load(
  readFileSync('.github/workflows/pr-register-repair-stack.yml', 'utf8')
);
const script = definition.jobs.register.steps[0].with.script;
const head = 'a'.repeat(40);
const base = 'b'.repeat(40);
const repository = 'owner/repo';

function fixture(count = 2, registered = count > 2 ? count - 1 : 0) {
  const metadata = createHash('sha256')
    .update(JSON.stringify(['feat: example', 'Feature description']))
    .digest('hex');
  const feature = {
    number: 11,
    head_ref: 'feature',
    head_sha: head,
    base_ref: 'main',
    base_sha: base,
    metadata_hash: metadata
  };
  const repairs = Array.from({ length: count }, (_, index) => ({
    number: 21 + index,
    head_ref: `repair/${index + 1}`,
    head_sha: (index + 1).toString(16).repeat(40),
    base_ref: index ? `repair/${index}` : 'feature',
    base_sha: index ? index.toString(16).repeat(40) : head,
    kind: index ? 'test' : 'lint',
    check_id: 100 + index,
    validation_run_id: 900 + index
  }));
  const state = {
    version: 1,
    repository,
    initial_head_sha: head,
    feature,
    round: count,
    stack_number: count > 2 ? 7 : null,
    repairs
  };
  const prs = [feature, ...repairs].map((entry) => ({
    number: entry.number,
    node_id: randomUUID(),
    state: 'open',
    draft: false,
    merged: false,
    auto_merge: null,
    title: 'feat: example',
    body: 'Feature description',
    user:
      entry.number === 11
        ? { login: 'author', type: 'User' }
        : { login: 'github-actions[bot]', type: 'Bot' },
    head: {
      ref: entry.head_ref,
      sha: entry.head_sha,
      repo: { full_name: repository }
    },
    base: {
      ref: entry.base_ref,
      sha: entry.base_sha,
      repo: { full_name: repository }
    }
  }));
  const outputs = {};
  const live = { count: registered };
  const stack = () => ({
    number: 7,
    base: { ref: 'feature' },
    open: true,
    pull_requests: repairs.slice(0, live.count).map((entry) => ({
      number: entry.number,
      state: 'open',
      draft: false,
      merged_at: null,
      head: { ref: entry.head_ref, sha: entry.head_sha }
    }))
  });
  const github = {
    rest: {
      pulls: {
        get: vi.fn(async ({ pull_number }) => ({
          data: prs.find((pr) => pr.number === pull_number)
        }))
      },
      git: {
        getRef: vi.fn(async ({ ref }) => ({
          data: {
            object: {
              sha: prs.find((pr) => `heads/${pr.head.ref}` === ref)?.head.sha
            }
          }
        }))
      },
      checks: {
        get: vi.fn(async ({ check_run_id }) => {
          const entry = repairs.find(
            (repair) => repair.check_id === check_run_id
          );
          return {
            data: {
              name: 'Scoped repair validation',
              head_sha: entry.head_sha,
              status: 'completed',
              conclusion: 'success',
              app: { slug: 'github-actions' },
              details_url: `https://github.com/${repository}/actions/runs/${entry.validation_run_id}`
            }
          };
        })
      }
    },
    request: vi.fn(async (route, parameters) => {
      if (route.startsWith('POST ')) {
        live.count = repairs.length;
        return { data: stack() };
      }
      if (route.includes('{stack_number}')) return { data: stack() };
      const index = repairs.findIndex(
        (entry) => entry.number === parameters.pull_request
      );
      return { data: index >= 0 && index < live.count ? [stack()] : [] };
    })
  };
  const sandbox = {
    require,
    github,
    process: { env: { STATE: JSON.stringify(state) } },
    core: {
      setOutput: (key, value) => {
        outputs[key] = value;
      },
      notice: vi.fn()
    },
    context: {
      repo: { owner: 'owner', repo: 'repo' },
      serverUrl: 'https://github.com',
      payload: { repository: { full_name: repository, default_branch: 'main' } }
    }
  };
  const run = () =>
    new Script(`(async () => { ${script}\n })()`).runInNewContext(sandbox, {
      timeout: 1000
    });
  const mutations = () =>
    github.request.mock.calls.filter(([route]) => route.startsWith('POST '));
  return {
    state,
    repairs,
    feature,
    prs,
    github,
    sandbox,
    outputs,
    live,
    stack,
    run,
    mutations
  };
}

describe('native repair stack registration', () => {
  it('keeps one repair standalone without inventing an empty extra PR', async () => {
    const f = fixture(1);
    await f.run();
    expect(JSON.parse(f.outputs.state).stack_number).toBeNull();
    expect(f.mutations()).toEqual([]);
  });

  it('registers only the two repair PRs, never the feature PR', async () => {
    const f = fixture();
    await f.run();
    expect(f.mutations()).toEqual([
      [
        'POST /repos/{owner}/{repo}/stacks',
        expect.objectContaining({ pull_requests: [21, 22] })
      ]
    ]);
    expect(JSON.parse(f.outputs.state)).toMatchObject({
      stack_number: 7,
      initial_head_sha: head,
      feature: { number: 11, head_sha: head }
    });
  });

  it('appends only the newest member to the same stack', async () => {
    const f = fixture(3);
    await f.run();
    expect(f.mutations()).toEqual([
      [
        'POST /repos/{owner}/{repo}/stacks/{stack_number}/add',
        expect.objectContaining({ stack_number: 7, pull_requests: [23] })
      ]
    ]);
  });

  it('recognizes an already-completed create after an interrupted response', async () => {
    const f = fixture(2, 2);
    await f.run();
    expect(f.mutations()).toEqual([]);
    expect(JSON.parse(f.outputs.state).stack_number).toBe(7);
  });

  it('recognizes an already-completed append without recreating the stack', async () => {
    const f = fixture(3, 3);
    await f.run();
    expect(f.mutations()).toEqual([]);
    expect(JSON.parse(f.outputs.state).repairs.map((pr) => pr.number)).toEqual([
      21, 22, 23
    ]);
  });

  it.each([
    { draft: true },
    { auto_merge: { enabled_by: 'someone' } },
    { state: 'closed', merged: true },
    { user: { login: 'other', type: 'User' } }
  ])(
    'rejects ineligible layer state without mutating metadata: %j',
    async (change) => {
      const f = fixture();
      Object.assign(f.prs[1], change);
      await expect(f.run()).rejects.toThrow('not an eligible');
      expect(f.mutations()).toEqual([]);
    }
  );

  it('refuses to register a feature PR that already belongs to a stack', async () => {
    const f = fixture();
    const original = f.github.request.getMockImplementation();
    f.github.request.mockImplementation((route, input) =>
      input.pull_request === 11
        ? { data: [{ number: 99 }] }
        : original(route, input)
    );
    await expect(f.run()).rejects.toThrow('must remain outside');
    expect(f.mutations()).toEqual([]);
  });

  it('rejects branch movement even if the PR resource still reports the old SHA', async () => {
    const f = fixture();
    f.github.rest.git.getRef.mockResolvedValue({
      data: { object: { sha: 'f'.repeat(40) } }
    });
    await expect(f.run()).rejects.toThrow('branch moved');
    expect(f.mutations()).toEqual([]);
  });

  it('rejects check evidence from a different commit or publisher', async () => {
    const f = fixture();
    f.github.rest.checks.get.mockResolvedValue({
      data: {
        name: 'Scoped repair validation',
        head_sha: nextHash(),
        status: 'completed',
        conclusion: 'success',
        app: { slug: 'another-app' }
      }
    });
    await expect(f.run()).rejects.toThrow('scoped-check evidence');
    expect(f.mutations()).toEqual([]);
  });

  it('rejects wrong target/order in existing native metadata', async () => {
    const f = fixture(3);
    const original = f.github.request.getMockImplementation();
    f.github.request.mockImplementation((route, input) => {
      if (route.includes('{stack_number}')) {
        const stack = f.stack();
        stack.pull_requests.reverse();
        return { data: stack };
      }
      return original(route, input);
    });
    await expect(f.run()).rejects.toThrow('exact repair-only membership');
    expect(f.mutations()).toEqual([]);
  });

  it('rechecks root freshness immediately before mutating native metadata', async () => {
    const f = fixture();
    let roots = 0;
    const original = f.github.rest.pulls.get.getMockImplementation();
    f.github.rest.pulls.get.mockImplementation((input) => {
      if (input.pull_number === 11 && ++roots === 2)
        f.prs[0].head.sha = nextHash();
      return original(input);
    });
    await expect(f.run()).rejects.toThrow('Feature PR changed');
    expect(f.mutations()).toEqual([]);
  });

  it('fails on unknown API shape rather than assuming no membership', async () => {
    const f = fixture();
    f.github.request.mockResolvedValue({ data: { stacks: [] } });
    await expect(f.run()).rejects.toThrow('Unknown native stack membership');
    expect(f.mutations()).toEqual([]);
  });

  it('does not hide a failed native registration request', async () => {
    const f = fixture();
    const original = f.github.request.getMockImplementation();
    f.github.request.mockImplementation((route, input) => {
      if (route.startsWith('POST ')) throw new Error('registration denied');
      return original(route, input);
    });
    await expect(f.run()).rejects.toThrow('registration denied');
    expect(f.outputs.state).toBeUndefined();
  });

  it('rejects unexpected postconditions without publishing success-shaped state', async () => {
    const f = fixture();
    const original = f.github.request.getMockImplementation();
    f.github.request.mockImplementation(async (route, input) => {
      const result = await original(route, input);
      if (route.startsWith('POST ')) result.data.base.ref = 'main';
      return result;
    });
    await expect(f.run()).rejects.toThrow('exact repair-only membership');
    expect(f.outputs.state).toBeUndefined();
  });
});

function nextHash() {
  return 'e'.repeat(40);
}
