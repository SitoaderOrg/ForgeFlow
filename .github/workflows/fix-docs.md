---
name: 'Fix: Docs'
run-name: 'Fix: Docs · PR #${{ inputs.pr_number }}'
description: Analyzes PR source changes and generates missing markdown documentation or API guides when flagged with docs-required
emoji: "📚"

on:
  workflow_dispatch:
    inputs:
      pr_number:
        description: "Pull request number to remediate (dispatch this workflow on the PR head branch)"
        required: true
        type: string
      findings:
        description: "Gate findings handed over by the pipeline"
        required: false
        type: string
        default: ""
  # Dispatched by the pipeline with GITHUB_TOKEN (actor github-actions[bot]);
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
  # One retry (2 attempts): a 429 with a long retry-after should fail fast and hand off to the relay.
  harness:
    max-retries: 1
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

strict: true

# Hands off to the remediation relay from the generated conclusion job, whatever the agent's result.
imports:
  - shared/remediation-handoff.md

features:
  copilot-requests: true

safe-outputs:
  create-pull-request:
    title-prefix: "docs: "
    labels: ["doc-remediation"]
    allowed-base-branches: ["*"]
    draft: false
    fallback-as-issue: false
  add-labels:
    allowed: ["docs-not-required"]
    target: "*"
  add-comment:
    max: 1
    target: "*"
---

## Pull Request Context
- **Parent pull request**: #${{ github.event.inputs.pr_number }} — this workflow was dispatched on that PR's head branch, which is checked out in the workspace.
- **Gate findings from the pipeline**:

```text
${{ github.event.inputs.findings }}
```

Always pass `pull_request_number: ${{ github.event.inputs.pr_number }}` (or `item_number` for comments/labels) to safe outputs that target the parent PR.

## Before You Start
Confirm with `gh pr view ${{ github.event.inputs.pr_number }} --json state,headRefName` that the pull request is open and that its head branch is the branch checked out in the workspace (`git branch --show-current`). Your changes and any stacked pull request are based on this branch, and the sandbox cannot fetch other branches. If the pull request is not open or its head branch is different, change nothing: call `noop` explaining that this workflow must be re-dispatched with "Use workflow from" set to the pull request's head branch, and stop.

## Efficiency Rules (keep the run small)
- Fetch the PR metadata and diff once (`gh pr view ${{ github.event.inputs.pr_number }} --json number,title,body,headRefName,files` and `gh pr diff ${{ github.event.inputs.pr_number }}`) and work from that output instead of calling `gh` repeatedly.
- `readme.md` and `docs/` in this repository document the **CI framework**, not the applications. Do not search them. Documentation for an application lives next to it in `apps/<app>/README.md` (create it if it does not exist) — e.g. `apps/ferret-heist/README.md`.
- Only read the source files listed in the gate findings. Finish in fewer than 15 tool calls.

## Objective
Semantically evaluate the pull request diff to determine if documentation updates are required. If documentation is needed and missing, autonomously draft accurate, clear documentation in a stacked pull request. If documentation is not required, record that decision with the `docs-not-required` label. The `docs-required` label is owned by the Documentation Drift gate — never add or remove it.

## 📋 Documentation Decision Criteria

### ✅ Document These:
- **Public APIs & Interfaces**: Exported functions, methods, classes, and HTTP/REST endpoints.
- **Complex Logic & Algorithms**: Non-obvious workflows, calculations, or business rules requiring explanation.
- **Architectural & Workflow Changes**: New lifecycle steps, pipeline integrations, or architectural patterns.
- **Breaking Changes**: Altered method signatures, renamed configuration keys, or changed behaviors.
- **New Dependencies & Integrations**: Added third-party packages, SDKs, or external services.
- **Security & Performance Changes**: New authentication requirements, encryption models, or caching layers.
- **Database Schemas & Data Models**: Added entities, modified tables, migrations, or data structures.
- **Unit & Integration Test Guides**: How to run and structure tests for newly introduced modules.

### ❌ Skip These (Do Not Generate Docs):
- Minor refactoring, formatting, or lint corrections.
- Internal private helpers with self-explanatory implementation.
- Trivial typo fixes, comments, or variable renaming.
- Pure code moves or imports reorganization without behavior changes.
- Patch-level dependency bumps.

## 🔒 STRICT GUARDRAIL: DOCUMENTATION FILES ONLY
- **YOU ARE STRICTLY PROHIBITED FROM MODIFYING PRODUCTION CODE, BUSINESS LOGIC, TESTS, OR BUILD CONFIGURATION.**
- You may **ONLY** create or update markdown files (`README.md`, `docs/**/*.md`, `*.md`) or documentation references.
- Any pull request that proposes changes to source code or non-documentation files will be rejected.

## Step 1: Semantic Evaluation of PR Diff & Scope
1. Query the pull request details and diff using GitHub CLI:
   - `gh pr view --json number,title,body,headRefName,files`
   - `gh pr diff`
2. Check if the PR already includes documentation changes (`.md` files or `docs/` updates):
   - If appropriate documentation is already included in the PR, call `noop` explaining which files document the change and conclude gracefully.
3. Compare source changes against the **Documentation Decision Criteria**:
   - If the PR contains only changes in the **❌ Skip** list, call `add-labels` with `docs-not-required` (this records your decision for the Documentation Drift gate), post a one-line `add-comment` explaining why, and exit. No documentation needed.
   - If the PR introduces changes matching the **✅ Document** list without documentation, proceed to Step 2.

## Step 2: Discover Existing Documentation Conventions
1. Inspect the repository for existing documentation structure:
   - Root documentation: `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`
   - Dedicated docs folder: `docs/`, `doc/`, `wiki/`
2. Determine existing documentation style, formatting, and tone (e.g., Markdown headers, code block syntax, mermaid diagrams, tables).

## Step 3: Author Idiomatic Documentation Updates
1. Draft surgical, high-quality documentation covering the new changes:
   - **Usage Examples**: Clear, runnable code snippets showing how to invoke the new or updated logic.
   - **Configuration / API Reference**: Document parameter names, expected types, default values, and return structures.
   - **Context & Motivation**: Briefly explain why the feature or change exists and when to use it.
2. If the project has a `README.md` or feature guide, update the relevant section or add a new topic.

## Step 4: Validate Markdown & Links
1. Ensure all new markdown files have valid headers, code fences, and relative links that resolve properly.
2. Verify formatting matches the rest of the repository.

## Step 5: Propose Stacked Pull Request
Apply safe outputs:
1. Call `create-pull-request` to open a stacked pull request:
   - Set `base` to the parent PR branch (`headRefName`).
   - Set `title`: `docs: update documentation for PR changes`
   - Set `body`: Provide a clear breakdown of:
     - **Updated Documents**: List of files updated or added.
     - **Summary of Documentation Added**: Overview of new APIs/features documented.
     - **Lifecycle**: "This stacked PR was automatically opened by the **Fix: Docs** agent and will be automatically squashed and merged into your feature branch by \`relay.yml\`."
2. Call `add-comment` on the parent PR notifying the author that a stacked PR containing the documentation updates has been created and will be automatically merged into their branch. Include the direct link to the stacked PR.

## Safe Output Rules
- Before editing files, create a new branch from the checked-out pull request branch with `git switch -c docs-fix/pr-${{ github.event.inputs.pr_number }}` and commit your changes there. Call `create_pull_request` with `branch` set to that new branch and `base` set to the pull request's head branch. Never use the pull request's head branch as `branch`: a pull request cannot be stacked on its own branch.
- Provide only `title`, `body`, `branch` and `base` — do **not** pass a `temporary_id` or `dependencies`.
- Do not invent or guess URLs for the stacked pull request in comments. Refer to it as "the stacked remediation PR"; the remediation relay posts the exact link once it is merged.

## When You Are Done
Stop after your safe outputs: the remediation relay is dispatched automatically when this run ends. It merges any stacked remediation pull request into the feature branch and re-checks the gate. Only the gates decide whether the findings are fixed, so never claim they are.
