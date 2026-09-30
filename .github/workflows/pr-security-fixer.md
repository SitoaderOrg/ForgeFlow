---
name: PR Security Fixer
description: Automatically investigates and remediates GitHub Code Security alerts (vulnerable dependencies and CodeQL SAST issues) on pull requests flagged with security-alert
emoji: "🛡️"

on:
  pull_request:
    types: [labeled]
  labels: ["security-alert"]
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
    allowed: ["security-alert"]
  add-comment:
    max: 1
---

## Objective
Remediate security alerts (vulnerable dependencies or CodeQL SAST security vulnerabilities) on this pull request to help it pass the PR Security Gatekeeper.

## Instructions
1. Inspect the pull request using `gh pr diff` and `gh pr view --json files,commits,headRefName`.
2. Inspect the failed CI logs or run annotations for the `PR Security Gatekeeper` workflow:
   - Check dependency review failures using `gh run list --workflow=pr-security.yml` and `gh run view <run-id> --log-failed`.
   - Check CodeQL alerts using `gh api repos/{owner}/{repo}/code-scanning/alerts?ref={head_branch}` or review the step summary and log annotations.
3. Identify the security issues:
   - **Vulnerable Dependencies**: If flagged by Dependency Review, identify the vulnerable package and find the minimum secure patched version. Update the version specification in the relevant manifest (e.g. `package.json`, `requirements.txt`, `go.mod`, `pom.xml`, etc.).
   - **CodeQL SAST Vulnerabilities**: If flagged for security vulnerabilities in code (e.g., SQL injection, unsanitized input, insecure regex, path traversal), refactor the code to properly sanitize inputs, use parameterized queries, or apply safe coding patterns.
4. Verify your changes do not break existing functionality or style.
5. Apply safe outputs:
   - Call `push-to-pull-request-branch` to commit and push the security remediations directly to the PR branch.
   - Call `add-comment` to post a clear summary of the vulnerabilities addressed (citing CVE/CWE if applicable) and how they were remediated.
   - Call `remove-labels` to remove the `security-alert` label so the gatekeeper can re-evaluate the PR.
