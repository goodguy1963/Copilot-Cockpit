# Integrations

## Execution Providers

Copilot Cockpit supports three scheduled execution providers from the same workspace settings surface:

- `GitHub Copilot Chat`
- `OpenAI Codex CLI`
- `OpenCode CLI`

The setting that chooses between them is the workspace `taskExecutionProvider` value exposed in `Settings` as `Task execution provider`.

This split matters:

- `GitHub Copilot Chat` is a native VS Code chat integration.
- `Codex` is an external CLI integration.
- `OpenCode` is an external CLI integration.

Cockpit does not host models for any of them. It is the control layer around those execution surfaces.

## Shared Defaults And Provider-Specific Behavior

The `Settings` tab exposes one shared execution-defaults form with three values:

- `Task execution provider`
- `Default agent`
- `Default model`

Those shared defaults do not map identically to every provider.

### GitHub Copilot Chat

- Uses the native VS Code chat execution harness.
- Uses Cockpit `defaultModel` when the active VS Code chat environment exposes that model choice.
- Uses Cockpit `defaultAgent` through the same chat/customization surface.
- This is the only provider that runs through the editor's native chat UI flow.

### OpenAI Codex CLI

- Runs scheduled tasks through local `codex exec --json -`.
- Cockpit forwards `defaultModel` only, and only when it is non-empty.
- Cockpit does not forward or use Cockpit `defaultAgent` for Codex.
- Codex provider accounts, authentication, upstream providers, and model availability are configured in Codex itself, outside Cockpit.

### OpenCode CLI

- Runs scheduled tasks through local `opencode run --format json <prompt>`.
- Cockpit forwards `defaultModel` when it is non-empty.
- Cockpit forwards `defaultAgent` when it is non-empty.
- OpenCode provider accounts, authentication, upstream providers, and model availability are configured in OpenCode itself, outside Cockpit.

In short:

- `Copilot` uses `defaultModel` and `defaultAgent` through VS Code chat.
- `Codex` uses `defaultModel` only.
- `OpenCode` uses `defaultModel` and `defaultAgent`.

## Supported AI Surfaces

### GitHub Copilot in VS Code

- Primary native scheduling and execution surface.
- The scheduler uses native VS Code chat commands to open chat, focus chat, start a new chat when needed, and submit prompts.
- Model selection and agent or mode selection flow through the same native chat harness when the active chat surface supports them.
- Repo-local MCP config lives in `.vscode/mcp.json`.
- Repo-local bundled skills live in `.github/skills`.
- This is the main reason Cockpit can benefit from ongoing VS Code Insiders and Copilot improvements without becoming its own model host.

### OpenRouter.AI

- Supported through the extension's native Copilot/VS Code chat execution path when your editor environment exposes OpenRouter-backed models there.
- Tasks still execute through the extension's native chat execution flow in that case, not through a separate external scheduler service.

### OpenAI Codex CLI

- Scheduled execution is external and CLI-based, not a native VS Code chat surface.
- Repo-local MCP config lives in `.codex/config.toml`.
- Repo-local Codex guidance lives in `AGENTS.md`.
- Repo-local Codex skills live in `.agents/skills`.
- The Cockpit Settings tab can switch scheduled task execution from GitHub Copilot Chat to Codex.
- The Codex VS Code extension can be used side by side, but scheduled execution does not automate its sidebar because the documented command surface does not expose prompt submission.

### OpenCode CLI

- Scheduled execution is external and CLI-based, not a native VS Code chat surface.
- Repo-local OpenCode MCP config lives in `opencode.json` or `opencode.jsonc`.
- Repo-local OpenCode skills live in `.opencode/skills`.
- Repo-local OpenCode agents live in `.opencode/agents`.
- Shared Copilot Cockpit guidance also lives in `AGENTS.md`.
- The Cockpit Settings tab can switch scheduled task execution to OpenCode.
- The OpenCode IDE/TUI workflow can be used side by side, but scheduled execution uses the non-interactive CLI rather than automating the terminal UI.

## External Prerequisites

Before selecting `Codex` or `OpenCode` as the scheduled execution provider, set them up separately from Copilot Cockpit.

### Codex prerequisites

- Install the Codex CLI so `codex` is available on `PATH`.
- Authenticate Codex separately.
- Configure any upstream provider, account, or model selection that Codex needs in Codex itself.

### OpenCode prerequisites

- Install the OpenCode CLI so `opencode` is available on `PATH`.
- Authenticate OpenCode separately.
- Configure any upstream provider, account, or model selection that OpenCode needs in OpenCode itself.

Cockpit does not install these tools, does not sign you in, and does not provision their hosted providers or models.

## What The Settings Buttons Do

The `Settings` tab exposes a small set of setup actions. They are practical repo-local file writers, not abstract toggles.

## MCP and Skills

- The extension bundles an embedded MCP server at `out/server.js`.
- Practical setup order for optional integration layers: get the core loop working first, use `Set Up MCP`, add any separate third-party MCP servers to the same `.vscode/mcp.json`, use `Sync Bundled Skills`, then choose `Stage Bundled Agents` or `Sync Bundled Agents` if you want the optional agent layer.
- `Set Up MCP` creates or repairs the local `scheduler` entry in `.vscode/mcp.json`, refreshes the workspace support launcher under `.vscode/copilot-cockpit-support/mcp/`, activates the repo-local scheduler MCP server for this workspace, and does not overwrite unrelated servers.
- `Add MCP To Codex` creates or updates the repo-local Codex entry in `.codex/config.toml`.
- In practice, `Add MCP To Codex` ensures `.codex/config.toml` exists, then creates or updates the `[mcp_servers.scheduler]` table without removing unrelated Codex tables.
- `Add Skills To Codex` syncs bundled skills into `.agents/skills` and refreshes the managed Copilot Cockpit guidance block in `AGENTS.md`.
- In practice, `Add Skills To Codex` mirrors the bundled skill set into the Codex repo-local skill tree and keeps the managed `AGENTS.md` block aligned with the current bundled skills and custom agents.
- `Add MCP To OpenCode` creates or updates the repo-local OpenCode MCP entry in `opencode.json`, or updates `opencode.jsonc` when that file already exists.
- In practice, `Add MCP To OpenCode` preserves the surrounding OpenCode config object and merges the scheduler entry into the `mcp` section.
- `Add Agents To OpenCode` syncs bundled skills into `.opencode/skills`, converts bundled agents into `.opencode/agents`, and refreshes the managed Copilot Cockpit guidance block in `AGENTS.md`.
- In practice, `Add Agents To OpenCode` gives OpenCode both the repo-local skill tree and converted subagent files, instead of only copying raw `.github/agents` files.
- `Enable External-Agent Access` turns on a same-machine-only local connector for one selected workspace folder. It creates or reuses a per-workspace `repoId`, generates a per-workspace repo key in VS Code SecretStorage, refreshes repo-local support files under `.vscode/copilot-cockpit-support/external-agent/`, and keeps the live key out of repo files.
- `Disable External-Agent Access` revokes that workspace's local connector and terminates active external-agent sessions.
- `Rotate External-Agent Repo Key` replaces the selected workspace's repo key in SecretStorage and immediately revokes existing external-agent sessions.
- `Copy External-Agent Setup Info` copies the selected workspace's launcher path, repoId, command args, and required environment variable names to the clipboard and can reveal the support folder or copy the current repo key on demand.
- The external-agent launcher wrapper authenticates over a local named pipe on Windows or a local Unix domain socket on other platforms before it spawns the existing repo-local MCP launcher at `.vscode/copilot-cockpit-support/mcp/launcher.js`.
- External-agent access only works while VS Code is running, the matching workspace folder is open and approved for Cockpit writes, and `copilotCockpit.enabled` remains true for that workspace.
- Third-party MCP servers such as Tavily, Perplexity, or [Prefab by Max Health Inc.](https://github.com/Max-Health-Inc/prefab) are separate additions to that same workspace MCP config and may need their own API keys or provider-specific setup.
- `Sync Bundled Skills` updates the Copilot skill files under `.github/skills`.
- When the Prefab by Max Health Inc. MCP server is configured for the workspace, that bundled skills path also installs `prefab-ui` so Copilot can route Prefab by Max Health Inc. UI JSON, renderer, and API-backed view work through the shipped MCP-aware skill.
- `Stage Bundled Agents` writes the bundled starter agents under `.vscode/copilot-cockpit-support/bundled-agents`, leaves the live `.github/agents` tree untouched, and opens a fresh Copilot chat prompt that asks the `copilot-scheduler-agent-merge` skill to compare the staged mirror against the live repo-local system.
- `Sync Bundled Agents` copies the bundled starter agents into live `.github/agents` files on demand. Missing files are created, previously managed files update when unchanged locally, and customized workspace copies are skipped.
- When the Prefab by Max Health Inc. MCP server is configured for the workspace, the bundled agent sync path also adds `Prefab UI Specialist` as the shipped custom agent for Prefab by Max Health Inc.-specific UI and renderer work.
- Use `Stage Bundled Agents` when you want a compare-first preview that does not change the live repo-local agent system. Use `Sync Bundled Agents` when you want the bundled starter pack installed for live use in the workspace.
- Live bundled-agent use in GitHub Copilot also requires the Copilot setting `chat.customAgentInSubagent.enabled`.
- The managed `AGENTS.md` block also lists shipped operational skills such as `prefab-ui` and any bundled top-level custom agents such as `Prefab UI Specialist` for Prefab by Max Health Inc. when those files are present.
- The combined harness is: native VS Code chat for Copilot execution, external CLI execution for Codex/OpenCode when selected, MCP for structured tool access, and repo-local skills for behavior shaping.
- Bundled skills carry frontmatter metadata that distinguishes operational skills from support/onboarding skills.
- Operational skill metadata declares MCP namespaces, workflow intents, and ready/closeout flag compatibility used when Todo handoff guidance is built.
- MCP exposure is powerful: once tools are visible to an agent, they can inspect state, change saved items, and trigger allowed operations.
- Prefer secure prompt inputs or SecretStorage-backed connectors for secrets instead of storing live API keys directly in repo-local config files.

## File Locations By Integration Surface

These are the repo-local files that Cockpit can create or maintain for each integration path.

### Copilot / shared workspace setup

- `.vscode/mcp.json` for workspace MCP servers.
- `.github/skills` for bundled Copilot skills.
- `.github/agents` when you explicitly sync the bundled starter agents.

### Codex setup

- `.codex/config.toml` for the scheduler MCP server entry.
- `.agents/skills` for bundled Codex skills.
- `AGENTS.md` for the managed Copilot Cockpit guidance block shared across Codex/OpenCode setup.

### OpenCode setup

- `opencode.json` or `opencode.jsonc` for the scheduler MCP server entry.
- `.opencode/skills` for bundled OpenCode skills.
- `.opencode/agents` for converted bundled OpenCode agents.
- `AGENTS.md` for the managed Copilot Cockpit guidance block shared across Codex/OpenCode setup.

## Scheduled Execution Behavior

When a scheduled task runs, Cockpit resolves the task prompt first and then chooses the runtime path from `taskExecutionProvider`.

### Copilot path

- Runs through the native VS Code chat execution flow.
- Task-level `agent` and `model` can still override shared defaults for that task.

### Codex path

- Runs `codex exec --json -` in the task workspace.
- Sends the resolved task prompt on standard input.
- Adds `--model <value>` only when the task or shared default model is non-empty.
- Does not add a Cockpit agent flag because Cockpit `defaultAgent` is not part of the Codex execution path.

### OpenCode path

- Runs `opencode run --format json <prompt>` in the task workspace.
- Adds `--model <value>` only when the task or shared default model is non-empty.
- Adds `--agent <value>` only when the task or shared default agent is non-empty.

## Recommended Setup Order

If you want the full provider-aware setup path, use this order:

1. Get the core `Todo` -> `Research` -> `Task` or `Job` loop working first.
2. Use `Set Up MCP` to establish the shared workspace scheduler server in `.vscode/mcp.json`.
3. If you use Copilot repo-local guidance, use `Sync Bundled Skills` and optionally the bundled agents workflow.
4. If you use Codex, run `Add MCP To Codex` and then `Add Skills To Codex`.
5. If you use OpenCode, run `Add MCP To OpenCode` and then `Add Agents To OpenCode`.
6. Only after the external tool is installed and authenticated should you switch `Task execution provider` to `Codex` or `OpenCode`.

For the faster onboarding path, see [Getting Started](./getting-started.md). For the workspace-level overview of these controls, see [Feature Tour](./feature-tour.md).

## GitHub Inbox Integration

- GitHub integration is an optional repo-local `Settings` tab feature for one repository in the current workspace.
- Inbox sync uses direct GitHub REST API reads plus repo-local cached state. It does not depend on the GitHub Pull Requests and Issues extension.
- GitHub.com refresh uses VS Code's built-in `github` authentication provider.
- A non-default GitHub API base URL routes refresh through VS Code's built-in `github-enterprise` authentication provider.
- The resolver derives a likely GitHub Enterprise server root from `apiBaseUrl` and syncs `github-enterprise.uri` at workspace scope before requesting the session.
- New saves do not persist or reuse a GitHub PAT; older token fields are tolerated only when legacy workspace state is read for compatibility.
- The webview only receives safe GitHub state plus connection and cache status. It does not receive the runtime access token.
- Manual `Refresh GitHub Inbox` loads cached `Issues`, `Pull Requests`, and `Security Alerts` lanes into the top of the `Todo Cockpit` board.
- Sync is read-only. Copilot Cockpit imports GitHub rows into local Todo cards rather than mutating GitHub issues, pull requests, or alerts.
- GitHub-sourced `needs-bot-review` and `ready` handoffs include GitHub context, reuse the saved GitHub automation prompt, and add pull-request branch preflight when VS Code's built-in Git extension can provide the current local branch.
- There is no webhook or live push sync yet.
- For setup, storage, import behavior, and operator workflow, see [GitHub Integration](./github-integration.md).

## Platform Credit

Copilot Cockpit stands on top of the Visual Studio Code platform and the GitHub Copilot chat ecosystem. That includes the editor runtime, chat UI, commands, extension APIs, and the broader model-provider surfaces that users connect through those environments.

Useful references:

- [Visual Studio Code documentation](https://code.visualstudio.com/docs)
- [AI agents in VS Code](https://code.visualstudio.com/docs/copilot/concepts/agents)
- [Customize Copilot with MCP, instructions, and prompts](https://code.visualstudio.com/docs/copilot/guides/customize-copilot-guide)

## Telegram

- Telegram configuration lives in `Settings`.
- The bot token is stored only in `.vscode/scheduler.private.json`.
- Outbound test messaging is implemented.
- Inbound reply-driven continuation still depends on a future relay or webhook bridge.

[Back to README](../README.md)
