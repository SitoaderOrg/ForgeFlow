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
    labels: ["security-remediation"]
    allowed-base-branches: ["*"]
  add-comment:
    max: 1
---

## Objective
Automatically create a stacked remediation pull request targeting the developer's feature branch to resolve CodeQL SAST vulnerabilities—leveraging GitHub Copilot Autofix suggestions when available or synthesizing defensive code patches—with distinct, itemized commit-style sections explaining each fix, allowing the developer to review and merge the solution.

## Instructions
1. Inspect the pull request using `gh pr diff` and `gh pr view --json number,files,commits,headRefName`.
2. Inspect the failed CI logs and CodeQL alerts:
   - Query CodeQL alerts: `gh api repos/{owner}/{repo}/code-scanning/alerts?ref={head_branch}&state=open` or review run logs via `gh run list --workflow=pr-security.yml` and `gh run view <run-id> --log-failed`.
3. For each detected vulnerability:
   - Check if **GitHub Copilot Autofix** produced a suggestion: `gh api repos/{owner}/{repo}/code-scanning/alerts/<alert-number>/autofix` or inspect inline review suggestions on the PR.
   - If a valid Copilot Autofix suggestion exists, validate its safety and apply the suggested patch.
   - If Copilot Autofix is not available: analyze the CodeQL taint path, vulnerable sink, and rule ID (e.g., SQL injection, unsanitized input/XSS, path traversal, command injection), and refactor the code defensively using parameterized queries, safe path resolution, or input sanitization.
   - Maintain a list of each distinct fix with a descriptive commit title (e.g., `fix(security): sanitize input to prevent path traversal in <file>`) and explanation.
4. Apply safe outputs:
   - Call `create-pull-request` to open a stacked pull request:
     - Set `base` to the parent PR branch (`headRefName`).
     - Set `title`: `fix(security): resolve CodeQL SAST vulnerabilities`
     - Set `body`: Structure the PR body with an itemized breakdown of each fix:
       - **Commit Title & Summary**: A conventional commit title for each vulnerability resolved.
       - **Vulnerability Details**: Rule ID, CWE number, affected file and line number.
       - **Remediation Applied**: Explain the defensive pattern or Copilot Autofix patch.
       - **Lifecycle**: "This stacked PR was automatically opened by the **PR CodeQL Fixer** agent and will be automatically squashed and merged into your feature branch by \`pr-stacked-merge.yml\`."
   - Call `add-comment` on the parent PR to inform the developer that a stacked remediation PR has been opened with the itemized fixes and will be automatically consolidated into their branch. Include the direct link to the stacked PR.
