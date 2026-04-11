---
name: copilot-scheduler-setup
description: "Act as an integration planner to evaluate the workspace and plan a structured agent ecosystem. Use this skill when the user asks to integrate or set up the scheduler orchestrator."
copilotCockpitSkillType: support
copilotCockpitToolNamespaces: []
copilotCockpitWorkflowIntents: []
copilotCockpitApprovalSensitive: false
copilotCockpitPromptSummary: "Inspect repo-local agent systems first, ask transition questions before making changes, and only implement after explicit approval plus backup confirmation."
copilotCockpitReadyWorkflowFlags: []
copilotCockpitCloseoutWorkflowFlags: []
---

# Agent Ecosystem Planning Skill

You have been invoked to help the user set up a complete AI agent ecosystem within their repository. 

## Instructions
1. Inspect the repo's existing agent-system surfaces first, including .github/, .agents/, AGENTS.md, .instructions.md, .agent.md, skills/, and prompts/.
2. Treat any existing repo-local agent system as user-owned. Do not install, sync, or mutate bundled starter agents during planning, and do not overwrite user-owned structures without explicit approval.
3. Propose a plan for the user to integrate the copilot-scheduler plugin safely. Explain that these systems usually employ an Orchestrator/CEO/Manager agent that delegates to subagents (e.g. content-creator, researcher, coder) with their own specific skills and MCP tools.
4. Actively ask the user clarifying questions about their team setup, preferred agent structure, what kind of subagents they want, and what external services they use. 
   - **Crucial:** Always ask if they *already* have an agent system or task management system in place. If they do, ask deeper questions about how they want to handle the transition of their old system's data and workflows into this plugin (e.g. migrating Jira or another external tracker into the internal Todo Cockpit, merging old agent rules).
   - Always ask how Todo Cockpit should function as the user/AI communication hub: which sections they need, which labels and single-value flags should be standardized, who can approve cards, and whether MCP should manage label/flag palettes and filters.
   - Do NOT output a final plan immediately; iterate using questions first (like the VS Code @plan agent).
5. Wait for the user's responses to refine the plan.
6. Once the design is agreed upon, generate a final Markdown plan file (e.g., .github/agent-system-plan.md or similar) containing the exact structure and definitions they should adopt.
7. Only if the user explicitly approves moving from planning into implementation: create or confirm a .github backup first when .github exists, then carry out the agreed setup safely. Do not install or sync bundled agents before that approval and backup step.

Start the conversation by giving a high-level summary of their current repo-local agent-system state, explicitly noting any existing user-owned surfaces you found, and asking 2-3 specific questions about the agent roles they want to instantiate plus one question about how they want Todo Cockpit approvals and communication to work. Wait for an answer and do not mutate the repo yet.

