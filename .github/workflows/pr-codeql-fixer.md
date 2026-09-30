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
  create-pull-request:
    title-prefix: "fix(security): "
    labels: ["security-remediation", "human-review-needed"]
  add-comment:
    max: 1
---

## Objective
Automatically create a stacked remediation pull request targeting the developer's feature branch to resolve CodeQL SAST vulnerabilities—leveraging GitHub Copilot Autofix suggestions when available or synthesizing defensive code patches—allowing the developer to review and merge the fix.

## Instructions
1. Inspect the pull request using `gh pr diff` and `gh pr view --json number,files,commits,headRefName`.
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
   - Call `create-pull-request` to open a stacked pull request:
     - Set `base` to the parent PR branch (`headRefName`).
     - Set `title` explaining the security remediation (e.g., `fix(security): sanitize input for CWE-<id>`).
     - Set `body` with details of the vulnerability, CWE/rule ID, explanation of the defensive pattern (or Copilot Autofix patch), and clear instructions: "Merge this stacked PR to incorporate the security fix into your feature branch and clear the security gate."
   - Call `add-comment` on the parent PR to inform the developer that a stacked remediation PR has been opened for their review and approval.
