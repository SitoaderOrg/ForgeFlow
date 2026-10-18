# Independent Framework CI

[`agentic-workflows-compilation.yml`](../.github/workflows/agentic-workflows-compilation.yml)
is the maintainer-owned **Framework CI** workflow. It is not called as an
application pipeline stage. Its single native job is named exactly
**`Framework CI / Required`**.

GitHub Agentic Workflows stores authored instructions in
`.github/workflows/*.md` and executable generated workflows in corresponding
`*.lock.yml` files. CI verifies their consistency; it never publishes a
replacement workflow, pushes a fix, or invokes an inference agent.

## Independent merge requirements

Require both checks on `main`, with GitHub Actions as their expected source:

- `PR Quality / Ready for review`: all six application gates, the current
  feature snapshot, and no pending repair chain.
- `Framework CI / Required`: applicable framework compilation and regression
  checks, or an explicit not-needed result for an app-only change.

Also require fresh human approval, code-owner review for owned paths, strict
up-to-date checks, and no bypass actors. The optional native auto-merge handoff
verifies these requirements; it does not create or weaken repository rules.

A framework failure does not stop independent application checks or select an
app repair agent. It still blocks merging through its own required check.
App readiness is therefore not a claim that every repository merge requirement
has passed.

The workflow intentionally has **no PR-level path filter**. Every PR gets a
result, so app-only changes are not stuck waiting for an absent required check.
Only the expensive steps are conditional. There is no second compilation call
inside `pr-pipeline.yml`.

## Revision-bound execution

Framework CI runs on PR events, pushes to `main`, and explicit dispatches.
For a PR, it captures the head and base SHAs and checks out the head, not the
synthetic merge commit. A dispatched run must use the current same-repository
PR head branch and SHA. Stale events, malformed inputs and API errors fail.
After successful checks it rechecks live PR head/base identities.

PR change classification uses the full `base...head` diff. Pushes compare their
before/after snapshots; an initial push inspects its complete tree. Git errors
fail rather than being interpreted as no changes. NUL-delimited paths and
disabled rename detection ensure renamed/deleted inputs are not missed.

| Changed inputs | Compiler | Framework lint/tests |
| --- | --- | --- |
| `.github/**` or `.gitattributes` | Yes | Yes |
| `tests/framework/**`, root package/lockfile, root test/lint/format/tooling configuration | No | Yes |
| App source/tests/configuration or ordinary documentation only | No | No |

Keep compiler inputs and shared workflow imports under `.github` so source,
generated lockfiles, `.github/aw/actions-lock.json`, compiler pins, and shared
instructions share the protected/classified boundary. An import outside that
boundary requires extending both classification and ownership in the same
maintainer-reviewed change.

Root lockfile changes can affect framework tooling even when motivated by an
app dependency update, so they run framework regression checks. Root aggregate
developer commands still check both framework and apps locally. CI separates
them: application adapters use `lint:apps` and `test:ci:apps`, whereas framework
CI uses `lint:framework` and `test:framework`.

## Compilation and regression checks

When compilation inputs change, CI installs **gh-aw `v0.89.21`**, runs
`gh aw compile --validate --purge`, and rejects tracked drift under `.github`
or untracked generated outputs. `--purge` also detects obsolete lockfiles left
behind after deleting an agent source.

Commit verified action resolutions in `.github/aw/actions-lock.json` alongside
the generated workflows. Different GitHub API access locally and in CI can
otherwise leave a version tag in one environment but resolve it to a commit
SHA in the other. The setup-action release is pinned in this cache to keep
generation consistent; drift verification remains enabled.

Framework regression checks install the shared root lockfile with
`npm ci --ignore-scripts`, then run framework lint and tests. All jobs use
read-only repository permissions and disable persisted checkout credentials.
They do not restore or publish shared npm Actions caches from PR code execution.
App-only changes do not install the compiler or framework dependencies.

Code owners must correct framework failures. Automatic app repairs remain
prohibited from changing workflow policy, framework tests, or quality settings.
The old `workflow-compilation-failed` app label is retired; framework status is
its native check. Remove an old label during rollout only after confirming the
independent framework result.

## Ownership and deployment

`.github/CODEOWNERS` assigns framework inputs, shared tooling, and framework
documentation to `@sitoader`. It protects the owner file itself as well.
Code owners need repository write access, and branch rules must require their
review. CODEOWNERS does not prevent developers from proposing file edits and
does not by itself make unreviewed PR code trusted.

Deploy the reviewed framework workflow and owner file to `main` before relying
on them for new feature PRs. GitHub uses the base branch's CODEOWNERS file.
Wait for the new check to appear before adding its exact name to required
checks. Ensure eligible reviewers are available; authors cannot approve their
own PRs. See [Prerequisites](../prereqs.md) for the complete rollout policy.

After token-authenticated repair-stack landing, PR events may not fire. The
existing continuation controller therefore dispatches independent framework CI
on the actual updated feature head alongside application revalidation.
Candidate-only and metadata-only continuations do not duplicate framework
checks on the unchanged feature revision. A dispatch failure is explicit, not
a fallback to a successful or skipped framework verdict.

## Compile locally

```shell
gh extension install github/gh-aw --pin v0.89.21
gh aw version
gh aw compile --validate --purge
git diff -- .github
npm run lint:framework
npm run test:framework
```

Review generated additions and deletions and commit them with their source
changes. Use the pinned compiler; do not hand-edit lockfiles or suppress drift.
Compilation validates generated workflow consistency, not production permissions,
security-service availability, agent execution or branch-rule enforcement.

The installed compiler's reusable-workflow interface remains unchanged:
native PR creation outputs identify repairs, and the documentation reviewer
uses its typed revision-bound assessment artifact. Separating framework CI does
not alter repair ownership, native-stack ordering, agent budgets, or the human
approval boundary. Live lifecycle acceptance is still required after deployment.
