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

strict: true

features:
  copilot-requests: true

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
  # Hand-off to the remediation relay (GITHUB_TOKEN events do not trigger workflows).
  dispatch-workflow:
    workflows: [pr-stacked-merge]
    target-ref: ${{ github.event.repository.default_branch }}
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
- Read the PR diff once with `gh pr diff ${{ github.event.inputs.pr_number }}` and run `npm ci` once before testing. Each finding already contains the rule id and `file:line`; open only those files.
- Prefer safe DOM APIs (`textContent`, `createElement`) over `innerHTML` for untrusted input. Run `npm test` and `npm run lint` once after the fix. Finish in fewer than 15 tool calls.

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

## Safe Output Rules
- Before editing files, create a new branch from the checked-out pull request branch with `git switch -c security-fix/pr-${{ github.event.inputs.pr_number }}` and commit your changes there. Call `create_pull_request` with `branch` set to that new branch and `base` set to the pull request's head branch. Never use the pull request's head branch as `branch`: a pull request cannot be stacked on its own branch.
- Provide only `title`, `body`, `branch` and `base` — do **not** pass a `temporary_id` or `dependencies`.
- Do not invent or guess URLs for the stacked pull request in comments. Refer to it as "the stacked remediation PR"; the remediation relay posts the exact link once it is merged.

## Hand Off to the Remediation Relay
Unless you stopped in **Before You Start**, finish by calling `dispatch_workflow` for `pr-stacked-merge`, after all other safe outputs, with these inputs:
- `branch`: the checked-out branch (the pull request's head branch)
- `agent_result`: `success` if your safe outputs address the gate findings, otherwise `failure`
- `source`: `${{ github.workflow }} (run ${{ github.run_id }})`

The relay merges stacked remediation pull requests into the feature branch and re-runs the PR Quality Pipeline. Only the gates decide whether the findings are fixed, so never claim they are.
