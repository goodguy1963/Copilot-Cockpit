import * as fs from "fs";
import * as assert from "assert";
import * as path from "path";
import * as os from "os";
import {
  applyPrivateConfigIgnoreForWorkspaceRoot,
  isAutoIgnorePrivateFilesEnabledForWorkspaceRoot,
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

  test("defaults auto ignore to enabled when the workspace setting is absent", () => {
    const workspaceRoot = createWorkspaceRoot();

    try {
      assert.strictEqual(
        isAutoIgnorePrivateFilesEnabledForWorkspaceRoot(workspaceRoot),
        true,
      );
    } finally {
      removeWorkspaceRoot(workspaceRoot);
    }
  });

  test("skips future ignore writes when the workspace setting disables auto ignore", () => {
    const workspaceRoot = createWorkspaceRoot();
    const settingsPath = path.join(workspaceRoot, ".vscode", "settings.json");
    const vscodeIgnorePath = path.join(workspaceRoot, ".vscode", ".gitignore");
    const rootIgnorePath = path.join(workspaceRoot, ".gitignore");

    try {
      fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
      fs.writeFileSync(
        settingsPath,
        [
          "{",
          "  // Per-project opt-out for local-only files.",
          '  "copilotCockpit.autoIgnorePrivateFiles": false,',
          "}",
          "",
        ].join("\n"),
        "utf8",
      );

      assert.strictEqual(
        isAutoIgnorePrivateFilesEnabledForWorkspaceRoot(workspaceRoot),
        false,
      );
      assert.strictEqual(
        ensurePrivateConfigIgnoredForWorkspaceRoot(workspaceRoot),
        undefined,
      );
      assert.strictEqual(
        fs.existsSync(vscodeIgnorePath),
        false,
      );
      assert.strictEqual(
        fs.existsSync(rootIgnorePath),
        false,
      );
    } finally {
      removeWorkspaceRoot(workspaceRoot);
    }
  });

  test("force apply writes ignore entries without waiting for settings file reread", () => {
    const workspaceRoot = createWorkspaceRoot();
    const settingsPath = path.join(workspaceRoot, ".vscode", "settings.json");
    const vscodeIgnorePath = path.join(workspaceRoot, ".vscode", ".gitignore");
    const rootIgnorePath = path.join(workspaceRoot, ".gitignore");

    try {
      fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
      fs.writeFileSync(
        settingsPath,
        '{\n  "copilotCockpit.autoIgnorePrivateFiles": false\n}\n',
        "utf8",
      );

      assert.strictEqual(
        ensurePrivateConfigIgnoredForWorkspaceRoot(workspaceRoot),
        undefined,
      );
      assert.strictEqual(
        applyPrivateConfigIgnoreForWorkspaceRoot(workspaceRoot),
        vscodeIgnorePath,
      );
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

  test("multi-root updates skip roots with auto ignore disabled", () => {
    const firstRoot = createWorkspaceRoot();
    const secondRoot = createWorkspaceRoot();
    const firstSettingsPath = path.join(firstRoot, ".vscode", "settings.json");

    try {
      fs.mkdirSync(path.dirname(firstSettingsPath), { recursive: true });
      fs.writeFileSync(
        firstSettingsPath,
        '{\n  "copilotCockpit.autoIgnorePrivateFiles": false\n}\n',
        "utf8",
      );

      const updatedPaths = ensurePrivateConfigIgnoredForWorkspaceRoots([
        firstRoot,
        secondRoot,
      ]);

      assert.deepStrictEqual(
        updatedPaths.sort(),
        [
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
