# Step 5: Build Verification & Autonomous Documentation Updater

This module ensures code compiles cleanly across ecosystems and prevents documentation drift by autonomously drafting missing guides and API references when new functionality is added.

---

## Architecture Overview

```mermaid
flowchart TD
    PR[PR Created / Synchronized] --> BuildDocGate[1. Build & Doc Gatekeeper\n.github/workflows/pr-build-and-docs.yml]
    
    subgraph GatekeeperChecks [Deterministic Gatekeeper]
        BuildDocGate --> CheckBuild{Compile & Build Project\n(tsc, go build, cargo check, etc.)}
        BuildDocGate --> CheckDrift{Detect Documentation Drift\n(Significant logic added without docs?)}
    end

    CheckBuild -->|❌ Build Fails| LabelBuild[Apply 'build-failed' Label\nFail Fast / Halt Pipeline]
    CheckDrift -->|❌ Docs Missing| LabelDocs[Apply 'docs-required' Label\nFail Fast / Halt Pipeline]

    CheckBuild -->|✅ Builds Cleanly| PassBuild[Build Pass]
    CheckDrift -->|✅ Docs Present / Minor Change| PassDocs[Docs Pass]

    PassBuild & PassDocs --> ClearLabels[Clear 'build-failed' & 'docs-required' Labels\nProceed to Next CI Gate]

    LabelDocs --> DocAgent[2. Autonomous Doc Updater\n.github/workflows/pr-doc-updater.md]
    DocAgent --> Analyze[Analyze PR Diff & Changed Signatures]
    DocAgent --> AuthorDocs[Draft Usage Examples & API Docs in Markdown]
    DocAgent --> StackedPR[Open Batched Stacked PR\nTargeting author's feature branch]

    StackedPR --> DevReview([Developer Reviews & Merges Stacked PR])
    DevReview --> Recheck([Feature Branch Updated & Checks Re-evaluated])
    Recheck -->|✅ Passed| ClearLabels
```

---

## 1. Deterministic Gatekeeper (`.github/workflows/pr-build-and-docs.yml`)

The deterministic runner verifies compilation integrity and checks for documentation drift:

- **Polyglot Build Verification**:
  - **Node.js / TypeScript**: Runs `npm run build` or `npx tsc --noEmit`.
  - **Go**: Runs `go build -v ./...`.
  - **Rust**: Runs `cargo check`.
  - **Java / Kotlin**: Runs `./mvnw compile` or `./gradlew classes`.
  - **C# / .NET**: Runs `dotnet build -c Release`.
  - **Fail-Fast**: If project compilation fails, attaches `build-failed` and halts downstream progression.

- **Documentation Drift Detection**:
  - Compares source code changes (`.ts`, `.js`, `.py`, `.go`, etc.) against documentation changes (`.md`, `docs/`, `README`).
  - If a pull request adds or alters substantial business logic without touching documentation files, the gate flags **documentation drift**.
  - Attaches `docs-required` to signal that documentation is required.
  - Automatically clears both labels once the build passes and documentation is present.

---

## 2. Autonomous Documentation Updater (`.github/workflows/pr-doc-updater.md`)

When a PR introduces new or modified logic without docs, this GitHub Agentic Workflow triages the change and drafts documentation:

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
