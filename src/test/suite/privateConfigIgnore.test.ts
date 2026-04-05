import * as fs from "fs";
import * as assert from "assert";
import * as path from "path";
import * as os from "os";
import {
  ensurePrivateConfigIgnoredForWorkspaceRoot,
  ensurePrivateConfigIgnoredForWorkspaceRoots,
} from "../../privateConfigIgnore";

function createWorkspaceRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "copilot-cockpit-private-ignore-"));
}

function removeWorkspaceRoot(root: string): void {
  try {
    const cleanupOptions: fs.RmOptions = {};
    cleanupOptions.recursive = true;
    cleanupOptions.force = true;
    cleanupOptions.maxRetries = 3;
    cleanupOptions.retryDelay = 50;
    fs.rmSync(root, cleanupOptions);
  } catch {
    // Best effort cleanup for temp fixtures.
  }
}

function readUtf8(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

suite("Private config ignore behavior", () => {
  test("creates both ignore files with cockpit-private defaults", () => {
    const workspaceRoot = createWorkspaceRoot();
    const vscodeIgnorePath = path.join(workspaceRoot, ".vscode", ".gitignore");
    const rootIgnorePath = path.join(workspaceRoot, ".gitignore");

    try {
      const returnedPath = ensurePrivateConfigIgnoredForWorkspaceRoot(workspaceRoot);
      assert.strictEqual(returnedPath, vscodeIgnorePath);
      assert.strictEqual(
        readUtf8(vscodeIgnorePath),
        "# Copilot Cockpit private config\nscheduler.private.json\ncopilot-cockpit.db\ncopilot-cockpit.db-migration.json\ncopilot-cockpit.private.json\ncockpit-prompt-backups/\ncockpit-input-uploads/\nscheduler-prompt-backups/\ncopilot-cockpit-support/\n",
      );
      assert.strictEqual(
        readUtf8(rootIgnorePath),
        "# Copilot Cockpit logs\n.copilot-cockpit-logs/\n",
      );
    } finally {
      removeWorkspaceRoot(workspaceRoot);
    }
  });

  test("preserves existing ignore content while appending missing cockpit entries", () => {
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
        readUtf8(vscodeIgnorePath),
        "history/\nresearch-history/\n\n# Copilot Cockpit private config\nscheduler.private.json\ncopilot-cockpit.db\ncopilot-cockpit.db-migration.json\ncopilot-cockpit.private.json\ncockpit-prompt-backups/\ncockpit-input-uploads/\nscheduler-prompt-backups/\ncopilot-cockpit-support/\n",
      );
      assert.strictEqual(
        readUtf8(rootIgnorePath),
        "node_modules/\nout/\n\n# Copilot Cockpit logs\n.copilot-cockpit-logs/\n",
      );
      assert.strictEqual(
        ensurePrivateConfigIgnoredForWorkspaceRoot(workspaceRoot),
        undefined,
      );
    } finally {
      removeWorkspaceRoot(workspaceRoot);
    }
  });

  test("updates several workspace roots in one pass", () => {
    const firstRoot = createWorkspaceRoot();
    const secondRoot = createWorkspaceRoot();

    try {
      const updatedPaths = ensurePrivateConfigIgnoredForWorkspaceRoots([
        firstRoot,
        secondRoot,
      ]);

      assert.deepStrictEqual(
        updatedPaths.sort(),
        [
          path.join(firstRoot, ".gitignore"),
          path.join(firstRoot, ".vscode", ".gitignore"),
          path.join(secondRoot, ".gitignore"),
          path.join(secondRoot, ".vscode", ".gitignore"),
        ].sort(),
      );
    } finally {
      removeWorkspaceRoot(firstRoot);
      removeWorkspaceRoot(secondRoot);
    }
  });
});
