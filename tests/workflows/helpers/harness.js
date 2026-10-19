// Test harness for the PR lifecycle workflows.
//
// Inline `actions/github-script` blocks are extracted from the workflow YAML and executed
// against an in-memory fake of the GitHub REST API, so scenarios exercise the exact code
// that runs in Actions (`${{ }}` expressions are replaced by the `env` passed in).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..'
);
export const WORKFLOWS_DIR = path.join(ROOT, '.github', 'workflows');
export const SCRIPTS_DIR = path.join(ROOT, '.github', 'scripts');

const nodeRequire = createRequire(import.meta.url);
export const quality = nodeRequire(path.join(SCRIPTS_DIR, 'pr-quality.cjs'));
export const remediation = nodeRequire(
  path.join(SCRIPTS_DIR, 'remediation.cjs')
);

export const OWNER = 'octo';
export const REPO = 'demo';
export const DEFAULT_BRANCH = 'main';

// ---------------------------------------------------------------------------
// Workflow files
// ---------------------------------------------------------------------------

export function readWorkflow(file) {
  return fs.readFileSync(path.join(WORKFLOWS_DIR, file), 'utf8');
}

export function loadWorkflow(file) {
  return parse(readWorkflow(file));
}

/** Frontmatter of a gh-aw agent (`.md`) workflow. */
export function loadAgentFrontmatter(file) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readWorkflow(file));
  if (!match) throw new Error(`No frontmatter in ${file}`);
  return parse(match[1]);
}

/** Natural-language prompt (markdown body) of a gh-aw agent workflow. */
export function loadAgentBody(file) {
  return readWorkflow(file).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
}

export function listWorkflowFiles(predicate = () => true) {
  return fs.readdirSync(WORKFLOWS_DIR).filter(predicate).sort();
}

export function getStep(file, jobId, stepName) {
  const job = loadWorkflow(file).jobs[jobId];
  if (!job) throw new Error(`Job '${jobId}' not found in ${file}`);
  const step = (job.steps || []).find((s) => s.name === stepName);
  if (!step) {
    throw new Error(`Step '${stepName}' not found in ${file}#${jobId}`);
  }
  return step;
}

export function getScript(file, jobId, stepName) {
  const script = getStep(file, jobId, stepName).with?.script;
  if (!script) throw new Error(`Step '${stepName}' in ${file} has no script`);
  return script;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let prSeq = 0;
let shaSeq = 0;
export const nextSha = () =>
  (0xa000000 + ++shaSeq).toString(16).padEnd(40, '0');

export function makePR({
  number,
  branch = 'feat/sample',
  base = DEFAULT_BRANCH,
  title = 'feat(app): add sample feature',
  body = 'Adds the sample feature with tests and documentation.',
  labels = [],
  sha,
  state = 'open',
  draft = false
} = {}) {
  const n = number ?? 100 + ++prSeq;
  return {
    number: n,
    title,
    body,
    state,
    draft,
    labels: labels.map((name) => ({ name })),
    head: { ref: branch, sha: sha ?? nextSha() },
    base: { ref: base },
    node_id: `PR_node_${n}`,
    html_url: `https://github.com/${OWNER}/${REPO}/pull/${n}`
  };
}

export function makeRun({
  id,
  workflow,
  branch,
  event = 'workflow_dispatch',
  status = 'completed',
  conclusion = 'success',
  jobs = [],
  title
}) {
  return {
    id,
    workflow_id: workflow,
    display_title: title ?? workflow,
    head_branch: branch,
    event,
    status,
    conclusion,
    html_url: `https://github.com/${OWNER}/${REPO}/actions/runs/${id}`,
    jobs
  };
}

/** An active gh-aw agent run; `phase` is how far it got. */
export function makeAgentRun({ id, workflow, branch, phase = 'agent' }) {
  const jobs = {
    queued: [],
    agent: [
      { name: 'activation', status: 'completed' },
      { name: 'agent', status: 'in_progress' },
      { name: 'conclusion', status: 'queued' }
    ],
    conclusion: [
      { name: 'activation', status: 'completed' },
      { name: 'agent', status: 'completed' },
      { name: 'safe_outputs', status: 'completed' },
      { name: 'conclusion', status: 'in_progress' }
    ]
  }[phase];
  return makeRun({
    id,
    workflow,
    branch,
    status: phase === 'queued' ? 'queued' : 'in_progress',
    conclusion: null,
    jobs
  });
}

// ---------------------------------------------------------------------------
// Fake GitHub API
// ---------------------------------------------------------------------------

const clone = (value) => JSON.parse(JSON.stringify(value));
const notFound = () => Object.assign(new Error('Not Found'), { status: 404 });

export function createGitHub(initial = {}) {
  const state = {
    pulls: [],
    comments: [],
    statuses: {},
    runs: [],
    dispatches: [],
    graphql: [],
    deletedRefs: [],
    merges: [],
    commits: {},
    token: 'github-token',
    mergeErrors: {},
    missingWorkflows: [],
    dispatchError: null,
    addLabelError: null,
    calls: [],
    ...clone(initial)
  };

  const findPull = (number) =>
    state.pulls.find((p) => p.number === Number(number));
  const record = (name, fn) =>
    async function (args = {}) {
      state.calls.push({ name, args: clone(args) });
      return fn(args);
    };

  const rest = {
    pulls: {
      get: record('pulls.get', async ({ pull_number }) => {
        const pr = findPull(pull_number);
        if (!pr) throw notFound();
        return { data: clone(pr) };
      }),
      list: record(
        'pulls.list',
        async ({ state: st = 'open', head, base }) => ({
          data: clone(
            state.pulls.filter(
              (p) =>
                (st === 'all' || p.state === st) &&
                (!head || `${OWNER}:${p.head.ref}` === head) &&
                (!base || p.base.ref === base)
            )
          )
        })
      ),
      merge: record(
        'pulls.merge',
        async ({ pull_number, merge_method, commit_title, commit_message }) => {
          if (state.mergeErrors[pull_number]) {
            throw Object.assign(new Error(state.mergeErrors[pull_number]), {
              status: 405
            });
          }
          const pr = findPull(pull_number);
          if (!pr) throw notFound();
          if (pr.draft) {
            throw Object.assign(new Error('Pull Request is still a draft'), {
              status: 405
            });
          }
          const sha = nextSha();
          pr.state = 'closed';
          pr.merged = true;
          const parent = state.pulls.find(
            (p) => p.state === 'open' && p.head.ref === pr.base.ref
          );
          state.commits[sha] = {
            message: [commit_title, commit_message]
              .filter(Boolean)
              .join('\n\n'),
            parents: parent ? [parent.head.sha] : []
          };
          if (parent) parent.head.sha = sha;
          state.merges.push({
            number: pr.number,
            merge_method,
            commit_title,
            commit_message,
            sha,
            token: state.token
          });
          return { data: { sha, merged: true } };
        }
      )
    },
    issues: {
      listLabelsOnIssue: record(
        'issues.listLabelsOnIssue',
        async ({ issue_number }) => ({
          data: clone(findPull(issue_number)?.labels || [])
        })
      ),
      addLabels: record(
        'issues.addLabels',
        async ({ issue_number, labels }) => {
          if (state.addLabelError) throw new Error(state.addLabelError);
          const pr = findPull(issue_number);
          for (const name of labels) {
            if (!pr.labels.some((l) => l.name === name))
              pr.labels.push({ name });
          }
          return { data: clone(pr.labels) };
        }
      ),
      removeLabel: record(
        'issues.removeLabel',
        async ({ issue_number, name }) => {
          const pr = findPull(issue_number);
          const index = pr ? pr.labels.findIndex((l) => l.name === name) : -1;
          if (index < 0) throw notFound();
          pr.labels.splice(index, 1);
          return { data: clone(pr.labels) };
        }
      ),
      createComment: record(
        'issues.createComment',
        async ({ issue_number, body }) => {
          state.comments.push({ issue_number, body });
          return { data: {} };
        }
      ),
      listComments: record('issues.listComments', async ({ issue_number }) => ({
        data: clone(
          state.comments.filter((c) => c.issue_number === issue_number)
        )
      }))
    },
    actions: {
      listWorkflowRuns: record(
        'actions.listWorkflowRuns',
        async ({ workflow_id, branch, event }) => {
          if (state.missingWorkflows.includes(workflow_id)) throw notFound();
          return {
            data: {
              workflow_runs: clone(
                state.runs.filter(
                  (r) =>
                    r.workflow_id === workflow_id &&
                    (!branch || r.head_branch === branch) &&
                    (!event || r.event === event)
                )
              )
            }
          };
        }
      ),
      listJobsForWorkflowRun: record(
        'actions.listJobsForWorkflowRun',
        async ({ run_id }) => ({
          data: {
            jobs: clone(state.runs.find((r) => r.id === run_id)?.jobs || [])
          }
        })
      ),
      createWorkflowDispatch: record(
        'actions.createWorkflowDispatch',
        async (args) => {
          if (state.dispatchError) throw new Error(state.dispatchError);
          state.dispatches.push(clone(args));
          return { data: {} };
        }
      )
    },
    repos: {
      // Commits are `state.commits[sha] = { message, parents }`; history follows first parents.
      compareCommitsWithBasehead: record(
        'repos.compareCommitsWithBasehead',
        async ({ basehead }) => {
          const [base, head] = basehead.split('...');
          const commits = [];
          let sha = head;
          while (sha && sha !== base) {
            const commit = state.commits[sha];
            if (!commit) {
              return {
                data: { status: 'diverged', commits: clone(commits) }
              };
            }
            commits.unshift({ sha, commit: { message: commit.message } });
            sha = commit.parents[0];
          }
          if (!sha) return { data: { status: 'diverged', commits: [] } };
          return {
            data: {
              status: commits.length ? 'ahead' : 'identical',
              commits: clone(commits)
            }
          };
        }
      ),
      getCommit: record('repos.getCommit', async ({ ref }) => {
        const commit = state.commits[ref];
        if (!commit) throw notFound();
        return {
          data: {
            sha: ref,
            commit: { message: commit.message },
            parents: commit.parents.map((p) => ({ sha: p }))
          }
        };
      }),
      getCombinedStatusForRef: record(
        'repos.getCombinedStatusForRef',
        async ({ ref }) => ({
          data: { statuses: clone(state.statuses[ref] || []) }
        })
      ),
      // Newest first, like the combined status API.
      createCommitStatus: record('repos.createCommitStatus', async (args) => {
        const { sha, context, state: st, description, target_url } = args;
        (state.statuses[sha] ||= []).unshift({
          context,
          state: st,
          description,
          target_url,
          updated_at: new Date().toISOString()
        });
        return { data: {} };
      })
    },
    git: {
      deleteRef: record('git.deleteRef', async ({ ref }) => {
        state.deletedRefs.push(ref);
        return { data: {} };
      })
    }
  };

  const client = {
    rest,
    state,
    async paginate(method, args) {
      const { data } = await method(args);
      if (Array.isArray(data)) return data;
      return data.workflow_runs || data.jobs || data.statuses || [];
    },
    async graphql(query, variables) {
      state.graphql.push({ query, variables });
      if (query.includes('markPullRequestReadyForReview')) {
        const pr = state.pulls.find((p) => p.node_id === variables.id);
        if (pr) pr.draft = false;
      }
      return {};
    },
    pr: findPull,
    calls: (name) => state.calls.filter((c) => c.name === name),
    labels: (number) => findPull(number).labels.map((l) => l.name),
    comments: (number) =>
      state.comments
        .filter((c) => c.issue_number === number)
        .map((c) => c.body),
    qualityStatuses: (sha) =>
      (state.statuses[sha] || []).filter(
        (s) => s.context === quality.STATUS_CONTEXT
      )
  };

  // Client authenticated with another token (`getOctokit(token)`): same fake, calls record `state.token`.
  const withToken = (token, api) =>
    Object.fromEntries(
      Object.entries(api).map(([key, value]) => [
        key,
        typeof value === 'function'
          ? async (args) => {
              const previous = state.token;
              state.token = token;
              try {
                return await value(args);
              } finally {
                state.token = previous;
              }
            }
          : withToken(token, value)
      ])
    );
  client.as = (token) => ({ ...client, rest: withToken(token, rest) });
  return client;
}

/** Store a `pr-quality` status for the PR's current revision, as the pipeline does. */
export async function seedQualityStatus(github, pr, state, summary = 'seeded') {
  const rev = quality.revision(pr);
  await quality.setQualityStatus({
    github,
    context: createContext(),
    sha: pr.head.sha,
    state,
    summary,
    rev,
    targetUrl: 'https://github.com/octo/demo/actions/runs/1'
  });
  return rev;
}

// ---------------------------------------------------------------------------
// Actions runtime fakes
// ---------------------------------------------------------------------------

export function createContext({
  eventName = 'workflow_dispatch',
  ref = `refs/heads/${DEFAULT_BRANCH}`,
  runId = 9000,
  payload = {}
} = {}) {
  return {
    eventName,
    ref,
    runId,
    serverUrl: 'https://github.com',
    repo: { owner: OWNER, repo: REPO },
    payload: { repository: { default_branch: DEFAULT_BRANCH }, ...payload }
  };
}

export function createCore() {
  const core = {
    outputs: {},
    failed: [],
    warnings: [],
    notices: [],
    infos: [],
    summaryText: '',
    setOutput: (name, value) => {
      core.outputs[name] = String(value);
    },
    setFailed: (message) => core.failed.push(String(message)),
    warning: (message) => core.warnings.push(String(message)),
    notice: (message) => core.notices.push(String(message)),
    info: (message) => core.infos.push(String(message)),
    summary: {
      addRaw(text) {
        core.summaryText += text;
        return core.summary;
      },
      async write() {
        return core.summary;
      }
    }
  };
  return core;
}

export function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wf-test-'));
}

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const MAX_SLEEPS = 1000;

// Map `${GITHUB_WORKSPACE}/.github/scripts/x.cjs` and `.gate-scripts/...` to the repo copy.
function scriptRequire(id) {
  const match = /\.github[\\/]scripts[\\/]([\w.-]+\.cjs)$/.exec(id);
  return nodeRequire(match ? path.join(SCRIPTS_DIR, match[1]) : id);
}

/**
 * Run a github-script body the way actions/github-script does.
 * `setTimeout` resolves immediately; `onSleep(ms, count)` lets a test change the world
 * between polls (e.g. finish a pipeline run).
 */
export async function runScript(
  script,
  {
    github,
    context = createContext(),
    core = createCore(),
    env = {},
    onSleep
  } = {}
) {
  const saved = {};
  const vars = {
    GITHUB_WORKSPACE: ROOT,
    GITHUB_RUN_ATTEMPT: '1',
    RUNNER_TEMP: undefined,
    ...env
  };
  for (const [key, value] of Object.entries(vars)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = String(value);
  }
  const sleeps = [];
  const fakeTimeout = (callback, ms) => {
    sleeps.push(ms);
    if (sleeps.length > MAX_SLEEPS) throw new Error('Polling loop never ended');
    if (onSleep) onSleep(ms, sleeps.length);
    callback();
    return 0;
  };
  try {
    const fn = new AsyncFunction(
      'require',
      'github',
      'context',
      'core',
      'setTimeout',
      'getOctokit',
      script
    );
    const getOctokit = (token) => github.as(token);
    const result = await fn(
      scriptRequire,
      github,
      context,
      core,
      fakeTimeout,
      getOctokit
    );
    return { result, core, github, sleeps };
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
