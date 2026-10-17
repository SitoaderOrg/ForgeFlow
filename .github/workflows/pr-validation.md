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

engine:
  id: copilot
  # Pinned: the "auto" alias can resolve to models that reject Copilot CLI custom tools.
  model: claude-sonnet-5.5

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
  remove-labels:
    allowed: ["needs-metadata"]
    target: "*"
  add-comment:
    max: 1
    target: "*"
---

## Pull Request Context
- **Parent pull request**: #${{ github.event.inputs.pr_number }} — this workflow was dispatched on that PR's head branch, which is checked out in the workspace.
- **Gate findings from the PR Quality Pipeline**:

```text
${{ github.event.inputs.findings }}
```

Always pass `pull_request_number: ${{ github.event.inputs.pr_number }}` (or `item_number` for comments/labels) to safe outputs that target the parent PR.

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
   - `remove-labels`: Remove the `needs-metadata` label.
