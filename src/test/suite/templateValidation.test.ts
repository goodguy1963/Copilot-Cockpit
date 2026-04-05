import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { validateTemplateLoadRequest } from "../../templateValidation";
import type { PromptTemplate } from "../../types";

type TemplateCaseInput = {
  workspaceRoot: string;
  templatePath: string;
  cachedTemplates?: PromptTemplate[];
  globalPromptsPath?: string;
  source?: "local" | "global";
};

function createCachedTemplate(templatePath: string, source: "local" | "global" = "local"): PromptTemplate {
  return {
    path: templatePath,
    name: path.basename(templatePath, path.extname(templatePath)),
    source,
  };
}

function validateCase(input: TemplateCaseInput) {
  return validateTemplateLoadRequest({
    cachedTemplates: input.cachedTemplates ?? [],
    globalPromptsPath: input.globalPromptsPath,
    templatePath: input.templatePath,
    source: input.source ?? "local",
    workspaceFolderPaths: [input.workspaceRoot],
  });
}

function expectFailure(
  input: TemplateCaseInput,
  reason:
    | "invalidPath"
    | "invalidSource"
    | "noAllowedRoots"
    | "notAllowed"
    | "notInCache"
    | "notMarkdown",
): void {
  const result = validateCase(input);
  assert.strictEqual(result.ok, false);
  if (!result.ok) {
    assert.strictEqual(result.reason, reason);
  }
}

suite("Template validation behavior", () => {
  test("accepts a cached local prompt inside the prompts directory", () => {
    const workspaceRoot = path.join("/tmp", "template-validation-accept");
    const templatePath = path.join(workspaceRoot, ".github", "prompts", "daily.md");
    const result = validateCase({
      workspaceRoot,
      templatePath,
      cachedTemplates: [createCachedTemplate(templatePath)],
    });

    assert.deepStrictEqual(result, { ok: true });
  });

  test("rejects non-markdown and agent-markdown files", () => {
    const workspaceRoot = path.join("/tmp", "template-validation-invalid-ext");
    expectFailure({
      workspaceRoot,
      templatePath: path.join(workspaceRoot, ".github", "prompts", "daily.txt"),
      cachedTemplates: [createCachedTemplate(path.join(workspaceRoot, ".github", "prompts", "daily.txt"))],
    }, "notMarkdown");

    expectFailure({
      workspaceRoot,
      templatePath: path.join(workspaceRoot, ".github", "prompts", "daily.agent.md"),
      cachedTemplates: [createCachedTemplate(path.join(workspaceRoot, ".github", "prompts", "daily.agent.md"))],
    }, "notMarkdown");
  });

  test("rejects uncached and out-of-root local templates", () => {
    const workspaceRoot = path.join("/tmp", "template-validation-local-reject");
    const insidePath = path.join(workspaceRoot, ".github", "prompts", "inside.md");
    const outsidePath = path.join(workspaceRoot, "other", "outside.md");

    expectFailure({
      workspaceRoot,
      templatePath: insidePath,
    }, "notInCache");

    expectFailure({
      workspaceRoot,
      templatePath: outsidePath,
      cachedTemplates: [createCachedTemplate(outsidePath)],
    }, "notAllowed");
  });

  test("rejects symlink escapes from the prompts directory", function () {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cockpit-template-validation-"));

    try {
      const workspaceRoot = path.join(tempRoot, "workspace");
      const promptsRoot = path.join(workspaceRoot, ".github", "prompts");
      const outsideRoot = path.join(tempRoot, "outside");
      fs.mkdirSync(promptsRoot, { recursive: true });
      fs.mkdirSync(outsideRoot, { recursive: true });

      const outsideFile = path.join(outsideRoot, "secret.md");
      fs.writeFileSync(outsideFile, "secret", "utf8");

      const symlinkPath = path.join(promptsRoot, "linked.md");
      try {
        fs.symlinkSync(outsideFile, symlinkPath, "file");
      } catch {
        this.skip();
        return;
      }

      expectFailure({
        workspaceRoot,
        templatePath: symlinkPath,
        cachedTemplates: [createCachedTemplate(symlinkPath)],
      }, "notAllowed");
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  });
});
