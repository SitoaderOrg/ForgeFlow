### End-to-End PR Quality Flow

1. **Pre-Flight Gatekeeper (Fail-Fast)**: Validates PR metadata, templates, and branch rules before triggering CI runs.
2. **Linters & Static Formatters**: Prettier, ESLint, Stylelint, `gofmt` (runs standard linters; fail-fast).
3. **Polyglot Build Verification**: Verifies compilation and build artifacts across ecosystems (TypeScript, Go, Rust, Java, .NET).
4. **Automated Testing & Coverage**: Executes test runner with diff-scoped coverage (configurable threshold, defaulting to 80%).
5. **GitHub Security & Quality**: Native CodeQL static analysis, Secret Scanning, and Dependabot dependency reviews.
6. **Documentation Drift Verification**: Detects when significant code logic is introduced without documentation.
7. **Autonomous `gh-aw` Remediation Loops**: Proposes fixes as stacked PRs when gates fail.
8. **Automated Consolidation & Auto-Merge**: Automatically squashes validated remediation PRs into the feature branch with full audit trails.
9. **Semantic Review & Merge**: GitHub Copilot performs review before human approval and final merge.

### 💡 Why This Framework is Relevant: Solving Review Fatigue

Without consolidation, autonomous agents running in parallel can overwhelm engineers with disjointed pull requests, repetitive CI runs, and constant context switching:

- **Zero Human Churn**: Developers aren't interrupted every 5 minutes to review 4 minor stacked PRs. The pipeline auto-merges them into the feature branch.
- **Auditability & Traceability**: Because each agent created its own stacked PR, there is a clean git history and PR record for *why* a test was added or a security patch was merged.
- **Transparency via Comments**: Commenting on the parent PR keeps the author informed of everything that was auto-merged.
- **Final Single Review**: Copilot reviews the final, clean, remediated branch, and the human author only does **one comprehensive review** of all auto-remediated changes plus Copilot's review feedback.

| Metric | Traditional Human-Only CI/CD | Our Autonomous PR Lifecycle |
| :--- | :--- | :--- |
| **Average Time-to-Merge (TTM)** | **2 to 5 business days** (waiting for peer reviewers to wake up, point out missing tests, request formatting fixes, wait for changes, re-review) | **15 to 45 minutes** |
| **CI/CD Pipeline Run Time** | 3 to 10 minutes per push | 2 to 5 minutes per push |
| **Review Cycles** | 3–4 back-and-forth round trips over days | **1 single review session** by the developer |

### Architectural Rule of Thumb

- **Regular GitHub Actions:** Deterministic, binary (pass/fail), fast, reproducible tasks (compiling, running test runners, linting, scanning). -> (fast, zero token cost, reproducible).
- **`gh-aw` (English Agentic Workflows):** Tasks requiring **reasoning, semantic understanding, synthesis, or code generation**. -> (using English in Markdown).
- **Auto-Cancellation & Concurrency Control:** All PR gatekeepers use `concurrency` with `cancel-in-progress: true`. Whenever an author or automated agent pushes a new commit or fix to a PR, any active workflows running on the obsolete commit are immediately cancelled to save CI minutes and avoid race conditions.

### Documentation & Implemented Modules

- [Prerequisites & Repository Settings](prereqs.md)
- [Pre-Flight PR Gatekeeper & Validation](docs/pr-gatekeeper-and-validation.md)
- [Agentic Workflows Compilation & Verification](docs/agentic-workflows-compilation.md)
- [Polyglot Linters & PR Lint Fixer](docs/pr-lint-and-fixer.md)
- [Polyglot Build & Compilation Verification](docs/pr-build.md)
- [Polyglot Automated Testing & PR Test Generator](docs/pr-test-and-generator.md)
- [GitHub Code Security & PR Security Fixers](docs/pr-security-and-fixer.md)
- [Documentation Drift & Autonomous Documentation Updater](docs/pr-docs-and-updater.md)
- [Automated Consolidation, Copilot Review & Developer Sign-Off](docs/pr-review-and-consolidation.md)

### 1. Standard GitHub Actions Workflows

- **PR Orchestrator Pipeline (`pr-pipeline.yml`)**: Single entry point orchestrating individual modular workflows in a clean staged DAG.
- **PR Gatekeeper (`pr-gatekeeper.yml`)**: Validates branch names, PR templates, and Conventional Commit titles (reusable).
- **Linters (`pr-lint.yml`)**: Polyglot linting using Super-Linter (reusable).
- **Build Gate (`pr-build.yml`)**: Compiles and builds project artifacts (reusable).
- **Test Gate (`pr-test.yml`)**: Polyglot test runner with diff-scoped 80% coverage check (reusable).
- **Security Scanning (`pr-security.yml`)**: CodeQL, Dependency Review, and Secret Scanning (reusable).
- **Review & Consolidation Dispatcher (`pr-review-dispatcher.yml`)**: Dispatches Copilot code review and posts consolidated audit summaries (reusable).
- **Stacked PR Auto-Merger (`pr-stacked-merge.yml`)**: Automatically merges verified remediation PRs into the feature branch.

### 2. `gh-aw` Workflows (Natural Language Markdown)

- **PR Validation (`pr-validation.md`)**: Triggered on `needs-metadata` label. Summarizes broad diffs into clean, template-compliant PR descriptions and Conventional Commit titles when missing.
- **PR Lint Fixer (`pr-lint-fixer.md`)**: Triggered on `lint-failed`. Automatically formats and resolves linter errors on the PR branch.
- **PR Test Generator (`pr-test-generator.md`)**: Triggered on `test-required`. Drafts missing unit tests and boundary cases in a stacked PR.
- [Security Fixers (`pr-codeql-fixer.md`, `pr-dependency-fixer.md`, `pr-secret-fixer.md`)](.github/workflows/pr-codeql-fixer.md): Remediates vulnerabilities and alerts via stacked PRs.
- [Documentation Evaluator & Updater (`pr-doc-updater.md`)](.github/workflows/pr-doc-updater.md): Semantically evaluates PR diffs against documentation criteria (public APIs, schemas, architecture) and authors missing guides via stacked PRs.

### 3. Sample Application: Ferret Heist (`apps/ferret-heist`)

A standalone, zero-deployment 2D stealth action browser game built for testing the PR gatekeeper and autonomous remediation loops:

- **Run Directly**: Open `dist/index.html` or `apps/ferret-heist/index.html` in any browser, or run `npm run dev` / `npm run preview`.
- **Verify Build**: `npm run build` (builds bundled assets into `dist/`).
- **Execute Tests & Coverage**: `npm test` or `npm run test:cov` (runs Vitest with diff-scoped coverage verification >= 80%).
- **Chaos Testing**:
  - Break a test in `tests/ferret.test.js` to trigger the **PR Test Generator** loop.
  - Introduce lint formatting issues in `apps/ferret-heist/` to trigger the **PR Lint Fixer** loop.
  - Break compilation or syntax to trigger the **PR Build Gatekeeper** loop.
