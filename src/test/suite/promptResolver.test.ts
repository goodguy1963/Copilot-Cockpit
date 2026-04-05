import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  resolveAllowedPathInBaseDir,
  resolveGlobalPromptPath,
  resolveGlobalPromptsRoot,
  resolveLocalPromptPath,
} from "../../promptResolver";

function canonicalize(filePath: string | undefined): string {
  if (!filePath) {
    return "";
  }

  const resolved = path.resolve(filePath);
  const trimmed = path.normalize(resolved).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? trimmed.toLowerCase() : trimmed;
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
        this.skip();
        return;
      }

      assert.strictEqual(resolveAllowedPathInBaseDir(allowedRoot, "linked.md"), undefined);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  });
});
