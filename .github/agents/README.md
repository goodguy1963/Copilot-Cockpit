# Copilot Cockpit Starter Agents

This starter pack gives a workspace a small, generalized orchestration layer:

- `ceo.agent.md`: top-level orchestrator that delegates instead of doing everything directly.
- `planner.agent.md`: planning specialist for feature design and refactoring plans.
- `custom-agent-foundry.agent.md`: creates new repo-local agents or skills when a gap exists.
- `cockpit-todo-expert.agent.md`: owns Todo Cockpit state, approvals, and backlog hygiene.

These files are bundled with Copilot Cockpit and sync into `.github/agents` only when the user triggers a manual sync from Settings.

Manual sync rules:

- Missing bundled files are created.
- Previously managed files are updated when they are still unchanged locally.
- Customized local copies are skipped so workspace edits are preserved.

Recommended pattern:

1. Let `CEO` coordinate the request.
2. Use `Planner` for architecture and sequencing.
3. Use `Cockpit Todo Expert` for persistent board updates and approval routing.
4. Use `Custom Agent Foundry` to create any missing specialists in the repo.