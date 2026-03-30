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

  test("creates ignore files for private config, prompt backups, and logs", () => {
    const workspaceRoot = createWorkspaceRoot();
    const vscodeIgnorePath = path.join(workspaceRoot, ".vscode", ".gitignore");
    const rootIgnorePath = path.join(workspaceRoot, ".gitignore");

    try {
      const ignorePath = ensurePrivateConfigIgnoredForWorkspaceRoot(workspaceRoot);
      assert.strictEqual(ignorePath, vscodeIgnorePath);
      assert.strictEqual(
        fs.readFileSync(vscodeIgnorePath, "utf8"),
        "# Copilot Cockpit private config\nscheduler.private.json\ncockpit-prompt-backups/\ncockpit-input-uploads/\nscheduler-prompt-backups/\n",
      );
      assert.strictEqual(
        fs.readFileSync(rootIgnorePath, "utf8"),
        "# Copilot Cockpit logs\n.copilot-cockpit-logs/\n",
      );
    } finally {
      cleanup(workspaceRoot);
    }
  });

  test("appends missing ignore entries without clobbering existing content", () => {
    const workspaceRoot = createWorkspaceRoot();
    const vscodeIgnorePath = path.join(workspaceRoot, ".vscode", ".gitignore");
    const rootIgnorePath = path.join(workspaceRoot, ".gitignore");

    try {
      fs.mkdirSync(path.dirname(vscodeIgnorePath), { recursive: true });
      fs.writeFileSync(vscodeIgnorePath, "history/\nresearch-history/\n", "utf8");
      fs.writeFileSync(rootIgnorePath, "node_modules/\nout/\n", "utf8");

      const updatedPath = ensurePrivateConfigIgnoredForWorkspaceRoot(workspaceRoot);
      assert.strictEqual(updatedPath, vscodeIgnorePath);
      assert.strictEqual(
        fs.readFileSync(vscodeIgnorePath, "utf8"),
        "history/\nresearch-history/\n\n# Copilot Cockpit private config\nscheduler.private.json\ncockpit-prompt-backups/\ncockpit-input-uploads/\nscheduler-prompt-backups/\n",
      );
      assert.strictEqual(
        fs.readFileSync(rootIgnorePath, "utf8"),
        "node_modules/\nout/\n\n# Copilot Cockpit logs\n.copilot-cockpit-logs/\n",
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
        path.join(workspaceRootA, ".gitignore"),
        path.join(workspaceRootA, ".vscode", ".gitignore"),
        path.join(workspaceRootB, ".gitignore"),
        path.join(workspaceRootB, ".vscode", ".gitignore"),
      ].sort());
    } finally {
      cleanup(workspaceRootA);
      cleanup(workspaceRootB);
    }
  });
});