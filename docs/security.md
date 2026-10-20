# Step 5: GitHub Code Security & Autonomous Remediation

This step implements security gates powered by **GitHub Code Security** combined with specialized, autonomous AI remediation loops for vulnerable dependencies, static code vulnerabilities, and exposed secrets.

---

## Architecture Overview

```mermaid
flowchart TD
    BuildPass[Pipeline autofix done] --> SecGate[Security Gate, in parallel with the other gates\n.github/workflows/gate-security.yml]
    
    subgraph GitHub_Code_Security [GitHub Code Security Engines]
        SecGate --> DepReview[Dependency Review Action\nChecks PR diff for CVEs / license issues]
        SecGate --> CodeQL[CodeQL SAST Analysis\nScans code for security vulnerabilities]
    end

    DepReview -->|❌ High/Crit CVE| AddDepLabel[Apply 'dependency-alert' Label]
    CodeQL -->|❌ Code Vulnerability| AddCodeqlLabel[Apply 'codeql-alert' Label]

    AddDepLabel --> DepFixer[Autonomous Dependency Fixer\n.github/workflows/fix-dependencies.md]
    DepFixer --> BumpDep[Bump to Minimum Secure Versions in Manifest]
    DepFixer --> StackedPRDep[Create Stacked PR: security-remediation]

    AddCodeqlLabel --> CodeqlFixer[Autonomous CodeQL Fixer\n.github/workflows/fix-codeql.md]
    CodeqlFixer --> AutofixCheck[Query Copilot Autofix or Synthesize Fix]
    CodeqlFixer --> StackedPRCodeql[Create Stacked PR: security-remediation]

    StackedPRDep & StackedPRCodeql --> AutoMerge[Auto-Merged into Feature Branch\n.github/workflows/relay.yml\nSquashes commit & posts audit link\nGates clear security labels on recheck]

    AutoMerge --> Recheck([Feature Branch Updated & Security gate re-checked alone])
```
```

---

## 1. Deterministic Security Gate (`.github/workflows/gate-security.yml`)

The deterministic security gate leverages native GitHub Code Security features:

- **Dynamic Environment Detection**:
  - Automatically identifies whether the repository contains dependency manifests (`package.json`, `requirements.txt`, `go.mod`, `pom.xml`, `Cargo.lock`, etc.); the CodeQL scan detects its languages itself.
  - Skips jobs cleanly if no relevant source files exist, guaranteeing polyglot compatibility without false failures.
- **GitHub Dependency Review (`actions/dependency-review-action`)**:
  - Evaluates changes to dependency manifests introduced in the pull request against GitHub's Advisory Database.
  - Blocks high- and critical-severity CVEs from entering the codebase.
  - Applies the **`dependency-alert`** label on failure.
- **GitHub CodeQL SAST (`github/codeql-action`, `.github/workflows/scan-codeql.yml`)**:
  - The repository's single CodeQL configuration (advanced setup); GitHub's CodeQL *default setup* must stay disabled, otherwise every PR is scanned twice and the uploads are rejected.
  - The gate calls it on the PR head: a per-language matrix (`actions` for workflow files, plus `javascript-typescript`, `python`, `go`, `java-kotlin`, `csharp`, `ruby`, `c-cpp`, `swift` as detected) with a supported build mode (`none` for interpreted languages, `autobuild` for Go/Swift) and the `security-extended` query suite.
  - CodeQL's analyze step succeeds even when it finds vulnerabilities, so the scan evaluates the SARIF output itself and fails on any result whose `security-severity` is at or above `CODEQL_MIN_SECURITY_SEVERITY` (repository variable, default `4.0` = medium).
  - Results are uploaded to `refs/pull/<n>/head` for the analyzed commit (also for re-checks dispatched on the branch), so the same scan provides the PR's code scanning alerts, annotations and Copilot Autofix suggestions. Fork PRs only get a read-only token and keep their results in the run.
  - The same workflow scans `main` on every push and weekly, keeping the default-branch alerts that PR results are compared against.
  - Applies the **`codeql-alert`** label on failure and dispatches the CodeQL fixer with the rule id, severity, message and `file:line` of each finding.
- **GitHub Secret Protection & Scanning**:
  - Repositories configure native GitHub Push Protection to reject hardcoded secrets server-side at `git push`.
  - Secrets introduced by the PR diff are caught by Super-Linter's **GITLEAKS** linter in the lint stage.
  - Repository-wide Secret Scanning alerts are not evaluated per PR: they are not scoped to the PR and `GITHUB_TOKEN` cannot read them. `fix-secrets.md` remains available for a manual run (`workflow_dispatch` with `pr_number`).
- **Autonomous Label Management**:
  - Each label is independent: if only one check fails, only its specific alert label is attached.
  - The remediation relay auto-merges the stacked PR into the feature branch and re-runs only the security gate on the new commit (or every gate together, when this was the last repair and the others passed); the security gate clears the labels only if the re-check passes.

---

## 2. Stacked PR Autonomous Remediation Loops

Rather than modifying the contributor's in-flight feature branch directly without consent, remediators propose their solutions as **Stacked Pull Requests**:

```mermaid
gitGraph
   commit id: "main base"
   branch "feat/my-feature"
   commit id: "developer code (vulnerability)"
   branch "fix/security-remediation"
   commit id: "AI security remediation"
   checkout "feat/my-feature"
   merge "fix/security-remediation" id: "dev merges stacked PR"
   checkout main
   merge "feat/my-feature" id: "merge to main"
```

### 2a. Fix: Dependencies (`.github/workflows/fix-dependencies.md`)
- **Trigger**: Dispatched by the security gate when Dependency Review fails (the gate also adds the **`dependency-alert`** label).
- **Batched Remediation**: Reads Dependency Review failure logs and updates all vulnerable packages across manifests in a single stacked PR.
- **Itemized Commit-Style Structure**:
  - The PR body details each package bump with a distinct commit title (e.g. `fix(deps): bump <package> from <old> to <new> to resolve <CVE>`), CVE/GHSA advisory details, and version deltas.
  - Opens the stacked PR against the developer's feature branch and adds a notification comment on the parent PR.

### 2b. Fix: CodeQL alerts (`.github/workflows/fix-codeql.md`)
- **Trigger**: Dispatched by the security gate with the CodeQL findings (the gate also adds the **`codeql-alert`** label).
- **Copilot Autofix Integration**:
  - Queries `gh api repos/{owner}/{repo}/code-scanning/alerts/<alert-number>/autofix` and PR review suggestions for an existing Copilot Autofix recommendation.
  - If a valid Copilot Autofix suggestion exists, it incorporates the patch into the remediation.
  - If Copilot Autofix is not enabled or produces no fix, the agent performs autonomous defensive refactoring using CodeQL taint analysis.
- **Itemized Commit-Style Structure**:
  - Remediates all open CodeQL alerts together in a single stacked PR.
  - The PR body documents each vulnerability resolved with a distinct commit title (e.g. `fix(security): sanitize input to prevent path traversal in <file>`), CWE number, sink, and defensive pattern.

### 2c. Fix: Secrets (`.github/workflows/fix-secrets.md`)
- **Trigger**: Manual only: run it with `workflow_dispatch` and the `pr_number` on the PR head branch. No gate dispatches it (see above).
- **Secret Scrubbing**:
  - Identifies exposed secrets from secret scanning alerts.
  - Scrubs hardcoded credentials from source files and replaces them with standard environment variable lookups (`process.env.SECRET_NAME`, `os.environ.get(...)`).
  - Adds dummy placeholder entries in `.env.example`.
- **Rotation Warning & Stacked PR**:
  - Opens a stacked PR targeting the author's feature branch with itemized commit titles for each scrubbed secret.
  - Posts a high-priority warning comment on the parent PR reminding the author to **immediately revoke and rotate the exposed credential** with the issuing provider.
