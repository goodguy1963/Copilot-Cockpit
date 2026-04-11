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
- `Set Up MCP` creates or repairs the local `scheduler` entry in `.vscode/mcp.json` without overwriting unrelated servers.
- `Add MCP To Codex` creates or updates the repo-local Codex entry in `.codex/config.toml`.
- `Sync Bundled Skills` updates the Copilot skill files under `.github/skills`.
- `Add Skills To Codex` syncs the same bundled skills into `.agents/skills` and refreshes the managed guidance block in `AGENTS.md`.
- The combined harness is: native VS Code chat for execution, MCP for structured tool access, and repo-local skills for behavior shaping.
- Bundled skills carry frontmatter metadata that distinguishes operational skills from support/onboarding skills.
- Operational skill metadata declares MCP namespaces, workflow intents, and ready/closeout flag compatibility used when Todo handoff guidance is built.
- MCP exposure is powerful: once tools are visible to an agent, they can inspect state, change saved items, and trigger allowed operations.
- Prefer secure prompt inputs for secrets instead of storing live API keys directly in repo-local config files.

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
