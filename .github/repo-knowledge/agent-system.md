# Agent System

## Quick Reference

- Shared starter-pack rules live in `.github/agents/system/knowledge/`.
- Repo-specific durable memory lives in `.github/repo-knowledge/`.
- Keep repo-specific knowledge outside `.github/agents/` because this repository ships bundled starter agents from that tree.
- Bundled starter-agent packaging now maps the neutral scaffold at `.github/agents/system/repo-knowledge-template/` into shipped/staged/live `.github/repo-knowledge/` paths.
- The daily `Knowledge and Shipping Packager` task is a staging extractor, not a direct publisher.

## Current Write-Back Workflow

- Stage candidate memory and doc updates under `output_sessions/knowledge-candidates/`.
- Publish repo-specific durable lessons into this directory after dedupe and source validation.
- Publish shared starter-pack lessons into `.github/agents/system/knowledge/` only when they improve behavior across repositories.

## Retrieval Rules

- Before non-trivial work, read `.github/repo-knowledge/README.md` and the relevant repo-specific files when they exist.
- Do not treat `/memories/repo/` as the only durable memory surface. Those notes are useful input, but curated repo knowledge should be readable from the workspace tree.

## Current Failure Mode

- A task that only produces "knowledge candidates" without a deterministic publish path leaves the durable KB empty even when useful findings exist.

## Current Fix

- Use extractor plus curator workflow: stage first, then publish through a focused documentation or knowledge pass.
