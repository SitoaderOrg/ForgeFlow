### End-to-End PR Quality Flow



1. **Pre-Flight Gatekeeper (Fail-Fast)**: Validates PR metadata, templates, and branch rules before triggering expensive CI runs.

2. **Parallel Quality & Security Gates**: Executes linters, GHAS security scans (CodeQL, secrets), unit tests (<80% coverage check), and documentation drift verification.

3. **Autonomous `gh-aw` Remediation Loops**: When a gate fails, specialized Copilot agent workflows autonomously triage errors, generate missing tests or doc updates, and commit fixes back to the PR branch.

4. **Review & Merge**: Once all gates pass, GitHub Copilot performs semantic/architectural review before final human approval and merge.


### Architectural Rule of Thumb



- **Regular GitHub Actions:** Deterministic, binary (pass/fail), fast, reproducible tasks (compiling, running test runners, linting, scanning). -> (fast, zero token cost, reproducible).

- **`gh-aw` (English Agentic Workflows):** Tasks requiring **reasoning, semantic understanding, synthesis, or code generation**. -> (using English in Markdown).

### 1. Standard GitHub Actions Workflows



- **PR Gatekeeper**: Regex checks for branch names, template presence, and conventional commit titles.

- **Linters & Static Formatters**: Prettier, ESLint, `gofmt` (runs standard linters; fail-fast).

- **Security Scanning**: Native CodeQL action, Secret Scanning, and Dependabot.

- **Test & Coverage Gate**: Runs test runner (e.g. `npm test -- --coverage`); fails if coverage is below 80% and adds label `test-required` with uncovered lines.

- **Doc Drift & Build Verification**: Verifies build artifacts and link integrity; adds `docs-required` on failure.

- **Trigger Copilot Review**: A lightweight step using `gh pr edit` or native rules to request Copilot review once all gates pass.




### 2. `gh-aw` Workflows (Natural Language Markdown)



- **Unit Test Generator** (triggered on `test-required` label): Reads uncovered line numbers and changed files, drafts unit tests matching project conventions, and commits to the PR branch.

- **Documentation Updater** (triggered on `docs-required` label): Analyzes API/feature diffs and generates matching markdown documentation updates.

- **Security & Vulnerability Remediation**: Analyzes complex CodeQL alerts or dependency alerts and proposes a surgical patch PR.

- **PR Validation** (`pr-validation.md`): Triggered on `needs-metadata` label. Summarizes broad diffs into clean, template-compliant PR descriptions and Conventional Commit titles when missing.