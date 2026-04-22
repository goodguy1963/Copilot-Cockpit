import type { ResearchProvider, SearchProvider } from "./types";

export type LegacySearchProviderSettingValue = SearchProvider | "perplexity";

export interface ResolvedProviderSettings {
  searchProvider: SearchProvider;
  researchProvider: ResearchProvider;
}

export function normalizeSearchProvider(value: unknown): SearchProvider {
  return value === "tavily"
    ? "tavily"
    : "built-in";
}

export function normalizeResearchProvider(value: unknown): ResearchProvider {
  switch (value) {
    case "perplexity":
    case "tavily":
    case "google-grounded":
      return value;
    default:
      return "none";
  }
}

function resolveLegacyResearchProvider(value: unknown): ResearchProvider {
  switch (value) {
    case "perplexity":
      return "perplexity";
    case "tavily":
      return "tavily";
    default:
      return "none";
  }
}

export function resolveProviderSettings(options: {
  searchProvider?: unknown;
  researchProvider?: unknown;
  hasExplicitResearchProvider?: boolean;
}): ResolvedProviderSettings {
  return {
    searchProvider: normalizeSearchProvider(options.searchProvider),
    researchProvider: options.hasExplicitResearchProvider
      ? normalizeResearchProvider(options.researchProvider)
      : resolveLegacyResearchProvider(options.searchProvider),
  };
}