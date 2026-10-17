---
name: PR Test Generator
description: Automatically generates missing unit tests or fixes broken test assertions on pull requests flagged with test-required, offering the solution as a stacked PR
emoji: "🧪"

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
  create-pull-request:
    title-prefix: "test: "
    labels: ["test-remediation"]
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
2. Start from the **Gate findings** above (failing tests and coverage table), then reproduce locally with `npx vitest run --coverage` (dependencies are pre-installed).
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
   - Set `base` to the parent PR branch (`headRefName`). Create the PR from a new branch; never push to the parent branch directly.
   - Set `title`: `test: add unit test coverage for PR changes`
   - Set `body`: Provide an itemized breakdown of:
     - **New Test Files & Cases**: List of test files and functions added.
     - **Uncovered Paths Addressed**: How the new tests bring coverage above 80%.
     - **Lifecycle**: "This stacked PR was automatically opened by the **PR Test Generator** agent and will be automatically squashed and merged into your feature branch by \`pr-stacked-merge.yml\`."
2. Call `add-comment` on the parent PR informing the developer that a stacked PR containing the validated unit tests has been opened and will be automatically consolidated into their branch. Include the direct link to the stacked PR.

## Safe Output Rules
- When calling `create_pull_request`, provide `title`, `body` and (if needed) `base`/`branch` only — do **not** pass a `temporary_id`.
- Do not invent or guess URLs for the stacked pull request in comments. Refer to it as "the stacked remediation PR"; the remediation relay posts the exact link once it is merged.
