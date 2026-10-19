---
# Deterministic hand-off to the remediation relay, shared by every remediation agent.
#
# GitHub never starts workflow runs for pushes, labels or pull requests created with
# GITHUB_TOKEN, so the relay (pr-stacked-merge.yml) has to be dispatched. The generated
# `conclusion` job runs after the agent and its safe outputs whatever their result, so this
# step always hands off, whether the agent repaired something, changed nothing or crashed
# (HTTP 429, timeout, sandbox error). `agent_result` tells the relay which case it is:
#   success      the agent applied a repair (stacked PR, PR metadata edit or decision label):
#                the relay merges it and re-checks the repaired gate;
#   no-changes   the agent finished without applying a repair;
#   <other>      the agent or its safe outputs did not succeed (failure, cancelled, skipped).
# In the last two cases nothing changed, so the relay re-checks nothing and publishes the
# verdict: the gate that dispatched the agent still fails, so pr-quality fails fast with an
# error comment (or stays pending while other agents are still repairing the PR).
jobs:
  conclusion:
    # Dispatching the relay needs actions: write (gh-aw grants read by default).
    permissions:
      actions: write
    pre-steps:
      - name: Hand off to the remediation relay
        if: github.ref_name != github.event.repository.default_branch
        continue-on-error: true
        uses: actions/github-script@v9
        env:
          BRANCH: ${{ github.ref_name }}
          SOURCE: ${{ github.workflow }} (run ${{ github.run_id }})
          AGENT_RESULT: ${{ needs.agent.result }}
          SAFE_OUTPUTS_RESULT: ${{ needs.safe_outputs.result }}
          OUTPUT_TYPES: ${{ needs.agent.outputs.output_types }}
        with:
          script: |
            const REPAIRS = ['create_pull_request', 'update_pull_request', 'add_labels'];
            const { AGENT_RESULT, SAFE_OUTPUTS_RESULT, OUTPUT_TYPES, BRANCH, SOURCE } = process.env;
            const applied = (OUTPUT_TYPES || '').split(',').map((t) => t.trim());
            let result = 'success';
            if (AGENT_RESULT !== 'success') result = AGENT_RESULT || 'skipped';
            else if (!applied.some((t) => REPAIRS.includes(t))) result = 'no-changes';
            else if (SAFE_OUTPUTS_RESULT !== 'success') result = `safe-outputs-${SAFE_OUTPUTS_RESULT || 'skipped'}`;
            await github.rest.actions.createWorkflowDispatch({
              owner: context.repo.owner,
              repo: context.repo.repo,
              workflow_id: 'pr-stacked-merge.yml',
              ref: context.payload.repository.default_branch,
              inputs: { branch: BRANCH, agent_result: result, source: SOURCE }
            });
            core.notice(`Handed off to the remediation relay for ${BRANCH} (agent_result: ${result}).`);
---