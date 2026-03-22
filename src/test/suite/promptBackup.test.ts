import * as assert from "assert";
import * as path from "path";
import {
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

        assert.ok(relativePath.startsWith(".github/scheduler-prompt-backups/"));
        assert.strictEqual(relativePath.includes(".github/prompts"), false);
        assert.ok(relativePath.endsWith(".prompt.md"));
    });

    test("resolvePromptBackupPath allows backup-root relative paths only", () => {
        const workspaceRoot = path.join("/tmp", "workspace");
        const resolved = resolvePromptBackupPath(
            workspaceRoot,
            ".github/scheduler-prompt-backups/test.prompt.md",
        );
        const rejected = resolvePromptBackupPath(
            workspaceRoot,
            ".github/prompts/test.prompt.md",
        );

        assert.strictEqual(
            normalizePathForTest(resolved),
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