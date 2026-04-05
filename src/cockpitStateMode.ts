import * as vscode from "vscode";
import { getCompatibleConfigurationValue } from "./extensionCompat";
import type { CockpitDeterministicStateMode } from "./types";

export const DEFAULT_COCKPIT_STATE_MODE: CockpitDeterministicStateMode = "canonical-primary";

export function normalizeCockpitDeterministicStateMode(
  value: unknown,
): CockpitDeterministicStateMode {
  switch (value) {
    case "off":
    case "shadow":
    case "dual-write":
    case "canonical-primary":
      return value;
    default:
      return DEFAULT_COCKPIT_STATE_MODE;
  }
}

export function getConfiguredCockpitDeterministicStateMode(
  scope?: vscode.ConfigurationScope,
): CockpitDeterministicStateMode {
  return normalizeCockpitDeterministicStateMode(
    getCompatibleConfigurationValue<CockpitDeterministicStateMode>(
      "deterministicCockpitStateMode",
      DEFAULT_COCKPIT_STATE_MODE,
      scope,
    ),
  );
}

export function getConfiguredCockpitLegacyFallbackOnError(
  scope?: vscode.ConfigurationScope,
): boolean {
  return getCompatibleConfigurationValue<boolean>(
    "legacyFallbackOnError",
    true,
    scope,
  ) !== false;
}

export function isLegacyRoutingPrimaryMode(
  mode: CockpitDeterministicStateMode,
): boolean {
  return mode === "off";
}

export function shouldLogCockpitRoutingReconciliation(
  mode: CockpitDeterministicStateMode,
): boolean {
  return mode === "shadow" || mode === "dual-write";
}

export function shouldLogCockpitStateNormalization(
  mode: CockpitDeterministicStateMode,
): boolean {
  return mode !== "off";
}