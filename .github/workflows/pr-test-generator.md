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
Automatically generate missing unit tests or repair broken test assertions for code introduced or modified in this pull request to achieve robust test coverage and unblock the PR Tests Gatekeeper. Propose all tests in a single batched stacked pull request targeting the author's feature branch.

## Instructions
1. Inspect the pull request using `gh pr diff` and `gh pr view --json number,files,commits,headRefName`.
2. Inspect the failed CI logs for the `PR Tests & Coverage Gatekeeper` workflow:
   - Run `gh run list --workflow=pr-test.yml` and `gh run view <run-id> --log-failed` to identify failing test suites, broken assertions, or uncovered code paths.
3. Analyze the new or modified logic in the PR diff:
   - Identify edge cases, boundary conditions, error handling branches, and untested functions.
   - Detect existing test framework and conventions in the repo (e.g. Jest, Vitest, Mocha, PyTest, Go testing, Cargo test, JUnit).
4. Author comprehensive, idiomatic unit tests:
   - Follow existing project conventions, folder structure (e.g. `tests/`, `__tests__/`, or co-located `*.test.js`), and mocking patterns.
   - If existing tests failed due to updated business logic, update the assertions to match expected behavior.
   - Add new test cases covering all uncovered branches.
5. Apply safe outputs:
   - Call `create-pull-request` to open a stacked pull request:
     - Set `base` to the parent PR branch (`headRefName`).
     - Set `title`: `test: add unit test coverage for PR changes`
     - Set `body`: Provide an itemized breakdown of:
       - **New Test Cases**: List of test files and functions added.
       - **Edge Cases Covered**: Boundary and error handling scenarios tested.
       - **Instructions**: "Merge this stacked PR into your feature branch to include the tests and clear the test gate."
   - Call `add-comment` on the parent PR informing the developer that a stacked PR containing the required unit tests has been opened for their review and approval.
