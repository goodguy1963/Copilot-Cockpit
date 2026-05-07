---
name: copilot-scheduler-setup
description: "Act as an integration planner to evaluate the workspace and plan a structured agent ecosystem. Use this skill when the user asks to integrate or set up the scheduler orchestrator."
copilotCockpitSkillType: support
copilotCockpitToolNamespaces: []
copilotCockpitWorkflowIntents: []
copilotCockpitApprovalSensitive: true
copilotCockpitPromptSummary: "Inspect live repo-local agent systems first, require explicit authority and legacy-surface decisions before planning, prefer staged comparison over direct sync, and only implement after explicit approval plus backup confirmation."
copilotCockpitReadyWorkflowFlags: []
copilotCockpitCloseoutWorkflowFlags: []
---

# Agent Ecosystem Planning Skill

You have been invoked to help the user set up a complete AI agent ecosystem within their repository. 

## Instructions
1. Inspect the repo's existing agent-system surfaces first, including .github/, .agents/, AGENTS.md, .instructions.md, .agent.md, skills/, and prompts/.
2. Treat any existing repo-local agent system as live user-owned infrastructure. Distinguish it clearly from bundled or staged support content. During planning, leave live user-owned files untouched and do not install, sync, rename, merge, or mutate bundled starter agents into the live system.
3. If the repo already has a richer CEO/team or other specialized agent surfaces, recommend the Settings action `Stage Bundled Agents` first so the bundled starter pack is written only to `.vscode/copilot-cockpit-support/bundled-agents/`. Treat that staged tree as reference material only. Point the user to the `copilot-scheduler-agent-merge` skill for selective adoption into their live system after explicit approval.
4. Start by summarizing the current repo-local agent-system state. Explicitly list the live user-owned surfaces you found, note any staged or bundled support surfaces separately, and call out any legacy task-management or backlog surfaces that could conflict with Cockpit or scheduler workflows.
5. Before you propose any final plan, require an explicit authority matrix from the user. Ask direct questions that establish:
   - which surface is the durable source of truth for planning
   - which surface is the durable source of truth for approvals
   - whether scheduler tasks remain separate from planning cards
   - who is allowed to move cards into execution-ready states
   - who is allowed to move cards into final-accepted or archived-complete states
   - whether scheduler execution must wait for explicit board approval
6. If the repo contains legacy task stores or backlog surfaces such as `.github/agents/todos/*.md`, markdown backlog folders, or other file-based trackers, require the user to classify each relevant surface as one of:
   - active system of record
   - mirrored legacy surface
   - archive-only history
   Ask this explicitly when markdown backlog history exists: "Should legacy markdown task files remain active, be mirrored from Cockpit, or become archive-only history?"
7. Preserve user-owned agent identity by default. If the workspace already has live agent names, aliases, task-manager agents, or overlapping coordination surfaces, do not suggest renaming, merging, removing, or redefining them unless the user explicitly asks for that change.
8. Make approval semantics first-class in the plan. Capture whether the workspace wants:
   - user-only approval
   - user-only final acceptance
   - delegated board mutation with approval restrictions
   - scheduler execution only after explicit board approval
   If the workspace wants Cockpit to be the approval hub, require user-only approval semantics unless the user explicitly authorizes a broader approval model.
9. Actively ask clarifying questions about their team setup, preferred agent structure, what kind of subagents they want, and what external services they use.
   - **Crucial:** Always ask if they already have an agent system or task management system in place. If they do, ask deeper questions about how they want to transition old data and workflows into this plugin without leaving multiple live systems competing for authority.
   - Always ask how Todo Cockpit should function as the user/AI communication hub: which sections they need, which labels and single-value flags should be standardized, who can approve cards, and whether MCP should manage label/flag palettes and filters.
   - Do NOT output a final plan immediately; iterate using questions first and do not emit the final plan until the authority matrix, approval ownership, and legacy-surface classification are explicit.
10. Wait for the user's responses to refine the plan.
11. Once the design is agreed upon, generate a final Markdown plan file (for example `.github/agent-system-plan.md`) containing the exact structure and definitions they should adopt.
12. The final plan must state, for each relevant surface, whether it is authoritative, mirrored, staged-reference-only, or archive-only. At minimum cover Cockpit, scheduler tasks, and any markdown backlog files or legacy task stores.
13. If the plan includes a future implementation path, the plan must also state:
   - the backup path that already exists, if any
   - whether a fresh backup will be created before edits
   - whether bundled-agent sync is out of scope
14. Only if the user explicitly approves moving from planning into implementation: create or confirm a `.github` backup first when `.github` exists before any live bundled-agent sync or live agent-system edits, then carry out the agreed setup safely. When the workspace already has a stronger agent system, prefer staging plus selective merge over direct sync.

Start the conversation by giving a high-level summary of their current repo-local agent-system state, explicitly separating live user-owned surfaces from staged or bundled support surfaces, then ask at least one source-of-truth question, one approval-authority question, and one legacy-backlog question before asking about desired agent roles. Wait for an answer and do not mutate the repo yet.

