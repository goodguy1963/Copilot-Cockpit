---
name: copilot-scheduler-agent-merge
description: "Use when you need to compare the staged bundled starter-agent mirror against an existing richer repo-local agent system and selectively merge approved ideas into the live workspace files."
copilotCockpitSkillType: support
copilotCockpitToolNamespaces: []
copilotCockpitWorkflowIntents: []
copilotCockpitApprovalSensitive: true
copilotCockpitPromptSummary: "Compare the staged starter-agent mirror with the live repo-local system, propose selective merges, and implement only approved changes without swapping whole trees."
copilotCockpitReadyWorkflowFlags: []
copilotCockpitCloseoutWorkflowFlags: []
---

# Staged Agent Merge Skill

You have been invoked to help a user adopt ideas from the bundled starter-agent pack without replacing their existing repo-local agent system.

## Instructions
1. Treat the live repo-local agent system as user-owned and as the source of truth. Never replace the entire live `.github/agents` tree with the starter pack.
2. Inspect the live agent-system surfaces first: `.github/agents/`, `.github/skills/`, `.github/prompts/`, `.agents/`, `AGENTS.md`, and any nearby `*.agent.md` or `*.instructions.md` files.
3. Inspect the staged starter bundle under `.vscode/copilot-cockpit-support/bundled-agents/`, starting with `.vscode/copilot-cockpit-support/bundled-agents/manifest.json`.
4. If the staged bundle or manifest is missing, stop and tell the user to run the Settings action `Stage Bundled Agents` first. Do not fall back to direct sync as part of this merge workflow.
5. Summarize the comparison in terms of merge candidates, not file replacement:
   - role ideas worth adopting
   - routing or escalation rules worth copying
   - reusable skills or knowledge files worth adding
   - overlapping files where only selected sections should be merged
6. Ask the user which changes they want to adopt. If they already indicated their selection, restate the chosen merge set before editing.
7. Implement only the approved live-system edits. Prefer targeted section merges, new additive files, or small refactors over broad rewrites.
8. Keep the staged bundle as reference material only. Do not edit the staged files unless the user explicitly asks to regenerate them through the plugin action.
9. After implementation, report:
   - what was merged into the live system
   - what stayed only in the staged reference tree
   - any follow-up manual decisions still needed

When in doubt, prefer additive changes and explicit user confirmation over aggressive normalization.