---
name: 'Probe: agentic Copilot review round'
description: Temporary experiment. Can one agentic workflow run a full Copilot review round on a PR?

on:
  workflow_dispatch:
    inputs:
      pr_number:
        description: "Pull request number"
        required: true
        type: string

concurrency:
  job-discriminator: ${{ github.run_id }}

engine:
  id: copilot
  model: ${{ vars.GH_AW_AGENT_MODEL || 'gpt-4.1' }}

permissions:
  contents: read
  pull-requests: read
  issues: read
  actions: read
  copilot-requests: write

tools:
  edit: true
  bash: true
  github:
    mode: "gh-proxy"

network:
  allowed:
    - defaults
    - node

strict: true

features:
  copilot-requests: true

safe-outputs:
  add-reviewer:
    allowed-reviewers: [copilot]
    target: "*"
    max: 1
  create-pull-request:
    title-prefix: "probe(review): "
    allowed-base-branches: ["*"]
    draft: true
    fallback-as-issue: false
  dispatch-workflow:
    workflows: [pipeline]
    max: 1
  add-comment:
    target: "*"
    max: 1
---

# Copilot review round for pull request #${{ inputs.pr_number }}

Pull request #${{ inputs.pr_number }} in ${{ github.repository }} has passed all of its automated quality gates and is ready for a Copilot code review.

## Goal

Take the pull request through one complete Copilot review round, end to end, in this run:

1. Get a fresh GitHub Copilot code review of the pull request.
2. Address every suggestion from that review in a single stacked pull request that targets the pull request's head branch.
3. Make sure the repository's quality gates (the `pipeline` workflow) run again on the result.

If Copilot's review has no suggestions, there is nothing to fix: skip the stacked pull request and the gate run.

## Report

Finish by posting one comment on pull request #${{ inputs.pr_number }} titled "Probe result" that states, with UTC timestamps, what you did for each goal, whether you actually saw Copilot's new review during this run, what it contained, and anything that prevented you from completing a goal.
