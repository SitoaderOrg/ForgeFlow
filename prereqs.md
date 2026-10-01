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
- **Secret scanning**: Enabled
- **Push protection**: Enabled
  > **Why**: Prevents secret leaks and feeds detections to `pr-secret-fixer.md`.

---

## 3. GitHub Copilot & AI Access

All `gh-aw` workflows use GitHub Copilot as their default reasoning engine via GitHub Actions permissions:
- Ensure the repository belongs to an organization or account with an active **GitHub Copilot** subscription (Copilot Business, Enterprise, or Pro).
- Workflows declare `permissions: copilot-requests: write`, which authorizes the workflow to use Copilot inference without requiring personal API keys or third-party secrets.

---

## 4. GitHub Actions Secrets & Variables (Optional)

Navigate to **Settings → Secrets and variables → Actions**:

### Variables (Repository Variables)
- `COVERAGE_THRESHOLD`: (Default: `80`) Minimum line coverage percentage enforced by `pr-test.yml`. Can be adjusted as needed (e.g. `70` or `85`).

### Secrets (Repository Secrets)
- `GH_AW_CI_TRIGGER_TOKEN`: *(Optional)* A Personal Access Token (PAT) with `repo` and `workflow` scope if you want pull requests created by GitHub Actions to trigger downstream CI workflows (by default, GitHub prevents actions-created PRs from triggering workflows to avoid recursive loops).

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
| **Security** | Dependency graph & alerts | Settings → Code security | Dependency Review Gatekeeper |
| **Security** | Automatic dependency submission | Settings → Code security | Build-time dependency detection |
| **Security** | Dependabot alerts & malware alerts | Settings → Code security | Vulnerability detection database |
| **Security** | Secret scanning & push protection | Settings → Code security | Secret Scanning Gatekeeper |
| **Security** | CodeQL analysis | Settings → Code security | SAST Security Gatekeeper |
| **AI / Copilot** | Copilot license & access | Organization / User Settings | Agentic reasoning & remediation |
| **Workflows** | `allowed-base-branches: ["*"]` | `.github/workflows/*.md` | Stacked PR target branching |
