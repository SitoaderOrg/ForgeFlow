import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  createContext,
  createCore,
  createGitHub,
  getScript,
  loadWorkflow,
  makeAgentRun,
  makePR,
  makeRun,
  quality,
  readWorkflow,
  runScript,
  SCRIPTS_DIR,
  seedQualityStatus
} from './helpers/harness.js';

// Copilot code review -> Fix: Copilot review comments -> one stacked PR (.github/scripts/review.cjs).

const review = createRequire(import.meta.url)(
  path.join(SCRIPTS_DIR, 'review.cjs')
);
const BRANCH = 'feat/sample';
const COPILOT = 'copilot-pull-request-reviewer';

const thread = (id, commentId, extra = {}) => ({
  id,
  path: `apps/${id}.js`,
  line: 7,
  comments: [
    { databaseId: commentId, body: `Fix ${commentId}.`, author: COPILOT }
  ],
  ...extra
});

async function world({ quality: state = 'success', threads, ...rest } = {}) {
  const pr = makePR({ number: 20, branch: BRANCH });
  const github = createGitHub({
    pulls: [pr],
    reviewThreads: { 20: threads ?? [thread('T1', 9001), thread('T2', 9002)] },
    ...rest
  });
  if (state) await seedQualityStatus(github, pr, state);
  return { github, pr: github.pr(20) };
}

const address = (github, core = createCore()) =>
  review.addressCopilotReview({
    github,
    context: createContext(),
    core,
    prNumber: 20
  });
const fixerDispatches = (github) =>
  github.state.dispatches.filter((d) => d.workflow_id === review.REVIEW_FIXER);

describe('review.cjs addressCopilotReview', () => {
  it('hands every open Copilot comment to the review-comments fixer in one dispatch', async () => {
    const { github, pr } = await world();
    expect(await address(github)).toEqual({
      result: 'dispatched',
      comments: 2
    });
    const [dispatch] = fixerDispatches(github);
    expect(dispatch).toMatchObject({
      ref: BRANCH,
      inputs: { pr_number: '20' }
    });
    expect(dispatch.inputs.findings).toBe(
      '[comment 9001] apps/T1.js:7\nFix 9001.\n\n[comment 9002] apps/T2.js:7\nFix 9002.'
    );
    // Held out of human review until the fixes landed and the gates re-checked them.
    const [status] = github.qualityStatuses(pr.head.sha);
    expect(status.state).toBe('pending');
    expect(status.description).toContain(
      'Addressing 2 Copilot review comment(s)'
    );
  });

  it('ignores resolved, outdated and non-Copilot threads', async () => {
    const { github } = await world({
      threads: [
        thread('T1', 9001, { isResolved: true }),
        thread('T2', 9002, { isOutdated: true }),
        {
          ...thread('T3', 9003),
          comments: [
            { databaseId: 9003, body: 'Human note', author: 'octocat' }
          ]
        },
        thread('T4', 9004)
      ]
    });
    expect(await address(github)).toEqual({
      result: 'dispatched',
      comments: 1
    });
    expect(fixerDispatches(github)[0].inputs.findings).toMatch(
      /^\[comment 9004\]/
    );
  });

  it('truncates very long comments', async () => {
    const long = thread('T1', 9001);
    long.comments[0].body = 'x'.repeat(5000);
    const { github } = await world({ threads: [long] });
    await address(github);
    const { findings } = fixerDispatches(github)[0].inputs;
    expect(findings.length).toBeLessThan(1400);
    expect(findings).toContain('[comment truncated]');
  });

  it.each([
    ['pending', 'gates-not-green'],
    ['failure', 'gates-not-green'],
    [null, 'gates-not-green']
  ])('waits for the gates (pr-quality %s)', async (state, result) => {
    const { github } = await world({ quality: state });
    expect((await address(github)).result).toBe(result);
    expect(github.state.dispatches).toEqual([]);
  });

  it('runs one automatic round per PR', async () => {
    const { github } = await world({
      runs: [makeRun({ id: 1, workflow: review.REVIEW_FIXER, branch: BRANCH })]
    });
    expect((await address(github)).result).toBe('already-addressed');
    expect(github.state.dispatches).toEqual([]);
  });

  it('addresses the review again once after its stacked PR was superseded', async () => {
    const superseded = (number) =>
      makePR({
        number,
        branch: `review-fix/pr-20-${number}`,
        base: BRANCH,
        state: 'closed',
        labels: ['review-remediation', 'remediation-superseded']
      });
    const fixerRun = (id) =>
      makeRun({ id, workflow: review.REVIEW_FIXER, branch: BRANCH });
    const { github } = await world({ runs: [fixerRun(1)] });
    github.state.pulls.push(superseded(50));
    expect((await address(github)).result).toBe('dispatched');

    // The regenerated round counts: no third one.
    github.state.runs.push(fixerRun(2));
    await seedQualityStatus(github, github.pr(20), 'success');
    expect((await address(github)).result).toBe('already-addressed');
  });

  it('does not dispatch twice while the fixer is still running', async () => {
    const { github } = await world({
      runs: [
        makeAgentRun({ id: 1, workflow: review.REVIEW_FIXER, branch: BRANCH })
      ]
    });
    expect((await address(github)).result).toBe('already-addressed');
  });

  it('retries when the earlier run never reached the agent', async () => {
    const { github } = await world({
      runs: [
        makeRun({
          id: 1,
          workflow: review.REVIEW_FIXER,
          branch: BRANCH,
          conclusion: 'cancelled'
        })
      ]
    });
    expect((await address(github)).result).toBe('dispatched');
  });

  it('does nothing without open Copilot comments', async () => {
    const { github } = await world({ threads: [] });
    expect((await address(github)).result).toBe('no-comments');
    expect(github.state.dispatches).toEqual([]);
  });

  it('skips drafts, closed, forked and stacked PRs', async () => {
    for (const [patch, result] of [
      [{ draft: true }, 'draft'],
      [{ state: 'closed' }, 'not-open'],
      [
        {
          head: {
            ref: BRANCH,
            sha: 'f'.repeat(40),
            repo: { full_name: 'fork/demo' }
          }
        },
        'fork'
      ],
      [{ labels: [{ name: 'lint-remediation' }] }, 'stacked-pr']
    ]) {
      const { github } = await world();
      Object.assign(github.pr(20), patch);
      expect((await address(github)).result).toBe(result);
    }
  });
});

describe('review.cjs parseReviewDecisions', () => {
  it('reads one decision per comment id from the stacked PR body', () => {
    const body = [
      'Summary',
      '## Review decisions',
      '- applied 101: guard the empty list',
      '* Skipped #102 — out of scope',
      '- applied comment 103',
      '- applied 101: last one wins',
      'applied 104: not a list item'
    ].join('\n');
    expect(review.parseReviewDecisions(body)).toEqual([
      { decision: 'applied', commentId: 101, reason: 'last one wins' },
      { decision: 'skipped', commentId: 102, reason: 'out of scope' },
      { decision: 'applied', commentId: 103, reason: '' }
    ]);
    expect(review.parseReviewDecisions(undefined)).toEqual([]);
  });

  it('recognizes the Copilot reviewer under its REST and GraphQL logins', () => {
    for (const login of [COPILOT, `${COPILOT}[bot]`, 'Copilot']) {
      expect(review.isCopilot(login)).toBe(true);
    }
    expect(review.isCopilot('octocat')).toBe(false);
    expect(review.isCopilot('copilot-impersonator')).toBe(false);
  });
});

describe('review.cjs answerCopilotReview', () => {
  it('warns and leaves the threads alone when the PR lists no decisions', async () => {
    const { github } = await world();
    const core = createCore();
    const answered = await review.answerCopilotReview({
      github,
      context: createContext(),
      core,
      prNumber: 20,
      stacked: { number: 50, body: 'No decisions here.' },
      sha: 'a'.repeat(40)
    });
    expect(answered).toEqual([]);
    expect(core.warnings[0]).toContain('lists no review decisions');
    expect(github.state.reviewReplies).toBeUndefined();
  });
});

describe('review-intake.yml', () => {
  const wf = loadWorkflow('review-intake.yml');
  const script = getScript(
    'review-intake.yml',
    'intake',
    'Hand the review to the review-comments fixer'
  );

  it('runs when Copilot submits a review, or by hand', () => {
    expect(wf.on.pull_request_review.types).toEqual(['submitted']);
    expect(wf.on.workflow_dispatch.inputs.pr_number.required).toBe(true);
    expect(wf.jobs.intake.if).toContain(
      "contains(github.event.review.user.login, 'copilot')"
    );
    expect(wf.permissions).toMatchObject({
      actions: 'write',
      statuses: 'write'
    });
  });

  it('dispatches the review-comments fixer', async () => {
    const { github } = await world();
    const { core } = await runScript(script, {
      github,
      env: { PR_NUMBER: '20' }
    });
    expect(fixerDispatches(github)).toHaveLength(1);
    expect(core.summaryText).toContain('Result: dispatched (2 comment(s))');
  });
});

describe('review.cjs copilotReviewRequest', () => {
  const ask = (github) =>
    review.copilotReviewRequest({
      github,
      context: createContext(),
      prNumber: 20
    });
  const copilotReview = (submitted_at, state = 'COMMENTED') => ({
    user: { login: `${COPILOT}[bot]` },
    state,
    submitted_at
  });
  const reviewFix = (number, merged_at, labels = ['review-remediation']) => ({
    ...makePR({ number, branch: `review-fix/pr-20-${number}`, base: BRANCH }),
    state: 'closed',
    merged: Boolean(merged_at),
    merged_at,
    labels: labels.map((name) => ({ name }))
  });
  const T0 = '2025-01-01T10:00:00Z';
  const T1 = '2025-01-01T11:00:00Z';
  const T2 = '2025-01-01T12:00:00Z';

  it('requests the first review when Copilot never reviewed the PR', async () => {
    const { github } = await world();
    expect((await ask(github)).request).toBe('initial');
  });

  it('does not request while a Copilot review is pending', async () => {
    const { github } = await world({
      requestedReviewers: { 20: ['Copilot'] }
    });
    expect((await ask(github)).request).toBe('');
  });

  it('does not re-request when no review fix was merged', async () => {
    // The fixer skipped every comment, or the human addressed them: nothing new to confirm.
    const { github } = await world({ reviews: { 20: [copilotReview(T0)] } });
    github.state.pulls.push(
      reviewFix(31, null),
      reviewFix(32, T1, ['lint-remediation'])
    );
    expect(await ask(github)).toMatchObject({
      request: '',
      reason: expect.stringContaining('no review fixes were merged')
    });
  });

  it('requests one confirmation review once every comment was applied', async () => {
    // The relay resolved every applied thread when the review fix merged.
    const { github } = await world({
      reviews: { 20: [copilotReview(T0)] },
      threads: [
        thread('T1', 9001, { isResolved: true }),
        thread('T2', 9002, { isResolved: true, isOutdated: true })
      ]
    });
    github.state.pulls.push(reviewFix(31, T1));
    expect((await ask(github)).request).toBe('confirmation');
  });

  it('skips the confirmation review while a comment is still open', async () => {
    // A skipped comment stays open: Copilot would only repeat it, and not approve.
    const { github } = await world({
      reviews: { 20: [copilotReview(T0)] },
      threads: [
        thread('T1', 9001, { isResolved: true }),
        thread('T2', 9002, { isOutdated: true })
      ]
    });
    github.state.pulls.push(reviewFix(31, T1));
    expect(await ask(github)).toMatchObject({
      request: '',
      reason: expect.stringContaining('1 Copilot comment(s) are still open')
    });
  });

  it('never requests a third review', async () => {
    const { github } = await world({
      reviews: { 20: [copilotReview(T0), copilotReview(T2, 'APPROVED')] }
    });
    github.state.pulls.push(reviewFix(31, T1));
    expect(await ask(github)).toMatchObject({
      request: '',
      reason: expect.stringContaining('already reviewed the review fixes')
    });
  });

  it('leaves the confirmation review comments to the author', async () => {
    // The confirmation review's comments arrive through the intake: the fix round is used up.
    const { github } = await world({
      reviews: { 20: [copilotReview(T0), copilotReview(T2)] },
      runs: [makeRun({ id: 1, workflow: review.REVIEW_FIXER, branch: BRANCH })]
    });
    github.state.pulls.push(reviewFix(31, T1));
    expect((await address(github)).result).toBe('already-addressed');
    expect(fixerDispatches(github)).toHaveLength(0);
  });
});

describe('Copilot review wiring', () => {
  it('the review-request workflow requests Copilot at most twice and hands over earlier reviews', async () => {
    const text = readWorkflow('review-request.yml');
    expect(text).toContain(
      'COPILOT_REQUEST: ${{ steps.copilot.outputs.request }}'
    );
    expect(text).toContain('confirmation review');
    const wf = loadWorkflow('review-request.yml');
    expect(wf.permissions).toMatchObject({
      actions: 'write',
      statuses: 'write'
    });

    const { github } = await world();
    const { core } = await runScript(
      getScript(
        'review-request.yml',
        'review-request',
        'Decide on a Copilot review'
      ),
      { github, env: { PR_NUMBER: '20' } }
    );
    expect(core.outputs.request).toBe('initial');

    await runScript(
      getScript(
        'review-request.yml',
        'review-request',
        'Address an earlier Copilot review'
      ),
      { github, env: { PR_NUMBER: '20' } }
    );
    expect(fixerDispatches(github)).toHaveLength(1);
  });

  it('the watchdog hands over Copilot reviews whose event was lost', async () => {
    const { github } = await world();
    const { core } = await runScript(
      getScript('verdict.yml', 'verdict', 'Publish pr-quality status'),
      {
        github,
        context: createContext({ eventName: 'schedule' }),
        env: {
          PR_NUMBER: '',
          GATE: '',
          GATE_RESULT: '',
          GATE_SHA: '',
          STALE_VERDICT_MINUTES: '30'
        }
      }
    );
    expect(fixerDispatches(github)).toHaveLength(1);
    expect(core.summaryText).toContain(
      '#20: handed 2 Copilot review comment(s) to the review-comments fixer'
    );
  });

  it('keeps pr-quality pending while the fixer works, even with every gate green', async () => {
    const { github, pr } = await world({
      quality: null,
      runs: [
        makeAgentRun({ id: 7, workflow: review.REVIEW_FIXER, branch: BRANCH })
      ]
    });
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
    const verdict = await quality.evaluateVerdict({
      github,
      context: createContext(),
      core: createCore(),
      prNumber: 20
    });
    expect(verdict.state).toBe('pending');
    expect(verdict.summary).toContain(
      'waiting for: fix-review-comments.lock.yml'
    );
    expect(
      github.state.dispatches.some(
        (d) => d.workflow_id === 'review-request.yml'
      )
    ).toBe(false);
  });
});
