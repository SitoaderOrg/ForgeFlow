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
Automatically remediate source code security vulnerabilities flagged by GitHub CodeQL SAST analysis on this pull request to help it pass the PR Security Gatekeeper.

## Instructions
1. Inspect the pull request using `gh pr diff` and `gh pr view --json files,commits,headRefName`.
2. Inspect the failed CI logs and CodeQL alerts:
   - Check CodeQL alerts using `gh api repos/{owner}/{repo}/code-scanning/alerts?ref={head_branch}` or inspect run logs via `gh run list --workflow=pr-security.yml` and `gh run view <run-id> --log-failed`.
3. Locate the vulnerable code lines, sink, and taint path reported by CodeQL (e.g., SQL injection, unsanitized HTML/XSS, path traversal, command injection, insecure regex, hardcoded credentials).
4. Refactor the code surgically to remediate the vulnerability:
   - Use safe APIs (e.g., parameterized queries, ORM parameters, safe path resolution, strict input validation/sanitization).
   - Preserve existing business logic and code formatting conventions.
5. Apply safe outputs:
   - Call `push-to-pull-request-branch` to push the security patch directly to the PR branch.
   - Call `add-comment` to post a summary of the vulnerability resolved, citing the CWE/rule ID and explaining the defensive coding pattern applied.
   - Call `remove-labels` to remove the `codeql-alert` label once the fix is pushed.
