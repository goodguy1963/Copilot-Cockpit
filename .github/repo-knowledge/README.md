# Repo Knowledge

Use this directory for durable, repo-specific memory that should help future work on this workspace but should not ship as shared starter-pack guidance.

## Purpose

- Keep stable repo facts, recurring failure modes, repo-specific durable memory, and local operating decisions easy to find.
- Separate source-scheduler-specific memory from `.github/agents/system/knowledge/`, which is reserved for shared starter-pack behavior.
- Give agents one canonical repo-specific retrieval surface before planning or editing.

## What Belongs Here

- repo-specific architecture and maintenance notes
- recurring workspace-only failure modes and fixes
- local workflow decisions that would confuse other repositories if copied into the starter pack
- concise examples or commands that save repeat discovery work on this repo

## What Does Not Belong Here

- shared starter-pack orchestration rules
- session checkpoints or temporary handoff notes
- scratch output, raw logs, or exploratory drafts
- one-off bug narratives with no reusable lesson

## Curation Flow

1. Stage raw findings under `output_sessions/knowledge-candidates/`.
2. Dedupe against existing files here and `/memories/repo/`.
3. Publish only concise recurring lessons with a clear target file.
4. Route shared starter-pack improvements to `.github/agents/system/knowledge/` instead.

## Current Files

- `agent-system.md`: repo-specific knowledge about the agent system, memory surfaces, and write-back workflow in this repository.

## Writing Rules

- Keep files short and searchable.
- Prefer current decisions and quick reference near the top.
- Use stable file paths and concrete terms over narrative.
- Update an existing file before creating a new one unless a new topic is clearly durable.
