import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { PromptTemplate } from "../../types";
import { validateTemplateLoadRequest } from "../../templateValidation";

suite("Template Load Validation Tests", () => {
  test("Accepts cached local template under .github/prompts", () => {
    const ws = path.join("/tmp", "ws");
    const templatePath = path.join(ws, ".github", "prompts", "a.md");
    const cached: PromptTemplate[] = [
      { path: templatePath, name: "a", source: "local" },
    ];

    const res = validateTemplateLoadRequest({
      templatePath,
      source: "local",
      cachedTemplates: cached,
      workspaceFolderPaths: [ws],
      globalPromptsPath: undefined,
    });

    assert.deepStrictEqual(res, { ok: true });
  });

  test("Rejects non-markdown templates", () => {
    const ws = path.join("/tmp", "ws");
    const templatePath = path.join(ws, ".github", "prompts", "a.txt");
    const cached: PromptTemplate[] = [
      { path: templatePath, name: "a", source: "local" },
    ];
    const res = validateTemplateLoadRequest({
      templatePath,
      source: "local",
      cachedTemplates: cached,
      workspaceFolderPaths: [ws],
      globalPromptsPath: undefined,
    });
    assert.strictEqual(res.ok, false);
    if (!res.ok) {
      assert.strictEqual(res.reason, "notMarkdown");
    }
  });

  test("Rejects .agent.md templates", () => {
    const ws = path.join("/tmp", "ws");
    const templatePath = path.join(ws, ".github", "prompts", "a.agent.md");
    const cached: PromptTemplate[] = [
      { path: templatePath, name: "a.agent", source: "local" },
    ];
    const res = validateTemplateLoadRequest({
      templatePath,
      source: "local",
      cachedTemplates: cached,
      workspaceFolderPaths: [ws],
      globalPromptsPath: undefined,
    });
    assert.strictEqual(res.ok, false);
    if (!res.ok) {
      assert.strictEqual(res.reason, "notMarkdown");
    }
  });

  test("Rejects templates not present in cache", () => {
    const ws = path.join("/tmp", "ws");
    const templatePath = path.join(ws, ".github", "prompts", "a.md");
    const res = validateTemplateLoadRequest({
      templatePath,
      source: "local",
      cachedTemplates: [],
      workspaceFolderPaths: [ws],
      globalPromptsPath: undefined,
    });
    assert.strictEqual(res.ok, false);
    if (!res.ok) {
      assert.strictEqual(res.reason, "notInCache");
    }
  });

  test("Rejects local templates outside allowed root", () => {
    const ws = path.join("/tmp", "ws");
    const outside = path.join(ws, "other", "a.md");
    const cached: PromptTemplate[] = [
      { path: outside, name: "a", source: "local" },
    ];
    const res = validateTemplateLoadRequest({
      templatePath: outside,
      source: "local",
      cachedTemplates: cached,
      workspaceFolderPaths: [ws],
      globalPromptsPath: undefined,
    });
    assert.strictEqual(res.ok, false);
    if (!res.ok) {
      assert.strictEqual(res.reason, "notAllowed");
    }
  });

  test("Rejects cached local template symlink escaping allowed root", function () {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-validation-"),
    );

    try {
      const ws = path.join(tempRoot, "ws");
      const promptsDir = path.join(ws, ".github", "prompts");
      const outsideDir = path.join(tempRoot, "outside");
      fs.mkdirSync(promptsDir, { recursive: true });
      fs.mkdirSync(outsideDir, { recursive: true });

      const outside = path.join(outsideDir, "secret.md");
      fs.writeFileSync(outside, "secret", "utf8");

      const linkPath = path.join(promptsDir, "link.md");
      try {
        fs.symlinkSync(outside, linkPath, "file");
      } catch {
        // Symlink may be unavailable (e.g. Windows without privileges).
        this.skip();
        return;
      }

      const cached: PromptTemplate[] = [
        { path: linkPath, name: "link", source: "local" },
      ];

      const res = validateTemplateLoadRequest({
        templatePath: linkPath,
        source: "local",
        cachedTemplates: cached,
        workspaceFolderPaths: [ws],
        globalPromptsPath: undefined,
      });

      assert.strictEqual(res.ok, false);
      if (!res.ok) {
        assert.strictEqual(res.reason, "notAllowed");
      }
    } finally {
      fs.rmSync(tempRoot, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 50,
      });
    }
  });
});
