---
name: PR Dependency Fixer
description: Automatically upgrades vulnerable dependencies flagged by GitHub Dependency Review on pull requests
emoji: "📦"

on:
  pull_request:
    types: [labeled]
  labels: ["dependency-alert"]
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
  create-pull-request:
    title-prefix: "fix(deps): "
    labels: ["security-remediation", "human-review-needed"]
  add-comment:
    max: 1
---

## Objective
Automatically create a stacked remediation pull request targeting the developer's feature branch to resolve vulnerable dependencies flagged by GitHub Dependency Review, allowing the developer to review and merge the fix.

## Instructions
1. Inspect the pull request using `gh pr diff` and `gh pr view --json number,files,commits,headRefName`.
2. Inspect the failed CI logs for the `PR Security Gatekeeper` workflow:
   - Run `gh run list --workflow=pr-security.yml` and `gh run view <run-id> --log-failed` to locate the Dependency Review failure details.
3. Identify the vulnerable package(s):
   - Determine which dependency and version range is flagged by the security advisory (CVE / GHSA).
   - Find the minimum secure patched version that resolves the vulnerability without unnecessary breaking changes.
4. Update the dependency version in the appropriate package manifest (e.g. `package.json`, `package-lock.json`, `requirements.txt`, `go.mod`, `pom.xml`, `Cargo.lock`, etc.).
5. Apply safe outputs:
   - Call `create-pull-request` to open a stacked pull request:
     - Set `base` to the parent PR branch (`headRefName`).
     - Set `title` explaining the dependency upgrade (e.g., `fix(deps): bump <package> from <old> to <new>`).
     - Set `body` with details of the vulnerability, CVE/GHSA advisory, and clear instructions: "Merge this stacked PR to incorporate the security fix into your feature branch and clear the security gate."
   - Call `add-comment` on the parent PR to inform the developer that a stacked remediation PR has been opened for their review and approval.
