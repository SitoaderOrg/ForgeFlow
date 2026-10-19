# Prerequisites & Configuration Guide

To ensure all gatekeepers, GitHub Actions, and autonomous `gh-aw` remediation loops run smoothly without unexpected errors or fallback issues, verify the following configurations in your repository.

---

## 1. GitHub Actions Permissions (Critical)

Navigate to **Settings → Actions → General**:

### A. Workflow Permissions
- Select: **Read and write permissions**
- Check: **Allow GitHub Actions to create and approve pull requests**
  > **Why**: Without this setting, remediation agents (`pr-test-generator`, `pr-doc-updater`, `pr-codeql-fixer`, etc.) cannot open stacked remediation pull requests. Instead, they fall back to creating issues with the diff preview.

---

## 2. GitHub Code Security & Analysis

Navigate to **Settings → Code security and analysis**:

### Dependency Management
- **Dependency Graph**: Enabled
- **Automatic dependency submission**: Enabled
  > **Why**: Detects build-time and dynamic dependencies resolved during compilation, ensuring complete coverage for the Dependency Review gatekeeper.
- **Dependabot alerts**: Enabled
  > **Why**: Powers the vulnerability database checked by `pr-security.yml` (Dependency Review) during PR checks.
- **Dependabot malware alerts**: Enabled
  > **Why**: Flags malicious packages and software supply-chain compromises.
- **Dependabot security updates**: Enabled (optional)
  > **How it works alongside our flow**: Dependabot patches *existing* dependencies on `main` over time, while our `pr-dependency-fixer.md` autonomously intercepts and patches vulnerable packages *inside the active PR diff* before they reach `main`. They are fully complementary with zero conflicts.

### Static Analysis & Secret Protection
- **CodeQL analysis**: Set up (Default or Advanced setup)
  > **Why**: Enables SAST static code scanning in `pr-security.yml` and feeds alerts to `pr-codeql-fixer.md`.
- **Copilot Autofix for CodeQL**: Enabled (optional but recommended)
  > **Why**: Generates AI-powered code fix suggestions on CodeQL alerts, which `pr-codeql-fixer.md` directly inspects and leverages to assemble defensive patches in stacked remediation PRs.
- **Secret scanning**: Enabled
- **Push protection**: Enabled
  > **Why**: Prevents secret leaks and feeds detections to `pr-secret-fixer.md`.

---

## 3. GitHub Copilot & AI Access

All `gh-aw` workflows use GitHub Copilot as their default reasoning engine via GitHub Actions permissions:
- Ensure the repository belongs to an organization or account with an active **GitHub Copilot** subscription (Copilot Business, Enterprise, or Pro).
- Workflows declare `permissions: copilot-requests: write`, which authorizes the workflow to use Copilot inference without requiring personal API keys or third-party secrets.
- Agents read their model from the `GH_AW_AGENT_MODEL` repository variable (fallback `gpt-4.1`). It must be a model enabled for the organization's Copilot inference — the available list is written to `sandbox/firewall/logs/api-proxy-logs/models.json` in every agent run's `agent` artifact. Avoid `auto` (it can resolve to models that reject Copilot CLI tools). Switch models (e.g. when one hits its rate limit / `429 Too Many Requests`) by updating the variable — no recompilation needed. Observed with gh-aw v0.89.21 / Copilot CLI 1.0.87: `gpt-4.1` works; `auto` (→ `gpt-5.6-luna-utility`) and `gpt-4o` fail with `Unsupported Responses custom tool`, and `gpt-5.3-codex` fails after its first edit with `Invalid 'input[n].id' ... Expected an ID that begins with 'fc'`.

---

## 4. GitHub Actions Secrets & Variables (Optional)

Navigate to **Settings → Secrets and variables → Actions**:

### Variables (Repository Variables)
- `COVERAGE_THRESHOLD`: (Default: `80`) Minimum line coverage percentage enforced by `pr-test.yml`. Can be adjusted as needed (e.g. `70` or `85`).
- `CODEQL_MIN_SECURITY_SEVERITY`: (Default: `4.0`) Minimum CodeQL `security-severity` that fails the security gate.
- `GH_AW_AGENT_MODEL`: (Default: `gpt-4.1`) Copilot model used by all remediation agents (e.g. `gpt-5.3-codex`, `gpt-4.1`).
- `MAX_REMEDIATION_ATTEMPTS`: (Default: `1`) How many times a gate may dispatch the same remediation agent for one PR branch. With `1`, a gate that still fails after its repair fails `pr-quality` and asks for manual intervention.
- `PIPELINE_WAIT_MINUTES`: (Default: `30`) How long the remediation relay waits for a running pipeline before re-checking gates.
- `STALE_VERDICT_MINUTES`: (Default: `30`) How long `pr-quality` may stay pending (with no pipeline or relay running) before the watchdog re-evaluates it.
- `PR_BOT_CLIENT_ID`: *(Recommended)* Client ID of the GitHub App used for bot pushes (autofix commits and stacked-PR merges). Set it with `PR_BOT_PRIVATE_KEY`.

### Secrets (Repository Secrets)
- `PR_BOT_PRIVATE_KEY`: *(Recommended)* Private key of that GitHub App. The App needs **Contents: Read and write** and **Pull requests: Read and write** and is installed on this repository only. Without it, every bot push also leaves an approval-held "Action required" run, because PR events created with `GITHUB_TOKEN` are held for approval (see [GitHub App for bot pushes](docs/remediation-chaining.md#recommended-github-app-for-bot-pushes)).
- `GH_AW_CI_TRIGGER_TOKEN`: *(Not recommended)* The framework chains every gate → agent → relay → pipeline hop with `workflow_dispatch` (see [Remediation Chaining](docs/remediation-chaining.md)). A PAT here would also make agent-created stacked PRs start `pull_request` runs, which only adds noise.

---

## 5. Local Developer Tooling

When developing and compiling workflows locally:

1. **GitHub CLI (`gh`)**:
   ```bash
   gh --version # Ensure gh v2.40+ is installed
   ```
2. **`gh-aw` Extension**:
   ```bash
   gh extension install github/gh-aw
   ```
3. **Compilation Command**:
   Whenever modifying `.github/workflows/*.md`, recompile lockfiles before committing:
   ```bash
   gh aw compile --validate
   ```

---

## 6. Checklist Summary

| Area | Setting | Path in GitHub UI | Required For |
| :--- | :--- | :--- | :--- |
| **Actions** | Read and write permissions | Settings → Actions → General | Auto-merging & labeling PRs |
| **Actions** | Allow Actions to create & approve PRs | Settings → Actions → General | Stacked remediation PRs |
| **Actions** | `PR_BOT_CLIENT_ID` variable + `PR_BOT_PRIVATE_KEY` secret (GitHub App) | Settings → Secrets and variables → Actions | No "Action required" runs after bot pushes (recommended) |
| **Branches** | Require `pr-quality` status + "Require branches to be up to date before merging" on `main` | Settings → Branches (or Rulesets) | No merge on a stale or conflicting verdict (recommended) |
| **Security** | Dependency graph & alerts | Settings → Code security | Dependency Review Gatekeeper |
| **Security** | Automatic dependency submission | Settings → Code security | Build-time dependency detection |
| **Security** | Dependabot alerts & malware alerts | Settings → Code security | Vulnerability detection database |
| **Security** | Secret scanning & push protection | Settings → Code security | Secret Scanning Gatekeeper |
| **Security** | CodeQL analysis | Settings → Code security | SAST Security Gatekeeper |
| **Security** | Copilot Autofix for CodeQL | Settings → Code security | AI fix suggestions for SAST alerts |
| **AI / Copilot** | Copilot license & access | Organization / User Settings | Agentic reasoning & remediation |
| **Workflows** | `allowed-base-branches: ["*"]` | `.github/workflows/*.md` | Stacked PR target branching |
