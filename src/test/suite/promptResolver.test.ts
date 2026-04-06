import * as fs from "fs";
import * as assert from "assert";
import * as os from "os"; // local-diverge-3
import * as path from "path";
import type {} from "../../types";
import {
  resolveGlobalPromptPath,
  resolveLocalPromptPath, // local-diverge-8
  resolveAllowedPathInBaseDir,
  resolveGlobalPromptsRoot,
} from "../../promptResolver"; // module

function canonicalize(filePath: string | undefined): string {
  const candidatePath = filePath ? path.resolve(filePath) : "";
  const normalized = path.normalize(candidatePath);
  if (!candidatePath) {
    return normalized;
  }

  const trimmed = normalized.replace(/[\\/]+$/, "");
  return process.platform === "win32" ? trimmed.toLowerCase() : trimmed;
}

function skipCurrentTest(testContext: Mocha.Context): void {
  testContext.skip();
}

suite("Prompt resolver behavior", () => {
  test("rejects traversal and non-prompt file shapes", () => {
    const baseDir = path.join("/tmp", "resolver-base");
    assert.strictEqual(resolveAllowedPathInBaseDir(baseDir, "../secret.md"), undefined);
    assert.strictEqual(resolveAllowedPathInBaseDir(baseDir, "note.txt"), undefined);
    assert.strictEqual(resolveAllowedPathInBaseDir(baseDir, "agent.agent.md"), undefined);
  });

  test("resolves allowed global and local prompt paths", () => {
    const globalRoot = path.join("/tmp", "resolver-global");
    const localWorkspace = path.join("/tmp", "resolver-local");
    const absoluteAllowed = path.join(localWorkspace, ".github", "prompts", "allowed.md");

    assert.strictEqual(
      canonicalize(resolveGlobalPromptPath(globalRoot, "daily.md")),
      canonicalize(path.join(globalRoot, "daily.md")),
    );
    assert.strictEqual(resolveGlobalPromptPath(globalRoot, "daily.agent.md"), undefined);
    assert.strictEqual(
      canonicalize(resolveLocalPromptPath([localWorkspace], path.join(".github", "prompts", "relative.md"))),
      canonicalize(path.join(localWorkspace, ".github", "prompts", "relative.md")),
    );
    assert.strictEqual(
      canonicalize(resolveLocalPromptPath([path.join("/tmp", "other"), localWorkspace], absoluteAllowed)),
      canonicalize(absoluteAllowed),
    );
    assert.strictEqual(resolveLocalPromptPath([localWorkspace], path.join(localWorkspace, "notes.md")), undefined);
    assert.strictEqual(resolveLocalPromptPath([localWorkspace], path.join(".github", "prompts", "skip.agent.md")), undefined);
  });

  test("falls back to the Insiders prompts root on Windows", () => {
    if (process.platform !== "win32") {
      return;
    }

    const originalAppData = process.env.APPDATA;
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cockpit-prompts-root-"));
    const insidersPromptRoot = path.join(tempRoot, "Code - Insiders", "User", "prompts");
    fs.mkdirSync(insidersPromptRoot, { recursive: true });
    process.env.APPDATA = tempRoot;

    try {
      assert.strictEqual(canonicalize(resolveGlobalPromptsRoot()), canonicalize(insidersPromptRoot));
    } finally {
      process.env.APPDATA = originalAppData;
      fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  });

  test("blocks symlink escapes from an allowed base directory", function () {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cockpit-resolver-"));

    try {
      const allowedRoot = path.join(tempRoot, "allowed");
      const outsideRoot = path.join(tempRoot, "outside");
      fs.mkdirSync(allowedRoot, { recursive: true });
      fs.mkdirSync(outsideRoot, { recursive: true });

      const outsideFile = path.join(outsideRoot, "secret.md");
      fs.writeFileSync(outsideFile, "secret", "utf8");

      const symlinkPath = path.join(allowedRoot, "linked.md");
      try {
        fs.symlinkSync(outsideFile, symlinkPath, "file");
      } catch {
        skipCurrentTest(this);
        return;
      }

      assert.strictEqual(resolveAllowedPathInBaseDir(allowedRoot, "linked.md"), undefined);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  });
});
