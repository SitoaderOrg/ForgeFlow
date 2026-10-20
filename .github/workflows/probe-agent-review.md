---
name: 'Probe: agent requests and waits for Copilot review'
description: Temporary experiment. Can an agent request a Copilot review and see it within the same run?

on:
  workflow_dispatch:
    inputs:
      pr_number:
        description: "Pull request number"
        required: true
        type: string

engine:
  id: copilot
  model: ${{ vars.GH_AW_AGENT_MODEL || 'gpt-4.1' }}

permissions:
  contents: read
  pull-requests: read
  issues: read
  copilot-requests: write

tools:
  bash: true
  github:
    mode: "gh-proxy"

strict: true

features:
  copilot-requests: true

safe-outputs:
  add-reviewer:
    allowed-reviewers: [copilot]
    target: "*"
    max: 1
  add-comment:
    target: "*"
    max: 1
---

# Probe: request a Copilot review and wait for it

This is an experiment on pull request #${{ inputs.pr_number }} in ${{ github.repository }}. Follow these steps exactly.

1. Run `date -u +%FT%TZ` with bash and remember it as START.
2. Using the GitHub tools, list the reviews on pull request #${{ inputs.pr_number }} and count the reviews by `copilot-pull-request-reviewer` (or `Copilot`). Remember the count as BEFORE and the submitted_at time of the latest one.
3. Request a review from Copilot on pull request #${{ inputs.pr_number }} with the `add_reviewer` tool (reviewer `copilot`).
4. Wait for Copilot's new review: repeat up to 10 times — run `sleep 30` with bash, then list the reviews on the pull request again and count the Copilot reviews. Stop as soon as the count is greater than BEFORE. Also check whether Copilot appears in the pull request's requested reviewers.
5. Post one comment on pull request #${{ inputs.pr_number }} with the `add_comment` tool, titled "Probe result", stating: START, the time you stopped waiting, BEFORE, the final count, whether a new Copilot review appeared while you waited, and whether Copilot was ever listed as a requested reviewer during the wait.
