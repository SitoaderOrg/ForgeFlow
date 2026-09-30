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
  push-to-pull-request-branch:
    target: "triggering"
  remove-labels:
    allowed: ["dependency-alert"]
  add-comment:
    max: 1
---

## Objective
Automatically remediate vulnerable dependencies flagged by GitHub Dependency Review on this pull request to help it pass the PR Security Gatekeeper.

## Instructions
1. Inspect the pull request using `gh pr diff` and `gh pr view --json files,commits,headRefName`.
2. Inspect the failed CI logs for the `PR Security Gatekeeper` workflow:
   - Run `gh run list --workflow=pr-security.yml` and `gh run view <run-id> --log-failed` to locate the Dependency Review failure details.
3. Identify the vulnerable package(s):
   - Determine which dependency and version range is flagged by the security advisory (CVE / GHSA).
   - Find the minimum secure patched version that resolves the vulnerability without unnecessary breaking changes.
4. Update the dependency version in the appropriate package manifest (e.g. `package.json`, `package-lock.json`, `requirements.txt`, `go.mod`, `pom.xml`, `Cargo.lock`, etc.).
5. Apply safe outputs:
   - Call `push-to-pull-request-branch` to push the updated manifest directly to the PR branch.
   - Call `add-comment` to post a concise summary detailing which packages were updated, the advisory/CVE resolved, and the old vs new versions.
   - Call `remove-labels` to remove the `dependency-alert` label once the patch is pushed.
