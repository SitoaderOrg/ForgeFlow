# Step 4: Polyglot Automated Testing & Autonomous Test Generation

This step implements automated testing and coverage validation combined with an autonomous AI remediation loop that drafts missing unit tests and fixes broken assertions.

---

## Architecture Overview

```mermaid
flowchart TD
    PR[PR Created / Synchronized] --> TestGate[1. Tests & Coverage Gatekeeper\n.github/workflows/pr-test.yml]
    
    TestGate --> PolyglotDetect{Detect Test Runner}
    PolyglotDetect -->|Node.js / TS| RunNpm[npm test]
    PolyglotDetect -->|Python| RunPytest[pytest / unittest]
    PolyglotDetect -->|Go| RunGo[go test -v -cover]
    PolyglotDetect -->|Rust| RunCargo[cargo test]
    PolyglotDetect -->|No tests configured| PassClean[Pass Cleanly / Skip]

    RunNpm --> StatusCheck{All Tests Pass?}
    RunPytest --> StatusCheck
    RunGo --> StatusCheck
    RunCargo --> StatusCheck

    StatusCheck -->|✅ Pass| NextGate[Downstream CI Gates\nDoc Drift & Build]
    StatusCheck -->|❌ Tests Fail / Missing| AddLabel[Apply 'test-required' Label\nFail Fast / Halt Pipeline]

    AddLabel --> Generator[2. Autonomous Test Generator\n.github/workflows/pr-test-generator.md]
    Generator --> Inspect[Inspect PR Diff & Failed Test Logs]
    Generator --> Synthesize[Synthesize Idiomatic Unit Tests\nCover boundary cases & edge scenarios]
    Generator --> StackedPR[Create Batched Stacked PR\nTargeting author's feature branch]

    StackedPR --> DevReview([Developer Reviews & Merges Stacked PR])
    DevReview --> Recheck([Feature Branch Updated & Tests Re-evaluated])
    Recheck -->|✅ Passed| ClearLabel[Gatekeeper Clears 'test-required']
```

---

## 1. Deterministic Testing Gate (`.github/workflows/pr-test.yml`)

The deterministic test runner automatically discovers and executes test suites based on repository manifests:

- **Universal & Polyglot**:
  - **JavaScript / TypeScript**: Discovers `package.json` test scripts (`npm test` / `npm run test:cov`).
  - **Python**: Discovers `pytest` / `unittest` test suites (`test_*.py`) and validates line coverage (`--cov-fail-under=80`).
  - **Go**: Discovers `go.mod` and executes `go test -v -coverprofile=coverage.out ./...`, validating that total line coverage meets or exceeds **80%**.
  - **Rust**: Discovers `Cargo.toml` and runs `cargo test`.
  - **Zero Noise**: Repositories without test suites or manifests skip cleanly without failing the check.
- **Fail-Fast & Triggering Remediation**:
  - If test assertions fail, or if test coverage is below the **80% threshold**, the gatekeeper fails and attaches the **`test-required`** label.
  - When all tests pass and coverage requirements are met, the `test-required` label is automatically cleared.

---

## 2. Autonomous Test Generator (`.github/workflows/pr-test-generator.md`)

When unit tests fail or code changes lack test coverage, this GitHub Agentic Workflow drafts idiomatic unit tests.

- **Trigger**: Activates automatically when the **`test-required`** label is added to a PR.
- **Test Location & Convention Discovery**:
  - Automatically queries the repository using `git ls-files '*test*' '*spec*'` to detect whether the project places tests in:
    - Dedicated test directories: `tests/`, `test/`, `__tests__/`, `spec/`
    - Co-located next to implementation files: `src/*.test.ts`, `src/*_test.go`
  - Enforces that new tests are placed in the matching directory using identical naming patterns.
- **80% Coverage Target**:
  - Reads coverage failure reports from `pr-test.yml` to identify specific uncovered lines, error branches, and edge cases.
  - Generates targeted test cases that bring coverage above 80%.
- **🔒 Strict Guardrail: Test Files Only**:
  - **The agent is strictly prohibited from modifying production or application code.**
  - It may only create or modify test files. If an existing test fails, it must adapt the test assertion—never rewrite application logic to make tests pass.
- **Stacked PR Remediation**:
  - Opens a **Stacked Pull Request** targeting the author's feature branch containing only the new/modified test files.
  - Posts a comment on the parent PR with an itemized breakdown of test cases added.
