// Shared helpers for the Check -> Repair -> Recheck loop (used via actions/github-script).
//
// The `pr-quality` commit status on the PR head commit is the single source of truth:
// - pr-pipeline.yml sets it to `pending` when it starts and to `success`/`failure` when
//   every gate has reported. Reviewers rely on it before giving the final human approval.
// - The status description carries a revision fingerprint (head SHA + PR metadata +
//   gate decision labels). A revision that already has a status is never re-checked,
//   so agents only cause a recheck when they actually changed something.

const crypto = require('crypto');

const STATUS_CONTEXT = 'pr-quality';

// Labels written by agents that record a gate decision (and therefore change the outcome).
const DECISION_LABELS = ['docs-not-required'];

const REMEDIATION_WORKFLOWS = [
  'pr-validation.lock.yml',
  'pr-lint-fixer.lock.yml',
  'pr-test-generator.lock.yml',
  'pr-codeql-fixer.lock.yml',
  'pr-dependency-fixer.lock.yml',
  'pr-secret-fixer.lock.yml',
  'pr-doc-updater.lock.yml'
];

const ACTIVE_STATUSES = new Set(['queued', 'in_progress', 'waiting', 'pending', 'requested']);
const FINAL_STATES = new Set(['success', 'failure', 'error']);

/** Fingerprint of everything the gates evaluate: code, PR metadata and decision labels. */
function revision(pr) {
  const labels = (pr.labels || [])
    .map((l) => (typeof l === 'string' ? l : l.name))
    .filter((name) => DECISION_LABELS.includes(name))
    .sort();
  const metadata = crypto
    .createHash('sha256')
    .update([pr.title || '', pr.body || '', labels.join(',')].join('\u0000'))
    .digest('hex')
    .slice(0, 8);
  return `${pr.head.sha.slice(0, 7)}.${metadata}`;
}

function parseRevision(description) {
  const match = /\[rev ([0-9a-f]{7}\.[0-9a-f]{8})\]/.exec(description || '');
  return match ? match[1] : null;
}

/** Latest `pr-quality` status on a commit, with its parsed revision. */
async function getQualityStatus({ github, context, sha }) {
  const { owner, repo } = context.repo;
  const { data } = await github.rest.repos.getCombinedStatusForRef({ owner, repo, ref: sha, per_page: 100 });
  const status = (data.statuses || []).find((s) => s.context === STATUS_CONTEXT);
  if (!status) return null;
  return {
    state: status.state,
    description: status.description,
    targetUrl: status.target_url,
    revision: parseRevision(status.description),
    final: FINAL_STATES.has(status.state)
  };
}

async function setQualityStatus({ github, context, sha, state, summary, rev, targetUrl }) {
  const { owner, repo } = context.repo;
  const suffix = ` [rev ${rev}]`;
  const description = `${summary.slice(0, 140 - suffix.length)}${suffix}`;
  await github.rest.repos.createCommitStatus({
    owner,
    repo,
    sha,
    state,
    context: STATUS_CONTEXT,
    description,
    target_url: targetUrl
  });
}

/**
 * Remediation agent runs on `branch` that have not applied their safe outputs yet.
 * A run counts as finished once its `conclusion` job started: by then the stacked PR /
 * metadata change exists and the run has already handed off to the relay.
 */
async function pendingRemediationRuns({ github, context, branch, excludeRunId }) {
  const { owner, repo } = context.repo;
  const pending = [];
  for (const workflow of REMEDIATION_WORKFLOWS) {
    let runs = [];
    try {
      runs = await github.paginate(github.rest.actions.listWorkflowRuns, {
        owner,
        repo,
        workflow_id: workflow,
        branch,
        event: 'workflow_dispatch',
        per_page: 50
      });
    } catch (e) {
      if (e.status === 404) continue;
      throw e;
    }
    for (const run of runs.filter((r) => ACTIVE_STATUSES.has(r.status) && r.id !== excludeRunId)) {
      const jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRun, {
        owner,
        repo,
        run_id: run.id,
        per_page: 100
      });
      const conclusion = jobs.find((j) => j.name === 'conclusion');
      const handedOff = conclusion && ['in_progress', 'completed'].includes(conclusion.status);
      if (!handedOff) pending.push({ workflow, id: run.id, url: run.html_url });
    }
  }
  return pending;
}

module.exports = {
  STATUS_CONTEXT,
  DECISION_LABELS,
  REMEDIATION_WORKFLOWS,
  revision,
  parseRevision,
  getQualityStatus,
  setQualityStatus,
  pendingRemediationRuns
};
