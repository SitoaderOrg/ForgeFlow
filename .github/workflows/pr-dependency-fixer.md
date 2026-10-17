---
name: PR Dependency Fixer
description: Automatically upgrades vulnerable dependencies flagged by GitHub Dependency Review on pull requests
emoji: "📦"

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
  edit: true
  bash: true
  github:
    mode: "gh-proxy"

network:
  allowed:
    - defaults
    - node

strict: true

features:
  copilot-requests: true

safe-outputs:
  create-pull-request:
    title-prefix: "fix(deps): "
    labels: ["security-remediation"]
    allowed-base-branches: ["*"]
    draft: false
    fallback-as-issue: false
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
Automatically create a stacked remediation pull request targeting the developer's feature branch to resolve vulnerable dependencies flagged by GitHub Dependency Review, with distinct commit-style entries explaining each package upgrade and advisory, allowing the developer to review and merge the solution.

## Instructions
1. Inspect the pull request using `gh pr diff` and `gh pr view --json number,files,commits,headRefName`.
2. Inspect the failed CI logs for the `PR Security Gatekeeper` workflow:
   - Run `gh run list --workflow=pr-security.yml` and `gh run view <run-id> --log-failed` to locate the Dependency Review failure details.
3. For each vulnerable package flagged by Dependency Review:
   - Determine which dependency and version range is affected by the security advisory (CVE / GHSA).
   - Find the minimum secure patched version that resolves the vulnerability without unnecessary breaking changes.
   - Update the dependency version in the appropriate package manifest (e.g. `package.json`, `package-lock.json`, `requirements.txt`, `go.mod`, `pom.xml`, `Cargo.lock`, etc.).
   - Note down a conventional commit title for each package (e.g., `fix(deps): bump <package> from <old> to <new> to resolve <CVE>`).
4. Apply safe outputs:
   - Call `create-pull-request` to open a stacked pull request:
     - Set `base` to the parent PR branch (`headRefName`).
     - Set `title`: `fix(deps): update vulnerable dependencies to secure versions`
     - Set `body`: Structure the PR body with an itemized breakdown of each dependency bump:
       - **Commit Title & Package**: e.g., `fix(deps): bump lodash from 4.17.15 to 4.17.21`
       - **Security Advisory**: Advisory ID, CVE number, and severity level.
       - **Version Delta**: Previous version vs patched version.
       - **Lifecycle**: "This stacked PR was automatically opened by the **PR Dependency Fixer** agent and will be automatically squashed and merged into your feature branch by \`pr-stacked-merge.yml\`."
   - Call `add-comment` on the parent PR to inform the developer that a stacked remediation PR has been opened with the itemized dependency updates and will be automatically consolidated into their branch. Include the direct link to the stacked PR.
