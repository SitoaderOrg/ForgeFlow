---
name: 'Fix: Copilot review comments'
run-name: 'Fix: Copilot review comments · PR #${{ inputs.pr_number }}'
description: Addresses all Copilot code review comments on a pull request at once, offering the fixes as a single stacked PR
emoji: "🔍"

on:
  workflow_dispatch:
    inputs:
      pr_number:
        description: "Pull request number to remediate (dispatch this workflow on the PR head branch)"
        required: true
        type: string
      findings:
        description: "Open Copilot review comments, one block per comment id"
        required: false
        type: string
        default: ""
  # Dispatched by the review-request workflow / intake with GITHUB_TOKEN (actor github-actions[bot]);
  # workflow_dispatch itself already requires write access to the repository.
  roles: all

concurrency:
  group: "gh-aw-${{ github.workflow }}-${{ github.ref }}"
  job-discriminator: ${{ github.ref }}

# Agents edit the branch they are dispatched on and stack their PR onto it; a run left on
# the default branch (the Actions UI default) can never target the feature PR.
if: github.ref_name != github.event.repository.default_branch

engine:
  id: copilot
  # Pinned: "auto" can resolve to models that reject Copilot CLI custom tools (e.g. gpt-5.6-luna-utility).
  # Must be a chat model enabled for the org's Copilot inference (see the api-proxy models.json in run artifacts).
  model: ${{ vars.GH_AW_AGENT_MODEL || 'gpt-4.1' }}
  # Serialize agent jobs repo-wide: parallel remediation agents exhaust the Copilot
  # inference rate limit (HTTP 429).
  concurrency:
    group: "gh-aw-copilot-remediation-agents"
    queue: max
  # One retry (2 attempts): a 429 with a long retry-after should fail fast and hand off to the relay.
  harness:
    max-retries: 1
    initial-delay-ms: 30000
    backoff-multiplier: 2
    max-delay-ms: 180000

permissions:
  contents: read
  pull-requests: read
  issues: read
  copilot-requests: write

tools:
  edit: true
  bash: true
  github:
    mode: "gh-proxy"

network:
  allowed:
    - defaults
    - node

strict: true

# Hands off to the remediation relay from the generated conclusion job, whatever the agent's result.
imports:
  - shared/remediation-handoff.md

features:
  copilot-requests: true

safe-outputs:
  create-pull-request:
    title-prefix: "fix(review): "
    labels: ["review-remediation"]
    allowed-base-branches: ["*"]
    draft: false
    fallback-as-issue: false
  add-comment:
    max: 1
    target: "*"
---

## Pull Request Context
- **Parent pull request**: #${{ github.event.inputs.pr_number }} — this workflow was dispatched on that PR's head branch, which is checked out in the workspace.
- **Open Copilot code review comments** (each block starts with `[comment <id>] <file>:<line>`):

```text
${{ github.event.inputs.findings }}
```

Always pass `pull_request_number: ${{ github.event.inputs.pr_number }}` (or `item_number` for comments) to safe outputs that target the parent PR.

## Before You Start
Confirm with `gh pr view ${{ github.event.inputs.pr_number }} --json state,headRefName` that the pull request is open and that its head branch is the branch checked out in the workspace (`git branch --show-current`). Your changes and any stacked pull request are based on this branch, and the sandbox cannot fetch other branches. If the pull request is not open or its head branch is different, change nothing: call `noop` explaining that this workflow must be re-dispatched with "Use workflow from" set to the pull request's head branch, and stop.

## Efficiency Rules (keep the run small)
- The comments above are your work list. Only if the list ends with `[truncated]`, fetch the remaining ones once with `gh api repos/${{ github.repository }}/pulls/${{ github.event.inputs.pr_number }}/comments`.
- Only read the files the comments point at (and their tests). Each application is a self-contained project in `apps/<app>/`: run `npm ci` once in that folder for its tests, and once at the repository root for the shared lint (`npm run lint`). Finish in fewer than 25 tool calls.

## Objective
Every quality gate already passed on this pull request; GitHub Copilot then reviewed it. Address **all** of its comments in **one** stacked pull request, so the author reviews a single consolidated change instead of clicking through suggestions one by one. You are the only automatic round: comments you skip go to the author, so decide each one carefully.

## Step 1: Decide Each Comment
For every `[comment <id>]`, decide whether to apply it:
- **Apply** when it points out a real bug, a missed edge case, a security or correctness issue, a clear readability improvement, or carries a ` ```suggestion ` block that is correct as written.
- **Skip** when it is wrong, already handled elsewhere, a matter of taste, out of the PR's scope, or would need a design decision from the author. Write a one-sentence reason.

## Step 2: Apply the Accepted Comments
1. Before editing files, create a new branch from the checked-out pull request branch with `git switch -c review-fix/pr-${{ github.event.inputs.pr_number }}`.
2. Apply a ` ```suggestion ` block exactly as written at the commented lines; otherwise make the smallest change that fully addresses the comment. Keep the author's style, and never change unrelated code.
3. If a fix changes behavior, update or add the matching tests.
4. Run the linter and the tests of the affected files. If a fix breaks them and you cannot repair it, revert that fix and mark the comment as skipped with the reason.
5. Commit all accepted fixes together.

## Step 3: Propose One Stacked Pull Request
If you applied at least one comment, call `create-pull-request`:
- `branch`: `review-fix/pr-${{ github.event.inputs.pr_number }}`; `base`: the pull request's head branch (`headRefName`).
- `title`: `address Copilot review comments`
- `body`: a short summary, then a `## Review decisions` section with **exactly one line per comment**, using its numeric id, in this format (the relay parses these lines to reply to each Copilot thread):

  ```markdown
  ## Review decisions
  - applied 1234567890: short note on what changed
  - skipped 1234567891: one-sentence reason
  ```

  End the body with: "This stacked PR was automatically opened by the **Fix: Copilot review comments** agent and will be squashed into your feature branch by \`relay.yml\`, which re-checks every gate and answers each Copilot comment."

If you skip every comment, change nothing: call `add-comment` on the parent PR with the same `## Review decisions` list, then call `noop` and stop.

## Safe Output Rules
- Call `create_pull_request` with `branch` set to the new `review-fix/pr-${{ github.event.inputs.pr_number }}` branch and `base` set to the pull request's head branch. Never use the pull request's head branch as `branch`: a pull request cannot be stacked on its own branch.
- Provide only `title`, `body`, `branch` and `base` — do **not** pass a `temporary_id` or `dependencies`.
- Do not reply to or resolve review threads yourself, and do not invent URLs: the remediation relay answers every Copilot comment once the stacked PR is merged.

## When You Are Done
Stop after your safe outputs: the remediation relay is dispatched automatically when this run ends. It merges the stacked pull request into the feature branch and re-checks every gate. Only the gates decide whether the changes are sound, so never claim they are.
