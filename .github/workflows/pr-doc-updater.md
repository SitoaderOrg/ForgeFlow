---
name: PR Documentation Updater
description: Analyzes PR source changes and generates missing markdown documentation or API guides when flagged with docs-required
emoji: "📚"

on:
  pull_request:
    types: [opened, synchronize, reopened, labeled]
  labels: ["docs-required"]
  workflow_dispatch:

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
    labels: ["doc-remediation", "human-review-needed"]
    allowed-base-branches: ["*"]
  add-labels:
    allowed: ["docs-required"]
  remove-labels:
    allowed: ["docs-required"]
  add-comment:
    max: 1
---

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
   - If the PR contains only changes in the **❌ Skip** list, call `remove-labels` with `docs-required` (if present) and exit. No documentation needed.
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
     - **Instructions**: "Merge this stacked PR into your branch to include the documentation and satisfy the gatekeeper."
3. Call `add-comment` on the parent PR notifying the author that a stacked PR containing the documentation updates has been created for review.
