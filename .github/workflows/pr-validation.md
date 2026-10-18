---
name: PR Validation
description: Automatically validates and updates PR title and description using .github/pull_request_template.md when metadata is missing or incomplete
emoji: "✍️"

on:
  workflow_dispatch:
    inputs:
      pr_number:
        description: "Pull request number to remediate (dispatch this workflow on the PR head branch)"
        required: true
        type: string
      findings:
        description: "Gate findings handed over by the PR Quality Pipeline"
        required: false
        type: string
        default: ""
  # Dispatched by the PR Quality Pipeline with GITHUB_TOKEN (actor github-actions[bot]);
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
  # Back off generously on 429s instead of giving up after ~35s.
  harness:
    max-retries: 5
    initial-delay-ms: 30000
    backoff-multiplier: 2
    max-delay-ms: 180000

permissions:
  contents: read
  pull-requests: read
  issues: read
  copilot-requests: write

tools:
  github:
    mode: "gh-proxy"

strict: true

features:
  copilot-requests: true

safe-outputs:
  update-pull-request:
    title: true
    body: true
    target: "*"
  add-comment:
    max: 1
    target: "*"
  # Hand-off to the remediation relay (GITHUB_TOKEN events do not trigger workflows).
  dispatch-workflow:
    workflows: [pr-stacked-merge]
    target-ref: ${{ github.event.repository.default_branch }}
---

## Pull Request Context
- **Parent pull request**: #${{ github.event.inputs.pr_number }} — this workflow was dispatched on that PR's head branch, which is checked out in the workspace.
- **Gate findings from the PR Quality Pipeline**:

```text
${{ github.event.inputs.findings }}
```

Always pass `pull_request_number: ${{ github.event.inputs.pr_number }}` (or `item_number` for comments/labels) to safe outputs that target the parent PR.

## Before You Start
Confirm with `gh pr view ${{ github.event.inputs.pr_number }} --json state,headRefName` that the pull request is open and that its head branch is the branch checked out in the workspace (`git branch --show-current`). Your changes and any stacked pull request are based on this branch, and the sandbox cannot fetch other branches. If the pull request is not open or its head branch is different, change nothing: call `noop` explaining that this workflow must be re-dispatched with "Use workflow from" set to the pull request's head branch, and stop.

## Objective
Analyze the changes introduced in this pull request and generate complete, accurate PR metadata (title and description) matching the repository standard defined in `.github/pull_request_template.md`.

## Context & Inputs
- The PR was flagged with `needs-metadata` by the PR Gatekeeper because the title does not follow Conventional Commits, the description is empty, or placeholder text was left in place.
- Use `gh pr view ${{ github.event.inputs.pr_number }} --json title,body,commits,files,headRefName` and `gh pr diff ${{ github.event.inputs.pr_number }}` to review all changes, commit messages, and the branch name.
- Read `.github/pull_request_template.md` to follow the exact expected section format.

## Tasks
1. **Analyze Diff & Intent**:
   - Determine what the changes actually accomplish (bug fix, new feature, docs, chore, etc.).
   - Note key files touched and functions modified.

2. **Formulate PR Title**:
   - Follow Conventional Commits format: `<type>(<scope>): <short description>` or `<type>: <short description>` (e.g., `feat(auth): add JWT login endpoint` or `fix(ci): handle empty pr description`).
   - If the existing title already follows this format correctly and accurately describes the change, keep it. Otherwise, generate an improved title.

3. **Fill PR Template Description**:
   - Use the structure from `.github/pull_request_template.md`.
   - **Summary**: 2-4 concise bullet points explaining what was changed and why.
   - **Type of Change**: Mark the appropriate checkbox (`- [x]`) based on the diff.
   - **Linked Issues**: Link any issue mentioned in commits or branch name (e.g. `Closes #123`), or leave as `None`.
   - **Verification & Testing**: Note tests that were added or modified in the diff.
   - The description must be at least 20 characters and must not contain the words "TODO" or "fill this out" (the gatekeeper rejects them).

4. **Apply Safe Outputs**:
   - `update-pull-request`: Update the PR with the new `title` and generated `body`.
   - `add-comment`: Post a friendly comment indicating that the PR metadata was automatically drafted based on the diff, and encourage the author to review and customize it.
   - Do **not** touch the `needs-metadata` label: the PR Gatekeeper removes it once the re-check passes.

## Hand Off to the Remediation Relay
Unless you stopped in **Before You Start**, finish by calling `dispatch_workflow` for `pr-stacked-merge`, after all other safe outputs, with these inputs:
- `branch`: the checked-out branch (the pull request's head branch)
- `agent_result`: `success` if your safe outputs address the gate findings, otherwise `failure`
- `source`: `${{ github.workflow }} (run ${{ github.run_id }})`

The relay merges stacked remediation pull requests into the feature branch and re-runs the PR Quality Pipeline. Only the gates decide whether the findings are fixed, so never claim they are.
