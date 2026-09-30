---
name: PR Documentation Updater
description: Analyzes PR source changes and generates missing markdown documentation or API guides when flagged with docs-required
emoji: "📚"

on:
  pull_request:
    types: [labeled]
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
  add-comment:
    max: 1
---

## Objective
Analyze newly introduced or modified functionality in this pull request and draft accurate, clear, and comprehensive documentation updates in a stacked PR to resolve documentation drift and clear the `docs-required` label.

## 🔒 STRICT GUARDRAIL: DOCUMENTATION FILES ONLY
- **YOU ARE STRICTLY PROHIBITED FROM MODIFYING PRODUCTION CODE, BUSINESS LOGIC, TESTS, OR BUILD CONFIGURATION.**
- You may **ONLY** create or update markdown files (`README.md`, `docs/**/*.md`, `*.md`) or documentation references.
- Any pull request that proposes changes to source code or non-documentation files will be rejected.

## Step 1: Analyze Pull Request Diff & Scope
1. Query the pull request details and diff using GitHub CLI:
   - `gh pr view --json number,title,body,headRefName,files`
   - `gh pr diff`
2. Identify all newly added or modified:
   - Public functions, methods, classes, and exported interfaces
   - CLI flags, environment variables, or configuration parameters
   - Architectural workflows or external behaviors

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
     - **Instructions**: "Merge this stacked PR into your branch to include the documentation and satisfy the gatekeeper."
2. Call `add-comment` on the parent PR notifying the author that a stacked PR containing the documentation updates has been created for review.
