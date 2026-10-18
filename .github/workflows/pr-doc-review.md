---
name: PR Semantic Documentation Review
description: Decide whether a PR needs documentation and whether its existing documentation is sufficient.

on:
  workflow_call:
    inputs:
      pr_number:
        required: true
        type: string
      head_ref:
        required: true
        type: string
      head_sha:
        required: true
        type: string
      base_ref:
        required: true
        type: string
      base_sha:
        required: true
        type: string
      comparison_base_sha:
        description: Original feature base for reviewing a repair in full context.
        type: string
        default: ''
  roles: all

permissions:
  contents: read
  pull-requests: read
  copilot-requests: write

strict: true
timeout-minutes: 8
max-turns: 20
max-ai-credits: 20
max-turn-cache-misses: 3

engine:
  id: copilot
  model: ${{ vars.GH_AW_AGENT_MODEL || 'gpt-4.1' }}
  max-continuations: 1
  concurrency:
    group: gh-aw-copilot-remediation-agents
    queue: max
  harness:
    max-retries: 1
    initial-delay-ms: 5000
    backoff-multiplier: 1
    max-delay-ms: 5000

features:
  copilot-requests: true

checkout:
  ref: ${{ inputs.head_sha }}
  path: .
  fetch-depth: 0

tools:
  edit: false
  github: false
  bash:
    - 'pwd'
    - 'ls *'
    - 'cat *'
    - 'head *'
    - 'sed *'
    - 'rg *'
    - 'test *'
    - 'git diff *'
    - 'git ls-files *'
    - 'git show *'
    - 'git rev-parse *'

network:
  allowed:
    - defaults

pre-agent-steps:
  - name: Prepare the exact PR diff
    env:
      GH_TOKEN: ${{ github.token }}
      PR_NUMBER: ${{ inputs.pr_number }}
      EXPECTED_HEAD_REF: ${{ inputs.head_ref }}
      EXPECTED_HEAD_SHA: ${{ inputs.head_sha }}
      EXPECTED_BASE_REF: ${{ inputs.base_ref }}
      EXPECTED_BASE_SHA: ${{ inputs.base_sha }}
      COMPARISON_BASE_SHA: ${{ inputs.comparison_base_sha || inputs.base_sha }}
    run: |
      set -euo pipefail
      [[ "$PR_NUMBER" =~ ^[1-9][0-9]*$ ]]
      [[ "$EXPECTED_HEAD_SHA" =~ ^[0-9a-f]{40}$ && "$EXPECTED_BASE_SHA" =~ ^[0-9a-f]{40}$ ]]
      [[ "$COMPARISON_BASE_SHA" =~ ^[0-9a-f]{40}$ ]]
      git check-ref-format "refs/heads/$EXPECTED_HEAD_REF"
      git check-ref-format "refs/heads/$EXPECTED_BASE_REF"
      cd "$GITHUB_WORKSPACE"
      timeout 30s gh api "repos/$GITHUB_REPOSITORY/pulls/$PR_NUMBER" |
      jq -e --arg repo "$GITHUB_REPOSITORY" --arg head "$EXPECTED_HEAD_SHA" \
        --arg branch "$EXPECTED_HEAD_REF" --arg base "$EXPECTED_BASE_SHA" \
        --arg base_ref "$EXPECTED_BASE_REF" \
        '.state == "open" and .head.repo.full_name == $repo and .base.repo.full_name == $repo
         and .head.sha == $head and .head.ref == $branch
         and .base.sha == $base and .base.ref == $base_ref' >/dev/null
      git rev-parse HEAD | grep -Fx "$EXPECTED_HEAD_SHA"
      git cat-file -e "$EXPECTED_BASE_SHA^{commit}"
      git cat-file -e "$COMPARISON_BASE_SHA^{commit}"
      mkdir -p "$GITHUB_WORKSPACE/.git/gh-aw-doc-review"
      git diff --name-only -z "$COMPARISON_BASE_SHA...$EXPECTED_HEAD_SHA" |
        jq -Rs 'split("\u0000") | map(select(length > 0))' \
        > "$GITHUB_WORKSPACE/.git/gh-aw-doc-review/changed-files.json"
      printf 'Absolute review workspace: %s\n' "$GITHUB_WORKSPACE"

jobs:
  agent:
    timeout-minutes: 15
  detection:
    timeout-minutes: 5
  conclusion:
    permissions:
      actions: read
      contents: read
    pre-steps:
      - name: Require an explicit assessment
        if: always()
        env:
          AGENT_RESULT: ${{ needs.agent.result }}
          DETECTION_RESULT: ${{ needs.detection.result }}
          ASSESSMENT_RESULT: ${{ needs.docs_assessment.result }}
        run: |
          set -euo pipefail
          [[ "$AGENT_RESULT" == success && "$DETECTION_RESULT" == success && "$ASSESSMENT_RESULT" == success ]]

safe-outputs:
  github-token: ${{ secrets.GITHUB_TOKEN }}
  activation-comments: false
  report-failure-as-issue: false
  report-failed-jobs: false
  missing-data: false
  missing-tool: false
  report-incomplete: false
  noop: false
  timeout-minutes: 5
  threat-detection:
    model: ${{ vars.GH_AW_AGENT_MODEL || 'gpt-4.1' }}
    max-turns: 4
    retries: 0
    engine-timeout: 90s
    max-ai-credits: 5
    continue-on-error: false
    report-as-issue: false
  jobs:
    docs_assessment:
      name: Record the agent's documentation decision
      description: Publish exactly one explicit decision for the reviewed revision.
      max: 1
      permissions:
        contents: read
        pull-requests: read
      inputs:
        head_sha:
          description: Exact assessed PR head SHA.
          type: string
          required: true
        base_sha:
          description: Exact assessed base SHA.
          type: string
          required: true
        decision:
          description: Whether docs are unnecessary, already sufficient, missing, or uncertain.
          type: choice
          options: [not_needed, sufficient, missing, uncertain]
          required: true
        findings:
          description: Evidence-based explanation and, if needed, specific documentation changes; at most 6000 characters.
          type: string
          required: true
      steps:
        - name: Bind the decision to the reviewed PR revision
          timeout-minutes: 2
          env:
            GH_TOKEN: ${{ github.token }}
            PR_NUMBER: ${{ inputs.pr_number }}
            EXPECTED_HEAD_REF: ${{ inputs.head_ref }}
            EXPECTED_HEAD_SHA: ${{ inputs.head_sha }}
            EXPECTED_BASE_REF: ${{ inputs.base_ref }}
            EXPECTED_BASE_SHA: ${{ inputs.base_sha }}
            COMPARISON_BASE_SHA: ${{ inputs.comparison_base_sha || inputs.base_sha }}
          run: |
            set -euo pipefail
            timeout 30s gh api "repos/$GITHUB_REPOSITORY/pulls/$PR_NUMBER" |
            jq -e --arg repo "$GITHUB_REPOSITORY" --arg head "$EXPECTED_HEAD_SHA" \
              --arg branch "$EXPECTED_HEAD_REF" --arg base "$EXPECTED_BASE_SHA" \
              --arg base_ref "$EXPECTED_BASE_REF" \
              '.state == "open" and .head.repo.full_name == $repo and .base.repo.full_name == $repo
               and .head.sha == $head and .head.ref == $branch
               and .base.sha == $base and .base.ref == $base_ref' >/dev/null
            jq -e --arg head "$EXPECTED_HEAD_SHA" --arg base "$EXPECTED_BASE_SHA" \
              --arg comparison "$COMPARISON_BASE_SHA" --arg pr "$PR_NUMBER" '
              if (.errors | type == "array" and length == 0)
                and (.items | type == "array" and length == 1)
                and .items[0].type == "docs_assessment"
              then .items[0] else error("Exactly one explicit docs_assessment is required") end
              | if .head_sha == $head and .base_sha == $base
                and (.decision == "not_needed" or .decision == "sufficient" or .decision == "missing" or .decision == "uncertain")
                and (.findings | type == "string" and length > 0 and length <= 6000 and test("\\S"))
              then {version: 2, pr_number: $pr, head_sha: $head, base_sha: $base, comparison_base_sha: $comparison, decision, findings}
              else error("Invalid, empty, or stale documentation decision") end
            ' "$GH_AW_AGENT_OUTPUT" > assessment.json
        - name: Upload the revision-bound decision
          timeout-minutes: 2
          uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a
          with:
            name: pr-doc-assessment-${{ inputs.head_sha }}-${{ inputs.base_sha }}
            path: assessment.json
            if-no-files-found: error
            retention-days: 7
---

# Decide documentation need and sufficiency

Review PR #${{ inputs.pr_number }} at `${{ inputs.head_sha }}` against
`${{ inputs.comparison_base_sha || inputs.base_sha }}`. For a repair PR this is
the original feature base, so assess the feature plus its repair, not just the
new documentation diff. The PR's immediate base is `${{ inputs.base_sha }}`.
You decide whether the change needs documentation and
whether the documentation already present accurately covers it.

Start at `${{ github.workspace }}`. Read `.git/gh-aw-doc-review/changed-files.json`
and a diff summary, then inspect focused hunks and relevant existing documentation.
The changed-file list is not filtered by file extension or directory. Decide what
matters semantically; do not require documentation merely because code changed,
and do not declare it sufficient merely because Markdown changed.

Consider public behavior, APIs, configuration, architecture, workflow semantics,
breaking changes and non-obvious operational constraints. Tests, generated files,
formatting, deletions and documentation-only changes may or may not need a docs
update; judge the actual change. Existing unchanged documentation can be sufficient.
Group related changes instead of producing a checklist for every file.

Application documentation belongs with the application. Root `readme.md` and
`docs/` describe this CI framework; inspect them only when relevant to the diff.
Use `git ls-files` to verify paths and `git show <base_sha>:<path>` for deleted
files. Never read repository files as `/readme.md` or `/docs/...`. After a failed
path read, allow one corrected attempt; otherwise report uncertainty instead of
repeating the lookup. Do not read full generated lockfiles when their source
workflow and a diff summary provide the necessary context.

Return one `docs_assessment` with the exact head/base SHAs, a concise evidence-based
`findings` explanation, and one decision:

- `not_needed`: the change does not require a documentation update; explain why.
- `sufficient`: documentation is needed and the existing docs already cover it;
  name the relevant documents and behavior you checked.
- `missing`: documentation is needed but absent or inaccurate; identify the
  expected location and specific missing content for the repair agent.
- `uncertain`: you cannot establish need or sufficiency within the available
  evidence or runtime budget; explain the blocker.

Do not edit files, change GitHub metadata, waive gates with labels, approve, merge,
push or dispatch. Do not execute application code or install dependencies.
Do not use `noop` as a substitute for a decision. Runtime limits are 20 model
turns, eight minutes and 20 AI credits, with one five-second retry.

The small safe-output job checks only response validity and revision identity,
not documentation policy. It publishes `assessment.json` in
`pr-doc-assessment-${{ inputs.head_sha }}-${{ inputs.base_sha }}`. The caller maps
`not_needed`/`sufficient` to success and `missing`/`uncertain` to failure.
The artifact is needed because gh-aw v0.89.21 does not expose custom reusable
workflow outputs; it is not a deterministic documentation-presence heuristic.
