### End-to-End PR Quality Flow

1. **Gate: PR metadata**: Validates PR metadata, templates, and branch rules. All six gates (1–6) run in parallel after a deterministic `eslint --fix`/`prettier --write` autofix (proposed as a stacked PR and auto-merged, like every automated change), so every failure is found in the first run.
2. **Linters & Static Formatters**: Prettier, ESLint, Stylelint, `gofmt` (runs standard linters).
3. **Polyglot Build Verification**: Verifies compilation and build artifacts across ecosystems (TypeScript, Go, Rust, Java, .NET).
4. **Automated Testing & Coverage**: Executes test runner with diff-scoped coverage (configurable threshold, defaulting to 80%).
5. **GitHub Security & Quality**: Native CodeQL static analysis (SARIF findings gated by security severity), Dependency Review, and secret detection (GITLEAKS in the lint stage).
6. **Documentation Drift Verification**: Detects when application code changes without documentation and hands the semantic decision to the documentation agent.
7. **Autonomous `gh-aw` Remediation Loops**: Failing gates dispatch the matching agent with the concrete findings (bounded attempts); agents propose stacked PRs or metadata fixes but never mark a gate as passed (see [Remediation Chaining](docs/remediation-chaining.md)).
8. **Automated Consolidation & Per-Gate Recheck**: The remediation relay squashes each stacked PR into the feature branch with a full audit trail and re-checks only the gate that was repaired, carrying the other gates' `gate/<id>` results over. A gate still failing after its repair fails `pr-quality`; once all gates are green, one final full run confirms the combined fixes.
9. **Semantic Review & Human Merge**: Once the `pr-quality` status is green, GitHub Copilot reviews the PR; the review-comments fixer addresses all of its comments at once in one stacked PR (one automatic round, every gate re-checked, each Copilot thread answered), and, if every comment was applied, Copilot confirms the final commit with one more review. A human then gives the final approval and merges it. Only stacked remediation PRs are merged automatically (into the feature branch).

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
- **Auto-Cancellation & Concurrency Control:** The orchestrator (`pipeline.yml`) owns a per-PR `concurrency` group: a newer human push cancels the obsolete check, while dispatched and bot runs queue behind it and are de-duplicated per revision via the `pr-quality` status; verdicts are serialized per PR. Reusable gates intentionally declare no workflow-level concurrency (it would deadlock with the caller's group), and agent jobs are serialized to respect Copilot inference rate limits.
- **No PAT required:** Events created with `GITHUB_TOKEN` never start workflows on their own (PR events only create approval-held runs), so every hop is chained with `workflow_dispatch` — see [Remediation Chaining Without PATs](docs/remediation-chaining.md). An optional, repository-scoped GitHub App (`PR_BOT_CLIENT_ID` / `PR_BOT_PRIVATE_KEY`) makes bot pushes start the pipeline natively, so no "Action required" runs are left behind.

### Documentation & Implemented Modules

- [Prerequisites & Repository Settings](prereqs.md)
- [Pre-Flight Gate: PR metadata & Validation](docs/metadata.md)
- [Agentic Workflows Compilation & Verification](docs/agentic-workflows-compilation.md)
- [Polyglot Linters & Fix: Lint & format](docs/lint.md)
- [Polyglot Build & Compilation Verification](docs/build.md)
- [Polyglot Automated Testing & Fix: Tests](docs/tests.md)
- [GitHub Code Security & PR Security Fixers](docs/security.md)
- [Documentation Drift & Autonomous Documentation Updater](docs/docs-drift.md)
- [Remediation Chaining Without PATs (dispatch, relay & guard rails)](docs/remediation-chaining.md)
- [Automated Consolidation, Copilot Review & Developer Sign-Off](docs/review.md)

### Naming convention

Workflow files and names share a role prefix, so the Actions sidebar groups them and every run title names its target (e.g. `Fix: Lint & format · PR #35`):

| Prefix | Role | Files |
| :--- | :--- | :--- |
| **Pipeline** | Entry point for every feature PR into `main` | `pipeline.yml` |
| **Gate:** | Checks one aspect and records `gate/<id>`; never changes code | `gate-*.yml` |
| **Fix:** | gh-aw agent that repairs one failing gate through a stacked PR | `fix-*.md` |
| **Relay:** | Merges stacked fixes into the feature branch and re-checks the repaired gates | `relay.yml` |
| **Review:** | Requests Copilot code review and hands its comments to the review-comments fixer | `review-*.yml` |
| — | `pr-quality` verdict and watchdog; merge conflict check | `verdict.yml`, `conflicts.yml` |

### 1. Standard GitHub Actions Workflows

- **Pipeline (`pipeline.yml`)**: Single entry point orchestrating individual modular workflows as parallel gates (after an autofix job) and publishes the `pr-quality` verdict. Runs on `pull_request` and on `workflow_dispatch(pr_number, force)` (manual re-checks and the final check after repairs).
- **Gate: PR metadata (`gate-metadata.yml`)**: Validates branch names, PR templates, and Conventional Commit titles (reusable; also `workflow_dispatch`).
- **Gate: Lint & format (`gate-lint.yml`)**: Polyglot linting using Super-Linter (reusable; also `workflow_dispatch`).
- **Gate: Build (`gate-build.yml`)**: Compiles and builds project artifacts (reusable; also `workflow_dispatch`).
- **Gate: Tests & coverage (`gate-tests.yml`)**: Polyglot test runner with diff-scoped 80% coverage check (reusable; also `workflow_dispatch`).
- **Gate: Security (`gate-security.yml`)**: Per-language CodeQL matrix and Dependency Review (reusable; also `workflow_dispatch`).
- **Gate: Docs drift (`gate-docs.yml`)**: Fails when application code changes without Markdown documentation, unless the doc agent recorded `docs-not-required` (reusable; also `workflow_dispatch`).
- **Review: request (`review-request.yml`)**: Requests a Copilot code review (once when the gates pass, once more to confirm the review fixes) and posts consolidated audit summaries (reusable; also `workflow_dispatch`).
- **Review: Copilot intake (`review-intake.yml`)**: When Copilot submits a review, hands all of its open comments to the review-comments fixer in one batch (see [Copilot review comments](docs/remediation-chaining.md#copilot-review-comments)).
- **Relay: merge stacked fixes (`relay.yml`)**: Dispatched by every agent when it finishes; merges remediation PRs into the feature branch and re-runs only the repaired gate on the new commit. A stacked PR that conflicts with the feature branch is superseded and regenerated once on the current head.
- **Merge conflict check (`conflicts.yml`)**: Runs on every push, because GitHub never starts `pull_request` runs for conflicting PRs; fails `pr-quality` with resolve instructions for PRs that conflict with `main` (see [Merge conflicts](docs/remediation-chaining.md#merge-conflicts)).
- **Verdict & watchdog (`verdict.yml`)**: Derives the `pr-quality` status from the `gate/<id>` statuses after a gate is re-checked alone (reusable; also `workflow_dispatch`).
- **Shared gate helper (`.github/scripts/remediation.cjs`)**: Label management and deduplicated, budgeted agent dispatch.

### 2. `gh-aw` Workflows (Natural Language Markdown)

- **Fix: PR metadata (`fix-metadata.md`)**: Dispatched by the PR metadata gate (`needs-metadata`). Summarizes broad diffs into clean, template-compliant PR descriptions and Conventional Commit titles when missing.
- **Fix: Lint & format (`fix-lint.md`)**: Dispatched by the lint gate (`lint-failed`) with the per-linter Super-Linter output. Automatically formats and resolves linter errors and opens a stacked PR (`lint-remediation`) that is auto-merged into the PR branch.
- **Fix: Tests (`fix-tests.md`)**: Dispatched by the test gate (`test-required`) with failing tests and coverage. Drafts missing unit tests and boundary cases in a stacked PR.
- [Fix: CodeQL alerts, Fix: Dependencies, Fix: Secrets (`fix-codeql.md`, `fix-dependencies.md`, `fix-secrets.md`)](.github/workflows/fix-codeql.md): Remediates vulnerabilities and alerts via stacked PRs.
- [Fix: Docs (`fix-docs.md`)](.github/workflows/fix-docs.md): Semantically evaluates PR diffs against documentation criteria (public APIs, schemas, architecture) and authors missing guides via stacked PRs.
- [Fix: Copilot review comments (`fix-review-comments.md`)](.github/workflows/fix-review-comments.md): Dispatched with every open Copilot review comment once the gates pass. Applies or skips each one (with a reason) in a single stacked PR (`review-remediation`); the relay re-checks every gate and answers each Copilot thread.

### 3. Sample Application: Ferret Heist (`apps/ferret-heist`)

A standalone, zero-deployment 2D stealth action browser game built for testing the PR gate and autonomous remediation loops:

- **Run Directly**: Open `dist/index.html` or `apps/ferret-heist/index.html` in any browser, or run `npm run dev` / `npm run preview`.
- **Verify Build**: `npm run build` (builds bundled assets into `dist/`).
- **Execute Tests & Coverage**: `npm test` or `npm run test:cov` (runs Vitest with diff-scoped coverage verification >= 80%).
- **Test the CI/CD workflows**: `npm run test:workflows` (offline scenario tests for the pipeline, gates, relay and agents; see [Testing the workflows](docs/remediation-chaining.md#testing-the-workflows)).
- **Lint**: `npm run lint` (ESLint, Prettier, HTMLHint — the same configs Super-Linter uses in CI); `npm run lint:fix` to auto-fix.
- **Chaos Testing**:
  - Break a test in `tests/ferret.test.js` to trigger the **Fix: Tests** loop.
  - Introduce lint formatting issues in `apps/ferret-heist/` to trigger the **Fix: Lint & format** loop.
  - Break compilation or syntax to trigger the **Gate: Build** loop.
