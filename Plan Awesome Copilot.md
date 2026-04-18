# Publication Plan: Copilot Cockpit on Awesome Copilot

Date: 2026-04-15  
Status: Review-ready for internal approval; direct PR preparation pending human approval

## Current Status

- Public repository path confirmed: https://github.com/goodguy1963/Copilot-Cockpit
- Repo-link verification is no longer a blocker.
- The current stage is internal approval and send review readiness.
- The next move is preparing a PR against awesome-copilot with a `website/data/tools.yml` entry for Copilot Cockpit.
- PR submission remains blocked on human approval.

## Target State

Copilot Cockpit is being prepared for Awesome Copilot as a `Tool` entry in `website/data/tools.yml`. Re-scoping to `Plugin` happens only if maintainers explicitly reject the tool path during PR review.

The direct PR and final submission stay behind human approval gates.

## Guardrails

- The tool path is the working decision.
- The tool catalog appears to be data-driven by `website/data/tools.yml`, which is the visible integration surface for a tool contribution.
- Do not imply Marketplace availability; the current public install path is GitHub Releases plus VSIX.
- Every claim must be supported by the README, package.json, public repo links, or existing demo assets.
- No PR submission or external outreach without human approval.

## Phases

### Phase 0 - Prepare submission materials

Deliverables:
- concise English submission pack
- short English path note replacing the old maintainer inquiry draft
- asset pack built from existing public files with gaps clearly marked
- draft `tools.yml` entry using the visible upstream fields and category set

Success criterion:
- All text, links, requirements, and claims are ready for review and aligned with the tool path; the public repo path is confirmed.

### Phase 1 - Internal review gates

Review Gate G1:
- Human approval for pitch, short description, benefit list, category, audience, and link set

Review Gate G2:
- Human approval for asset selection, claim set, and statements that must be avoided

Success criterion:
- The package can be sent externally without further content decisions.

### Phase 2 - Prepare awesome-copilot PR

Goal:
- Prepare the actual `website/data/tools.yml` entry and supporting PR copy based on the fetched upstream files.

Review Gate G3:
- Human approval before opening the PR

Stop condition:
- If PR review shows a different required path, stop and re-plan against the reviewer guidance.

### Phase 3 - Final submission PR

Goal:
- Submit the approved PR to awesome-copilot with the prepared `tools.yml` entry and supporting materials.

Review Gate G4:
- Explicit human approval before the actual PR submission

## Validation

1. Check links for repo, releases, README, issues, license, and demo.
2. Verify the proposed entry matches the visible `tools.yml` structure: `tools:` -> entry with `id`, `name`, `description`, `category`, `featured`, `requirements`, `links`, optional `features`, optional `configuration`, and `tags`.
3. Confirm the install path is described as GitHub Releases plus VSIX, with no Marketplace implication.
4. Use only existing assets and mark missing requested captures as `pending`.

## Upstream Notes

- The fetched upstream files do not show a separate tool-submission intake in `CONTRIBUTING.md`.
- The visible categories in `tools.yml` are `MCP Servers`, `VS Code Extensions`, `CLI Tools`, `Visual Studio Extensions`, and `Documentation & Discovery`.
- The next move is preparing a PR against awesome-copilot with a `tools.yml` entry, not sending a format-check inquiry first.