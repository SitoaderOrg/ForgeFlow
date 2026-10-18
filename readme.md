# Autonomous PR lifecycle

GitHub Actions owns validation and scheduling; GitHub Agentic Workflows (`gh-aw`)
provides bounded repairs. GitHub's native branch rules and optional auto-merge own
the final feature merge decision. Every automated file change, including lint,
gets a focused repair PR instead of a direct push. Repairs form a **GitHub-native
stack whose trunk is the feature branch**. The feature PR itself stays outside
that stack. There is no shared remediation script or label-driven dispatch relay.

## Lifecycle

1. A PR event starts validation on the **exact PR head commit**, rather than
   certifying the event's synthetic merge commit.
2. Reusable workflows verify compiled workflow consistency, metadata, lint, build,
   tests/coverage, security findings, dependency changes, secrets, and documentation.
3. One bounded repair agent handles **one failing gate per round**. Native gh-aw
   safe outputs create the first repair PR against the feature branch and each
   later repair against the previous repair's branch. Metadata-only repairs update
   the parent title/body with an audit comment; they do not invent a file change.
4. The controller checks repair identity, scope, and revision, then runs the
   selected gate and all previously successful project gates. After a scoped pass,
   it registers the native stack when the second repair exists, or appends a later
   layer. **It does not merge the repair yet.**
5. The full pipeline evaluates the cumulative candidate. Further failures produce
   another focused layer. When every candidate gate passes, GitHub's asynchronous
   merge API squash-merges the repair stack **only into the feature branch**.
   The parent comment links the pre-automation snapshot, each repair PR, its
   individual squash commit, and the baseline-to-final comparison.
6. All parent checks run again on the actual merged feature head. At most **six
   repair calls** are allowed across the cycle, including metadata repairs.
   Landing does not reset that budget. Failed scoped checks, no progress, changed
   snapshots, conflicting repairs and exhausted budgets stop rather than merge.
7. `PR Quality / Ready for review` passes only when every mandatory gate succeeds,
   the live head, base, and metadata match the validated snapshot, and no automated
   repair PR remains open against the feature branch.
8. The PR waits for human review. Optional native auto-merge can merge it **after**
   required human approval and checks; the agent never approves or force-merges it.

Native cascading merge is intentional **within the repair-only stack**. The feature
PR is never a member, so landing repairs cannot also land it into `main`. A single
repair remains an ordinary PR because GitHub requires at least two for a native
stack; it uses the same guarded asynchronous landing path.

Each repair retains a focused diff, discussion and revertable squash commit. The
feature PR's combined diff includes the landed repairs; `initial_head_sha` and
the audit links distinguish the pre-repair feature snapshot from added changes.
Already failing or unexecuted gates remain unresolved during scoped validation.
Only complete candidate validation permits landing, and only fresh parent
validation permits human-review readiness.

The original failing runs remain visible as diagnostics. A subsequent run validates
the repaired commit and publishes its own native checks; a successful agent job
never turns an earlier failed validation green.

## Why there is still a small dispatch step

Native `needs.<gate>.result` failures select the repair agent through reusable
`workflow_call` jobs. An explicit dispatch starts the next candidate or final
parent validation. `GITHUB_TOKEN`-generated label events do not
start workflows, and some PR events create approval-required runs. The lifecycle
does not depend on those events, a PAT, or a GitHub App credential.

Failure labels such as `test-required`, `docs-required`, and `security-failed`
mirror native check results for visibility. They do not trigger repairs, authorize
merges, or waive checks. A label clears only after its check succeeds on the current
parent head, not when an agent finishes or a repair merges.

Continuation carries a small typed state artifact by its immutable upload ID from
a successful trusted controller job in a verified prior attempt of this workflow.
An artifact from a code-check job cannot substitute for it. It records the feature snapshot, original head SHA, ordered
repair/check identities, native stack number and budget. It is not a log parser
or an agent-authored approval: missing, stale or foreign state fails closed.

Documentation is assessed for the revision under review, not accepted
merely because an unrelated Markdown file changed.
The agent decides both whether documentation is needed and whether it is sufficient,
without extension-based eligibility rules. Deterministic glue only verifies a valid,
current-revision response and blocks missing or uncertain assessments.

## Generic orchestration, project-owned checks

The lifecycle consumes reusable workflow results, not a universal language
detector or a shared test-report parser. Each repository supplies its own lint,
build, testing/coverage and security commands and policies. A failing command
fails its check natively; bounded log excerpts provide repair context, not the
source of truth for scheduling.

## Application workspaces

Applications live under `apps/<app>` and own their package metadata, dependencies,
source, tests, build/test configuration, documentation and generated output.
The root package is a private npm workspace coordinator, not the sample game.
Framework regression tests live in `tests/framework`; shared lint/format policy
and lifecycle workflows remain at the root.

Run these commands from the repository root:

| Command | Scope |
| --- | --- |
| `npm ci` | Install all workspaces from the single root lockfile |
| `npm run lint` | Framework lint, then every app's declared lint command |
| `npm run build` | Every app's declared build command |
| `npm run test:framework` | Lifecycle and guard regression tests only |
| `npm test` | Framework tests, then every app's tests |
| `npm run test:ci` | Framework tests, then every app's CI/coverage command |

To add another compatible app, create `apps/<app>/package.json` with a unique
name and explicit `lint`, `build`, `test`, and `test:ci` scripts, add its source,
tests and configuration, then run `npm install` at the root and commit the updated
root lockfile. The `apps/*` workspace declaration discovers
the app without changing the lifecycle YAML. Required commands are not run with
`--if-present`: missing app checks are failures, not silent successes.

Use `npm run dev --workspace=<app-name>` or
`npm run preview --workspace=<app-name>` to select a development server. The root
`dev`/`preview` convenience commands run workspace scripts sequentially; they are
not a multi-app parallel server launcher.

App test runners own coverage thresholds and no-tests behavior. Build and
coverage output stays inside each app, avoiding collisions. A different language
or security toolchain still needs an explicit check adapter; this is not universal
language detection. Framework tests and quality configuration stay protected from
automatic app repairs; dependency fixes may change versions, not workspace
membership, package scripts or gate policy.

## Workflow map

| File                                               | Responsibility                                                                        |
| -------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `pr-start.yml`                                     | PR event to immutable-head validation                                                 |
| `pr-pipeline.yml`                                  | Staged gates, scoped repair selection, bounded revalidation, required readiness check |
| `pr-gatekeeper.yml`, `pr-lint.yml`, `pr-build.yml` | Metadata, lint and build                                                              |
| `pr-test.yml`, `pr-security.yml`, `pr-docs.yml`    | Tests/coverage, security and documentation                                            |
| `pr-repair.md` / `.lock.yml`                       | Reusable repair agent and generated workflow                                          |
| `pr-validate-repair.yml`                           | Protected-scope checks and native scoped evidence on each new layer                   |
| `pr-register-repair-stack.yml`                     | Verified native stack creation and append, excluding the feature PR                   |
| `pr-land-repair-stack.yml`                         | Guarded asynchronous squash landing, postconditions and per-repair audit links        |
| `pr-status.yml`                                    | Current-revision native check results projected into failure labels                   |
| `pr-doc-review.md` / `.lock.yml`                   | Read-only semantic assessment with a typed, revision-bound artifact                   |
| `pr-review-dispatcher.yml`                         | Human-review handoff and opt-in native auto-merge                                     |
| `agentic-workflows-compilation.yml`                | Pinned, read-only compilation/drift verification                                      |

Workflow paths are relative to `.github/workflows/`. Markdown agent sources are
compiled using **gh-aw v0.89.21**; commit their generated lockfiles alongside them.
The compiler check never pushes workflow edits or opens another repair PR.

## Setup and operations

See [Prerequisites](prereqs.md) before deployment. In particular, a green check is
not a substitute for configuring an active branch ruleset requiring fresh human
approval and the exact `PR Quality / Ready for review` check, without bypass actors.

Manual validation starts a new bounded cycle:

```bash
gh workflow run pr-pipeline.yml --ref <feature-branch> -f pr_number=<number>
```

Automatic repair currently supports same-repository feature PRs. Fork PRs and
workflow-policy changes require maintainer handling; automation must not gain
privileged access by executing an untrusted fork.
An open failed repair blocks duplicate automatic repairs. Resolve or close it
before starting a new cycle; a human closing or merging a dependent bot repair
restarts parent validation, but does not adopt an unknown or changed chain.
Editing an open repair alone does not resume automation. Failed or partially
externally merged stacks remain intact for manual handling; the controller never
unregisters, recreates, rebases, force-pushes or deletes them to force progress.

## Documentation

- [Remediation and revalidation](docs/remediation-chaining.md)
- [Metadata](docs/pr-gatekeeper-and-validation.md)
- [Lint](docs/pr-lint-and-fixer.md) and [build](docs/pr-build.md)
- [Testing and coverage](docs/pr-test-and-generator.md)
- [Security](docs/pr-security-and-fixer.md)
- [Documentation assessment](docs/pr-docs-and-updater.md)
- [Human review and native merge](docs/pr-review-and-consolidation.md)
- [Workflow compilation](docs/agentic-workflows-compilation.md)

## Sample game

See the [Ferret Heist guide](apps/ferret-heist/README.md) for the sample application.
Project commands and coverage policy live in the project's configuration;
`tests/framework` covers the lifecycle's orchestration guards.

Deliberately failing game changes can exercise repair behavior, but they are not
exempt from the gates. A failed assertion or security finding must be resolved
before the feature is ready for human review.
