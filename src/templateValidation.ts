import * as path from "path";
import type { PromptSource, PromptTemplate } from "./types";
import { isPathInsideBaseDir, normalizeForCompare } from "./promptResolver";

export type TemplateLoadValidationInput = {
  templatePath: string;
  source: PromptSource;
  cachedTemplates: PromptTemplate[];
  workspaceFolderPaths: string[];
  globalPromptsPath?: string;
};

export type TemplateLoadValidationResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "invalidPath"
        | "notMarkdown"
        | "invalidSource"
        | "notInCache"
        | "noAllowedRoots"
        | "notAllowed";
    };

export function validateTemplateLoadRequest(
  input: TemplateLoadValidationInput,
): TemplateLoadValidationResult {
  const { templatePath, source } = input;

  if (!templatePath || typeof templatePath !== "string") {
    return { ok: false, reason: "invalidPath" };
  }

  if (!templatePath.toLowerCase().endsWith(".md")) {
    return { ok: false, reason: "notMarkdown" };
  }

  // Do not allow agent definitions to be loaded as prompt templates.
  if (templatePath.toLowerCase().endsWith(".agent.md")) {
    return { ok: false, reason: "notMarkdown" };
  }

  if (source !== "local" && source !== "global") {
    return { ok: false, reason: "invalidSource" };
  }

  // Only allow paths from our cached template list to prevent arbitrary file reads
  const resolvedTarget = path.resolve(templatePath);
  const normalizedTarget = normalizeForCompare(resolvedTarget);
  const cached = input.cachedTemplates.find(
    (t) =>
      t.source === source && normalizeForCompare(t.path) === normalizedTarget,
  );
  if (!cached) {
    return { ok: false, reason: "notInCache" };
  }

  const baseDirs =
    source === "local"
      ? (input.workspaceFolderPaths ?? [])
          .filter(Boolean)
          .map((folder) => path.join(folder, ".github", "prompts"))
      : (() => {
          const globalBase = input.globalPromptsPath;
          return globalBase ? [globalBase] : [];
        })();

  if (baseDirs.length === 0) {
    return { ok: false, reason: "noAllowedRoots" };
  }

  if (!baseDirs.some((d) => isPathInsideBaseDir(d, resolvedTarget))) {
    return { ok: false, reason: "notAllowed" };
  }

  return { ok: true };
}
