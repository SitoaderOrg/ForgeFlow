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
  bash: true
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
- **YOU ARE STRICTLY PROHIBITED FROM MODIFYING PRODUCTION/APPLICATION CODE, BUSINESS LOGIC, OR CORE CONFIGURATION.**
- You may **ONLY** create or edit test files (unit tests, test cases, test fixtures, test mocks, or test helpers).
- If an existing test failed, fix or adapt the test assertions—**NEVER modify the application code under test**.
- Any pull request that proposes changes to non-test files will be rejected.

## Step 1: Detect Project Language, Framework & Test Runner
Inspect repository configuration files and manifests to identify the language, testing framework, and coverage command:

| Ecosystem | Manifest File(s) | Common Test Frameworks | Typical Test & Coverage Command |
| :--- | :--- | :--- | :--- |
| **TypeScript / JavaScript** | `package.json` | Vitest, Jest, Mocha | `npm test`, `npm run test:coverage`, `npx vitest run --coverage` |
| **Python** | `pyproject.toml`, `requirements.txt`, `setup.py` | Pytest, Unittest | `pytest --cov=.`, `python -m unittest` |
| **Go** | `go.mod` | Go `testing` package, Testify | `go test -coverprofile=coverage.out ./...` |
| **Java / Kotlin** | `pom.xml`, `build.gradle` | JUnit 5, TestNG, Mockito | `./mvnw test`, `./gradlew test jacocoTestReport` |
| **C# / .NET** | `*.csproj`, `*.sln` | xUnit, NUnit, MSTest | `dotnet test --collect:"XPlat Code Coverage"` |
| **Rust** | `Cargo.toml` | Built-in test harness | `cargo test`, `cargo llvm-cov` |
| **Ruby** | `Gemfile` | RSpec, Minitest | `bundle exec rspec`, `rake test` |
| **PHP** | `composer.json` | PHPUnit, Pest | `vendor/bin/phpunit --coverage-text` |

Read the manifest or root test scripts to identify the exact coverage command used in CI.

## Step 2: Analyze Uncovered Code in PR Diff
1. Inspect the pull request using `gh pr diff` and `gh pr view --json number,files,commits,headRefName`.
2. Inspect the failed CI logs and coverage report for the `PR Tests & Coverage Gatekeeper` workflow:
   - Run `gh run list --workflow=pr-test.yml` and `gh run view <run-id> --log-failed`.
3. Identify all newly added or modified source files and testable logic:
   - Functions, methods, classes, and handlers
   - Conditional branches (`if/else`, `switch/match`)
   - Data transformations and validations
   - Error handling and exception paths
4. Determine existing test file naming and location conventions in the repository:
   - **Colocated tests**: e.g., `src/foo.test.ts`, `src/foo_test.go`, `src/test_foo.py`
   - **Centralized test suites**: e.g., `tests/`, `test/`, `spec/`, `src/test/java/`
5. Review any repository-specific instructions (e.g., `.github/instructions/` or `CONTRIBUTING.md`) for architectural rules and mock conventions.

## Step 3: Implement Comprehensive Tests
Write clean, idiomatic unit or integration tests matching the project's existing testing style:
1. **Happy Paths**: Verify standard inputs produce expected outputs, correct return types, or status codes.
2. **Boundary & Edge Cases**:
   - Empty collections, zero values, empty strings
   - Null / nil / undefined / None inputs
   - Extreme boundary values and off-by-one conditions
3. **Error Handling & Invalidation**:
   - Malformed data, missing required fields, or illegal arguments
   - Verify proper exception raising or error return types
4. **Mocking & Isolation**:
   - Follow the repo's existing patterns to mock external I/O, database connections, third-party APIs, or network requests.
   - Ensure tests are deterministic, fast, and free of side effects.

## Step 4: Validate Tests Locally
1. Run the project's test suite and coverage command identified in Step 1 using bash.
2. Verify that:
   - All tests pass with zero errors or regressions.
   - Code coverage for modified source files meets or exceeds the required threshold (80%).
3. If any test fails or coverage is insufficient, refine the tests and re-run until all checks pass.

## Step 5: Propose Stacked Pull Request
Apply safe outputs:
1. Call `create-pull-request` to open a stacked pull request:
   - Set `base` to the parent PR branch (`headRefName`).
   - Set `title`: `test: add unit test coverage for PR changes`
   - Set `body`: Provide an itemized breakdown of:
     - **New Test Files & Cases**: List of test files and functions added.
     - **Uncovered Paths Addressed**: How the new tests bring coverage above 80%.
     - **Instructions**: "Merge this stacked PR into your feature branch to include the tests and clear the test gate."
2. Call `add-comment` on the parent PR informing the developer that a stacked PR containing the validated unit tests has been opened for their review and approval.
