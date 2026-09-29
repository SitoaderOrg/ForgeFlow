---
name: PR Validation
description: Automatically validates and updates PR title and description using .github/pull_request_template.md when metadata is missing or incomplete
emoji: "✍️"

on:
  pull_request:
    types: [labeled]
  labels: ["needs-metadata"]
  workflow_dispatch:

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
  remove-labels:
    allowed: ["needs-metadata"]
  add-comment:
    max: 1
---

## Objective
Analyze the changes introduced in this pull request and generate complete, accurate PR metadata (title and description) matching the repository standard defined in `.github/pull_request_template.md`.

## Context & Inputs
- The PR was flagged with `needs-metadata` by the PR Gatekeeper because the title does not follow Conventional Commits, the description is empty, or placeholder text was left in place.
- Use `gh pr view --json title,body,commits,files,headRefName` and `gh pr diff` to review all changes, commit messages, and the branch name.
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

4. **Apply Safe Outputs**:
   - `update-pull-request`: Update the PR with the new `title` and generated `body`.
   - `add-comment`: Post a friendly comment indicating that the PR metadata was automatically drafted based on the diff, and encourage the author to review and customize it.
   - `remove-labels`: Remove the `needs-metadata` label.
