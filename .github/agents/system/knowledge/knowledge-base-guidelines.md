# Knowledge Base Guidelines

Use these rules when adding or restructuring files in `.github/agents/system/knowledge/`.

## Purpose

Knowledge docs exist to preserve institutional memory without creating context bloat.

## Structure Rules

- Put the most reusable and most searched information near the top.
- Prefer section headings that match how agents will search.
- Keep current decisions above historical notes.
- Split a file when it becomes hard to scan quickly.

## What Belongs In Shared Knowledge

- reusable patterns
- architectural decisions
- recurring failure modes and fixes
- workflow boundaries that multiple agents need to follow
- concise examples that prevent repeat mistakes

## What Does Not Belong

- routine one-off bug fixes
- full implementation logs
- large copied excerpts from official docs
- details that only matter to one agent one time

## Writing Rules

- Be concise.
- Prefer examples over long explanation.
- Use consistent keywords.
- Cross-reference instead of duplicating the same rule in multiple files.
- Remove or archive stale notes when they stop helping future work.

## Maintenance Triggers

Update a knowledge doc when:

- a non-obvious problem was solved
- an architectural rule changed
- a coordination or approval mistake exposed a reusable lesson
- a new agent or skill changes how the system should route work