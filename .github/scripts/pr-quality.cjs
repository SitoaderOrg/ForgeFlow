// Shared helpers for the Check -> Repair -> Recheck loop (used via actions/github-script).
//
// Every gate records its own result as a `gate/<id>` commit status on the commit it checked,
// mirrored by a `<id>-passed` label on the PR. The `pr-quality` commit status is derived from
// the gate statuses of the PR head commit by `evaluateVerdict`:
// - pending while a gate is still checking or a remediation agent is still repairing;
// - failure once a gate failed and nothing is repairing it any more;
// - success only when every gate passed on that exact commit. Results carried over from an
//   earlier commit (when a stacked fix for another gate landed) trigger one final re-check of
//   all gates together before the PR is handed to human review.
// The `pr-quality` description carries a revision fingerprint (head SHA + PR metadata +
// gate decision labels) so the pipeline never re-checks a revision that already has a verdict.

const crypto = require('crypto');
const path = require('path');

const STATUS_CONTEXT = 'pr-quality';

/** Quality gates in pipeline order. `workflow` re-runs one gate alone on the PR branch. */
const GATES = [
  { id: 'metadata', name: 'Metadata', workflow: 'gate-metadata.yml' },
  { id: 'lint', name: 'Lint', workflow: 'gate-lint.yml' },
  { id: 'build', name: 'Build', workflow: 'gate-build.yml' },
  { id: 'tests', name: 'Tests', workflow: 'gate-tests.yml' },
  { id: 'security', name: 'Security', workflow: 'gate-security.yml' },
  { id: 'docs', name: 'Docs', workflow: 'gate-docs.yml' }
];

// Gate repaired by a stacked remediation PR (label) or by its source (agent workflow name or the
// pipeline's lint auto-fix). `ALL_GATES`: Copilot review fixes can touch anything.
const ALL_GATES = '*';
const REPAIRED_GATE = {
  'review-remediation': ALL_GATES,
  'Fix: Copilot review comments': ALL_GATES,
  'lint-remediation': 'lint',
  'test-remediation': 'tests',
  'security-remediation': 'security',
  'doc-remediation': 'docs',
  'Lint auto-fix': 'lint',
  'Fix: PR metadata': 'metadata',
  'Fix: Lint & format': 'lint',
  'Fix: Tests': 'tests',
  'Fix: CodeQL alerts': 'security',
  'Fix: Dependencies': 'security',
  'Fix: Secrets': 'security',
  'Fix: Docs': 'docs'
};

const REMEDIATION_LABELS = ['lint-remediation', 'test-remediation', 'security-remediation', 'doc-remediation', 'review-remediation'];
// Set by the relay on a stacked PR it could not merge: a human has to resolve it.
const BLOCKED_LABEL = 'remediation-blocked';
// Set by the relay on a stacked PR it closed after a merge conflict (defined with the retry budget).
const { SUPERSEDED_LABEL } = require(path.join(__dirname, 'remediation.cjs'));
// Gates whose result depends on PR metadata / decision labels, not only on the commit.
const METADATA_GATES = ['metadata', 'docs'];
const RELAY_WORKFLOW = 'relay.yml';
const PIPELINE_WORKFLOW = 'pipeline.yml';
const REVIEW_WORKFLOW = 'review-request.yml';
const CARRIED = /^carried from ([0-9a-f]{7}): /;

// Labels written by agents that record a gate decision (and therefore change the outcome).
const DECISION_LABELS = ['docs-not-required'];

const REMEDIATION_WORKFLOWS = [
  'fix-metadata.lock.yml',
  'fix-lint.lock.yml',
  'fix-tests.lock.yml',
  'fix-codeql.lock.yml',
  'fix-dependencies.lock.yml',
  'fix-secrets.lock.yml',
  'fix-docs.lock.yml',
  'fix-review-comments.lock.yml'
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
    updatedAt: status.updated_at,
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
 * A run counts as finished once its `conclusion` job started: by then its `safe_outputs`
 * job has created the stacked PR / metadata change, and the conclusion job hands off to the relay.
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

// ---------------------------------------------------------------------------
// Per-gate results
// ---------------------------------------------------------------------------

const helpers = () => require(path.join(__dirname, 'remediation.cjs'));
const gateById = (id) => GATES.find((g) => g.id === id);
const gateContext = (id) => `gate/${id}`;
const passedLabel = (id) => `${id}-passed`;
const truncate = (text, max = 140) => (text.length > max ? `${text.slice(0, max - 3)}...` : text);
const runUrl = (context) =>
  `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`;

/** Gates repaired by a remediation label or agent source (`<workflow name> (run <id>)`). */
function repairedGates(source) {
  const name = String(source || '')
    .replace(/\s*\(run \d+\)\s*$/, '')
    .trim();
  const gate = REPAIRED_GATE[name];
  if (gate === ALL_GATES) return GATES.map((g) => g.id);
  return gate ? [gate] : [];
}

/** The single gate repaired by a label or source; null when none (or every gate). */
function repairedGate(source) {
  const gates = repairedGates(source);
  return gates.length === 1 ? gates[0] : null;
}

/** Latest `gate/<id>` status per gate on a commit (`revision`: PR revision it was recorded for). */
async function getGateStatuses({ github, context, sha }) {
  const { owner, repo } = context.repo;
  const { data } = await github.rest.repos.getCombinedStatusForRef({ owner, repo, ref: sha, per_page: 100 });
  const result = {};
  for (const status of data.statuses || []) {
    const match = /^gate\/([\w-]+)$/.exec(status.context || '');
    if (!match || result[match[1]]) continue;
    const full = status.description || '';
    const carried = CARRIED.exec(full);
    result[match[1]] = {
      state: status.state,
      description: full.replace(/ \[rev [0-9a-f.]+\]$/, ''),
      targetUrl: status.target_url,
      carriedFrom: carried ? carried[1] : null,
      revision: parseRevision(full)
    };
  }
  return result;
}

/**
 * Record a gate status on `sha`. `rev` (the PR revision checked) is kept at the end of the
 * description. With `prNumber`, the `<gate>-passed` label mirrors the
 * result, but only while `sha` is still the PR head (a stale check must not relabel the PR).
 */
async function setGateStatus({ github, context, core, prNumber, sha, gate, state, description, targetUrl, rev }) {
  const { owner, repo } = context.repo;
  const suffix = rev ? ` [rev ${rev}]` : '';
  await github.rest.repos.createCommitStatus({
    owner,
    repo,
    sha,
    state,
    context: gateContext(gate),
    description: `${truncate(description, 140 - suffix.length)}${suffix}`,
    target_url: targetUrl
  });
  if (!prNumber) return;
  const { data: pr } = await github.rest.pulls.get({ owner, repo, pull_number: prNumber });
  if (pr.head.sha !== sha) return;
  const label = passedLabel(gate);
  if (state === 'success') await helpers().addLabel({ github, context, core, prNumber, label });
  else await helpers().removeLabel({ github, context, core, prNumber, label });
}

/** Record the outcome of a gate job (`job.status`: success, failure or cancelled). */
async function recordGate({ github, context, core, prNumber, sha, gate, result }) {
  const { name } = gateById(gate);
  const state = result === 'success' ? 'success' : result === 'failure' ? 'failure' : 'error';
  const description = {
    success: `${name} passed`,
    failure: `${name} failed`,
    error: `${name} did not finish (${result || 'unknown'})`
  }[state];
  const { owner, repo } = context.repo;
  const { data: pr } = await github.rest.pulls.get({ owner, repo, pull_number: prNumber });
  const rev = revision({ ...pr, head: { ...pr.head, sha } });
  await setGateStatus({ github, context, core, prNumber, sha, gate, state, description, targetUrl: runUrl(context), rev });
  core.info(`gate/${gate} = ${state} on ${sha}`);
  return state;
}

/** Mark every gate as pending on a commit the pipeline is about to check. */
async function startGates({ github, context, core, prNumber, sha }) {
  for (const gate of GATES) {
    await setGateStatus({
      github,
      context,
      core,
      prNumber,
      sha,
      gate: gate.id,
      state: 'pending',
      description: `${gate.name}: checking`,
      targetUrl: runUrl(context)
    });
  }
}

async function activeRuns({ github, context, workflow, branch, event }) {
  const { owner, repo } = context.repo;
  try {
    const runs = await github.paginate(github.rest.actions.listWorkflowRuns, {
      owner,
      repo,
      workflow_id: workflow,
      ...(branch ? { branch } : {}),
      ...(event ? { event } : {}),
      per_page: 50
    });
    return runs.filter((r) => ACTIVE_STATUSES.has(r.status));
  } catch (e) {
    if (e.status === 404) return [];
    throw e;
  }
}

/**
 * Repairs still in flight for a branch: agents that have not handed off yet, stacked
 * remediation PRs waiting to be merged, and relay runs still consolidating them.
 */
async function remediationInProgress({ github, context, branch, excludeRunIds = [] }) {
  const { owner, repo } = context.repo;
  const exclude = new Set(excludeRunIds.map(Number));
  const work = (await pendingRemediationRuns({ github, context, branch })).filter((r) => !exclude.has(r.id));

  const stacked = (await github.paginate(github.rest.pulls.list, { owner, repo, state: 'open', base: branch, per_page: 100 }))
    .filter((p) => p.labels.some((l) => REMEDIATION_LABELS.includes(l.name)))
    .filter((p) => !p.labels.some((l) => l.name === BLOCKED_LABEL));
  for (const pr of stacked) work.push({ workflow: `stacked PR #${pr.number}`, id: pr.number, url: pr.html_url });

  const relays = (await activeRuns({ github, context, workflow: RELAY_WORKFLOW }))
    .filter((r) => !exclude.has(r.id) && String(r.display_title || '').endsWith(` ${branch}`));
  for (const run of relays) work.push({ workflow: RELAY_WORKFLOW, id: run.id, url: run.html_url });
  return work;
}

/**
 * Bring the gate statuses of the PR head commit up to date after a repair landed.
 * - `repaired` gates are re-checked alone on the new commit;
 * - other gates keep their result from the commit before the repair (`before`), marked as
 *   carried; gates with no final result anywhere are re-checked too;
 * - Metadata and Docs results recorded for different PR metadata (title, body, decision
 *   labels) are re-checked, so a metadata repair is never missed even without `repaired`.
 * @returns {Promise<{recheck: string[], carried: string[], kept: string[]}>}
 */
async function recheckGates({ github, context, core, prNumber, branch, before, sha, repaired = [], reason = 'remediation' }) {
  const { owner, repo } = context.repo;
  const current = await getGateStatuses({ github, context, sha });
  const previous = before && before !== sha ? await getGateStatuses({ github, context, sha: before }) : {};
  const { data: pr } = await github.rest.pulls.get({ owner, repo, pull_number: prNumber });
  const metadataHash = revision(pr).split('.')[1];
  const plan = { recheck: [], carried: [], kept: [] };

  for (const gate of GATES) {
    const cur = current[gate.id];
    const prev = previous[gate.id];
    const outdated = (status) =>
      METADATA_GATES.includes(gate.id) && Boolean(status.revision) && status.revision.split('.')[1] !== metadataHash;
    if (repaired.includes(gate.id)) {
      plan.recheck.push(gate.id);
    } else if (cur && cur.state !== 'pending') {
      (outdated(cur) ? plan.recheck : plan.kept).push(gate.id);
    } else if (cur) {
      const running = await activeRuns({ github, context, workflow: gate.workflow, branch, event: 'workflow_dispatch' });
      (running.length ? plan.kept : plan.recheck).push(gate.id);
    } else if (prev && FINAL_STATES.has(prev.state) && !outdated(prev)) {
      const description = prev.carriedFrom ? prev.description : `carried from ${before.slice(0, 7)}: ${prev.description}`;
      await setGateStatus({
        github,
        context,
        core,
        sha,
        gate: gate.id,
        state: prev.state,
        description,
        targetUrl: prev.targetUrl,
        rev: prev.revision
      });
      plan.carried.push(gate.id);
    } else {
      plan.recheck.push(gate.id);
    }
  }

  for (const id of plan.recheck) {
    const gate = gateById(id);
    await setGateStatus({
      github,
      context,
      core,
      prNumber,
      sha,
      gate: id,
      state: 'pending',
      description: `${gate.name}: re-checking after ${reason}`,
      targetUrl: runUrl(context)
    });
    await github.rest.actions.createWorkflowDispatch({
      owner,
      repo,
      workflow_id: gate.workflow,
      ref: branch,
      inputs: { pr_number: String(prNumber) }
    });
    core.info(`🔁 Re-checking the ${gate.name} gate (${gate.workflow}) on ${sha.slice(0, 7)}.`);
  }
  return plan;
}

/**
 * Derive the `pr-quality` verdict for the PR head commit from its gate statuses.
 * `reported` ({ sha, results: { gate: job result } }) first marks gates that finished
 * without recording a result as errored. `announce` posts a comment on a final failure.
 */
async function evaluateVerdict({ github, context, core, prNumber, reported, excludeRunIds = [], announce = true }) {
  const { owner, repo } = context.repo;
  const targetUrl = runUrl(context);
  const { data: pr } = await github.rest.pulls.get({ owner, repo, pull_number: prNumber });
  if (pr.state !== 'open') return { state: 'closed', summary: `PR is ${pr.state}` };

  if (reported && reported.sha) {
    const statuses = await getGateStatuses({ github, context, sha: reported.sha });
    for (const [gate, result] of Object.entries(reported.results || {})) {
      const status = statuses[gate];
      if (status && status.state !== 'pending') continue;
      await setGateStatus({
        github,
        context,
        core,
        prNumber,
        sha: reported.sha,
        gate,
        state: 'error',
        description: `${gateById(gate).name} did not report a result (${result || 'not run'})`,
        targetUrl
      });
    }
  }

  const sha = pr.head.sha;
  const rev = revision(pr);
  const statuses = await getGateStatuses({ github, context, sha });
  const names = (predicate) => GATES.filter((g) => predicate(statuses[g.id])).map((g) => g.name);
  const waiting = names((s) => !s || s.state === 'pending');
  const failed = names((s) => s && (s.state === 'failure' || s.state === 'error'));
  const carried = names((s) => s && s.state === 'success' && s.carriedFrom);

  let state;
  let summary;
  let repairing = [];
  if (waiting.length) {
    state = 'pending';
    summary = `Checking: ${waiting.join(', ')}${failed.length ? `; failed: ${failed.join(', ')}` : ''}`;
  } else if (failed.length) {
    repairing = await remediationInProgress({ github, context, branch: pr.head.ref, excludeRunIds: [context.runId, ...excludeRunIds] });
    state = repairing.length ? 'pending' : 'failure';
    summary = `${repairing.length ? 'Repairing' : 'Failed'}: ${failed.join(', ')}`;
  } else if (carried.length) {
    state = 'pending';
    summary = 'Final check: re-running all gates together after the repairs';
    const running = await activeRuns({ github, context, workflow: PIPELINE_WORKFLOW, branch: pr.head.ref });
    if (!running.length) {
      await github.rest.actions.createWorkflowDispatch({
        owner,
        repo,
        workflow_id: PIPELINE_WORKFLOW,
        ref: pr.head.ref,
        inputs: { pr_number: String(prNumber), force: 'true' }
      });
      core.info(`Gates ${carried.join(', ')} were carried over from earlier commits; dispatched a final full check.`);
    }
  } else if (pr.mergeable === false) {
    return failBaseConflict({ github, context, core, pr, rev, targetUrl });
  } else {
    // e.g. the review-comments fixer addressing a Copilot review on this commit.
    repairing = await remediationInProgress({ github, context, branch: pr.head.ref, excludeRunIds: [context.runId, ...excludeRunIds] });
    state = repairing.length ? 'pending' : 'success';
    summary = repairing.length ? `All gates passed; waiting for: ${repairing.map((r) => r.workflow).join(', ')}` : 'All gates passed';
  }

  await setQualityStatus({ github, context, sha, state, summary, rev, targetUrl });
  core.info(`pr-quality = ${state}: ${summary} [rev ${rev}]`);

  if (state === 'success') {
    const ref = (context.payload.repository && context.payload.repository.default_branch) || 'main';
    try {
      await github.rest.actions.createWorkflowDispatch({ owner, repo, workflow_id: REVIEW_WORKFLOW, ref, inputs: { pr_number: String(prNumber) } });
    } catch (e) {
      core.warning(`Could not dispatch ${REVIEW_WORKFLOW}: ${e.message}`);
    }
  } else if (state === 'failure' && announce) {
    const links = GATES.filter((g) => statuses[g.id] && ['failure', 'error'].includes(statuses[g.id].state))
      .map((g) => `- **${g.name}**: ${statuses[g.id].description} ([run](${statuses[g.id].targetUrl}))`);
    await helpers().commentOnce({
      github,
      context,
      prNumber,
      marker: `<!-- pr-quality-failed:${rev} -->`,
      body: [
        '### ❌ Quality gates still failing after remediation',
        '',
        ...links,
        '',
        'No remediation agent is working on this PR any more. Please fix the remaining issues manually ' +
          '(pushing a commit re-runs every gate), or re-check with ' +
          `\`gh workflow run ${PIPELINE_WORKFLOW} --ref ${pr.head.ref} -f pr_number=${prNumber} -f force=true\`.`
      ].join('\n')
    });
  }
  return { state, summary, rev, waiting, failed, carried, repairing };
}

/**
 * Watchdog: re-evaluate PRs whose `pr-quality` has been pending for `staleMinutes` while no
 * pipeline or relay runs for them, e.g. when an agent failed before handing off to the relay
 * or a gate run was lost. Stuck gates are re-checked; finished repairs get a final verdict.
 */
async function sweepStalled({ github, context, core, staleMinutes = 30, now = Date.now() }) {
  const { owner, repo } = context.repo;
  const pulls = await github.paginate(github.rest.pulls.list, { owner, repo, state: 'open', per_page: 100 });
  const swept = [];
  for (const pr of pulls) {
    if (pr.labels.some((l) => REMEDIATION_LABELS.includes(l.name))) continue;
    if (pr.head.repo && pr.head.repo.full_name !== `${owner}/${repo}`) continue;
    const status = await getQualityStatus({ github, context, sha: pr.head.sha });
    if (!status || status.state !== 'pending') continue;
    if (status.updatedAt && now - Date.parse(status.updatedAt) < staleMinutes * 60000) continue;
    const branch = pr.head.ref;
    const pipelines = await activeRuns({ github, context, workflow: PIPELINE_WORKFLOW, branch });
    const relays = (await activeRuns({ github, context, workflow: RELAY_WORKFLOW })).filter((r) =>
      String(r.display_title || '').endsWith(` ${branch}`)
    );
    if (pipelines.length || relays.length) continue;
    try {
      core.info(`PR #${pr.number}: pr-quality pending since ${status.updatedAt || 'unknown'}; re-evaluating.`);
      const plan = await recheckGates({ github, context, core, prNumber: pr.number, branch, sha: pr.head.sha, reason: 'watchdog' });
      const verdict = await evaluateVerdict({ github, context, core, prNumber: pr.number });
      swept.push({ number: pr.number, recheck: plan.recheck, state: verdict.state, summary: verdict.summary });
    } catch (e) {
      core.warning(`PR #${pr.number}: watchdog could not re-evaluate: ${e.message}`);
    }
  }
  return swept;
}

// ---------------------------------------------------------------------------
// Repair commits (stacked PRs merged by the relay with the GitHub App token)
// ---------------------------------------------------------------------------

const RECHECK_TRAILER = 'Recheck-Gates';
const RECHECK_TRAILER_RE = new RegExp(`^${RECHECK_TRAILER}:[ \\t]*(.*)$`, 'm');

/** Commit message trailer naming the gates a relay merge repaired. */
function recheckTrailer(gates) {
  const ids = [...new Set(gates)].filter((id) => gateById(id));
  return `${RECHECK_TRAILER}: ${ids.join(', ')}`;
}

/** Gates named by a commit's `Recheck-Gates` trailer, or null when it is not a relay merge. */
function parseRecheckTrailer(message) {
  const match = RECHECK_TRAILER_RE.exec(message || '');
  if (!match) return null;
  return match[1]
    .split(',')
    .map((id) => id.trim())
    .filter((id) => gateById(id));
}

/**
 * Classify a `synchronize` push. When every pushed commit is a relay merge, return the gates to
 * re-check and the commit whose gate results carry over; otherwise null (full check).
 * Earlier relay merges whose own pipeline run never recorded every gate (e.g. it was replaced
 * by this push) are folded in, so their repairs are re-checked too. When no gate was ever
 * checked before the merges (the lint auto-fix stacked PR is proposed before the gates run),
 * there is nothing to carry over: null, so the push gets the full check.
 */
async function repairPush({ github, context, before, after, limit = 20 }) {
  const { owner, repo } = context.repo;
  if (!before || !after || /^0+$/.test(before)) return null;
  let compare;
  try {
    ({ data: compare } = await github.rest.repos.compareCommitsWithBasehead({ owner, repo, basehead: `${before}...${after}` }));
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
  if (compare.status !== 'ahead' || !(compare.commits || []).length) return null;
  const gates = new Set();
  for (const commit of compare.commits) {
    const repaired = parseRecheckTrailer(commit.commit && commit.commit.message);
    if (!repaired) return null;
    repaired.forEach((id) => gates.add(id));
  }

  let base = before;
  let statuses = await getGateStatuses({ github, context, sha: base });
  for (let i = 0; i < limit && !GATES.every((g) => statuses[g.id]); i++) {
    const { data: commit } = await github.rest.repos.getCommit({ owner, repo, ref: base });
    const repaired = parseRecheckTrailer(commit.commit && commit.commit.message);
    if (!repaired || !(commit.parents || []).length) break;
    repaired.forEach((id) => gates.add(id));
    base = commit.parents[0].sha;
    statuses = await getGateStatuses({ github, context, sha: base });
  }
  if (!GATES.some((g) => statuses[g.id])) return null;
  return { before: base, gates: GATES.map((g) => g.id).filter((id) => gates.has(id)) };
}

// ---------------------------------------------------------------------------
// Merge conflicts
// ---------------------------------------------------------------------------

/**
 * Whether a PR still merges into its base: 'clean', 'conflict' or 'unknown'. GitHub computes
 * `mergeable` in the background after either branch moves (null meanwhile), so with `sleep`
 * the PR is polled up to `attempts` times.
 */
async function mergeability({ github, context, prNumber, sleep, attempts = 5, delayMs = 3000 }) {
  const { owner, repo } = context.repo;
  for (let i = 1; ; i++) {
    const { data: pr } = await github.rest.pulls.get({ owner, repo, pull_number: prNumber });
    if (pr.mergeable === false) return { pr, state: 'conflict' };
    if (pr.mergeable !== null) return { pr, state: 'clean' };
    if (!sleep || i >= attempts) return { pr, state: 'unknown' };
    await sleep(delayMs);
  }
}

// The commit a stacked remediation PR was built on. The lint auto-fix records it in the PR body;
// gh-aw stamps its PRs with the agent run, whose `head_sha` is the commit it was dispatched on.
const STACKED_BASE_MARKER = /<!-- remediation-base: ([0-9a-f]{40}) -->/;
const GH_AW_RUN_MARKER = /<!-- gh-aw-agentic-workflow:[^>]*\bid: (\d+)/;
const stackedBaseMarker = (sha) => `<!-- remediation-base: ${sha} -->`;

/**
 * Whether the commit a stacked PR was built on is still in the parent branch's history:
 * 'intact', 'rebased' (the author rebased or force-pushed: merging it could bring back
 * commits the author removed) or 'unknown' (no recorded base).
 */
async function stackedBase({ github, context, pr, head }) {
  const { owner, repo } = context.repo;
  let base = (STACKED_BASE_MARKER.exec(pr.body || '') || [])[1];
  const runId = !base && (GH_AW_RUN_MARKER.exec(pr.body || '') || [])[1];
  if (runId) {
    try {
      ({
        data: { head_sha: base }
      } = await github.rest.actions.getWorkflowRun({ owner, repo, run_id: Number(runId) }));
    } catch (e) {
      if (e.status !== 404) throw e;
    }
  }
  if (!base) return { state: 'unknown', base: null };
  const { data } = await github.rest.repos.compareCommitsWithBasehead({ owner, repo, basehead: `${base}...${head}` });
  return { state: ['identical', 'ahead'].includes(data.status) ? 'intact' : 'rebased', base };
}

/**
 * Fail `pr-quality` for a PR that conflicts with its base branch. Resolving it means deciding
 * how this change combines with what landed on the base, so it is left to the author: no gate
 * or agent runs on a commit that cannot be merged anyway.
 */
async function failBaseConflict({ github, context, core, pr, rev = revision(pr), targetUrl = runUrl(context) }) {
  const base = pr.base.ref;
  const summary = `Merge conflict with ${base}: merge ${base} into the branch and push`;
  await setQualityStatus({ github, context, sha: pr.head.sha, state: 'failure', summary, rev, targetUrl });
  await helpers().commentOnce({
    github,
    context,
    prNumber: pr.number,
    marker: `<!-- base-conflict:${pr.head.sha} -->`,
    body: [
      `### ⚔️ Merge conflict with \`${base}\``,
      '',
      `This branch no longer merges cleanly into \`${base}\`, so the quality gates and remediation agents ` +
        'stop here. Conflict resolutions decide how this change combines with what landed on ' +
        `\`${base}\`, so they are left to you:`,
      '',
      '```bash',
      'git fetch origin',
      `git merge origin/${base}   # resolve the conflicts, then commit`,
      'git push',
      '```',
      '',
      'The push re-runs every gate.'
    ].join('\n')
  });
  core.notice(`PR #${pr.number} conflicts with ${base}: pr-quality = failure.`);
  return { state: 'failure', summary, rev, waiting: [], failed: [], carried: [], repairing: [], conflict: true };
}

/** A `pr-quality` status set by `failBaseConflict` (not a verdict on the code itself). */
const isBaseConflict = (status) => Boolean(status) && status.state === 'failure' && /^Merge conflict with /.test(status.description || '');

/**
 * Flag open PRs that conflict with their base (`pull_request` workflows do not run for them at
 * all). `pulls`: PRs to check; already flagged head commits are left alone.
 */
async function flagBaseConflicts({ github, context, core, pulls, sleep }) {
  const flagged = [];
  for (const candidate of pulls) {
    if (candidate.labels.some((l) => REMEDIATION_LABELS.includes(l.name))) continue;
    const { pr, state } = await mergeability({ github, context, prNumber: candidate.number, sleep });
    if (pr.state !== 'open' || state !== 'conflict') {
      core.info(`PR #${pr.number}: ${pr.state === 'open' ? state : pr.state}.`);
      continue;
    }
    if (isBaseConflict(await getQualityStatus({ github, context, sha: pr.head.sha }))) continue;
    await failBaseConflict({ github, context, core, pr });
    flagged.push(pr.number);
  }
  return flagged;
}

module.exports = {
  STATUS_CONTEXT,
  DECISION_LABELS,
  REMEDIATION_WORKFLOWS,
  REMEDIATION_LABELS,
  BLOCKED_LABEL,
  SUPERSEDED_LABEL,
  METADATA_GATES,
  GATES,
  revision,
  parseRevision,
  getQualityStatus,
  setQualityStatus,
  pendingRemediationRuns,
  repairedGate,
  repairedGates,
  passedLabel,
  getGateStatuses,
  setGateStatus,
  recordGate,
  startGates,
  remediationInProgress,
  recheckGates,
  evaluateVerdict,
  sweepStalled,
  recheckTrailer,
  parseRecheckTrailer,
  repairPush,
  mergeability,
  stackedBase,
  stackedBaseMarker,
  failBaseConflict,
  isBaseConflict,
  flagBaseConflicts
};
