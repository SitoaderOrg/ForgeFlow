# Getting Started with GitHub Agentic Workflows (`gh-aw`)

Follow these steps to create and run an agentic workflow in your repository:

---

### Step 1: Open Your Coding Agent
Open an AI coding agent in the context of your repository (such as **VS Code Agent Mode**, **GitHub Copilot CLI**, or any repository-aware agent).

---

### Step 2: Prompt the Agent to Design the Workflow
Send the following prompt to your coding agent:

> *Create a workflow for GitHub Agentic Workflows using https://raw.githubusercontent.com/github/gh-aw/main/create.md*  
> *The purpose of the workflow is: [describe your task, e.g., "A daily report on recent repository activity delivered as an issue"].*

Replace the purpose with your specific requirements, context, goals, and guardrails.

The agent will generate the workflow file at:
```text
.github/workflows/<workflow-name>.md
```

---

### Step 3: Configure Engine & Authentication
Set up your AI engine in the workflow's frontmatter:
- **Default Engine:** GitHub Copilot (requires no extra configuration).
- **Other Engines:** Set `engine:` (e.g., `claude`, `openai`, `gemini`) and configure the required API key secret under **Settings → Secrets and variables → Actions**.

---

### Step 4: Compile & Lock the Workflow
Compile the Markdown workflow into an executable GitHub Actions workflow:
```bash
gh aw compile
```
This generates the lockfile:
```text
.github/workflows/<workflow-name>.lock.yml
```

---

### Step 5: Commit and Push
Ensure `.gitattributes` contains:
```text
.github/workflows/*.lock.yml linguist-generated=true
```

Commit and push both the `.md` and `.lock.yml` files, or create a pull request:
```bash
git add .gitattributes .github/workflows/<workflow-name>.md .github/workflows/<workflow-name>.lock.yml
git commit -m "Add agentic workflow"
git push
```
