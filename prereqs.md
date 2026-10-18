# Prerequisites and deployment

## 1. Deploy workflows before requiring their checks

Compile with **gh-aw v0.89.21** and review the Markdown, generated lockfiles and YAML
together. Deploy the entry workflow and reusable workflows to the default branch,
including the independently dispatchable framework CI workflow, then incorporate
that revision into feature branches. GitHub requires a dispatched
workflow to exist on the default branch, even when it runs on a feature ref.

```bash
gh extension install github/gh-aw --pin v0.89.21
gh aw compile --validate --purge
```

Use `gh extension upgrade gh-aw --pin v0.89.21` if the extension is already installed.
Run local lifecycle tests with `npm run test:framework`.
Compilation drift is a failure requiring a reviewed local change; automation never
pushes protected workflow modifications.

Do not require a check before its workflow is deployed and has produced a run.
Existing repair PRs from an older controller are **not** adopted for automatic
merging; review or close them manually. Open automated repairs block duplicate
repair creation. Labels remain informational and have no control authority.

## 2. Configure native human approval and required checks

Create an **active repository branch ruleset** targeting `main` (or the actual base
branch) in Settings > Rules > Rulesets:

- Require a pull request before merging.
- Require at least **one approving review**.
- Require review from code owners for owned paths.
- Dismiss stale approvals when new commits are pushed.
- Require approval of the most recent reviewable push.
- Require both exact checks **`PR Quality / Ready for review`** and **`Framework CI / Required`**.
- Require the branch to be up to date before merging.
- Leave the bypass list empty, including for administrators and automation.

Select the GitHub Actions integration as the expected source of both
checks when configuring them. Add organization-specific checks where needed.
Application readiness requires metadata, lint, build, tests,
security and documentation; skipped, cancelled, failed, missing or stale results
do not pass it. Open automated repair PRs also block readiness.

Framework CI runs independently on all PRs and always reports its required
result, avoiding missing checks from workflow-level path filters. It skips
compiler and framework-test execution for app-only changes. Framework changes
require their own successful compilation/regression evidence; app readiness
does not waive that requirement.

`.github/CODEOWNERS` assigns `.github`, framework tests, shared root tooling and
framework documentation to `@sitoader`, including CODEOWNERS itself. Shared
root-lock updates also require this owner's review. CODEOWNERS is a merge-review
mechanism, not a restriction on who can propose edits or execute PR checks.
Ensure eligible reviewers are available; PR authors cannot approve themselves.
The effective owner file comes from the PR's base branch, so deploy it before
relying on it for subsequent feature PRs. Repository settings are not changed
by committing these files.

Allow squash merging for repair PRs targeting feature branches. The controller
respects applicable branch rules; if those branches require human approval, the
repair merge stops rather than bypassing it. Repair PRs must not be registered
in a stack that includes the feature PR or targets `main`. Native repair stacks
must target the feature branch, with only the recorded repair PRs as members.
The controller checks exact membership, order and snapshots before landing.

Review feature-branch rules before enabling automatic repair landing. A lower
repair can still contain failures that later layers address, so requiring the
feature's all-green readiness check on every intermediate layer can intentionally
block the stack. The controller never relaxes such rules. Complete candidate
quality is required before landing, then full feature quality and human approval
are required before the final merge to `main`.

Keep human approval required even when enabling auto-merge. Do not grant repair
agents approval or bypass capabilities. CODEOWNERS can assign appropriate human
reviewers automatically.

## 3. Optional native auto-merge

The default behavior stops for human review and manual merge.

To have GitHub perform the merge **after human approval**:

1. Enable **Allow auto-merge** in repository Settings > General.
2. Configure the active branch ruleset described above.
3. Set repository variable `PR_ENABLE_AUTO_MERGE` to `true`.

The handoff checks the live PR revision and effective branch rules before enabling
native squash auto-merge. Missing approval/check requirements, bypass actors,
inaccessible policy information or API errors stop the handoff rather than falling
back to a direct merge. This automatic policy verification targets repository
rulesets; classic branch protection alone is not sufficient for this opt-in path.
Drafts remain drafts and do not get auto-merge enabled.

For repositories using merge queues instead, leave `PR_ENABLE_AUTO_MERGE` false.
Queue-specific `merge_group` validation is not implemented here; do not configure
a queue to require this PR-only check without adding that validation.
Repair-stack landing also stops if the feature branch requires a merge queue;
it never substitutes a direct merge for a queue requirement.

## 4. GitHub Actions and agent access

Allow the explicitly declared per-job token permissions. Ordinary code checks use
read-only repository credentials with checkout credential persistence disabled.
PR-code jobs do not restore or publish shared npm Actions caches. The separate
label writer checks out no code and needs both issue-write and PR-write access
to manage repository labels and attach them to pull requests.
The repair agent runs read-only; gh-aw's isolated safe-output job receives the
permissions needed to publish permitted fixes. No PAT or GitHub App credential is
required for chaining.
The repair validator only publishes scoped evidence on the candidate SHA.
Separate controller jobs register native stack metadata and perform guarded
asynchronous landing; neither checks out repair code with write credentials.
Enable Actions' ability to create pull requests; no automated approval is needed.
Native stack and asynchronous merge APIs must be available to the repository's
workflow token. Unsupported or inaccessible APIs stop explicitly, without a
legacy synchronous-merge fallback.

Keep controller artifacts available for the bounded cycle. `repair-state-<attempt>`
contains typed continuation state, not logs or secrets, and is retained for seven
days. A continuation pins the immutable artifact ID and checks its successful
controller job, producer run/attempt/workflow and feature/candidate identities.
Missing or expired state requires manual handling,
not reconstruction from labels or arbitrary open PRs.

Copilot inference must be available to the repository and support
`copilot-requests: write`. `GH_AW_AGENT_MODEL` selects a compatible model, defaulting
to `gpt-4.1`. Test compatibility before changing it; an available model is not
necessarily compatible with the installed CLI's tool protocol. HTTP 429 alone does
not identify which quota was exceeded.

Only same-repository feature PRs are automated. Do not switch to a privileged
`pull_request_target` checkout of untrusted code to support forks.

### App command contract

The application adapters install from the root `package-lock.json` and call
`lint:apps`, `build`, and `test:ci:apps`. Those scripts delegate required checks
to packages discovered by `workspaces: ["apps/*"]`. Independent framework CI runs
`lint:framework` and `test:framework` when its inputs change. Root `lint` and
`test:ci` remain aggregate developer commands. Each app must provide explicit commands,
dependencies, test-discovery configuration and coverage/no-tests policy.

Keep a single root lockfile. Put app source, tests, build/test configuration,
documentation, `dist` and `coverage` under the app directory. Root framework
tests and shared lint/format conventions are not part of the game. App dependency
repairs cannot alter workspace membership, scripts, configuration or framework
tests. Update the security adapter explicitly when introducing a new language.

## 5. Security services

Enable the dependency graph, dependency review entitlement, code security and
secret scanning/push protection appropriate for the repository. CodeQL produces
SARIF used by the gate; successful analysis alone is not an absence of findings.
Dependency Review needs a resolvable immutable base and head.

The separate secret check uses Super-Linter's Gitleaks validator only. This is not
a guarantee that no secret exists; repository secret scanning and push protection
remain complementary.
Keep native default CodeQL checks if required by organizational policy.

## 6. Variables

| Variable                       | Default   | Meaning                                                                      |
| ------------------------------ | --------- | ---------------------------------------------------------------------------- |
| `GH_AW_AGENT_MODEL`            | `gpt-4.1` | Compatible Copilot model                                                     |
| `CODEQL_MIN_SECURITY_SEVERITY` | `4.0`     | Failing SARIF security severity                                              |
| `PR_REVIEWERS`                 | empty     | Optional comma-separated human GitHub logins; must not include the PR author |
| `PR_ENABLE_AUTO_MERGE`         | `false`   | Opt in to policy-guarded native auto-merge                                   |

`MAX_REMEDIATION_ATTEMPTS` and `GH_AW_CI_TRIGGER_TOKEN` are no longer used.
`COVERAGE_THRESHOLD` is no longer a workflow variable: the project's test runner
owns its coverage threshold and no-tests policy. Check commands belong in the
project adapters, not a language-detection framework.

The pipeline's declared bound is six repairs per validation cycle, not a lifetime
branch-run counter. Manual dispatch or a new human event on the parent PR starts
a new cycle; unrecognized existing repairs still block duplicate creation.
Metadata repairs count toward the bound. Native stack landing and the final
parent validation preserve the accumulated budget. Agent runtime limits
additionally bound an individual attempt.

## 7. Acceptance criteria

Before enabling the ruleset for a production repository, exercise a disposable PR
with bad metadata, lint, tests, security findings and missing documentation. Verify:

- One agent handles one failing gate per round; every file fix, including lint,
  gets a separate repair PR. The first targets the feature; later layers target
  the preceding repair. Metadata-only changes get a parent audit comment.
- Scoped validation checks the selected gate and previously successful gates.
  Failed or skipped baseline gates remain unresolved until full revalidation.
- At two repairs, GitHub shows a real native stack with only repair PRs. Later
  layers append to that same stack; a single repair stays standalone.
- Only after all candidate gates pass does the asynchronous API land the repairs.
  Confirm a squash commit per repair and a parent comment linking each PR/commit,
  the original feature snapshot and baseline-to-final comparison. The feature PR
  must never be a member or merge as part of this operation.
- Failed/no-op agents and failed scoped checks stop; no seventh repair is dispatched.
- An open repair blocks duplicate creation. Human closure or merge restarts the
  parent pipeline; editing an open repair does not automatically resume it.
- A new commit gets fresh checks, while outdated results cannot certify it.
- Candidate checks cannot make the unmerged feature ready for review.
- Stale/foreign continuation artifacts, changed members, API failures and polling
  timeouts stop explicitly without rebuilding native stacks or resetting budgets.
- Documentation decisions are revision-scoped and cannot be waived by labels.
- Failure labels clear only after successful validation of the current parent head.
- All gates pass before readiness, and fresh human approval remains necessary.
- App-only PRs do not invoke the compiler or framework tests in CI, but still
  receive `Framework CI / Required`. Framework edits run compiler/regression
  checks once, outside the application pipeline, and require code-owner review.
- After token-authenticated repair landing, independent framework CI is dispatched
  on the actual feature head alongside application revalidation.
- With auto-merge enabled, GitHub merges only after both checks and approval pass.

Local compilation and regression tests do not replace this live acceptance run.
