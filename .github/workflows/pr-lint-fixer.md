---
name: PR Lint Fixer
description: Automatically resolves formatting and linting errors on pull requests flagged with lint-failed
emoji: "🧹"

on:
  pull_request:
    types: [labeled]
  labels: ["lint-failed"]
  workflow_dispatch:

permissions:
  contents: read
  pull-requests: read
  issues: read
  copilot-requests: write

tools:
  edit: true
  github:
    mode: "gh-proxy"

strict: true

features:
  copilot-requests: true

safe-outputs:
  push-to-pull-request-branch:
    target: "triggering"
  remove-labels:
    allowed: ["lint-failed"]
  add-comment:
    max: 1
---

## Objective
Automatically fix code formatting and lint issues on this pull request to help it pass the PR Lint & Format gatekeeper.

## Instructions
1. Inspect the pull request using `gh pr diff` and `gh pr view --json files,commits,headRefName`.
2. Inspect the failed CI logs or run annotations for the `PR Lint & Format Gatekeeper` run using `gh run list --workflow=pr-lint.yml` and `gh run view <run-id> --log-failed`.
3. Locate the files with formatting or lint issues identified by the linter.
4. Apply the necessary formatting, style, or lint fixes to the affected files.
5. Apply safe outputs:
   - Call `push-to-pull-request-branch` to push the formatting/lint fix directly to the PR branch.
   - Call `add-comment` to post a concise summary of which files were fixed.
   - Call `remove-labels` to remove the `lint-failed` label once changes are pushed.
