# Provenance

## Upstream Foundation

Copilot Cockpit is built upon [vscode-copilot-scheduler by aktsmm](https://github.com/aktsmm/vscode-copilot-scheduler).

The upstream project is also published on the VS Code Marketplace as `yamapan.copilot-scheduler`.

This repository contains both:

- derived or adapted portions that originate from the upstream project and remain subject to `CC BY-NC-SA 4.0`
- later original additions developed in this repository

The purpose of this note is to clarify the relationship at a practical level. It is not a file-by-file legal audit.

## Derived or Adapted Portions

The inherited foundation includes the original VS Code extension baseline and scheduler-oriented architecture that this repository was built from and then expanded.

What was taken forward from the upstream project is, in clear terms:

- the original VS Code extension setup and scheduler baseline
- the scheduler-oriented architecture and execution model
- the task, prompt, storage, and tree-view foundation that this repository later expanded and rewrote in many places

These portions should be treated as derived from `vscode-copilot-scheduler` and therefore attributed to aktsmm under `CC BY-NC-SA 4.0`.

Direct SHA-256 comparison against the upstream checkout confirms that the following files are still byte-for-byte identical:

- `.eslintrc.cjs`
- `tsconfig.json`

Other checked foundation files in this repository are not byte-for-byte identical today, but they still sit on top of an upstream-derived extension and scheduler base that was adapted over time.

## Later Original Additions In This Repository

Major additions developed after the upstream foundation include, at a minimum:

- Todo Cockpit and its review-oriented workflow model
- Research Manager and bounded benchmark-oriented research flows
- SQLite-backed storage support and migration layers
- Jobs workflows and related orchestration surfaces
- Codex coordination support
- newer MCP-oriented orchestration, setup, and workflow surfaces added in this repository

Unless otherwise noted, these later original additions are made available under the MIT terms described in [LICENSE](LICENSE), while still coexisting in the same repository with derived portions that remain under `CC BY-NC-SA 4.0`.

## Scope Note

This note is intentionally conservative. It identifies exact unchanged files where direct SHA comparison confirms that fact, and it identifies the broader extension and scheduler base as upstream-derived where this repository clearly builds on that foundation. It does not claim that every other current file is either wholly original or wholly unchanged from upstream.

## Attribution Summary

- Built upon `vscode-copilot-scheduler` by aktsmm
- Derived or adapted portions: `CC BY-NC-SA 4.0`
- Later original additions in this repository: MIT, unless otherwise noted