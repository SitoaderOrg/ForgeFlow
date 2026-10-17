---
name: PR Documentation Updater
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

strict: true

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
    allowed: ["docs-required", "docs-not-required"]
    target: "*"
  remove-labels:
    allowed: ["docs-required"]
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
Semantically evaluate the pull request diff to determine if documentation updates are required. If documentation is needed and missing, autonomously draft accurate, clear documentation in a stacked pull request and apply the `docs-required` label. If documentation is already present or not required, clear the label cleanly.

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
   - If appropriate documentation is already included in the PR, call `remove-labels` with `docs-required` (if present) and conclude gracefully.
3. Compare source changes against the **Documentation Decision Criteria**:
   - If the PR contains only changes in the **❌ Skip** list, call `remove-labels` with `docs-required`, call `add-labels` with `docs-not-required` (this records your decision for the Documentation Drift gate), post a one-line `add-comment` explaining why, and exit. No documentation needed.
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

## Step 5: Propose Stacked Pull Request & Update Labels
Apply safe outputs:
1. Call `add-labels` to apply `docs-required` to the parent PR to track needed documentation.
2. Call `create-pull-request` to open a stacked pull request:
   - Set `base` to the parent PR branch (`headRefName`).
   - Set `title`: `docs: update documentation for PR changes`
   - Set `body`: Provide a clear breakdown of:
     - **Updated Documents**: List of files updated or added.
     - **Summary of Documentation Added**: Overview of new APIs/features documented.
     - **Lifecycle**: "This stacked PR was automatically opened by the **PR Documentation Updater** agent and will be automatically squashed and merged into your feature branch by \`pr-stacked-merge.yml\`."
3. Call `add-comment` on the parent PR notifying the author that a stacked PR containing the documentation updates has been created and will be automatically merged into their branch. Include the direct link to the stacked PR.
