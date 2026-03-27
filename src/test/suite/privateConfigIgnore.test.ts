import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  ensurePrivateConfigIgnoredForWorkspaceRoot,
  ensurePrivateConfigIgnoredForWorkspaceRoots,
} from "../../privateConfigIgnore";

suite("Private Config Ignore Tests", () => {
  function createWorkspaceRoot(): string {
    return fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-private-ignore-"),
    );
  }

  function cleanup(root: string): void {
    try {
      fs.rmSync(root, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 50,
      });
    } catch {
      // ignore
    }
  }

  test("creates a .vscode/.gitignore that ignores scheduler.private.json", () => {
    const workspaceRoot = createWorkspaceRoot();

    try {
      const ignorePath = ensurePrivateConfigIgnoredForWorkspaceRoot(workspaceRoot);
      assert.strictEqual(ignorePath, path.join(workspaceRoot, ".vscode", ".gitignore"));
      assert.strictEqual(
        fs.readFileSync(ignorePath!, "utf8"),
        "# Copilot Cockpit private config\nscheduler.private.json\n",
      );
    } finally {
      cleanup(workspaceRoot);
    }
  });

  test("appends the ignore entry without clobbering existing .vscode/.gitignore content", () => {
    const workspaceRoot = createWorkspaceRoot();
    const ignorePath = path.join(workspaceRoot, ".vscode", ".gitignore");

    try {
      fs.mkdirSync(path.dirname(ignorePath), { recursive: true });
      fs.writeFileSync(ignorePath, "history/\nresearch-history/\n", "utf8");

      const updatedPath = ensurePrivateConfigIgnoredForWorkspaceRoot(workspaceRoot);
      assert.strictEqual(updatedPath, ignorePath);
      assert.strictEqual(
        fs.readFileSync(ignorePath, "utf8"),
        "history/\nresearch-history/\n\n# Copilot Cockpit private config\nscheduler.private.json\n",
      );

      const secondResult = ensurePrivateConfigIgnoredForWorkspaceRoot(workspaceRoot);
      assert.strictEqual(secondResult, undefined);
    } finally {
      cleanup(workspaceRoot);
    }
  });

  test("updates multiple workspace roots in one pass", () => {
    const workspaceRootA = createWorkspaceRoot();
    const workspaceRootB = createWorkspaceRoot();

    try {
      const updated = ensurePrivateConfigIgnoredForWorkspaceRoots([
        workspaceRootA,
        workspaceRootB,
      ]);

      assert.deepStrictEqual(updated.sort(), [
        path.join(workspaceRootA, ".vscode", ".gitignore"),
        path.join(workspaceRootB, ".vscode", ".gitignore"),
      ].sort());
    } finally {
      cleanup(workspaceRootA);
      cleanup(workspaceRootB);
    }
  });
});