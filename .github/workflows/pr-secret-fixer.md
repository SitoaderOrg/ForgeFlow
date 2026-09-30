---
name: PR Secret Fixer
description: Automatically creates a stacked remediation pull request to scrub hardcoded credentials detected by GitHub Secret Protection / Scanning on pull requests
emoji: "🔑"

on:
  pull_request:
    types: [labeled]
  labels: ["secret-alert"]
  workflow_dispatch:

permissions:
  contents: read
  pull-requests: read
  issues: read
  security-events: read
  copilot-requests: write

tools:
  edit: true
  github:
    mode: "gh-proxy"

strict: true

features:
  copilot-requests: true

safe-outputs:
  create-pull-request:
    title-prefix: "fix(security): "
    labels: ["security-remediation", "human-review-needed"]
    allowed-base-branches: ["*"]
  add-comment:
    max: 1
---

## Objective
Automatically create a stacked remediation pull request targeting the developer's feature branch to scrub all hardcoded credentials and secrets detected by GitHub Secret Protection / Secret Scanning, replacing them with environment variables, while notifying the author to revoke and rotate the exposed secrets.

## Instructions
1. Inspect the pull request using `gh pr diff` and `gh pr view --json number,files,commits,headRefName`.
2. Inspect open secret scanning alerts:
   - Run `gh api repos/{owner}/{repo}/secret-scanning/alerts?state=open` or review CI logs for secret alert locations (file and line numbers).
3. For each detected secret:
   - Remove the plaintext credential from the code.
   - Replace it with a standard environment variable lookup (e.g., `process.env.SECRET_NAME`, `os.environ.get(...)`, `std::env::var(...)`).
   - Add a dummy placeholder entry in `.env.example` (e.g., `SECRET_NAME=your_secret_here`) if appropriate.
   - Note down a conventional commit title for each scrubbed secret (e.g., `fix(security): replace hardcoded <type> secret with environment variable in <file>`).
4. Apply safe outputs:
   - Call `create-pull-request` to open a stacked pull request:
     - Set `base` to the parent PR branch (`headRefName`).
     - Set `title`: `fix(security): scrub hardcoded credentials and use environment variables`
     - Set `body`: Structure the PR body with an itemized breakdown of each secret scrubbed:
       - **Commit Title & Summary**: Conventional commit title for each secret replaced.
       - **File & Variable**: Affected file and new environment variable introduced.
       - **Action Required**: "Merge this stacked PR to remove hardcoded credentials from your branch and clear the security gate."
   - Call `add-comment` on the parent PR:
     - Inform the author that a stacked PR has been opened with the scrubbed credentials.
     - **CRITICAL SECURITY WARNING**: Remind the author that because the secret was pushed to git history, they MUST immediately **revoke and rotate the compromised credential** with the issuing provider.
