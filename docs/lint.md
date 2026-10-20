# Step 2: Polyglot Linting & Autonomous Style Remediation

This step implements a language-agnostic code quality gate combined with an autonomous AI remediation loop for formatting, styling, and static linting errors.

---

## Architecture Overview

```mermaid
flowchart TD
    Autofix[Pipeline autofix job\neslint --fix / prettier --write\non changed files] -->|nothing to fix| Linter[Lint Gate, in parallel with the other gates\n.github/workflows/gate-lint.yml]
    Autofix -->|files fixed| AutofixPR[Stacked PR 'lint-remediation'\nlint-autofix/pr-N]
    AutofixPR --> AutofixRelay[relay.yml\nSquash-merge, then full check of the fixed commit]
    AutofixRelay --> Linter
    
    Linter -->|✅ All Linters Pass| Passed[gate/lint: success\nlabel 'lint-passed']
    Linter -->|❌ Lint / Style Failure| AddLabel[gate/lint: failure\nApply 'lint-failed' Label]
    
    AddLabel --> Fixer[Autonomous gh-aw Workflow\n.github/workflows/fix-lint.md]
    Fixer --> Inspect[Inspect PR Diff & Failed Linter Logs]
    Fixer --> Remediate[Format Code & Correct Lint Violations]
    Fixer --> SafeOutputs[Safe Outputs Execution:\n- Open stacked PR 'lint-remediation'\n- Comment on parent PR]
    SafeOutputs --> Relay[relay.yml\nSquash-merge stacked PR\nre-run gate-lint.yml alone]
    Relay --> Recheck([Lint gate re-checks the new commit\npasses: 'lint-passed' / still failing: pr-quality fails])
```

---

## 1. Deterministic Gate (`.github/workflows/gate-lint.yml`)

The linter gate uses GitHub's official **Super-Linter** to provide out-of-the-box linting across any programming language without manual per-language tooling setup.

- **Universal & Polyglot**: Automatically detects languages in the repository (JavaScript, TypeScript, Python, Go, Rust, Java, C#, Shell, JSON, YAML, etc.) and executes the appropriate linters.
- **Tuned & Noise-Free**:
  - Excludes noisy non-code linters (`VALIDATE_CHECKOV: false`, `VALIDATE_MARKDOWN: false`, `VALIDATE_NATURAL_LANGUAGE: false`, `VALIDATE_JSCPD: false`) to keep focus on code logic and formatting.
  - Skips internal metadata paths (`.github/`, `docs/`, `*.lock.yml`, and temp logs) via `FILTER_REGEX_EXCLUDE`.
- **Diff-Aware**: Sets `VALIDATE_ALL_CODEBASE: false` to only inspect changed files in the PR, minimizing runtime and avoiding legacy repo-wide noise.
- **Deterministic autofix first**: before any gate runs, the pipeline's `autofix` job runs `eslint --fix` and `prettier --write` on the changed files (same-repository PRs only). If anything changed, it commits `style(lint): auto-fix lint and formatting [pr-autofix]` to `lint-autofix/pr-<number>` and opens it as a stacked PR labelled `lint-remediation` — like every automated change, it never pushes to the feature branch directly. It then hands off to `relay.yml`, which squash-merges the stacked PR; the gates run on the merged commit. Most formatting failures therefore never reach the agent.
- **Gate result & Triggering Remediation**:
  - If any linter detects errors, the workflow marks the job as failed, records `gate/lint: failure` and attaches the **`lint-failed`** label to the PR.
  - If all linters pass, it clears the `lint-failed` label and records `gate/lint: success` (label `lint-passed`).

---

## 2. Autonomous `gh-aw` Remediation Loop (`.github/workflows/fix-lint.md`)

When formatting or style issues break the build, this GitHub Agentic Workflow automatically remediates the files rather than forcing developer context-switching.

- **Trigger**: Activates automatically when the **`lint-failed`** label is added to a PR (or manually via `workflow_dispatch`).
- **Log & Code Analysis**:
  - Inspects `gh pr diff` and recent linter failure logs from `gate-lint.yml`.
  - Pinpoints exact syntax, whitespace, import ordering, or style discrepancies reported by the linter.
- **Safe Outputs Execution**:
  - `create-pull-request`: Opens a stacked PR (labelled `lint-remediation`, title prefix `style(lint): `) targeting the author's feature branch with the formatting and lint fixes.
  - `add-comment`: Posts a summary on the parent PR of which files were formatted and which lint rules were corrected.
- **Auto-merge**: When the agent run ends, its `conclusion` job dispatches `relay.yml`, which squash-merges the stacked PR into the feature branch, posts an audit comment with the merged commit on the parent PR, and re-runs only the Lint gate (`gate-lint.yml`) on the new commit, carrying the other gates' results over. If the agent failed or opened no stacked PR, the relay re-checks nothing and `pr-quality` fails right away. The `lint-failed` label is only removed by the Lint gate when the re-check passes; if it still fails and nothing else is repairing the PR, `pr-quality` fails with an error comment (see [Remediation Chaining](remediation-chaining.md)).
