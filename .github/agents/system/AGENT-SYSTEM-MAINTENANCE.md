# Agent System Maintenance

Use this guide when changing the starter pack itself, not when simply using the agents.

## Source Of Truth

- The `.agent.md` files in `.github/agents/` are the behavioral source of truth for the starter roster.
- `.github/agents/system/TEAM-RULES.md` defines cross-agent operating rules.
- The files in `.github/agents/system/knowledge/` hold shared process and architecture guidance.
- `.github/agents/system/README.md` explains how the pack is meant to be used and maintained.

## When To Update Shared Docs

Update shared docs when a change affects more than one agent or would otherwise be duplicated.

Typical triggers:

- a new orchestration rule
- a new planning or validation standard
- a new Todo Cockpit workflow pattern
- a new session-management or memory discipline
- a roster change that changes how `CEO` should route work

## Roster Change Surfaces

When adding, removing, or renaming a starter agent, also review:

- `ceo.agent.md` routes, handoffs, and delegation prompts
- `.github/agents/system/TEAM-RULES.md`, `.github/agents/system/README.md`, and any affected `.github/agents/system/knowledge/` docs
- this guide when the maintenance workflow or system layout changes
- any tool, discovery, packaging, or regression-test surface that enumerates or validates the roster

## Safe Update Workflow

1. Update the affected `.agent.md` file or files.
2. Update `ceo.agent.md` when routing, handoffs, or delegation prompts change.
3. Update `.github/agents/system/TEAM-RULES.md` if the rule applies across agents.
4. Update the relevant `.github/agents/system/knowledge/` doc instead of copying the same guidance into every agent.
5. Update `.github/agents/system/README.md` or this guide if the roster, layout, purpose, or maintenance flow changed.
6. Add or update a regression test when the change is important enough to keep from silently drifting.

## Starter Pack Design Guardrails

- Keep the starter pack general-purpose.
- Do not copy repo-specific business language, customer terminology, or service assumptions into the bundled pack.
- Prefer sharper instructions over more agents.
- Add a new starter agent only when the role is broadly reusable across repositories.

## Sync Boundary

- Bundled files sync into a repo only through the manual sync action.
- Customized workspace copies are intentionally preserved.
- When a bundled improvement should be adopted by an already customized repo, treat that as a merge task, not an overwrite.

## Knowledge Hygiene

- Shared knowledge should stay concise and pattern-oriented.
- Archive or remove stale process notes instead of letting them accumulate into noise.
- If a lesson is only useful for one agent, prefer that agent file over a shared knowledge doc.