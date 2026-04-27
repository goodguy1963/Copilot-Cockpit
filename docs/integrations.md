# Integrations

## Supported AI Surfaces

### GitHub Copilot in VS Code

- Primary native scheduling and execution surface.
- The scheduler uses the native VS Code chat commands to open chat, focus chat, start a new chat when needed, and submit prompts.
- Model selection and agent or mode selection flow through the same native chat harness when the active chat surface supports them.
- Repo-local MCP config lives in `.vscode/mcp.json`.
- Repo-local bundled skills live in `.github/skills`.
- This is the main reason Cockpit can benefit from ongoing VS Code Insiders and Copilot improvements without becoming its own model host.

### OpenRouter.AI

- Supported through the extension's native chat execution path and model selection.
- Use it where the VS Code chat interface or configured providers expose OpenRouter-backed models.
- Tasks still execute through the extension's native chat execution flow, not through an external scheduler service.

### ChatGPT Codex in VS Code

- Experimental support.
- Repo-local MCP config lives in `.codex/config.toml`.
- Repo-local Codex instructions live in `AGENTS.md`.
- Repo-local Codex skills live in `.agents/skills`.
- Codex support currently focuses on todo and task-draft coordination.
- Scheduled task execution does not run through Codex today. Tasks run through the native Copilot or OpenRouter-backed chat execution flow instead.
- Scheduling tasks through the Codex VS Code extension is not implemented yet.

## MCP and Skills

- The extension bundles an embedded MCP server at `out/server.js`.
- Practical setup order for optional integration layers: get the core loop working first, use `Set Up MCP`, add any separate third-party MCP servers to the same `.vscode/mcp.json`, use `Sync Bundled Skills`, then choose `Stage Bundled Agents` or `Sync Bundled Agents` if you want the optional agent layer.
- `Set Up MCP` creates or repairs the local `scheduler` entry in `.vscode/mcp.json`, activates the repo-local scheduler MCP server for this workspace, and does not overwrite unrelated servers.
- `Add MCP To Codex` creates or updates the repo-local Codex entry in `.codex/config.toml`.
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
- `Add Skills To Codex` syncs the same bundled skills into `.agents/skills` and refreshes the managed guidance block in `AGENTS.md`.
- The managed `AGENTS.md` block also lists shipped operational skills such as `prefab-ui` and any bundled top-level custom agents such as `Prefab UI Specialist` for Prefab by Max Health Inc. when those files are present.
- The combined harness is: native VS Code chat for execution, MCP for structured tool access, and repo-local skills for behavior shaping.
- Bundled skills carry frontmatter metadata that distinguishes operational skills from support/onboarding skills.
- Operational skill metadata declares MCP namespaces, workflow intents, and ready/closeout flag compatibility used when Todo handoff guidance is built.
- MCP exposure is powerful: once tools are visible to an agent, they can inspect state, change saved items, and trigger allowed operations.
- Prefer secure prompt inputs or SecretStorage-backed connectors for secrets instead of storing live API keys directly in repo-local config files.

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
