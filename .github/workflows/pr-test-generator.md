---
name: PR Test Generator
description: Automatically generates missing unit tests or fixes broken test assertions on pull requests flagged with test-required, offering the solution as a stacked PR
emoji: "🧪"

on:
  pull_request:
    types: [labeled]
  labels: ["test-required"]
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
  create-pull-request:
    title-prefix: "test: "
    labels: ["test-remediation", "human-review-needed"]
  add-comment:
    max: 1
---

## Objective
Automatically generate missing unit tests or repair broken test assertions for code introduced or modified in this pull request to achieve at least 80% test coverage and unblock the PR Tests Gatekeeper. Propose all tests in a single batched stacked pull request targeting the author's feature branch.

## 🔒 STRICT GUARDRAIL: TEST FILES ONLY
- **YOU ARE STRICTLY PROHIBITED FROM MODIFYING PRODUCTION/APPLICATION CODE, BUSINESS LOGIC, OR CONFIGURATION FILES.**
- You may **ONLY** create or edit test files (files matching `*test*`, `*spec*`, or located inside test folders like `tests/`, `test/`, `__tests__/`).
- If an existing test failed, fix or adapt the test assertion—**NEVER modify the application code under test**.
- Any pull request that proposes changes to non-test files will be rejected.

## Instructions
1. Inspect the pull request using `gh pr diff` and `gh pr view --json number,files,commits,headRefName`.
2. Inspect the failed CI logs and coverage report for the `PR Tests & Coverage Gatekeeper` workflow:
   - Run `gh run list --workflow=pr-test.yml` and `gh run view <run-id> --log-failed`.
   - Identify which functions and line ranges were flagged as uncovered or below the 80% threshold.
3. Discover test location and naming conventions:
   - Search the repository for existing tests using `git ls-files '*test*' '*spec*'`.
   - Determine whether the repo uses:
     - Dedicated test folders (e.g. `tests/`, `test/`, `__tests__/`, `spec/`)
     - Co-located test files (e.g. `src/foo.test.js`, `src/foo_test.go`, `src/foo.spec.ts`)
   - **You MUST place new test files in the matching directory and follow the existing naming convention.**
4. Author comprehensive, idiomatic unit tests:
   - Use the existing test runner and assertions already used in the repo (e.g. Jest, Vitest, Mocha, PyTest, Go testing, Cargo test).
   - Write targeted test cases covering uncovered branches, boundary inputs, error handlers, and edge cases to exceed 80% coverage.
5. Apply safe outputs:
   - Call `create-pull-request` to open a stacked pull request:
     - Set `base` to the parent PR branch (`headRefName`).
     - Set `title`: `test: add unit test coverage for PR changes`
     - Set `body`: Provide an itemized breakdown of:
       - **New Test Files & Cases**: List of test files and functions added.
       - **Uncovered Paths Addressed**: How the new tests bring coverage above 80%.
       - **Instructions**: "Merge this stacked PR into your feature branch to include the tests and clear the test gate."
   - Call `add-comment` on the parent PR informing the developer that a stacked PR containing the required unit tests has been opened for their review and approval.
