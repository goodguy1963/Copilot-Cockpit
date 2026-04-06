# Architecture and Principles

Copilot Cockpit is a local orchestration layer for AI work inside VS Code. It treats planning, approval, execution, and review as separate surfaces instead of hiding everything inside one autonomous agent loop.

## Principles

- Human-in-the-loop is a core constraint, not a fallback.
- Workflow structure matters more than raw autonomy.
- Planning and execution should remain inspectable and editable.
- Repo-local state is preferred over external coordination systems.
- Small iterative runs are preferred over opaque long-running behavior.

## Core Surfaces

- Todos are the planning and handoff layer.
- Tasks are concrete execution units.
- Jobs are ordered multi-step workflows.
- Research is bounded benchmark-driven iteration.
- MCP is the tool surface for automation and orchestration.

## Foundation

Copilot Cockpit grew out of the open-source Copilot Scheduler by [aktsmm](https://github.com/aktsmm). The current workflow style is also inspired by the AK TM style of agent-oriented task management and disciplined handoff.

## Fork Notes

- VSIX and package name: `copilot-cockpit`
- Local build extension ID: `local-dev.copilot-cockpit`
- Embedded MCP server and guided workspace MCP setup are built in.
- The design is intentionally local-first, repo-scoped, and reviewable.
