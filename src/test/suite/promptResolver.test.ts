import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  resolveAllowedPathInBaseDir,
  resolveLocalPromptPath,
  resolveGlobalPromptPath,
  resolveGlobalPromptsRoot,
} from "../../promptResolver";

function norm(p: string | undefined): string {
  if (!p) return "";
  const n = path.normalize(path.resolve(p)).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? n.toLowerCase() : n;
}

suite("Prompt Resolver Tests", () => {
  test("resolveAllowedPathInBaseDir rejects traversal", () => {
    const base = path.join("/tmp", "ws");
    const resolved = resolveAllowedPathInBaseDir(base, "../secret.md");
    assert.strictEqual(resolved, undefined);
  });

  test("resolveAllowedPathInBaseDir requires .md", () => {
    const base = path.join("/tmp", "ws");
    const resolved = resolveAllowedPathInBaseDir(base, "a.txt");
    assert.strictEqual(resolved, undefined);
  });

  test("resolveAllowedPathInBaseDir rejects .agent.md", () => {
    const base = path.join("/tmp", "ws");
    const resolved = resolveAllowedPathInBaseDir(base, "a.agent.md");
    assert.strictEqual(resolved, undefined);
  });

  test("resolveGlobalPromptPath resolves under global root", () => {
    const globalRoot = path.join("/tmp", "prompts");
    const p = resolveGlobalPromptPath(globalRoot, "daily.md");
    assert.strictEqual(norm(p), norm(path.join(globalRoot, "daily.md")));
  });

  test("resolveGlobalPromptPath rejects .agent.md", () => {
    const globalRoot = path.join("/tmp", "prompts");
    const p = resolveGlobalPromptPath(globalRoot, "x.agent.md");
    assert.strictEqual(p, undefined);
  });

  test("resolveGlobalPromptsRoot falls back to Code - Insiders on Windows", () => {
    if (process.platform !== "win32") {
      return;
    }

    const originalAppData = process.env.APPDATA;
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-global-prompts-"),
    );
    const insidersRoot = path.join(
      tempRoot,
      "Code - Insiders",
      "User",
      "prompts",
    );
    fs.mkdirSync(insidersRoot, { recursive: true });
    process.env.APPDATA = tempRoot;

    try {
      assert.strictEqual(norm(resolveGlobalPromptsRoot()), norm(insidersRoot));
    } finally {
      process.env.APPDATA = originalAppData;
      fs.rmSync(tempRoot, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 50,
      });
    }
  });

  test("resolveLocalPromptPath supports multi-root absolute paths", () => {
    const ws1 = path.join("/tmp", "ws1");
    const ws2 = path.join("/tmp", "ws2");
    const allowed = path.join(ws2, ".github", "prompts", "a.md");
    const p = resolveLocalPromptPath([ws1, ws2], allowed);
    assert.strictEqual(norm(p), norm(allowed));
  });

  test("resolveLocalPromptPath rejects workspace files outside .github/prompts", () => {
    const ws1 = path.join("/tmp", "ws1");
    const outside = path.join(ws1, "notes.md");
    const p = resolveLocalPromptPath([ws1], outside);
    assert.strictEqual(p, undefined);
  });

  test("resolveLocalPromptPath accepts relative path from workspace root", () => {
    const ws1 = path.join("/tmp", "ws1");
    const rel = path.join(".github", "prompts", "x.md");
    const p = resolveLocalPromptPath([ws1], rel);
    assert.strictEqual(
      norm(p),
      norm(path.join(ws1, ".github", "prompts", "x.md")),
    );
  });

  test("resolveLocalPromptPath rejects .agent.md", () => {
    const ws1 = path.join("/tmp", "ws1");
    const rel = path.join(".github", "prompts", "x.agent.md");
    const p = resolveLocalPromptPath([ws1], rel);
    assert.strictEqual(p, undefined);
  });

  test("resolveAllowedPathInBaseDir rejects symlink escape", function () {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-resolver-"),
    );

    try {
      const base = path.join(tempRoot, "allowed");
      const outsideDir = path.join(tempRoot, "outside");
      fs.mkdirSync(base, { recursive: true });
      fs.mkdirSync(outsideDir, { recursive: true });

      const outsideFile = path.join(outsideDir, "secret.md");
      fs.writeFileSync(outsideFile, "secret", "utf8");

      const linkPath = path.join(base, "link.md");
      try {
        fs.symlinkSync(outsideFile, linkPath, "file");
      } catch {
        // Symlink may be unavailable (e.g. Windows without privileges).
        this.skip();
        return;
      }

      const resolved = resolveAllowedPathInBaseDir(base, "link.md");
      assert.strictEqual(resolved, undefined);
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
