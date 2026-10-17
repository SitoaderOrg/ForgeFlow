---
name: PR Lint Fixer
description: Automatically resolves formatting and linting errors on pull requests flagged with lint-failed
emoji: "🧹"

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
  # Serialize agent jobs repo-wide: parallel remediation agents exhaust the Copilot
  # inference rate limit (HTTP 429).
  concurrency:
    group: "gh-aw-copilot-remediation-agents"
    queue: max
  # Back off generously on 429s instead of giving up after ~35s.
  harness:
    max-retries: 5
    initial-delay-ms: 30000
    backoff-multiplier: 2
    max-delay-ms: 180000

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

checkout:
  fetch: ["*"]
  fetch-depth: 0

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
  push-to-pull-request-branch:
    target: "*"
  remove-labels:
    allowed: ["lint-failed"]
    target: "*"
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
Automatically fix code formatting and lint issues on this pull request to help it pass the PR Lint & Format gatekeeper.

## Instructions
1. Inspect the pull request using `gh pr diff <pr_number>` and `gh pr view <pr_number> --json files,commits,headRefName`.
2. The CI gate runs Super-Linter with the repository's own configs (`.eslintrc.json`, `.prettierrc`, `.prettierignore`). Dependencies are already installed, so reproduce it locally:
   - `npm run lint` — ESLint, Prettier check and HTMLHint.
   - `npm run lint:fix` — applies ESLint auto-fixes and Prettier formatting.
   - If the findings reference a run id you may also inspect `gh run view <run-id> --log-failed` (optional).
3. The **Gate findings** above contain the exact Super-Linter output per linter (e.g. `JAVASCRIPT_ES`, `JAVASCRIPT_PRETTIER`, `CSS` = stylelint-config-standard, `HTML` = HTMLHint). Every listed issue must be fixed — `npm run lint` does not cover stylelint, so fix CSS findings by hand. Run `npm run lint:fix`, then fix any remaining errors by hand (e.g. remove unused variables/imports, prefer `const`) **without changing runtime behaviour**. Only touch files changed in this PR unless a linter explicitly requires otherwise. CSS must use modern color notation (`rgb(0 0 0 / 50%)`) and HTML ids/classes must be lowercase-dash-case.
4. Re-run `npm run lint` until it passes, and run `npm test` to confirm nothing broke.
5. Apply safe outputs:
   - Call `push-to-pull-request-branch` to push the formatting/lint fix directly to the PR branch.
   - Call `add-comment` to post a concise summary of which files were fixed.
   - Call `remove-labels` to remove the `lint-failed` label once changes are pushed.
