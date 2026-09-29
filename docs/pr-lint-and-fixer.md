# Step 2: Polyglot Linting & Autonomous Style Remediation

This step implements a language-agnostic code quality gate combined with an autonomous AI remediation loop for formatting, styling, and static linting errors.

---

## Architecture Overview

```mermaid
flowchart TD
    PR[PR Created / Synchronized] --> Linter[1. Deterministic Linter Gate\n.github/workflows/pr-lint.yml]
    
    Linter -->|✅ All Linters Pass| NextGate[Downstream CI Gates\nTests, Security, Build]
    Linter -->|❌ Lint / Style Failure| AddLabel[Apply 'lint-failed' Label\nFail Fast / Halt Pipeline]
    
    AddLabel --> Fixer[2. Autonomous gh-aw Workflow\n.github/workflows/pr-lint-fixer.md]
    Fixer --> Inspect[Inspect PR Diff & Failed Linter Logs]
    Fixer --> Remediate[Format Code & Correct Lint Violations]
    Fixer --> SafeOutputs[Safe Outputs Execution:\n- Push fix directly to PR branch\n- Post explanatory comment\n- Remove 'lint-failed' label]
    SafeOutputs --> Recheck([PR Updated & Re-evaluated])
```

---

## 1. Deterministic Gate (`.github/workflows/pr-lint.yml`)

The linter gate uses GitHub's official **Super-Linter** to provide out-of-the-box linting across any programming language without manual per-language tooling setup.

- **Universal & Polyglot**: Automatically detects languages in the repository (JavaScript, TypeScript, Python, Go, Rust, Java, C#, Shell, Markdown, YAML, Dockerfile, etc.) and executes the appropriate linters.
- **Diff-Aware**: Sets `VALIDATE_ALL_CODEBASE: false` to only inspect changed files in the PR, minimizing runtime and avoiding legacy repo-wide noise.
- **Fail-Fast & Triggering Remediation**:
  - If any linter detects errors, the workflow marks the job as failed and automatically attaches the **`lint-failed`** label to the PR.
  - If all linters pass (or after autonomous fixes are applied), it clears the `lint-failed` label.

---

## 2. Autonomous `gh-aw` Remediation Loop (`.github/workflows/pr-lint-fixer.md`)

When formatting or style issues break the build, this GitHub Agentic Workflow automatically remediates the files rather than forcing developer context-switching.

- **Trigger**: Activates automatically when the **`lint-failed`** label is added to a PR (or manually via `workflow_dispatch`).
- **Log & Code Analysis**:
  - Inspects `gh pr diff` and recent linter failure logs from `pr-lint.yml`.
  - Pinpoints exact syntax, whitespace, import ordering, or style discrepancies reported by the linter.
- **Safe Outputs Execution**:
  - `push-to-pull-request-branch`: Commits and pushes the clean formatting and lint fixes directly to the author's PR branch.
  - `add-comment`: Posts a summary of which files were formatted and which lint rules were corrected.
  - `remove-labels`: Removes the `lint-failed` label to unblock the gatekeeper.
