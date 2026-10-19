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

# Agents edit the branch they are dispatched on and stack their PR onto it; a run left on
# the default branch (the Actions UI default) can never target the feature PR.
if: github.ref_name != github.event.repository.default_branch

engine:
  id: copilot
  # Pinned: "auto" can resolve to models that reject Copilot CLI custom tools (e.g. gpt-5.6-luna-utility).
  # Must be a chat model enabled for the org's Copilot inference (see the api-proxy models.json in run artifacts).
  model: ${{ vars.GH_AW_AGENT_MODEL || 'gpt-4.1' }}
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

strict: true

# Hands off to the remediation relay from the generated conclusion job, whatever the agent's result.
imports:
  - shared/remediation-handoff.md

features:
  copilot-requests: true

safe-outputs:
  create-pull-request:
    title-prefix: "style(lint): "
    labels: ["lint-remediation"]
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

## Before You Start
Confirm with `gh pr view ${{ github.event.inputs.pr_number }} --json state,headRefName` that the pull request is open and that its head branch is the branch checked out in the workspace (`git branch --show-current`). Your changes and any stacked pull request are based on this branch, and the sandbox cannot fetch other branches. If the pull request is not open or its head branch is different, change nothing: call `noop` explaining that this workflow must be re-dispatched with "Use workflow from" set to the pull request's head branch, and stop.

## Efficiency Rules (keep the run small)
- Run `npm ci` once before linting; read the PR diff with `gh pr diff ${{ github.event.inputs.pr_number }}` only if needed. Fix only the files named in the gate findings. Finish in fewer than 15 tool calls.

## Objective
Automatically fix code formatting and lint issues on this pull request to help it pass the PR Lint & Format gatekeeper. Deliver the fixes as a single stacked pull request targeting the author's feature branch; it is auto-merged into that branch by the remediation relay.

## Instructions
1. Inspect the pull request using `gh pr diff <pr_number>` and `gh pr view <pr_number> --json files,commits,headRefName`.
2. The CI gate runs Super-Linter with the repository's own configs (`.eslintrc.json`, `.prettierrc`, `.prettierignore`). Dependencies are already installed, so reproduce it locally:
   - `npm run lint` — ESLint, Prettier check and HTMLHint.
   - `npm run lint:fix` — applies ESLint auto-fixes and Prettier formatting.
   - If the findings reference a run id you may also inspect `gh run view <run-id> --log-failed` (optional).
3. The **Gate findings** above contain the exact Super-Linter output per linter (e.g. `JAVASCRIPT_ES`, `JAVASCRIPT_PRETTIER`, `CSS` = stylelint-config-standard, `HTML` = HTMLHint). Every listed issue must be fixed — `npm run lint` does not cover stylelint, so fix CSS findings by hand. Run `npm run lint:fix`, then fix any remaining errors by hand (e.g. remove unused variables/imports, prefer `const`) **without changing runtime behaviour**. Only touch files changed in this PR unless a linter explicitly requires otherwise. CSS must use modern color notation (`rgb(0 0 0 / 50%)`) and HTML ids/classes must be lowercase-dash-case.
4. Re-run `npm run lint` until it passes, and run `npm test` to confirm nothing broke.
5. Apply safe outputs:
   - Call `create-pull-request` to open a stacked pull request:
     - Set `base` to the parent PR branch (`headRefName`).
     - Set `title`: `fix lint and formatting issues`
     - Set `body`: list each file fixed and the linter rules corrected (e.g. `no-unused-vars`, Prettier formatting), then end with: "This stacked PR was automatically opened by the **PR Lint Fixer** agent and will be automatically squashed and merged into your feature branch by \`pr-stacked-merge.yml\`."
   - Call `add-comment` on the parent PR to tell the developer that a stacked lint remediation PR has been opened with a concise summary of the files fixed, and that it will be auto-merged into their branch.
   - Do **not** touch the `lint-failed` label: the Lint gate removes it once the re-check passes.

## Safe Output Rules
- Before editing files, create a new branch from the checked-out pull request branch with `git switch -c lint-fix/pr-${{ github.event.inputs.pr_number }}` and commit your changes there. Call `create_pull_request` with `branch` set to that new branch and `base` set to the pull request's head branch. Never use the pull request's head branch as `branch`: a pull request cannot be stacked on its own branch.
- Provide only `title`, `body`, `branch` and `base` — do **not** pass a `temporary_id` or `dependencies`.
- Do not invent or guess URLs for the stacked pull request in comments. Refer to it as "the stacked lint remediation PR"; the remediation relay posts the exact link once it is merged.

## When You Are Done
Stop after your safe outputs: the remediation relay is dispatched automatically when this run ends. It merges any stacked remediation pull request into the feature branch and re-checks the gate. Only the gates decide whether the findings are fixed, so never claim they are.
