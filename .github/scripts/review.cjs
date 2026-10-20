// Copilot code review -> one stacked fix (used via actions/github-script).
//
// Once every gate passed, the review-request workflow requests a Copilot code review. Its inline
// comments are handed to the review-comments fixer in one batch, which addresses them all in a
// single stacked PR (`review-remediation`). The relay merges it like any other repair, re-checks
// every gate (a review fix can touch anything) and answers each Copilot thread: applied comments
// are resolved, skipped ones get the agent's reason. One automatic round per PR: once the fixes
// passed the gates and every comment was applied, Copilot gets one confirmation review (which can
// approve the final commit); its comments, like those of any later review, are left to the author.

const path = require('path');

const quality = () => require(path.join(__dirname, 'pr-quality.cjs'));
const remediation = () => require(path.join(__dirname, 'remediation.cjs'));

const REVIEW_LABEL = 'review-remediation';
const REVIEW_FIXER = 'fix-review-comments.lock.yml';
const MAX_COMMENT_LENGTH = 1200;
const MAX_REASON_LENGTH = 500;

// REST reports the reviewer as `copilot-pull-request-reviewer[bot]`, GraphQL without `[bot]`.
const isCopilot = (login) => /^copilot(-pull-request-reviewer)?(\[bot\])?$/i.test(String(login || ''));

const THREADS_QUERY = `query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id isResolved isOutdated path line
          comments(first: 1) { nodes { databaseId body url author { login } } }
        }
      }
    }
  }
}`;

const RESOLVE_MUTATION = 'mutation($id: ID!) { resolveReviewThread(input: { threadId: $id }) { thread { id } } }';

/** Review threads on a PR opened by Copilot. */
async function copilotThreads({ github, context, prNumber }) {
  const { owner, repo } = context.repo;
  const threads = [];
  let cursor = null;
  do {
    const data = await github.graphql(THREADS_QUERY, { owner, repo, number: prNumber, cursor });
    const page = data.repository.pullRequest.reviewThreads;
    for (const thread of page.nodes) {
      const first = thread.comments.nodes[0];
      if (!first || !isCopilot(first.author && first.author.login)) continue;
      threads.push({
        id: thread.id,
        resolved: thread.isResolved,
        outdated: thread.isOutdated,
        path: thread.path,
        line: thread.line,
        commentId: first.databaseId,
        body: first.body || '',
        url: first.url
      });
    }
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (cursor);
  return threads;
}

/** Findings handed to the agent: one block per comment, keyed by its comment id. */
function reviewFindings(threads) {
  return threads
    .map((t) => {
      const body = t.body.length > MAX_COMMENT_LENGTH ? `${t.body.slice(0, MAX_COMMENT_LENGTH)}\n...[comment truncated]` : t.body;
      return `[comment ${t.commentId}] ${t.path}${t.line ? `:${t.line}` : ''}\n${body.trim()}`;
    })
    .join('\n\n');
}

/**
 * Hand the open Copilot review comments of a PR to the review-comments fixer, all in one batch.
 * Only once every gate passed on the head commit (so it never races the gate agents), and
 * only once per PR: any earlier review-comments fixer run on the branch means the round happened,
 * unless the relay superseded its stacked PR after a merge conflict.
 * @returns {Promise<{result: string, comments: number}>}
 */
async function addressCopilotReview({ github, context, core, prNumber }) {
  const { owner, repo } = context.repo;
  const q = quality();
  const skip = (result) => {
    core.info(`PR #${prNumber}: not addressing the Copilot review (${result}).`);
    return { result, comments: 0 };
  };

  const { data: pr } = await github.rest.pulls.get({ owner, repo, pull_number: prNumber });
  if (pr.state !== 'open') return skip('not-open');
  if (pr.draft) return skip('draft');
  if (pr.head.repo && pr.head.repo.full_name !== `${owner}/${repo}`) return skip('fork');
  if (pr.labels.some((l) => q.REMEDIATION_LABELS.includes(l.name))) return skip('stacked-pr');

  const status = await q.getQualityStatus({ github, context, sha: pr.head.sha });
  if (!status || status.state !== 'success') return skip('gates-not-green');

  let runs = [];
  try {
    runs = await github.paginate(github.rest.actions.listWorkflowRuns, {
      owner,
      repo,
      workflow_id: REVIEW_FIXER,
      branch: pr.head.ref,
      event: 'workflow_dispatch',
      per_page: 100
    });
  } catch (e) {
    if (e.status !== 404) throw e;
  }
  // Active runs have no conclusion yet and count too; cancelled/skipped ones never reached the agent.
  // A review fix the relay superseded after a merge conflict gives its round back (once: a
  // second conflict is blocked by the relay).
  const attempts = runs.filter((r) => !['cancelled', 'skipped'].includes(r.conclusion)).length;
  if (attempts) {
    const superseded = (
      await github.paginate(github.rest.pulls.list, { owner, repo, state: 'closed', base: pr.head.ref, per_page: 100 })
    ).filter((p) => [REVIEW_LABEL, remediation().SUPERSEDED_LABEL].every((name) => p.labels.some((l) => l.name === name)));
    if (attempts - superseded.length >= 1) return skip('already-addressed');
  }

  const threads = (await copilotThreads({ github, context, prNumber })).filter((t) => !t.resolved && !t.outdated);
  if (!threads.length) return skip('no-comments');

  const result = await remediation().dispatchRemediation({
    github,
    context,
    core,
    prNumber,
    headRef: pr.head.ref,
    workflow: REVIEW_FIXER,
    findings: reviewFindings(threads),
    stackedLabel: REVIEW_LABEL,
    maxAttempts: 1
  });
  if (result === 'dispatched') {
    // Keep the PR out of human review until the fixes landed and every gate re-checked them.
    await q.setQualityStatus({
      github,
      context,
      sha: pr.head.sha,
      state: 'pending',
      summary: `Addressing ${threads.length} Copilot review comment(s)`,
      rev: q.revision(pr),
      targetUrl: `${context.serverUrl}/${owner}/${repo}/actions/runs/${context.runId}`
    });
  }
  return { result, comments: threads.length };
}

/**
 * Decisions the agent listed in its stacked PR body, one per line:
 * `- applied <comment id>: <note>` or `- skipped <comment id>: <reason>`.
 */
function parseReviewDecisions(body) {
  const decisions = new Map();
  const re = /^[ \t]*[-*][ \t]*(applied|skipped)[ \t]+(?:comment[ \t]+)?#?(\d+)[ \t]*(?:[:\u2014-][ \t]*(.*))?$/gim;
  for (const match of String(body || '').matchAll(re)) {
    decisions.set(Number(match[2]), {
      decision: match[1].toLowerCase(),
      commentId: Number(match[2]),
      reason: (match[3] || '').trim().slice(0, MAX_REASON_LENGTH)
    });
  }
  return [...decisions.values()];
}

/**
 * After the relay merged a `review-remediation` PR: reply to every Copilot thread the agent
 * made a decision on, and resolve the applied ones. Skipped threads stay open for the author.
 */
async function answerCopilotReview({ github, context, core, prNumber, stacked, sha }) {
  const { owner, repo } = context.repo;
  const decisions = parseReviewDecisions(stacked.body);
  if (!decisions.length) {
    core.warning(`Stacked PR #${stacked.number} lists no review decisions; Copilot threads left as they are.`);
    return [];
  }
  const threads = new Map((await copilotThreads({ github, context, prNumber })).map((t) => [t.commentId, t]));
  const answered = [];
  for (const d of decisions) {
    const thread = threads.get(d.commentId);
    if (!thread || thread.resolved) continue;
    const body =
      d.decision === 'applied'
        ? `✅ Applied in ${sha.slice(0, 7)} (stacked PR #${stacked.number}).${d.reason ? ` ${d.reason}` : ''}`
        : `⏭️ Not applied by the review-comments fixer (stacked PR #${stacked.number}): ${d.reason || 'no reason given'}. Left for the author.`;
    try {
      await github.rest.pulls.createReplyForReviewComment({ owner, repo, pull_number: prNumber, comment_id: d.commentId, body });
      if (d.decision === 'applied') await github.graphql(RESOLVE_MUTATION, { id: thread.id });
      answered.push(d);
    } catch (e) {
      core.warning(`Could not answer Copilot comment ${d.commentId}: ${e.message}`);
    }
  }
  core.info(`Answered ${answered.length} Copilot review thread(s) on PR #${prNumber}.`);
  return answered;
}

/**
 * Whether the review-request workflow should request a Copilot review now (the gates just passed):
 * - `initial`: Copilot never reviewed the PR; its comments get the one automatic fix round;
 * - `confirmation`: a review fix was merged, every Copilot comment is resolved (all applied) and
 *   Copilot has not reviewed since. This review can approve the final commit (the fix commit
 *   dismissed any earlier Copilot approval); its comments are left to the author, since the fix
 *   round is used up. With a comment still open (skipped), no confirmation: Copilot would only
 *   repeat it (it does not remember earlier rounds).
 * Only one review fix round merges per PR, so Copilot is requested at most twice: no loop.
 * @returns {Promise<{request: ''|'initial'|'confirmation', reason: string}>}
 */
async function copilotReviewRequest({ github, context, prNumber }) {
  const { owner, repo } = context.repo;
  const { data: pr } = await github.rest.pulls.get({ owner, repo, pull_number: prNumber });
  const { data: requested } = await github.rest.pulls.listRequestedReviewers({ owner, repo, pull_number: prNumber });
  if ((requested.users || []).some((u) => isCopilot(u.login))) {
    return { request: '', reason: 'A Copilot review is already requested.' };
  }
  const reviews = (await github.paginate(github.rest.pulls.listReviews, { owner, repo, pull_number: prNumber, per_page: 100 })).filter(
    (r) => isCopilot(r.user && r.user.login)
  );
  if (!reviews.length) return { request: 'initial', reason: 'Copilot has not reviewed this PR yet.' };

  const fixes = (await github.paginate(github.rest.pulls.list, { owner, repo, state: 'closed', base: pr.head.ref, per_page: 100 }))
    .filter((p) => p.merged_at && p.labels.some((l) => l.name === REVIEW_LABEL))
    .map((p) => Date.parse(p.merged_at));
  if (!fixes.length) return { request: '', reason: 'Copilot already reviewed this PR and no review fixes were merged since.' };
  const lastFix = Math.max(...fixes);
  if (reviews.some((r) => Date.parse(r.submitted_at) > lastFix)) {
    return { request: '', reason: 'Copilot already reviewed the review fixes; request another review manually for a new pass.' };
  }
  // Applied comments were resolved when the fix merged; an open one was skipped (or left
  // unanswered). Copilot does not remember earlier rounds and would raise it again, so it would
  // not approve either: leave the open comments to the author instead.
  const open = (await copilotThreads({ github, context, prNumber })).filter((t) => !t.resolved).length;
  if (open) {
    return { request: '', reason: `${open} Copilot comment(s) are still open (not applied by the review fix); they are left to the author.` };
  }
  return { request: 'confirmation', reason: 'Every Copilot comment was applied: Copilot confirms the final commit.' };
}

/**
 * Right after requesting the first Copilot review: wait for Copilot's review of `headSha` and hand
 * its comments to the review-comments fixer at once. The `pull_request_review` run that Copilot's
 * review starts is held for approval (its actor is Copilot), so without this the hand-over waits
 * for the watchdog. Bounded: stops when the PR is closed or gets a new head commit (a new pipeline
 * run takes over), and after `timeoutMs` without a review (the watchdog takes over).
 * @returns {Promise<{result: 'reviewed'|'not-open'|'head-changed'|'timeout', address?: string, comments?: number}>}
 */
async function awaitCopilotReview({ github, context, core, prNumber, headSha, sleep, timeoutMs = 900000, intervalMs = 20000 }) {
  const { owner, repo } = context.repo;
  const polls = Math.max(1, Math.ceil(timeoutMs / intervalMs));
  for (let poll = 1; ; poll++) {
    const { data: pr } = await github.rest.pulls.get({ owner, repo, pull_number: prNumber });
    if (pr.state !== 'open') return { result: 'not-open' };
    if (pr.head.sha !== headSha) return { result: 'head-changed' };
    const reviews = await github.paginate(github.rest.pulls.listReviews, { owner, repo, pull_number: prNumber, per_page: 100 });
    if (reviews.some((r) => isCopilot(r.user && r.user.login) && r.commit_id === headSha)) {
      core.info(`PR #${prNumber}: Copilot reviewed ${headSha.slice(0, 7)}.`);
      const { result, comments } = await addressCopilotReview({ github, context, core, prNumber });
      return { result: 'reviewed', address: result, comments };
    }
    if (poll >= polls) return { result: 'timeout' };
    await sleep(intervalMs);
  }
}

/**
 * Watchdog fallback for a lost `pull_request_review` event: address Copilot reviews on open PRs
 * into the default branch whose gates all passed.
 */
async function sweepCopilotReviews({ github, context, core }) {
  const { owner, repo } = context.repo;
  const base = (context.payload.repository && context.payload.repository.default_branch) || 'main';
  const pulls = await github.paginate(github.rest.pulls.list, { owner, repo, state: 'open', base, per_page: 100 });
  const dispatched = [];
  for (const pr of pulls) {
    try {
      const { result, comments } = await addressCopilotReview({ github, context, core, prNumber: pr.number });
      if (result === 'dispatched') dispatched.push({ number: pr.number, comments });
    } catch (e) {
      core.warning(`PR #${pr.number}: could not check the Copilot review: ${e.message}`);
    }
  }
  return dispatched;
}

module.exports = {
  REVIEW_LABEL,
  REVIEW_FIXER,
  isCopilot,
  copilotThreads,
  reviewFindings,
  addressCopilotReview,
  parseReviewDecisions,
  answerCopilotReview,
  copilotReviewRequest,
  awaitCopilotReview,
  sweepCopilotReviews
};
