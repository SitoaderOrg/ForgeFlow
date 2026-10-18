import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { Script } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import yaml from 'js-yaml';

const require = createRequire(import.meta.url);
const definition = yaml.load(
  readFileSync('.github/workflows/pr-land-repair-stack.yml', 'utf8')
);
const step = definition.jobs.land.steps.find((entry) => entry.with?.script);
const script = new Script(`(async () => { ${step.with.script}\n })()`);
const oid = (digit) => digit.repeat(40);
const operation = '630b9d5e-3f2a-4f7e-8b0c-2d5f9a8c1e42';
const routes = {
  repository: 'GET /repos/{owner}/{repo}',
  pull: 'GET /repos/{owner}/{repo}/pulls/{pull_number}',
  refs: 'GET /repos/{owner}/{repo}/git/ref/{ref}',
  stacks: 'GET /repos/{owner}/{repo}/stacks',
  detail: 'GET /repos/{owner}/{repo}/stacks/{stack_number}',
  check: 'GET /repos/{owner}/{repo}/check-runs/{check_run_id}',
  rules: 'GET /repos/{owner}/{repo}/rules/branches/{branch}',
  commit: 'GET /repos/{owner}/{repo}/git/commits/{commit_sha}',
  submit: 'PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge-async',
  poll: 'GET /repos/{owner}/{repo}/pulls/{pull_number}/merge-async/{uuid}',
  comment: 'POST /repos/{owner}/{repo}/issues/{issue_number}/comments'
};
const response = (data, status = 200, headers = {}) => ({
  data: structuredClone(data),
  status,
  headers
});
const hash = (pr) =>
  createHash('sha256')
    .update(JSON.stringify([pr.title, pr.body || '']))
    .digest('hex');

function harness(count = 2) {
  const repository = {
    full_name: 'owner/repo',
    default_branch: 'main',
    allow_squash_merge: true,
    archived: false,
    disabled: false
  };
  const feature = {
    number: 11,
    head_ref: 'feature/repair',
    head_sha: oid('a'),
    base_ref: 'main',
    base_sha: oid('b')
  };
  const repairs = Array.from({ length: count }, (_, i) => ({
    number: 30 - i,
    head_ref: `repair/${i}`,
    head_sha: oid(i ? 'd' : 'c'),
    base_ref: i ? 'repair/0' : feature.head_ref,
    base_sha: i ? oid('c') : feature.head_sha,
    kind: i ? 'test' : 'lint',
    check_id: 50 + i,
    validation_run_id: 60 + i
  }));
  const state = {
    version: 1,
    repository: repository.full_name,
    initial_head_sha: feature.head_sha,
    feature,
    round: 0,
    stack_number: count > 1 ? 42 : null,
    repairs
  };
  const prs = new Map(
    [feature, ...repairs].map((snapshot) => [
      snapshot.number,
      {
        number: snapshot.number,
        state: 'open',
        draft: false,
        locked: false,
        auto_merge: null,
        merged: false,
        merged_at: null,
        merge_commit_sha: null,
        title: 'A validated feature',
        body: 'Description',
        user:
          snapshot === feature
            ? { login: 'human', type: 'User' }
            : { login: 'github-actions[bot]', type: 'Bot' },
        head: {
          ref: snapshot.head_ref,
          sha: snapshot.head_sha,
          repo: repository
        },
        base: {
          ref: snapshot.base_ref,
          sha: snapshot.base_sha,
          repo: repository
        }
      }
    ])
  );
  feature.metadata_hash = hash(prs.get(feature.number));
  const h = {
    state,
    prs,
    repository,
    merged: false,
    outputs: {},
    hooks: {},
    clock: 1800000000000,
    refs: new Map([
      [feature.base_ref, feature.base_sha],
      ...[feature, ...repairs].map((pr) => [pr.head_ref, pr.head_sha])
    ]),
    checks: new Map(
      repairs.map((pr) => [
        pr.check_id,
        {
          id: pr.check_id,
          name: 'Scoped repair validation',
          head_sha: pr.head_sha,
          status: 'completed',
          conclusion: 'success',
          app: { slug: 'github-actions' },
          details_url: `https://github.com/owner/repo/actions/runs/${pr.validation_run_id}`
        }
      ])
    ),
    commits: new Map([
      [
        repairs.at(-1).head_sha,
        { sha: repairs.at(-1).head_sha, tree: { sha: oid('9') } }
      ],
      ...repairs.map((_, i) => [
        oid(i ? 'f' : 'e'),
        {
          sha: oid(i ? 'f' : 'e'),
          tree: { sha: oid(i === count - 1 ? '9' : '8') },
          parents: [{ sha: i ? oid('e') : feature.head_sha }]
        }
      ])
    ])
  };
  h.final = oid(count === 1 ? 'e' : 'f');
  h.pending = (details = {}, status = 202, headers = {}) =>
    response(
      {
        status: 'pending',
        details: {
          message: 'Merge request enqueued.',
          uuid: operation,
          expected_head_sha: repairs.at(-1).head_sha,
          merge_method: 'squash',
          merge_action: 'direct_merge',
          ...details
        }
      },
      status,
      headers
    );
  h.done = () =>
    response({
      status: 'merged',
      details: { message: 'Pull request was merged.', sha: h.final }
    });
  h.finish = () => {
    h.merged = true;
    repairs.forEach((snapshot, i) => {
      Object.assign(prs.get(snapshot.number), {
        state: 'closed',
        merged: true,
        merged_at: '2026-10-18T10:00:00Z',
        merge_commit_sha: oid(i ? 'f' : 'e')
      });
    });
    prs.get(feature.number).head.sha = h.final;
    h.refs.set(feature.head_ref, h.final);
    h.onMerged?.();
  };
  h.stack = (detail = false) => ({
    id: 9876543,
    number: 42,
    node_id: 'S_kwDOABCDEF4AAAAA',
    url: 'https://api.github.com/repos/owner/repo/stacks/42',
    base: { ref: feature.head_ref },
    open: !h.merged,
    created_at: '2026-10-18T09:00:00Z',
    pull_requests: repairs.map(({ number }) => {
      const pr = prs.get(number);
      return {
        number,
        state: pr.state,
        draft: pr.draft,
        merged_at: pr.merged_at,
        head: structuredClone(pr.head),
        ...(detail
          ? {
              id: number * 100,
              node_id: `PR_${number}`,
              title: pr.title,
              html_url: `https://github.com/owner/repo/pull/${number}`,
              url: `https://api.github.com/repos/owner/repo/pulls/${number}`,
              user: pr.user,
              base: structuredClone(pr.base)
            }
          : {})
      };
    })
  });
  h.polls = [h.done()];
  h.submission = h.pending();
  const fallback = async (route, parameters) => {
    switch (route) {
      case routes.repository:
        return response(h.repository);
      case routes.pull:
        return response(h.prs.get(parameters.pull_number));
      case routes.refs:
        return response({
          ref: `refs/${parameters.ref}`,
          object: {
            type: 'commit',
            sha: h.refs.get(parameters.ref.slice('heads/'.length))
          }
        });
      case routes.stacks:
        return response(
          parameters.pull_request === feature.number || count === 1
            ? []
            : [h.stack()]
        );
      case routes.detail:
        return response(h.stack(true));
      case routes.rules:
        return response([]);
      case routes.check:
        return response(h.checks.get(parameters.check_run_id));
      case routes.commit:
        return response(h.commits.get(parameters.commit_sha));
      case routes.submit:
        if (h.submission.data.status === 'merged') h.finish();
        return h.submission;
      case routes.poll: {
        const next = h.polls.length > 1 ? h.polls.shift() : h.polls[0];
        if (next.data.status === 'merged') h.finish();
        return next;
      }
      case routes.comment:
        return response({ id: 100, body: parameters.body }, 201);
      default:
        throw new Error(`Unexpected API operation: ${route}`);
    }
  };
  h.github = {
    request: vi.fn((route, parameters) =>
      h.hooks[route]
        ? h.hooks[route](parameters, () => fallback(route, parameters))
        : fallback(route, parameters)
    ),
    graphql: vi.fn(async (_query, { number }) => {
      const pr = prs.get(number);
      return {
        repository: {
          pullRequest: {
            headRefOid: pr.head.sha,
            baseRefOid: pr.base.sha,
            locked: false,
            isInMergeQueue: false,
            isMergeQueueEnabled: false,
            mergeStateStatus: 'CLEAN',
            mergeQueueEntry: null,
            baseRef: { branchProtectionRule: null }
          }
        }
      };
    })
  };
  h.core = {
    setOutput: vi.fn((key, value) => {
      h.outputs[key] = value;
    }),
    error: vi.fn()
  };
  h.setTimeout = vi.fn((callback, milliseconds) => {
    h.clock += milliseconds;
    callback();
  });
  h.execute = () =>
    script.runInNewContext(
      {
        github: h.github,
        core: h.core,
        context: {
          repo: { owner: 'owner', repo: 'repo' },
          serverUrl: 'https://github.com'
        },
        require,
        process: { env: { REPAIR_STATE: JSON.stringify(state) } },
        Date: class extends Date {
          static now() {
            return h.clock;
          }
        },
        setTimeout: h.setTimeout
      },
      { timeout: 1000 }
    );
  h.calls = (route) =>
    h.github.request.mock.calls
      .filter(([called]) => called === route)
      .map(([, parameters]) => parameters);
  return h;
}

async function blocked(h, message) {
  await expect(h.execute()).rejects.toThrow(message);
  expect(h.outputs).toEqual({});
  expect(h.calls(routes.submit)).toHaveLength(0);
  expect(h.calls(routes.comment)).toHaveLength(0);
}

describe('native repair stack landing contract', () => {
  it('is reusable, scoped, bounded, inline, and does not execute repair code', () => {
    expect(definition.on).toEqual({
      workflow_call: {
        inputs: {
          state: {
            description: expect.any(String),
            required: true,
            type: 'string'
          }
        },
        outputs: {
          merge_sha: {
            description: expect.any(String),
            value: '${{ jobs.land.outputs.merge_sha }}'
          }
        }
      }
    });
    expect(definition.jobs.land.permissions).toEqual({
      contents: 'write',
      'pull-requests': 'write',
      checks: 'read'
    });
    expect(definition.jobs.land['timeout-minutes']).toBe(15);
    expect(step.with.retries).toBe(0);
    expect(definition.jobs.land.steps).toHaveLength(1);
    expect(step.env.REPAIR_STATE).toBe('${{ inputs.state }}');
    expect(step.with.script).not.toContain('${{');
  });

  it.each([1, 2])(
    'lands %i repair(s) with one pinned asynchronous top merge',
    async (count) => {
      const h = harness(count);
      await h.execute();
      expect(h.outputs).toEqual({ merge_sha: h.final });
      expect(h.calls(routes.submit)).toEqual([
        expect.objectContaining({
          pull_number: h.state.repairs.at(-1).number,
          sha: h.state.repairs.at(-1).head_sha,
          merge_action: 'direct_merge',
          merge_method: 'squash',
          bypass_rules: false
        })
      ]);
      expect(h.calls(routes.poll)[0].uuid).toBe(operation);
      expect(
        h.calls(routes.rules).every((p) => p.branch === 'feature/repair')
      ).toBe(true);
      expect(h.calls(routes.check)).toHaveLength(count * 2);
      const [comment] = h.calls(routes.comment);
      expect(comment.issue_number).toBe(11);
      for (const [i, repair] of h.state.repairs.entries()) {
        expect(comment.body).toContain(`#${repair.number}`);
        expect(comment.body).toContain(oid(i ? 'f' : 'e'));
        expect(comment.body).toContain(
          `/compare/${repair.base_sha}...${repair.head_sha}`
        );
        expect(comment.body).toContain(`/commit/${oid(i ? 'f' : 'e')}`);
        expect(comment.body).toContain(
          `/actions/runs/${repair.validation_run_id}`
        );
      }
      expect(comment.body).toContain(`/commit/${h.state.initial_head_sha}`);
      expect(comment.body).toContain(
        `/compare/${h.state.initial_head_sha}...${h.final}`
      );
      expect(comment.body).toContain('Fresh parent checks and human approval');
      expect(comment.body).toContain('feature PR was not merged');
      expect(
        h.github.request.mock.calls.filter(
          ([route]) => !route.startsWith('GET ')
        )
      ).toHaveLength(2);
      expect(
        h.github.request.mock.calls.every(
          ([, p]) => p.headers['X-GitHub-Api-Version'] === '2026-03-10'
        )
      ).toBe(true);
    }
  );

  it('accepts optional producer provenance without relying on it', async () => {
    const h = harness();
    h.state.producer_run_id = 900;
    h.state.repairs[0].producer = { trusted: 'not an authorization source' };
    await h.execute();
    expect(h.outputs.merge_sha).toBe(h.final);
  });

  it('retains the initial cycle snapshot separately from a later stack trunk', async () => {
    const h = harness();
    h.state.round = 3;
    h.state.initial_head_sha = oid('7');
    await h.execute();
    const [comment] = h.calls(routes.comment);
    expect(comment.body).toContain('round 3');
    expect(comment.body).toContain(
      `Feature snapshot before any automation in this bounded cycle: [\`${oid('7')}\`](https://github.com/owner/repo/commit/${oid('7')})`
    );
    expect(comment.body).toContain(
      `This repair stack's trunk snapshot: [\`${h.state.feature.head_sha}\`](https://github.com/owner/repo/commit/${h.state.feature.head_sha})`
    );
    expect(comment.body).toContain(
      `https://github.com/owner/repo/compare/${oid('7')}...${h.final}`
    );
    expect(h.outputs.merge_sha).toBe(h.final);
  });

  it.each([undefined, null, '', 123, 'bad-sha', 'a'.repeat(39)])(
    'rejects a missing or malformed initial_head_sha: %j',
    async (initial) => {
      const h = harness();
      h.state.initial_head_sha = initial;
      await blocked(h, 'initial_head_sha');
    }
  );

  it.each([
    ['version', 2],
    ['repository', 'other/repo'],
    ['round', -1],
    ['round', 7],
    ['round', 0.5],
    ['round', '0'],
    ['repairs', []],
    ['stack_number', null],
    ['stack_number', '42']
  ])('rejects invalid state %s=%j', async (field, value) => {
    const h = harness();
    h.state[field] = value;
    await blocked(h, /Invalid|Native stacks/);
  });

  it('rejects a singleton native stack', async () => {
    const h = harness(1);
    h.state.stack_number = 42;
    await blocked(h, 'at least two repairs');
  });

  it.each([
    ['number', 11],
    ['head_ref', 'feature/repair'],
    ['head_ref', '../unsafe'],
    ['head_ref', 'bad.lock'],
    ['head_sha', 'not-a-sha'],
    ['base_ref', 'main'],
    ['base_sha', oid('b')],
    ['kind', 'other'],
    ['check_id', '50'],
    ['validation_run_id', 0]
  ])('rejects invalid repair %s=%j', async (field, value) => {
    const h = harness();
    h.state.repairs[0][field] = value;
    await blocked(h, /Invalid/);
  });

  it('rejects the feature root being included among repair members', async () => {
    const h = harness();
    h.hooks[routes.detail] = () => {
      const stack = h.stack(true);
      stack.pull_requests[0].number = h.state.feature.number;
      return response(stack);
    };
    await blocked(h, 'root exclusion mismatch');
  });
});

describe('preflight identity, checks, rules, and membership', () => {
  it.each([
    ['state', 'closed'],
    ['draft', true],
    ['locked', true],
    ['auto_merge', {}],
    ['merged', true]
  ])('blocks repair %s=%j', async (field, value) => {
    const h = harness();
    h.prs.get(30)[field] = value;
    await blocked(h, /Stale|non-open/);
  });

  it.each(['head', 'base'])('rejects a fork in repair %s', async (side) => {
    const h = harness();
    h.prs.get(30)[side].repo = { full_name: 'fork/repo' };
    await blocked(h, 'foreign PR');
  });

  it.each([
    ['login', 'other[bot]'],
    ['type', 'User']
  ])('requires the repair author %s', async (field, value) => {
    const h = harness();
    h.prs.get(30).user[field] = value;
    await blocked(h, 'github-actions[bot]/Bot');
  });

  it.each(['head', 'base'])('rejects stale repair %s SHA/ref', async (side) => {
    for (const field of ['sha', 'ref']) {
      const h = harness();
      h.prs.get(30)[side][field] = field === 'sha' ? oid('9') : 'changed';
      await blocked(h, /Stale/);
    }
  });

  it.each(['title', 'body'])('pins feature %s', async (field) => {
    const h = harness();
    h.prs.get(11)[field] = 'Edited';
    await blocked(h, 'Stale feature title/body');
  });

  it.each(['head', 'base'])('pins feature %s SHA/ref', async (side) => {
    for (const field of ['sha', 'ref']) {
      const h = harness();
      h.prs.get(11)[side][field] = field === 'sha' ? oid('9') : 'changed';
      await blocked(h, /Stale/);
    }
  });

  it.each(['main', 'feature/repair', 'repair/0', 'repair/1'])(
    'pins the live branch ref %s, not just PR API snapshots',
    async (branch) => {
      const h = harness();
      h.refs.set(branch, oid('9'));
      await blocked(h, 'Stale or missing live branch ref');
    }
  );

  it('rechecks snapshots immediately before submission', async () => {
    const h = harness();
    h.hooks[routes.commit] = async (_parameters, fallback) => {
      const result = await fallback();
      h.prs.get(11).body = 'Changed during preflight';
      return result;
    };
    await blocked(h, 'Stale feature title/body');
    expect(h.calls(routes.rules)).toHaveLength(2);
  });

  it.each([
    ['id', 999],
    ['head_sha', oid('9')],
    ['name', 'Other check'],
    ['status', 'in_progress'],
    ['conclusion', 'failure'],
    ['app', { slug: 'other-app' }],
    ['details_url', 'https://github.com/owner/repo/actions/runs/999']
  ])('requires the exact scoped check %s', async (field, value) => {
    const h = harness();
    h.checks.get(50)[field] = value;
    await blocked(h, 'Scoped repair validation mismatch');
  });

  it('does not hide check API errors', async () => {
    const h = harness();
    h.hooks[routes.check] = () => {
      throw new Error('check permission denied');
    };
    await blocked(h, 'check permission denied');
  });

  it.each([
    ['isInMergeQueue', true],
    ['mergeQueueEntry', { id: 'queued' }],
    ['locked', true],
    ['headRefOid', oid('9')],
    ['isMergeQueueEnabled', undefined],
    ['mergeStateStatus', 'UNKNOWN'],
    ['mergeStateStatus', 'DIRTY'],
    ['mergeStateStatus', undefined]
  ])('blocks queued/unknown GraphQL state %s', async (field, value) => {
    const h = harness();
    const normal = h.github.graphql.getMockImplementation();
    h.github.graphql.mockImplementation(async (...args) => {
      const data = await normal(...args);
      data.repository.pullRequest[field] = value;
      return data;
    });
    await blocked(h, /Unknown, stale, locked, or queued/);
  });

  it('blocks a classic merge queue on the actual repair target', async () => {
    const h = harness();
    const normal = h.github.graphql.getMockImplementation();
    h.github.graphql.mockImplementation(async (...args) => {
      const data = await normal(...args);
      if (args[1].number === 30)
        data.repository.pullRequest.isMergeQueueEnabled = true;
      return data;
    });
    await blocked(h, 'merge_queue is unsupported');
  });

  it('does not apply main branch queue requirements to the feature trunk', async () => {
    const h = harness();
    const normal = h.github.graphql.getMockImplementation();
    h.github.graphql.mockImplementation(async (...args) => {
      const data = await normal(...args);
      if (args[1].number === 11)
        data.repository.pullRequest.isMergeQueueEnabled = true;
      return data;
    });
    await h.execute();
    expect(h.outputs.merge_sha).toBe(h.final);
  });

  it('blocks classic branch locks', async () => {
    const h = harness();
    const normal = h.github.graphql.getMockImplementation();
    h.github.graphql.mockImplementation(async (...args) => {
      const data = await normal(...args);
      data.repository.pullRequest.baseRef.branchProtectionRule = {
        lockBranch: true
      };
      return data;
    });
    await blocked(h, 'locked repair target');
  });

  it.each([
    [{ type: 'merge_queue' }],
    [{ type: 'update' }],
    [
      {
        type: 'pull_request',
        parameters: { allowed_merge_methods: ['merge'] }
      }
    ]
  ])('blocks effective branch restrictions %j', async (rule) => {
    const h = harness();
    h.hooks[routes.rules] = () => response([rule]);
    await blocked(h, /unsupported|locked|disallow squash/);
  });

  it('reads all active branch rule pages and rejects a later merge queue', async () => {
    const h = harness();
    h.hooks[routes.rules] = ({ page }) =>
      page === 1
        ? response([], 200, {
            link: '<https://api.github.com/next>; rel="next"'
          })
        : response([{ type: 'merge_queue' }]);
    await blocked(h, 'merge_queue is unsupported');
    expect(h.calls(routes.rules).map((p) => p.page)).toEqual([1, 2]);
  });

  it('does not treat unavailable effective rules as no rules', async () => {
    const h = harness();
    h.hooks[routes.rules] = () => {
      throw new Error('rules permission denied');
    };
    await blocked(h, 'rules permission denied');
  });

  it('requires repository squash permission', async () => {
    const h = harness();
    h.repository.allow_squash_merge = false;
    await blocked(h, 'Squash must be allowed');
  });

  it.each(['feature/repair', 'repair/0'])(
    'does not merge a default branch in this repair chain: %s',
    async (branch) => {
      const h = harness();
      h.repository.default_branch = branch;
      await blocked(h, 'feature branch');
    }
  );

  it.each(['wrapper', 'missing', 'multiple', 'truncated'])(
    'rejects %s native membership',
    async (kind) => {
      const h = harness();
      h.hooks[routes.stacks] = ({ pull_request }, fallback) => {
        if (pull_request === 11) return fallback();
        if (kind === 'wrapper') return response({ stacks: [h.stack()] });
        if (kind === 'missing') return response([]);
        if (kind === 'multiple') return response([h.stack(), h.stack()]);
        return response([h.stack()], 200, { link: '<next>; rel="next"' });
      };
      await blocked(h, /membership/);
    }
  );

  it.each([1, 2])(
    'rejects native membership of the feature PR with %i repairs',
    async (count) => {
      const h = harness(count);
      h.hooks[routes.stacks] = ({ pull_request }, fallback) =>
        pull_request === 11 ? response([h.stack()]) : fallback();
      await blocked(h, 'Feature PR must be excluded');
    }
  );

  it('requires a single repair to remain standalone', async () => {
    const h = harness(1);
    h.hooks[routes.stacks] = ({ pull_request }, fallback) =>
      pull_request !== 11 ? response([h.stack()]) : fallback();
    await blocked(h, 'single repair must be standalone');
  });

  it.each(['order', 'extra', 'trunk', 'sha', 'base', 'id', 'number', 'closed'])(
    'rejects changed native stack detail: %s',
    async (kind) => {
      const h = harness();
      h.hooks[routes.detail] = () => {
        const stack = h.stack(true);
        if (kind === 'order') stack.pull_requests.reverse();
        if (kind === 'extra') stack.pull_requests.push(stack.pull_requests[0]);
        if (kind === 'trunk') stack.base.ref = 'main';
        if (kind === 'sha') stack.pull_requests[0].head.sha = oid('9');
        if (kind === 'base') stack.pull_requests[0].base.sha = oid('9');
        if (kind === 'id') stack.id++;
        if (kind === 'number') stack.number++;
        if (kind === 'closed') stack.pull_requests[0].state = 'closed';
        return response(stack);
      };
      await blocked(h, /Native stack/);
    }
  );
});

describe('the real async merge response contract', () => {
  it('resumes only a matching 409 pending operation without repeating PUT', async () => {
    const h = harness();
    h.hooks[routes.submit] = () => {
      throw Object.assign(new Error('Conflict'), {
        status: 409,
        response: h.pending({}, 409)
      });
    };
    await h.execute();
    expect(h.calls(routes.submit)).toHaveLength(1);
    expect(h.calls(routes.poll)[0].uuid).toBe(operation);
    expect(h.outputs.merge_sha).toBe(h.final);
  });

  it.each([202, 409])(
    'requires every pinned pending detail for HTTP %i',
    async (status) => {
      for (const [field, value] of [
        ['uuid', 'not/a/uuid'],
        ['expected_head_sha', oid('9')],
        ['merge_action', 'default'],
        ['merge_action', 'merge_queue'],
        ['merge_method', 'merge'],
        ['bypass_rules', true]
      ]) {
        const h = harness();
        h.hooks[routes.submit] = () => {
          const result = h.pending({ [field]: value }, status);
          if (status === 409)
            throw Object.assign(new Error('Conflict'), {
              status,
              response: result
            });
          return result;
        };
        await expect(h.execute()).rejects.toThrow('does not match');
        expect(h.calls(routes.submit)).toHaveLength(1);
        expect(h.calls(routes.poll)).toHaveLength(0);
        expect(h.outputs).toEqual({});
      }
    }
  );

  it.each([
    'message',
    'uuid',
    'expected_head_sha',
    'merge_action',
    'merge_method'
  ])('requires pending details.%s', async (field) => {
    const h = harness();
    delete h.submission.data.details[field];
    await expect(h.execute()).rejects.toThrow(/shape|does not match/);
    expect(h.outputs).toEqual({});
  });

  it('rejects invented flattened async response fields', async () => {
    const h = harness();
    h.submission = response(
      { status: 'pending', ...h.pending().data.details },
      202
    );
    await expect(h.execute()).rejects.toThrow('response shape');
    expect(h.calls(routes.poll)).toHaveLength(0);
  });

  it('rejects a 409 that is not pending', async () => {
    const h = harness();
    h.hooks[routes.submit] = () => {
      throw Object.assign(new Error('Conflict'), {
        status: 409,
        response: { ...h.done(), status: 409 }
      });
    };
    await expect(h.execute()).rejects.toThrow('HTTP status/result');
    expect(h.outputs).toEqual({});
  });

  it('accepts an immediate merged result only after proving all postconditions', async () => {
    const h = harness();
    h.submission = h.done();
    await h.execute();
    expect(h.calls(routes.poll)).toHaveLength(0);
    expect(h.outputs.merge_sha).toBe(h.final);
  });

  it.each(['failed', 'enqueued', 'mystery'])(
    'does not treat polling status %s as a merge',
    async (status) => {
      const h = harness();
      h.polls = [
        response({ status, details: { message: 'Server diagnosis' } })
      ];
      await expect(h.execute()).rejects.toThrow(
        status === 'mystery' ? 'Unknown async merge status' : 'Server diagnosis'
      );
      expect(h.calls(routes.submit)).toHaveLength(1);
      expect(h.calls(routes.comment)).toHaveLength(0);
      expect(h.outputs).toEqual({});
    }
  );

  it('reports the server message on an immediate 400 failure', async () => {
    const h = harness();
    h.hooks[routes.submit] = () => {
      throw Object.assign(new Error('Bad request'), {
        status: 400,
        response: response(
          { status: 'failed', details: { message: 'Pull request is closed.' } },
          400
        )
      });
    };
    await expect(h.execute()).rejects.toThrow('Pull request is closed.');
    expect(h.calls(routes.poll)).toHaveLength(0);
    expect(h.outputs).toEqual({});
  });

  it('does not retry a denied or failed mutation', async () => {
    const h = harness();
    h.hooks[routes.submit] = () => {
      throw Object.assign(new Error('Forbidden'), { status: 403 });
    };
    await expect(h.execute()).rejects.toThrow('Forbidden');
    expect(h.calls(routes.submit)).toHaveLength(1);
    expect(h.calls(routes.poll)).toHaveLength(0);
  });

  it('rejects a pending UUID changing during polling', async () => {
    const h = harness();
    h.polls = [
      h.pending({ uuid: '730b9d5e-3f2a-4f7e-8b0c-2d5f9a8c1e42' }, 200)
    ];
    await expect(h.execute()).rejects.toThrow('does not match');
    expect(h.outputs).toEqual({});
  });

  it('requires merged.details.sha, not a top-level or invented commit field', async () => {
    for (const detail of [{}, { sha: 'bad' }, { merge_commit_sha: oid('f') }]) {
      const h = harness();
      h.polls = [
        response({
          status: 'merged',
          details: { message: 'Merged', ...detail }
        })
      ];
      await expect(h.execute()).rejects.toThrow(/details.sha|details shape/);
      expect(h.outputs).toEqual({});
    }
  });

  it('uses bounded exponential backoff and honors numeric Retry-After', async () => {
    const h = harness();
    h.submission = h.pending({}, 202, { 'retry-after': '3' });
    h.polls = [
      h.pending({}, 200),
      h.pending({}, 200),
      h.pending({}, 200),
      h.done()
    ];
    await h.execute();
    expect(h.setTimeout.mock.calls.map(([, ms]) => ms)).toEqual([
      3000, 2000, 4000, 8000
    ]);
  });

  it('honors HTTP-date Retry-After', async () => {
    const h = harness();
    h.submission = h.pending({}, 202, {
      'retry-after': new Date(h.clock + 9000).toUTCString()
    });
    await h.execute();
    expect(h.setTimeout.mock.calls[0][1]).toBe(9000);
  });

  it.each(['900', 'invalid-date'])(
    'stops rather than violating Retry-After %s',
    async (header) => {
      const h = harness();
      h.submission = h.pending({}, 202, { 'retry-after': header });
      await expect(h.execute()).rejects.toThrow(
        /timed out|Invalid Retry-After/
      );
      expect(h.calls(routes.poll)).toHaveLength(0);
      expect(h.outputs).toEqual({});
    }
  );

  it('times out a permanently pending operation without changing its metadata', async () => {
    const h = harness();
    h.polls = [h.pending({}, 200)];
    await expect(h.execute()).rejects.toThrow('Native landing timed out');
    expect(h.calls(routes.poll)).toHaveLength(12);
    expect(Math.max(...h.setTimeout.mock.calls.map(([, ms]) => ms))).toBe(
      60000
    );
    expect(h.calls(routes.submit)).toHaveLength(1);
    expect(h.calls(routes.comment)).toHaveLength(0);
    expect(h.core.error).toHaveBeenCalledWith(
      expect.stringContaining(`operation ${operation}`)
    );
    expect(h.outputs).toEqual({});
  });

  it('surfaces an expired operation without retrying the mutation', async () => {
    const h = harness();
    h.hooks[routes.poll] = () => {
      throw Object.assign(new Error('Operation expired'), { status: 404 });
    };
    await expect(h.execute()).rejects.toThrow('Operation expired');
    expect(h.calls(routes.submit)).toHaveLength(1);
    expect(h.outputs).toEqual({});
  });

  it.each([403, 429, 502, 503, 504])(
    'retries only polling after HTTP %i and honors Retry-After',
    async (status) => {
      const h = harness();
      let first = true;
      h.hooks[routes.poll] = (_parameters, fallback) => {
        if (!first) return fallback();
        first = false;
        throw Object.assign(new Error('Try again later'), {
          status,
          response: response({ message: 'Try again later' }, status, {
            'retry-after': '7'
          })
        });
      };
      await h.execute();
      expect(h.setTimeout.mock.calls.map(([, ms]) => ms)).toEqual([1000, 7000]);
      expect(h.calls(routes.submit)).toHaveLength(1);
      expect(h.calls(routes.poll)).toHaveLength(2);
      expect(h.outputs.merge_sha).toBe(h.final);
    }
  );

  it('bounds repeated polling failures and retains their diagnosis', async () => {
    const h = harness();
    h.hooks[routes.poll] = () => {
      throw Object.assign(new Error('Service unavailable'), { status: 503 });
    };
    await expect(h.execute()).rejects.toThrow(
      'Native landing timed out: Service unavailable'
    );
    expect(h.calls(routes.poll)).toHaveLength(12);
    expect(h.calls(routes.submit)).toHaveLength(1);
    expect(h.outputs).toEqual({});
  });
});

describe('native landing postconditions and notification', () => {
  it.each([
    'unmerged',
    'missing-sha',
    'wrong-first-parent',
    'wrong-upper-parent',
    'merge-not-squash',
    'wrong-tree',
    'wrong-result',
    'feature-head',
    'feature-base',
    'feature-body',
    'feature-closed',
    'live-feature',
    'live-base',
    'partial-membership',
    'changed-order'
  ])('withholds output after %s', async (kind) => {
    const h = harness();
    h.onMerged = () => {
      if (kind === 'unmerged') h.prs.get(30).merged = false;
      if (kind === 'missing-sha') h.prs.get(30).merge_commit_sha = null;
      if (kind === 'wrong-first-parent')
        h.commits.get(oid('e')).parents[0].sha = oid('9');
      if (kind === 'wrong-upper-parent')
        h.commits.get(oid('f')).parents[0].sha = oid('a');
      if (kind === 'merge-not-squash')
        h.commits.get(oid('e')).parents.push({ sha: oid('c') });
      if (kind === 'wrong-tree') h.commits.get(oid('f')).tree.sha = oid('8');
      if (kind === 'feature-head') h.prs.get(11).head.sha = oid('9');
      if (kind === 'feature-base') h.prs.get(11).base.sha = oid('9');
      if (kind === 'feature-body') h.prs.get(11).body = 'Edited after merge';
      if (kind === 'feature-closed') h.prs.get(11).state = 'closed';
      if (kind === 'live-feature') h.refs.set('feature/repair', oid('9'));
      if (kind === 'live-base') h.refs.set('main', oid('9'));
    };
    if (kind === 'wrong-result') h.polls[0].data.details.sha = oid('9');
    if (kind === 'partial-membership' || kind === 'changed-order') {
      h.hooks[routes.detail] = (_parameters, fallback) => {
        if (!h.merged) return fallback();
        const stack = h.stack(true);
        if (kind === 'partial-membership') stack.pull_requests.shift();
        else stack.pull_requests.reverse();
        return response(stack);
      };
    }
    await expect(h.execute()).rejects.toThrow();
    expect(h.calls(routes.comment)).toHaveLength(0);
    expect(h.outputs).toEqual({});
    expect(h.calls(routes.submit)).toHaveLength(1);
    expect(h.core.error).toHaveBeenCalledWith(
      expect.stringContaining('Existing native stack metadata is preserved')
    );
    expect(
      h.github.request.mock.calls
        .filter(([route]) => !route.startsWith('GET '))
        .map(([route]) => route)
    ).toEqual([routes.submit]);
  });

  it.each(['api-error', 'unconfirmed'])(
    'withholds merge_sha if the feature comment is %s',
    async (kind) => {
      const h = harness();
      h.hooks[routes.comment] = () => {
        if (kind === 'api-error') throw new Error('Comments unavailable');
        return response({}, 200);
      };
      await expect(h.execute()).rejects.toThrow(
        kind === 'api-error' ? 'Comments unavailable' : 'not confirmed'
      );
      expect(h.calls(routes.submit)).toHaveLength(1);
      expect(h.calls(routes.comment)).toHaveLength(1);
      expect(h.outputs).toEqual({});
    }
  );

  it('emits merge_sha strictly after the successful feature comment', async () => {
    const h = harness();
    h.hooks[routes.comment] = async (_parameters, fallback) => {
      expect(h.core.setOutput).not.toHaveBeenCalled();
      expect(h.prs.get(11).state).toBe('open');
      expect(h.merged).toBe(true);
      return fallback();
    };
    await h.execute();
    expect(h.core.setOutput).toHaveBeenCalledExactlyOnceWith(
      'merge_sha',
      h.final
    );
  });
});
