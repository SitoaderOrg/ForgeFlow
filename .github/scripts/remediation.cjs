// Shared helpers used by the PR gatekeeper workflows (via actions/github-script).
//
// Events created with the default GITHUB_TOKEN (labels, pushes, PRs) do NOT trigger
// new workflow runs. `workflow_dispatch` is the exception, so every gate hands work
// to its remediation agent by dispatching the agent workflow directly on the PR
// head branch instead of relying on `labeled` events.

const ACTIVE_STATUSES = new Set(['queued', 'in_progress', 'waiting', 'pending', 'requested']);
const MAX_FINDINGS_LENGTH = 6000;

async function getLabels({ github, context, prNumber }) {
  const { owner, repo } = context.repo;
  const labels = await github.paginate(github.rest.issues.listLabelsOnIssue, {
    owner,
    repo,
    issue_number: prNumber,
    per_page: 100
  });
  return labels.map((l) => l.name);
}

async function addLabel({ github, context, core, prNumber, label }) {
  const { owner, repo } = context.repo;
  try {
    const current = await getLabels({ github, context, prNumber });
    if (!current.includes(label)) {
      await github.rest.issues.addLabels({ owner, repo, issue_number: prNumber, labels: [label] });
      core.info(`Applied '${label}' label.`);
    }
  } catch (e) {
    core.warning(`Failed to add label '${label}': ${e.message}`);
  }
}

async function removeLabel({ github, context, core, prNumber, label }) {
  const { owner, repo } = context.repo;
  try {
    const current = await getLabels({ github, context, prNumber });
    if (current.includes(label)) {
      await github.rest.issues.removeLabel({ owner, repo, issue_number: prNumber, name: label });
      core.info(`Removed '${label}' label.`);
    }
  } catch (e) {
    core.warning(`Failed to remove label '${label}': ${e.message}`);
  }
}

async function commentOnce({ github, context, prNumber, marker, body }) {
  const { owner, repo } = context.repo;
  const comments = await github.paginate(github.rest.issues.listComments, {
    owner,
    repo,
    issue_number: prNumber,
    per_page: 100
  });
  if (comments.some((c) => (c.body || '').includes(marker))) {
    return false;
  }
  await github.rest.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body: `${marker}\n${body}`
  });
  return true;
}

/**
 * Dispatch a gh-aw remediation workflow on the PR head branch.
 * Skips when a run is already active, when an unmerged stacked remediation PR is
 * still pending, or when the retry budget for this branch is exhausted.
 * @returns {Promise<'dispatched'|'in-progress'|'pending-stacked-pr'|'exhausted'|'error'>}
 */
async function dispatchRemediation({
  github,
  context,
  core,
  prNumber,
  headRef,
  workflow,
  findings = '',
  stackedLabel = '',
  maxAttempts
}) {
  const { owner, repo } = context.repo;
  const max = Number(maxAttempts || process.env.MAX_REMEDIATION_ATTEMPTS || 2);

  try {
    const runs = await github.paginate(github.rest.actions.listWorkflowRuns, {
      owner,
      repo,
      workflow_id: workflow,
      branch: headRef,
      event: 'workflow_dispatch',
      per_page: 100
    });

    if (runs.some((r) => ACTIVE_STATUSES.has(r.status))) {
      core.info(`${workflow} is already running for '${headRef}'. Not dispatching again.`);
      return 'in-progress';
    }

    if (stackedLabel) {
      const open = await github.paginate(github.rest.pulls.list, {
        owner,
        repo,
        state: 'open',
        base: headRef,
        per_page: 100
      });
      if (open.some((p) => p.labels.some((l) => l.name === stackedLabel))) {
        core.info(`A stacked '${stackedLabel}' PR is still pending for '${headRef}'.`);
        return 'pending-stacked-pr';
      }
    }

    // Cancelled/skipped runs never reached the agent, so they do not consume the budget
    const attempts = runs.filter((r) => !['cancelled', 'skipped'].includes(r.conclusion)).length;
    if (attempts >= max) {
      core.warning(`${workflow} already ran ${attempts} time(s) for '${headRef}' (max ${max}).`);
      await commentOnce({
        github,
        context,
        prNumber,
        marker: `<!-- remediation-exhausted:${workflow} -->`,
        body:
          `### ⚠️ Autonomous remediation budget exhausted\n\n` +
          `\`${workflow}\` has already run ${attempts} time(s) on this branch without clearing the gate. ` +
          `Manual intervention is required (or raise \`MAX_REMEDIATION_ATTEMPTS\`).`
      });
      return 'exhausted';
    }

    let text = String(findings || '').trim();
    if (text.length > MAX_FINDINGS_LENGTH) {
      text = `${text.slice(0, MAX_FINDINGS_LENGTH)}\n...[truncated]`;
    }

    await github.rest.actions.createWorkflowDispatch({
      owner,
      repo,
      workflow_id: workflow,
      ref: headRef,
      inputs: { pr_number: String(prNumber), findings: text }
    });
    core.info(`🤖 Dispatched ${workflow} on '${headRef}' for PR #${prNumber}.`);
    return 'dispatched';
  } catch (e) {
    core.warning(`Failed to dispatch ${workflow}: ${e.message}`);
    return 'error';
  }
}

module.exports = { getLabels, addLabel, removeLabel, commentOnce, dispatchRemediation };
