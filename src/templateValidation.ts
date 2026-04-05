import type { PromptSource, PromptTemplate } from "./types";
import * as path from "path";
import { isPathInsideBaseDir, normalizeForCompare } from "./promptResolver";

const PROMPTS_DIRECTORY_PARTS = [".github", "prompts"] as const;
const VALID_TEMPLATE_SOURCES: readonly PromptSource[] = ["local", "global"];

export type TemplateLoadValidationInput = {
  cachedTemplates: PromptTemplate[];
  globalPromptsPath?: string;
  templatePath: string;
  source: PromptSource;
  workspaceFolderPaths: string[];
};

type TemplateValidationFailureReason =
  | "invalidPath"
  | "invalidSource"
  | "noAllowedRoots"
  | "notAllowed"
  | "notInCache"
  | "notMarkdown";

export type TemplateLoadValidationResult = { ok: true } | {
  ok: false;
  reason: TemplateValidationFailureReason;
};

function invalid(reason: TemplateValidationFailureReason): TemplateLoadValidationResult {
  return { ok: false, reason };
}

function isPromptTemplatePath(templatePath: string): boolean {
  const lowerPath = templatePath.toLowerCase();
  return lowerPath.endsWith(".md") && !lowerPath.endsWith(".agent.md");
}

function resolveAllowedRoots(
  source: PromptSource,
  workspaceFolderPaths: string[],
  globalPromptsPath?: string,
): string[] {
  if (source === "global") {
    return globalPromptsPath ? [globalPromptsPath] : [];
  }

  return workspaceFolderPaths
    .filter((folderPath) => Boolean(folderPath))
    .map((folderPath) => path.join(folderPath, ...PROMPTS_DIRECTORY_PARTS));
}

function isCachedTemplate(
  cachedTemplates: PromptTemplate[],
  source: PromptSource,
  normalizedPath: string,
): boolean {
  return cachedTemplates.some((template) =>
    template.source === source
    && normalizeForCompare(template.path) === normalizedPath);
}

export function validateTemplateLoadRequest(input: TemplateLoadValidationInput): TemplateLoadValidationResult {
  const { source, templatePath } = input;

  if (typeof templatePath !== "string" || templatePath.length === 0) {
    return invalid("invalidPath");
  }

  if (!isPromptTemplatePath(templatePath)) {
    return invalid("notMarkdown");
  }

  if (!VALID_TEMPLATE_SOURCES.includes(source)) {
    return invalid("invalidSource");
  }

  const resolvedTarget = path.resolve(templatePath);
  const normalizedTarget = normalizeForCompare(resolvedTarget);
  if (!isCachedTemplate(input.cachedTemplates, source, normalizedTarget)) {
    return invalid("notInCache");
  }

  const allowedRoots = resolveAllowedRoots(
    source,
    input.workspaceFolderPaths ?? [],
    input.globalPromptsPath,
  );
  if (allowedRoots.length === 0) {
    return invalid("noAllowedRoots");
  }

  const isInsideAllowedRoot = allowedRoots.some((rootPath) =>
    isPathInsideBaseDir(rootPath, resolvedTarget));
  return isInsideAllowedRoot ? { ok: true } : invalid("notAllowed");
}
