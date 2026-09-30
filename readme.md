### End-to-End PR Quality Flow

1. **Pre-Flight Gatekeeper (Fail-Fast)**: Validates PR metadata, templates, and branch rules before triggering CI runs.
2. **Linters & Static Formatters**: Prettier, ESLint, Stylelint, `gofmt` (runs standard linters; fail-fast).
3. **Polyglot Build Verification**: Verifies compilation and build artifacts across ecosystems (TypeScript, Go, Rust, Java, .NET).
4. **Automated Testing & Coverage**: Executes test runner with diff-scoped coverage (configurable threshold, defaulting to 80%).
5. **GitHub Security & Quality**: Native CodeQL static analysis, Secret Scanning, and Dependabot dependency reviews.
6. **Documentation Drift Verification**: Detects when significant code logic is introduced without documentation.
7. **Autonomous `gh-aw` Remediation Loops**: Proposes fixes as stacked PRs when gates fail.
8. **Semantic Review & Merge**: Once all gates pass, GitHub Copilot performs review before human approval and merge.

### Architectural Rule of Thumb

- **Regular GitHub Actions:** Deterministic, binary (pass/fail), fast, reproducible tasks (compiling, running test runners, linting, scanning). -> (fast, zero token cost, reproducible).
- **`gh-aw` (English Agentic Workflows):** Tasks requiring **reasoning, semantic understanding, synthesis, or code generation**. -> (using English in Markdown).
- **Auto-Cancellation & Concurrency Control:** All PR gatekeepers use `concurrency` with `cancel-in-progress: true`. Whenever an author or automated agent pushes a new commit or fix to a PR, any active workflows running on the obsolete commit are immediately cancelled to save CI minutes and avoid race conditions.

### Documentation & Implemented Modules

- [Pre-Flight PR Gatekeeper & Validation](docs/pr-gatekeeper-and-validation.md)
- [Agentic Workflows Compilation & Verification](docs/agentic-workflows-compilation.md)
- [Polyglot Linters & PR Lint Fixer](docs/pr-lint-and-fixer.md)
- [Polyglot Build & Compilation Verification](docs/pr-build.md)
- [Polyglot Automated Testing & PR Test Generator](docs/pr-test-and-generator.md)
- [GitHub Code Security & PR Security Fixers](docs/pr-security-and-fixer.md)
- [Documentation Drift & Autonomous Documentation Updater](docs/pr-docs-and-updater.md)

### 1. Standard GitHub Actions Workflows

- **PR Gatekeeper (`pr-gatekeeper.yml`)**: Validates branch names, PR templates, and Conventional Commit titles.
- **Linters (`pr-lint.yml`)**: Polyglot linting using Super-Linter.
- **Build Gate (`pr-build.yml`)**: Compiles and builds project artifacts.
- **Test Gate (`pr-test.yml`)**: Polyglot test runner with diff-scoped 80% coverage check.
- **Security Scanning (`pr-security.yml`)**: CodeQL, Dependency Review, and Secret Scanning.
- **Documentation Gate (`pr-docs.yml`)**: Verifies code-to-doc parity.




### 2. `gh-aw` Workflows (Natural Language Markdown)



- **Unit Test Generator** (triggered on `test-required` label): Reads uncovered line numbers and changed files, drafts unit tests matching project conventions, and commits to the PR branch.

- **Documentation Updater** (triggered on `docs-required` label): Analyzes API/feature diffs and generates matching markdown documentation updates.

- **Security & Vulnerability Remediation**: Analyzes complex CodeQL alerts or dependency alerts and proposes a surgical patch PR.

- **PR Validation** (`pr-validation.md`): Triggered on `needs-metadata` label. Summarizes broad diffs into clean, template-compliant PR descriptions and Conventional Commit titles when missing.