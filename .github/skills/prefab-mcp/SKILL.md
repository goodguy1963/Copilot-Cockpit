---
name: prefab-mcp
description: "Use when an agent needs to work with Prefab dynamic config or feature flags through the Prefab MCP server, including onboarding, listing configs, reading config values, creating flags, updating rollouts, toggling a feature, or debugging a feature flag."
copilotCockpitSkillType: operational
copilotCockpitToolNamespaces: [prefab]
copilotCockpitWorkflowIntents: []
copilotCockpitApprovalSensitive: true
copilotCockpitPromptSummary: "Start from prefab://docs, use tools/list when schema details are uncertain, and use the Prefab MCP tools and prompts instead of guessing config or rollout behavior."
copilotCockpitReadyWorkflowFlags: []
copilotCockpitCloseoutWorkflowFlags: []
---

# Prefab MCP Skill

Use this skill when a request is about Prefab, feature flags, dynamic configuration, config rollout, toggling a feature, updating a flag, onboarding Prefab in a project, or debugging a Prefab-backed behavior.

This skill is grounded in the verified Prefab MCP server contract for this workspace:

- Server endpoint: `https://maxhealth.tech/mcp/prefab`
- Resource from `resources/list`: `prefab://docs`
- Tools from `tools/list`: `create_config`, `get_config_value`, `list_configs`, `update_config`
- Prompts from `prompts/list`: `onboard-new-project`, `debug-feature-flag`

The live MCP resource and tool surface are the source of truth. Use general Prefab product knowledge only to clarify workflow intent, not to invent unsupported operations or payload shapes.

## Mandatory First Step

Before you plan or mutate anything, do this in order:

1. Read `prefab://docs`.
2. If any tool arguments, return shapes, or prompt inputs are unclear, inspect `tools/list` and `prompts/list` before proceeding.
3. Identify whether the user wants one of these outcomes:
   - onboard Prefab in a project
   - inspect existing configs or flags
   - read a config value for a specific environment or context
   - create a new config or feature flag
   - update an existing config, targeting rule, or rollout
   - debug why a feature flag or config value resolved the way it did

Do not rely on memory for exact schema details when the MCP surface can tell you directly.

## Mental Model

- Prefab in this workspace should be treated as a dynamic config and feature flag control plane.
- A config can represent a plain runtime setting, a boolean flag, or a multivariate flag depending on how the server docs describe it.
- Resolution can depend on environment and targeting context.
- The MCP surface here is for config and flag management workflows, not for claiming deployment, SDK installation, or runtime evaluation powers that are not exposed by the verified tools.

## Required Preflight

Before using any write tool, verify all of the following:

- The request is actually about Prefab-managed config or flags, not a local `.env` file or an unrelated settings system.
- The target environment, app, or audience context is known well enough to avoid mutating the wrong config.
- The config already exists when you intend to update it.
- The active agent can access the Prefab MCP resource, tools, and prompts in the current session.

If any of those checks fail, stop and report the blocker instead of guessing at a rollout or inventing a config shape.

## Mandatory MCP Capability Gate

This skill is MCP-dependent.

- If `prefab://docs` is unavailable, say so explicitly and do not pretend you are using the live Prefab surface.
- If the needed Prefab tools are unavailable, do not fake a mutation, do not claim success, and do not invent request payloads from memory.
- If the user still wants help while the MCP surface is unavailable, limit the response to one of these:
  - a plan for what to do once Prefab MCP is available
  - a repository-side implementation checklist for consuming a flag or config
  - a debugging checklist that clearly states it is not based on live Prefab reads
- Prefer a handoff only when the receiving agent actually has access to the same Prefab MCP surface.

## Tool Map

- `list_configs` - inventory available Prefab configs and flags before choosing a target
- `get_config_value` - inspect the resolved value for a config, typically for a specific environment or targeting context
- `create_config` - create a new Prefab config or feature flag when the key does not already exist
- `update_config` - modify an existing config, flag definition, targeting rule, or rollout when the key already exists
- `onboard-new-project` - prompt for structuring an initial Prefab adoption workflow inside a project
- `debug-feature-flag` - prompt for structuring a focused feature-flag investigation with the right context

## Core Workflows

### 1. Onboard Prefab In A Project

Use this when the user says things like "onboard Prefab", "set up feature flags", or "add dynamic config to this app".

Preferred sequence:

1. Read `prefab://docs`.
2. Open the `onboard-new-project` prompt.
3. Use `list_configs` to understand whether this Prefab project is empty or already has conventions that the repo should follow.
4. Identify the first configs or flags the project needs.
5. Create only the configs the request actually requires with `create_config`.
6. If the user also needs repo code changes, treat those as a separate implementation step after the Prefab-side plan is clear.

Use the prompt to structure discovery and adoption. Do not treat the prompt itself as a mutation.

### 2. Inventory Existing Configs Before Acting

Use `list_configs` first whenever the user asks to:

- toggle a feature
- update a flag
- roll out a config
- rename or inspect an existing setting
- debug a config that may already exist

Why this matters:

- It avoids creating duplicates.
- It helps you confirm naming conventions.
- It tells you whether the requested key already exists, which determines whether `create_config` or `update_config` is the correct next step.

Do not jump straight to `update_config` unless you already know the target exists.

### 3. Read A Config Value

Use `get_config_value` when the user wants to know what a config or flag resolves to.

Good fits:

- "What is this flag set to in staging?"
- "Why is user X seeing the feature enabled?"
- "Check the current value for this config before we change it."

When reading a value, be explicit about the context you are using:

- environment
- user or actor identifier, if relevant
- any targeting attributes the docs or prompt require

If the user does not provide enough context for a targeted read, ask for the missing environment or targeting details rather than assuming defaults.

### 4. Create A New Config Or Flag

Use `create_config` when the requested key does not exist yet.

Typical cases:

- create a boolean feature toggle
- create a multivariate flag for a rollout experiment
- create a dynamic runtime config such as a threshold or endpoint mode

Before creating it:

- confirm the intended name
- confirm whether it is boolean or multivariate, if that distinction matters in the docs
- confirm the target environments and any initial targeting expectations
- check `prefab://docs` or `tools/list` if you are unsure about required fields

Do not assume that `update_config` can create a missing key unless the live tool schema explicitly says it can.

### 5. Update An Existing Config Or Rollout

Use `update_config` only after confirming the config exists.

Typical cases:

- toggle a feature on or off
- expand a rollout from internal users to a wider audience
- change a default value
- modify a targeting rule for a specific environment

Safe sequence:

1. `list_configs` to confirm the key exists.
2. `get_config_value` to inspect the current state when the user wants a careful change.
3. `update_config` with the intended change.
4. If the result still seems surprising, use `get_config_value` again with the relevant environment or user context.

Prefer small, deliberate changes over rewriting the whole config blindly.

### 6. Debug A Feature Flag

Use this when the user says a flag is not behaving as expected, a rollout is inconsistent, or a user is getting the wrong variant.

Preferred sequence:

1. Read `prefab://docs`.
2. Open the `debug-feature-flag` prompt.
3. Use `list_configs` to confirm the exact key name.
4. Use `get_config_value` with the most relevant environment and targeting context.
5. If the issue is a misconfigured rule or rollout, use `update_config` to apply the smallest justified fix.
6. Re-read with `get_config_value` when the tool surface supports the needed context to verify the expected resolution.

Debugging without environment and targeting context is usually too weak to trust.

## Environment And Context Rules

- Treat environment as first-class input. Production, staging, dev, preview, and local may resolve differently.
- Treat targeting context as first-class input when debugging or validating rollouts. A user ID, tenant, organization, cohort, or request attribute can change the result.
- Distinguish between changing the default behavior and changing a targeted override.
- If the user says "turn it on" but does not say where, do not assume production.
- If the user says "the flag is wrong for this user" but gives no user or audience context, ask for it.

## Common Pitfalls

- Skipping `prefab://docs` and guessing tool payloads from general feature-flag experience.
- Updating a config without first confirming it exists.
- Mutating the wrong environment because the request never named one explicitly.
- Debugging a rollout without the actor or targeting context that drives resolution.
- Treating `onboard-new-project` or `debug-feature-flag` as if prompts make live changes.
- Claiming support for actions outside the verified tool contract, such as deleting configs, installing SDKs, or evaluating flags in runtime code, unless another available tool explicitly provides that capability.

## Output Expectations

When you use this skill, report the outcome in concrete operational terms:

- whether you read `prefab://docs`
- which Prefab tool or prompt you used
- which config key was inspected or changed
- which environment or targeting context was used
- whether you created a new config or updated an existing one
- any remaining uncertainty caused by missing MCP schema details or missing user context

## Decision Rules

- Prefer `list_configs` before any write operation unless the current session already verified the exact key.
- Prefer `get_config_value` before and after a sensitive rollout change when the request is risk-aware.
- Use `create_config` for net-new keys.
- Use `update_config` for existing keys only.
- Use `onboard-new-project` when the user needs a practical adoption path, not just a one-off mutation.
- Use `debug-feature-flag` when the user describes unexpected flag behavior and you need structured troubleshooting.
- Stay within the verified Prefab MCP surface. If the user wants repo code changes that consume Prefab values, make those as a separate, explicit implementation step.