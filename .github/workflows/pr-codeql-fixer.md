---
name: PR CodeQL Fixer
description: Automatically refactors and resolves security vulnerabilities flagged by GitHub CodeQL SAST on pull requests
emoji: "🛡️"

on:
  pull_request:
    types: [labeled]
  labels: ["codeql-alert"]
  workflow_dispatch:

permissions:
  contents: read
  pull-requests: read
  issues: read
  security-events: read
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
    allowed: ["codeql-alert"]
  add-comment:
    max: 1
---

## Objective
Automatically remediate source code security vulnerabilities flagged by GitHub CodeQL SAST analysis on this pull request—leveraging GitHub Copilot Autofix suggestions when available, or autonomously synthesizing defensive code patches—to unblock the PR Security Gatekeeper.

## Instructions
1. Inspect the pull request using `gh pr diff` and `gh pr view --json files,commits,headRefName`.
2. Inspect the failed CI logs and CodeQL alerts:
   - Query CodeQL alerts: `gh api repos/{owner}/{repo}/code-scanning/alerts?ref={head_branch}&state=open` or review run logs via `gh run list --workflow=pr-security.yml` and `gh run view <run-id> --log-failed`.
3. Check for **GitHub Copilot Autofix** suggestions:
   - For each open alert, check if Copilot Autofix generated a fix suggestion: `gh api repos/{owner}/{repo}/code-scanning/alerts/<alert-number>/autofix` or inspect inline review suggestions on the PR.
   - If a valid Copilot Autofix suggestion is found, validate its safety and apply the suggested patch.
4. If Copilot Autofix is not available or did not produce a fix:
   - Analyze the CodeQL taint path, vulnerable sink, and rule ID (e.g., SQL injection, unsanitized input/XSS, path traversal, command injection).
   - Refactor the code surgically to eliminate the vulnerability (e.g., parameterized queries, safe path resolution, strict input validation/sanitization).
   - Preserve existing business logic and code formatting conventions.
5. Apply safe outputs:
   - Call `push-to-pull-request-branch` to push the security patch directly to the PR branch.
   - Call `add-comment` to post a summary of the vulnerability resolved, citing the CWE/rule ID and whether Copilot Autofix or autonomous defensive refactoring was applied.
   - Call `remove-labels` to remove the `codeql-alert` label once the fix is pushed.
