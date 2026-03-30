import * as assert from "assert";
import * as path from "path";
import {
    getCanonicalPromptBackupPath,
    getDefaultPromptBackupRelativePath,
    renderPromptBackupContent,
    resolvePromptBackupPath,
} from "../../promptBackup";

function normalizePathForTest(value: string | undefined): string {
    if (!value) return "";
    const normalized = path.normalize(path.resolve(value)).replace(/[\\/]+$/, "");
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

suite("Prompt Backup Helpers", () => {
    test("default backup path stays outside .github/prompts", () => {
        const relativePath = getDefaultPromptBackupRelativePath(
            "exec:task/with unsafe chars",
        );

        assert.ok(relativePath.startsWith(".vscode/cockpit-prompt-backups/"));
        assert.strictEqual(relativePath.includes(".github/prompts"), false);
        assert.ok(relativePath.endsWith(".prompt.md"));
    });

    test("default backup path shortens long task ids", () => {
        const relativePath = getDefaultPromptBackupRelativePath(
            "task-" + "very-long-name-".repeat(16),
        );
        const fileName = path.basename(relativePath);

        assert.ok(fileName.length <= 74);
        assert.ok(/-[a-f0-9]{10}\.prompt\.md$/.test(fileName));
    });

    test("resolvePromptBackupPath allows current and legacy backup-root paths only", () => {
        const workspaceRoot = path.join("/tmp", "workspace");
        const resolvedCurrent = resolvePromptBackupPath(
            workspaceRoot,
            ".vscode/cockpit-prompt-backups/test.prompt.md",
        );
        const resolvedLegacyWorkspace = resolvePromptBackupPath(
            workspaceRoot,
            ".vscode/scheduler-prompt-backups/test.prompt.md",
        );
        const resolvedLegacy = resolvePromptBackupPath(
            workspaceRoot,
            ".github/scheduler-prompt-backups/test.prompt.md",
        );
        const rejected = resolvePromptBackupPath(
            workspaceRoot,
            ".github/prompts/test.prompt.md",
        );

        assert.strictEqual(
            normalizePathForTest(resolvedCurrent),
            normalizePathForTest(
                path.join(
                    workspaceRoot,
                    ".vscode",
                    "cockpit-prompt-backups",
                    "test.prompt.md",
                ),
            ),
        );
        assert.strictEqual(
            normalizePathForTest(resolvedLegacyWorkspace),
            normalizePathForTest(
                path.join(
                    workspaceRoot,
                    ".vscode",
                    "scheduler-prompt-backups",
                    "test.prompt.md",
                ),
            ),
        );
        assert.strictEqual(
            normalizePathForTest(resolvedLegacy),
            normalizePathForTest(
                path.join(
                    workspaceRoot,
                    ".github",
                    "scheduler-prompt-backups",
                    "test.prompt.md",
                ),
            ),
        );
        assert.strictEqual(rejected, undefined);
    });

    test("getCanonicalPromptBackupPath rewrites legacy paths into .vscode", () => {
        const workspaceRoot = path.join("/tmp", "workspace");
        const canonical = getCanonicalPromptBackupPath(
            workspaceRoot,
            ".github/scheduler-prompt-backups/test.prompt.md",
        );

        assert.strictEqual(
            normalizePathForTest(canonical),
            normalizePathForTest(
                path.join(
                    workspaceRoot,
                    ".vscode",
                    "cockpit-prompt-backups",
                    "test.prompt.md",
                ),
            ),
        );
    });

    test("renderPromptBackupContent adds metadata header and preserves prompt body", () => {
        const rendered = renderPromptBackupContent(
            {
                id: "todoist-dispatcher",
                name: "Todoist Dispatcher",
                cronExpression: "11 4 1 * *",
                prompt: "Line 1\nLine 2",
            },
            new Date("2026-03-15T12:34:56.000Z"),
        );

        assert.ok(rendered.startsWith("---\nbackupOnly: true\n"));
        assert.ok(rendered.includes('lastUpdated: "2026-03-15"'));
        assert.ok(rendered.endsWith("Line 1\nLine 2\n"));
    });
});