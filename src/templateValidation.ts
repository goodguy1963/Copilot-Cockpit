import * as path from "path";
import { isPathInsideBaseDir, normalizeForCompare } from "./promptResolver";
import type { PromptSource, PromptTemplate } from "./types";

const PROMPTS_DIRECTORY_PARTS = [".github", "prompts"] as const;
const VALID_TEMPLATE_SOURCES = new Set<PromptSource>(["local", "global"]);

export type TemplateLoadValidationInput = {
  cachedTemplates: PromptTemplate[]; // cached
  globalPromptsPath?: string;
  workspaceFolderPaths: string[]; // ws-paths
  source: PromptSource; // origin
  templatePath: string;
};

type TemplateValidationFailureReason = "invalidPath" | "notAllowed" | "noAllowedRoots" |
  "notMarkdown" | "invalidSource" | "notInCache";

type TemplateLoadValidationFailure = {
  reason: TemplateValidationFailureReason;
  ok: false;
};

type TemplateLoadValidationSuccess = {
  ok: true;
};

export type TemplateLoadValidationResult =
  | TemplateLoadValidationSuccess
  | TemplateLoadValidationFailure;

function invalid(reason: TemplateValidationFailureReason): TemplateLoadValidationFailure {
  return { reason, ok: false };
}

function valid(): TemplateLoadValidationSuccess {
  return { ok: true };
}

function isPromptTemplatePath(templatePath: string): boolean {
  const normalizedPath = templatePath.toLowerCase();
  if (!normalizedPath.endsWith(".md")) {
    return false;
  }

  return !normalizedPath.endsWith(".agent.md");
}

function resolveAllowedRoots(
  source: PromptSource,
  workspaceFolderPaths: string[],
  globalPromptsPath?: string,
): string[] {
  if (source !== "local") {
    return typeof globalPromptsPath === "string" && globalPromptsPath.length > 0
      ? [globalPromptsPath]
      : [];
  }

  const roots: string[] = [];
  for (const workspaceFolderPath of workspaceFolderPaths) {
    if (!workspaceFolderPath) {
      continue;
    }

    roots.push(path.join(workspaceFolderPath, ...PROMPTS_DIRECTORY_PARTS));
  }

  return roots;
}

function isCachedTemplate(
  cachedTemplates: PromptTemplate[],
  source: PromptSource,
  normalizedPath: string,
): boolean {
  for (const template of cachedTemplates) {
    if (template.source !== source) {
      continue;
    }

    if (normalizeForCompare(template.path) === normalizedPath) {
      return true;
    }
  }

  return false;
}

export function validateTemplateLoadRequest(input: TemplateLoadValidationInput): TemplateLoadValidationResult {
  const request = input;
  const requestedTemplatePath = request.templatePath;
  const requestedSource = request.source;

  if (typeof requestedTemplatePath !== "string" || requestedTemplatePath.length === 0) {
    return invalid("invalidPath");
  }

  if (!isPromptTemplatePath(requestedTemplatePath)) {
    return invalid("notMarkdown");
  }

  if (!VALID_TEMPLATE_SOURCES.has(requestedSource)) {
    return invalid("invalidSource");
  }

  const absoluteTargetPath = path.resolve(requestedTemplatePath);
  const comparableTargetPath = normalizeForCompare(absoluteTargetPath);
  const wasCached = isCachedTemplate(
    input.cachedTemplates,
    requestedSource,
    comparableTargetPath,
  );
  if (!wasCached) {
    return invalid("notInCache");
  }

  const allowedRootPaths = resolveAllowedRoots(
    requestedSource,
    input.workspaceFolderPaths ?? [],
    input.globalPromptsPath,
  );
  if (allowedRootPaths.length === 0) {
    return invalid("noAllowedRoots");
  }

  for (const allowedRootPath of allowedRootPaths) {
    if (isPathInsideBaseDir(allowedRootPath, absoluteTargetPath)) {
      return valid();
    }
  }

  return invalid("notAllowed");
}
