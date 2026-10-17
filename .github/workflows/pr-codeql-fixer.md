---
name: PR CodeQL Fixer
description: Automatically refactors and resolves security vulnerabilities flagged by GitHub CodeQL SAST on pull requests
emoji: "🛡️"

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
  # Pinned: "auto" can resolve to models that reject Copilot CLI custom tools (e.g. gpt-5.6-luna-utility).
  # Must be a chat model enabled for the org's Copilot inference (see the api-proxy models.json in run artifacts).
  model: gpt-4.1

permissions:
  contents: read
  pull-requests: read
  issues: read
  security-events: read
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

steps:
  - name: Install project dependencies
    run: |
      if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; fi

strict: true

features:
  copilot-requests: true

jobs:
  # Runs after safe outputs are applied. GITHUB_TOKEN-created PRs/pushes/labels never
  # trigger workflows (and neither does workflow_run for GITHUB_TOKEN-dispatched runs),
  # so hand off explicitly to the remediation relay (pr-stacked-merge.yml), which
  # auto-merges stacked PRs and re-runs the PR Quality Pipeline.
  conclusion:
    permissions:
      actions: write
    pre-steps:
      - name: Hand off to remediation relay
        uses: actions/github-script@v7
        with:
          script: |
            await github.rest.actions.createWorkflowDispatch({
              owner: context.repo.owner,
              repo: context.repo.repo,
              workflow_id: 'pr-stacked-merge.yml',
              ref: context.payload.repository.default_branch,
              inputs: { branch: process.env.GITHUB_REF_NAME }
            });
            core.info(`Dispatched remediation relay for '${process.env.GITHUB_REF_NAME}'.`);

safe-outputs:
  create-pull-request:
    title-prefix: "fix(security): "
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
Automatically create a stacked remediation pull request targeting the developer's feature branch to resolve CodeQL SAST vulnerabilities—leveraging GitHub Copilot Autofix suggestions when available or synthesizing defensive code patches—with distinct, itemized commit-style sections explaining each fix, allowing the developer to review and merge the solution.

## Instructions
1. Inspect the pull request using `gh pr diff` and `gh pr view --json number,files,commits,headRefName`.
2. Start from the **Gate findings** above: each line lists the CodeQL rule id, security severity, message and `file:line`. Optionally cross-check open alerts with `gh api "repos/${{ github.repository }}/code-scanning/alerts?ref=refs/pull/${{ github.event.inputs.pr_number }}/head&state=open"`.
3. For each detected vulnerability:
   - Check if **GitHub Copilot Autofix** produced a suggestion: `gh api repos/{owner}/{repo}/code-scanning/alerts/<alert-number>/autofix` or inspect inline review suggestions on the PR.
   - If a valid Copilot Autofix suggestion exists, validate its safety and apply the suggested patch.
   - If Copilot Autofix is not available: analyze the CodeQL taint path, vulnerable sink, and rule ID (e.g., SQL injection, unsanitized input/XSS, path traversal, command injection), and refactor the code defensively using parameterized queries, safe path resolution, or input sanitization.
   - Maintain a list of each distinct fix with a descriptive commit title (e.g., `fix(security): sanitize input to prevent path traversal in <file>`) and explanation.
4. Keep behaviour intact: run `npm test` and `npm run lint` after patching and make sure both pass (format with `npx prettier --write <file>` if needed).
5. Apply safe outputs:
   - Call `create-pull-request` to open a stacked pull request:
     - Set `base` to the parent PR branch (`headRefName`).
     - Set `title`: `fix(security): resolve CodeQL SAST vulnerabilities`
     - Set `body`: Structure the PR body with an itemized breakdown of each fix:
       - **Commit Title & Summary**: A conventional commit title for each vulnerability resolved.
       - **Vulnerability Details**: Rule ID, CWE number, affected file and line number.
       - **Remediation Applied**: Explain the defensive pattern or Copilot Autofix patch.
       - **Lifecycle**: "This stacked PR was automatically opened by the **PR CodeQL Fixer** agent and will be automatically squashed and merged into your feature branch by \`pr-stacked-merge.yml\`."
   - Call `add-comment` on the parent PR to inform the developer that a stacked remediation PR has been opened with the itemized fixes and will be automatically consolidated into their branch. Include the direct link to the stacked PR.
