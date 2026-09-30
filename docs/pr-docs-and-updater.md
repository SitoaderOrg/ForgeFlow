# Step 6: Documentation Drift & Autonomous Documentation Updater

This module prevents documentation drift by detecting significant source code modifications made without corresponding documentation updates, and autonomously drafting missing guides and API references in a stacked PR.

---

## Architecture Overview

```mermaid
flowchart TD
    PR[PR Created / Synchronized] --> DocGate[Documentation Gatekeeper\n.github/workflows/pr-docs.yml]
    
    DocGate --> CheckDrift{Detect Documentation Drift\n(>=30 source lines added without doc updates?)}

    CheckDrift -->|❌ Drift Detected| AddLabel[Apply 'docs-required' Label\nFail Fast / Halt Pipeline]
    CheckDrift -->|✅ Docs Present / Minor Change| ClearLabel[Clear 'docs-required' Label\nProceed to Next CI Gate]

    AddLabel --> DocAgent[Autonomous Doc Updater\n.github/workflows/pr-doc-updater.md]
    DocAgent --> Analyze[Analyze PR Diff & Public API Changes]
    DocAgent --> AuthorDocs[Draft Usage Examples & API Docs in Markdown]
    DocAgent --> StackedPR[Open Batched Stacked PR\nTargeting author's feature branch]

    StackedPR --> DevReview([Developer Reviews & Merges Stacked PR])
    DevReview --> Recheck([Feature Branch Updated & Checks Re-evaluated])
    Recheck -->|✅ Passed| ClearLabel
```

---

## 1. Deterministic Documentation Gate (`.github/workflows/pr-docs.yml`)

The deterministic runner verifies documentation drift:

- **Drift Detection**:
  - Compares source code changes (`.ts`, `.js`, `.py`, `.go`, etc.) against documentation changes (`.md`, `docs/`, `README`).
  - If a pull request adds or alters substantial business logic (≥ 30 added lines across source files) without modifying any documentation files, the gate flags **documentation drift**.
  - Attaches `docs-required` to signal that documentation is required.
  - Automatically clears `docs-required` once documentation is added.

---

## 2. Autonomous Documentation Updater (`.github/workflows/pr-doc-updater.md`)

When a PR introduces new or modified logic without docs, this GitHub Agentic Workflow drafts documentation:

### Workflow Capabilities:
1. **Analyze Diff & Public APIs**: Identifies newly added functions, exported types, configuration options, or CLI flags.
2. **Discover Existing Structure**: Discovers project documentation style in `README.md` or `docs/`.
3. **Draft Idiomatic Markdown**:
   - Usage examples and runnable snippets.
   - Parameter tables and return type contracts.
   - Behavior and architecture descriptions.
4. **🔒 Strict Guardrail: Documentation Files Only**:
   - The agent is **strictly prohibited from touching application code, business logic, tests, or build configuration**.
   - It only authors or modifies Markdown documentation files.
5. **Stacked Pull Request**:
   - Generates all documentation changes in a single stacked pull request targeting the author's feature branch.
   - Leaves a comment on the parent PR directing the author to review and merge the doc updates.
