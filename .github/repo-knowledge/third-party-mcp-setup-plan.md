# Implementation Plan: Optional Third-Party MCP Setup for Perplexity, Tavily, Google

## Overview

Add a guided onboarding dialog that asks users whether they want to set up optional third-party MCP integrations (Perplexity, Tavily, Google) after the main `copilot_cockpit` MCP setup. The Settings
panel already has a "Setup Third-Party MCP" button and provider selectors — the missing piece is a
contextual prompt when a user first selects a third-party provider.

## Current Constraints And Assumptions

- The extension already ships `THIRD_PARTY_MCP_TEMPLATES` and `THIRD_PARTY_MCP_INPUTS` arrays in `mcpConfigManager.ts` for Perplexity and Tavily (Google is guidance-only).
- A guided QuickPick flow (`setupThirdPartyMcpTemplatesGuided` in `extension.ts`) already exists to add them.
- The Settings support section already has `#setup-third-party-mcp-btn` and `#setup-third-party-mcp-btn` renders a button for re-running the flow later.
- Provider selectors exist in Settings for both `searchProvider` (dropdown, values: `built-in`, `tavily`) and `researchProvider` (dropdown, values: `none`, `perplexity`, `tavily`, `google-grounded`).
- The MCP setup prompt after initial setup already asks "Would you also like to add third-party MCP integrations?" with a button.
- The intro/setup skills (`copilot-scheduler-intro`, `copilot-scheduler-setup`) mention third-party MCP as manual but don't mention the guided flow.

## Evidence Map

| What | Where | Status |
|---|---|---|
| Provider type definitions | `types.ts` — `SearchProvider`, `ResearchProvider`, `StorageSettingsView` | ✅ Exists |
| Provider selectors in Settings UI | `cockpitWebviewWorkspaceTabsMarkup.ts` (search + research `<select>` dropdowns) | ✅ Exists |
| Settings help text mentioning "external MCP/API setup" | `cockpitWebviewStrings.ts` lines 633–648 | ✅ Exists |
| Third-party MCP button in Settings | `cockpitWebviewWorkspaceTabsMarkup.ts` line 637 | ✅ Exists |
| Third-party MCP templates + inputs | `mcpConfigManager.ts` lines 480–570 (`THIRD_PARTY_MCP_TEMPLATES`, `THIRD_PARTY_MCP_INPUTS`) | ✅ Exists |
| `upsertSingleThirdPartyMcpTemplate()` | `mcpConfigManager.ts` line 617 | ✅ Exists |
| Guided QuickPick flow | `extension.ts` — `setupThirdPartyMcpTemplatesGuided()` line 2627 | ✅ Exists |
| Post-MCP-setup prompt ("also add third-party?") | `extension.ts` — `setupMcp` case line 4344 | ✅ Exists |
| Webview `setupThirdPartyMcp` message case | `extension.ts` line 4355 | ✅ Exists |
| Settings onboarding callout (Steps 1-2-3) | `cockpitWebviewWorkspaceTabsMarkup.ts` lines 634–675 | ✅ Exists but **missing third-party MCP step** |
| Provider selector change → MCP setup trigger | *Nowhere* | ❌ **Missing** |
| Onboarding step 4 (third-party MCP) | *Nowhere* | ❌ **Missing** |
| Contextual badge/alert when provider needs MCP but not configured | *Nowhere* | ❌ **Missing** |
| Intro/setup skills mention guided flow | `.agents/skills/copilot-scheduler-intro/SKILL.md` | ❌ **Stale — says "manually added"** |

## Requirements

1. **Post-setup onboarding prompt**: After the main `copilot_cockpit` MCP setup completes successfully, ask the user "Would you also like to set up optional third-party MCP integrations for Perplexity, Tavily, or Google-powered search/research?" — ✅ **Already implemented**.

2. **Settings dropdown triggers MCP setup**: When a user changes the `searchProvider` or `researchProvider` dropdown to `tavily`, `perplexity`, or `google-grounded` and either (a) the `.vscode/mcp.json` entry doesn't exist or (b) the setting was changed from `none`/`built-in`, show a contextual prompt: "This provider requires an MCP server entry. Would you like to set it up now?"

3. **Fourth onboarding step**: Add a Step 4 to the Settings onboarding callout about optional third-party MCP integrations.

4. **Settings status metric**: Show whether third-party MCP providers are configured next to the MCP status metric.

5. **Update intro/setup skills**: Replace "manually added" language with reference to the guided third-party MCP setup flow.

## Proposed Changes

### Change 1: Provider dropdown change handler
**Files:** `cockpitWebviewMessageRouting.ts` (add handler), `extension.ts` (add webview message case)

Add a new webview message `"providerSelectionChanged"` that sends the `searchProvider`/`researchProvider` value, the old value, and whether the entry exists in `.vscode/mcp.json`. The extension-side handler:
- Checks if the new provider requires an MCP entry (`tavily`, `perplexity`)
- Checks if the entry already exists in `.vscode/mcp.json` via `readWorkspaceMcpConfig()`
- If the entry is missing, sends a UI-side response prompting the user to confirm (fires a confirmation dialog in the webview)
- If confirmed, calls `setupThirdPartyMcpTemplatesGuided()` pre-filtered to the selected provider

### Change 2: Onboarding callout step 4
**Files:** `cockpitWebviewWorkspaceTabsMarkup.ts`, `cockpitWebviewStrings.ts`

Add an optional Step 4 card to the onboarding step group in Settings:
> **Step 4 (Optional):** Add third-party MCP integrations for Perplexity, Tavily, or Google search/research

With a link to the existing `#setup-third-party-mcp-btn`.

### Change 3: Provider setup status in Settings metrics
**Files:** `cockpitWebviewWorkspaceTabsMarkup.ts` (JS bindings in `cockpitWebviewBinding*`), `cockpitWebviewMessageRouting.ts`

After the MCP status metric, add a "Third-Party Providers" metric that lists which providers are detected in `.vscode/mcp.json` and which are selected in settings but missing their entry.

### Change 4: Update intro/setup skills
**Files:** `.agents/skills/copilot-scheduler-intro/SKILL.md`, `.agents/skills/copilot-scheduler-setup/SKILL.md`

Update the "Third-party servers are manually added" language to mention the guided setup flow:
> "The **Setup Third-Party MCP** button in Settings guides you through adding Perplexity and Tavily MCP entries to `.vscode/mcp.json`. Google/gemini-grounded research requires manual entry."

## Validation Steps

1. **Unit tests**: `npm test` — verify `upsertSingleThirdPartyMcpTemplate` is idempotent and handles all three providers correctly.
2. **Manual test A**: Set up MCP → verify "Would you also like to add third-party MCP?" prompt appears.
3. **Manual test B**: Open Settings → click "Setup Third-Party MCP" → verify QuickPick shows Perplexity, Tavily, Google → select → verify `.vscode/mcp.json` is updated.
4. **Manual test C**: Change research provider dropdown to `perplexity` → verify contextual prompt → accept → verify `.vscode/mcp.json` now has `perplexity` entry.
5. **Manual test D**: Change search provider to `tavily` when already configured → verify no prompt (entry already exists).
6. **Webview compile**: `npm run compile:webview` passes without errors.

## Handoff Packet

```
## Delegation Packet
- **Request**: Add optional third-party MCP integrations (Perplexity, Tavily, Google) to setup flow. Prompt after main MCP setup + Settings button + contextual dropdown trigger.
- **Why now**: Users currently have no guided path to add these integrations. They must know the MCP config format and API key URLs independently.
- **Controlling assets**: 
  - `src/extension.ts` (setupThirdPartyMcpTemplatesGuided, webview message case)
  - `src/mcpConfigManager.ts` (THIRD_PARTY_MCP_TEMPLATES, upsertSingleThirdPartyMcpTemplate)
  - `src/cockpitWebviewWorkspaceTabsMarkup.ts` (Settings/onboarding markup)
  - `src/cockpitWebviewStrings.ts` (localized strings)
  - `src/cockpitWebviewMessageRouting.ts` (webview message router)
  - `.agents/skills/copilot-scheduler-intro/SKILL.md`
- **Success criteria**: 
  - Provider dropdown change to `tavily`/`perplexity` triggers contextual setup prompt
  - Settings onboarding shows Step 4 for third-party MCP
  - Status metrics show third-party provider configuration status
  - Intro skills mention guided flow instead of "manually added"
- **Required validation**: npm test, manual setup flow test, provider dropdown change test
- **Constraints / Non-goals**: 
  - Do not auto-write Google/gemini-grounded entry (stays guidance-only)
  - Keep the existing `upsertSchedulerMcpConfig` MCP-entry upsert logic aligned with the current `copilot_cockpit` server name
  - Do not modify the third-party provider lookup/settings in scheduled tasks
- **First step**: Read `src/cockpitWebviewMessageRouting.ts` to find the existing message handler pattern, then add the `"providerSelectionChanged"` case.
```

## Open Risks

- The provider selectors render HTML `<select>` elements that send their value change through the webview message system. If the select doesn't fire a webview message on change (only on save/submit), the contextual prompt will require a save-button commit first. Verify the existing binding pattern.
- Google/gemini-grounded research: no auto-write template exists. The contextual prompt should open the guidance document and show a manual-setup dialog rather than claiming auto-configuration support.
- The Setting's `searchProvider` and `researchProvider` values are stored in the extension's persistent settings (via `getCompatibleConfigurationValue`). Verify that updating `.vscode/mcp.json` doesn't reset these values — they are separate surfaces.
