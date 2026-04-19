# Copilot Cockpit Starter Agents

This starter pack gives a workspace a small, generalized orchestration layer that is meant to merge into an existing repo, not replace one.

Agent files in `.github/agents/`:

- `ceo.agent.md`: top-level orchestrator that delegates instead of doing everything directly.
- `planner.agent.md`: planning specialist for feature design and refactoring plans.
- `remediation-implementer.agent.md`: bounded implementation specialist for approved code changes.
- `documentation-specialist.agent.md`: keeps docs and reusable knowledge aligned with the codebase.
- `custom-agent-foundry.agent.md`: creates new repo-local agents or skills when a gap exists.
- `cockpit-todo-expert.agent.md`: owns Todo Cockpit state, approvals, and backlog hygiene.

Shared operating docs in `.github/agents/system/`:

- `system/TEAM-RULES.md`: shared rules that apply across the starter pack.
- `system/CEO-WORKFLOW-GUIDE.md`: practical orchestration loop for non-trivial work.
- `system/AGENT-SYSTEM-MAINTENANCE.md`: how to evolve the roster and shared docs without drift.
- `system/knowledge/`: reusable reference notes for architecture, planning, Todo Cockpit, sessions, and knowledge-base hygiene.

Repo-local durable knowledge can also live in `.github/repo-knowledge/` when the repository needs memory that should not ship as shared starter-pack guidance.

These files are bundled with Copilot Cockpit and sync into `.github/agents` only when the user triggers a manual sync from Settings.

Manual sync rules:

- Missing bundled files are created.
- Previously managed files are updated when they are still unchanged locally.
- Customized local copies are skipped so workspace edits are preserved.

Source-of-truth rules:

- The `.agent.md` files in `.github/agents/` are the starter pack's behavioral source of truth.
- The shared docs in `.github/agents/system/` explain how the starter pack should be operated and maintained.
- `.github/repo-knowledge/` is the repo-local durable memory surface for workspace-specific facts and recurring lessons.
- Repo-local customizations win after sync; the bundled pack is a starting point, not a forced overlay.

Recommended pattern:

1. Let `CEO` coordinate the request.
2. Use `Planner` for architecture and sequencing.
3. Use `Remediation Implementer` for approved bounded code changes.
4. Use `Documentation Specialist` when docs or knowledge need alignment.
5. Use `Cockpit Todo Expert` for persistent board updates and approval routing.
6. Use `Custom Agent Foundry` to create any missing specialists in the repo.

Recommended maintenance pattern:

1. Update the affected `.agent.md` files.
2. Update `.github/agents/system/TEAM-RULES.md`, `.github/agents/system/README.md`, or `.github/agents/system/knowledge/` when the change affects shared behavior.
3. Update `.github/repo-knowledge/` when the durable lesson is repo-specific rather than starter-pack-general.
4. If the roster changed, update `ceo.agent.md` routing plus any affected discovery, tool, packaging, or regression-test surfaces.
5. Keep reusable process guidance in the shared docs instead of duplicating it across every agent.
