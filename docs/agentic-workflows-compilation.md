# Pinned Agentic Workflow Compilation

GitHub Agentic Workflows stores human-authored source in
`.github/workflows/*.md` and generated Actions workflows in corresponding
`*.lock.yml` files. GitHub runs the generated workflow, so a Markdown-only change
does not update runtime behavior until the matching lockfile is compiled and
committed.

This repository pins the compiler to **gh-aw `v0.89.21`**.

## Read-only CI verification

[`agentic-workflows-compilation.yml`](../.github/workflows/agentic-workflows-compilation.yml)
runs on pull requests and pushes to `main` that change paths under
`.github/workflows/**`, and is also callable through `workflow_call`.
The path filter includes lockfiles and ordinary workflow YAML, not just
agent source Markdown.

The native PR pipeline calls this workflow **before metadata**, supplying the
immutable `head_sha` and comparison `base_sha`. Candidate runs inspect the full
feature-plus-repairs change against the captured root base, not only the newest
layer. Compilation is required both for an all-green candidate and for fresh
actual-parent readiness after landing; candidate results cannot certify an
unmerged feature PR.

The workflow:

1. Checks out the supplied immutable head (or `github.sha` for standalone
   execution), with full history and without persisting checkout credentials.
2. Inspects `base_sha...head_sha` for changes under `.github/workflows`. If none
   exist, the job succeeds without installing or running the compiler. A diff
   error fails; it is not treated as "no changes." Without a supplied base SHA,
   compilation is required.
3. When workflow changes require it, installs the exact compiler with
   `gh extension install github/gh-aw --pin v0.89.21`.
4. Runs `gh aw compile --validate --purge`.
5. Fails on tracked drift under `.github/workflows` or untracked generated
   `*.lock.yml` files.

The native **`PR Quality / Ready for review`** aggregate requires compilation
plus all six quality gates to succeed. A compilation failure blocks both
downstream metadata validation and automatic repair agents, because workflow
policy changes require human correction. Skipping unnecessary compiler steps
after a successful diff check is not the same as skipping this required job.

It uses **`contents: read`**, not branch-writing permissions. Compilation may
write generated files in the runner checkout for comparison, but CI does not
push them, create a repair branch/PR, assign a reviewer, or add labels.
There is no curl-based installer or automatic compiler upgrade.

`--validate` requests compiler validation; `--purge` removes obsolete compiled
outputs for removed workflow sources. This matters when migrating from the seven
specialized remediation agents to the callable
[`pr-repair.md`](../.github/workflows/pr-repair.md) workflow and its lockfile.
Generated files should be regenerated rather than manually patched.

In `v0.89.21`, gh-aw frontmatter does not support arbitrary
`on.workflow_call.outputs`. The lifecycle consumes the compiler-provided native
PR-creation output as the authoritative identity of a code/docs repair PR.
It does not infer that identity from labels or free-form agent text, nor use
direct parent-branch push outputs to authorize repair merges. Metadata-only
updates are verified against live parent metadata without creating an empty PR.
Do not hand-edit the lockfile to invent a custom interface. This compiler
limitation is distinct from the
ordinary reusable Actions gates' supported `findings`/`repair_kind` outputs.

The intended repair-only stack controller keeps the feature PR targeting `main`
outside the stack and uses feature as trunk. The first repair targets feature;
later repairs target the preceding repair branch. After scoped identity,
protected-path, and selected-plus-previously-green gate validation, planned
`pr-register-repair-stack.yml` registers native metadata at two PRs or appends
later layers. It does not merge; one repair remains ordinary. The agent publishes
the next PR only, never native stack metadata or landing operations. All
automated file repairs, including lint and formatting, require a separate PR.
Compilation remains a read-only verifier, not a direct-push exception.

The controller selects a repairable native `needs.<gate>.result == 'failure'`
and calls the repair workflow through `workflow_call`; failure labels are only
a view. Bounded explicit dispatch starts the next candidate or feature
validation, retaining native run/attempt and candidate identity.

Continuation uses a small typed artifact from a verified prior attempt of the
same workflow: root snapshot, ordered repair entries/check IDs, native stack
number, round, and the cycle-start **`initial_head_sha`**, which never changes
when landing advances the current root head. This is controller state, not logs or the documentation
agent's decision artifact. Missing or unverified state stops rather than
reconstructing ownership from PR lists.

Only a new all-green full-candidate run permits planned
`pr-land-repair-stack.yml` to pin the top, verify every root/member snapshot,
order, and feature target, and use guarded asynchronous squash landing. This
also applies to a single ordinary repair. Confirm every repair's squash SHA,
link each PR and per-layer SHA on feature alongside the initial baseline and
baseline-to-final comparison, and rerun compilation and all parent gates on
the actual updated feature head. Six repair calls total include metadata;
landing does not reset the budget. Branch rules stay enforced, merge queues are
blocked, and changed snapshots/errors require manual handling without deleting,
unstacking, recreating, rebasing, or force-pushing existing repairs.

The installed compiler also lacks a standalone native `set-output` capability.
The read-only `pr-doc-review.md` evaluator therefore uses a typed custom safe-output
job and a validated version-2 artifact as minimal integration glue. The consuming `pr-docs.yml` gate
validates the response schema, fresh identity SHAs, and effective comparison
base, then maps the agent's decision
(`not_needed`/`sufficient` pass; `missing`/`uncertain` fail). It does not expect a custom
`outputs.assessment` field. See the
[assessment contract](pr-docs-and-updater.md#implemented-evaluator-and-artifact-contract).

## Compile locally

Install the pinned version if the extension is not already installed:

```shell
gh extension install github/gh-aw --pin v0.89.21
gh aw version
gh aw compile --validate --purge
git diff -- .github/workflows
git ls-files --others --exclude-standard -- ".github/workflows/*.lock.yml"
```

If a different compiler version is installed, switch to the pinned version
before generating lockfiles. Review both additions and deletions, then include
the source changes and generated outputs in the same reviewed change.

The commands operate from the repository root. Compilation failure or drift is
resolved locally by the contributor; CI deliberately fails rather than applying
an unreviewed fix. Re-running the pinned compiler should leave no tracked drift
or unexpected untracked lockfiles.

## Runtime and deployment boundaries

Successful compilation checks the compiler's supported schema and generated
output. It does not prove that repository permissions, agent access, security
features, branch rules, or auto-merge have been configured in production.
Nor is a compiled agent's successful execution a substitute for native gate
results at the current PR revision.

See [native validation and repair](remediation-chaining.md),
[documentation assessment](pr-docs-and-updater.md), and
[review policy and administrative boundaries](pr-review-and-consolidation.md).
