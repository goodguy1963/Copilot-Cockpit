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

Copilot Cockpit is built upon [vscode-copilot-scheduler by aktsmm](https://github.com/aktsmm/vscode-copilot-scheduler). The current workflow style is also influenced by the AK TM style of agent-oriented task management and disciplined handoff.

It is also intentionally built on top of the Visual Studio Code and GitHub Copilot ecosystem rather than outside it. The extension relies on the editor runtime, the native chat surface, repo-local customization patterns, and MCP-oriented tooling so that model improvements and chat-surface improvements from the platform can flow into the cockpit over time.

The architectural split is deliberate:

- VS Code and Copilot provide the execution surface.
- Connected model providers provide the underlying reasoning and generation capability.
- Copilot Cockpit provides the workflow structure, review checkpoints, persistence, and controlled handoff around that surface.

## Fork Notes

- VSIX and package name: `copilot-cockpit`
- Local build extension ID: `local-dev.copilot-cockpit`
- Embedded MCP server and guided workspace MCP setup are built in.
- The design is intentionally local-first, repo-scoped, and reviewable.
- Mixed-license attribution details are summarized in [../PROVENANCE.md](../PROVENANCE.md) and [../LICENSE](../LICENSE).

[Back to README](../README.md)
