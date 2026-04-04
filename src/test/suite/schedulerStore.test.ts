import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { REDACTED_DISCORD_WEBHOOK_URL } from "../../schedulerJsonSanitizer";
import {
  findWorkspaceRoot,
  getActiveSchedulerReadPath,
  getPrivateSchedulerConfigPath,
  readSchedulerConfig,
  writeSchedulerConfig,
} from "../../schedulerStore";

suite("SchedulerStore Tests", () => {
  let workspaceRoot: string;

  setup(() => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-cockpit-store-"));
  });

  teardown(() => {
    try {
      fs.rmSync(workspaceRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    } catch {
      // ignore cleanup failures in tests
    }
  });

  test("getPrivateSchedulerConfigPath returns the sibling private config path", () => {
    assert.strictEqual(
      getPrivateSchedulerConfigPath(path.join(workspaceRoot, ".vscode", "scheduler.json")),
      path.join(workspaceRoot, ".vscode", "scheduler.private.json"),
    );
  });

  test("findWorkspaceRoot walks up to the nearest workspace with scheduler config", () => {
    const nestedRoot = path.join(workspaceRoot, "packages", "feature", "src");
    fs.mkdirSync(path.join(workspaceRoot, ".vscode"), { recursive: true });
    fs.mkdirSync(nestedRoot, { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, ".vscode", "scheduler.json"), JSON.stringify({ tasks: [] }), "utf8");

    assert.strictEqual(findWorkspaceRoot(nestedRoot), workspaceRoot);
  });

  test("findWorkspaceRoot falls back to the current working directory when no config exists", () => {
    const nestedRoot = path.join(workspaceRoot, "packages", "feature", "src");
    fs.mkdirSync(nestedRoot, { recursive: true });

    assert.strictEqual(findWorkspaceRoot(nestedRoot), process.cwd());
  });

  test("getActiveSchedulerReadPath prefers the newer valid private config over an older public config", () => {
    const vscodeDir = path.join(workspaceRoot, ".vscode");
    const publicPath = path.join(vscodeDir, "scheduler.json");
    const privatePath = path.join(vscodeDir, "scheduler.private.json");

    fs.mkdirSync(vscodeDir, { recursive: true });
    fs.writeFileSync(publicPath, JSON.stringify({ tasks: [{ id: "public" }] }), "utf8");
    fs.writeFileSync(privatePath, JSON.stringify({ tasks: [{ id: "private" }] }), "utf8");

    const older = new Date("2026-04-04T10:00:00.000Z");
    const newer = new Date("2026-04-04T11:00:00.000Z");
    fs.utimesSync(publicPath, older, older);
    fs.utimesSync(privatePath, newer, newer);

    assert.strictEqual(getActiveSchedulerReadPath(workspaceRoot), privatePath);
  });

  test("getActiveSchedulerReadPath falls back to the valid public config when private is invalid", () => {
    const vscodeDir = path.join(workspaceRoot, ".vscode");
    const publicPath = path.join(vscodeDir, "scheduler.json");
    const privatePath = path.join(vscodeDir, "scheduler.private.json");

    fs.mkdirSync(vscodeDir, { recursive: true });
    fs.writeFileSync(publicPath, JSON.stringify({ tasks: [{ id: "public" }] }), "utf8");
    fs.writeFileSync(privatePath, "not-json", "utf8");

    assert.strictEqual(getActiveSchedulerReadPath(workspaceRoot), publicPath);
  });

  test("readSchedulerConfig strips a leading BOM", () => {
    const vscodeDir = path.join(workspaceRoot, ".vscode");
    const publicPath = path.join(vscodeDir, "scheduler.json");

    fs.mkdirSync(vscodeDir, { recursive: true });
    fs.writeFileSync(publicPath, "\uFEFF{\"tasks\":[{\"id\":\"bom-task\"}]}", "utf8");

    assert.deepStrictEqual(readSchedulerConfig(workspaceRoot), {
      tasks: [{ id: "bom-task" }],
    });
  });

  test("writeSchedulerConfig writes a sanitized public file and full private file", () => {
    const webhookUrl = "https://discord.com/api/webhooks/123456/abcdef";
    const config = {
      tasks: [{
        id: "task-1",
        name: "Task 1",
        prompt: webhookUrl,
      }],
    };
    const vscodeDir = path.join(workspaceRoot, ".vscode");
    const publicPath = path.join(vscodeDir, "scheduler.json");
    const privatePath = path.join(vscodeDir, "scheduler.private.json");

    writeSchedulerConfig(workspaceRoot, config);

    const publicRaw = fs.readFileSync(publicPath, "utf8");
    const privateRaw = fs.readFileSync(privatePath, "utf8");
    const publicConfig = JSON.parse(publicRaw) as { tasks: Array<{ prompt: string }> };
    const privateConfig = JSON.parse(privateRaw) as { tasks: Array<{ prompt: string }> };

    assert.ok(publicRaw.includes(REDACTED_DISCORD_WEBHOOK_URL));
    assert.ok(!publicRaw.includes(webhookUrl));
    assert.ok(privateRaw.includes(webhookUrl));
    assert.strictEqual(publicConfig.tasks[0]?.prompt, REDACTED_DISCORD_WEBHOOK_URL);
    assert.strictEqual(privateConfig.tasks[0]?.prompt, webhookUrl);
    assert.strictEqual(readSchedulerConfig(workspaceRoot).tasks.length, config.tasks.length);
  });

  test("writeSchedulerConfig rejects invalid configs without a tasks array", () => {
    assert.throws(
      () => writeSchedulerConfig(workspaceRoot, {} as { tasks: any[] }),
      /Invalid config format: 'tasks' array is missing\./,
    );
  });

  test("readSchedulerConfig returns empty tasks list when no config files exist", () => {
    const result = readSchedulerConfig(workspaceRoot);

    assert.deepStrictEqual(result, { tasks: [] });
  });

  test("readSchedulerConfig returns empty tasks list when the file contains malformed JSON", () => {
    const vscodeDir = path.join(workspaceRoot, ".vscode");
    const publicPath = path.join(vscodeDir, "scheduler.json");

    fs.mkdirSync(vscodeDir, { recursive: true });
    fs.writeFileSync(publicPath, "{ this is not JSON }", "utf8");

    const result = readSchedulerConfig(workspaceRoot);

    assert.deepStrictEqual(result, { tasks: [] });
  });

  test("getActiveSchedulerReadPath returns the private path when only the private file exists", () => {
    const vscodeDir = path.join(workspaceRoot, ".vscode");
    const privatePath = path.join(vscodeDir, "scheduler.private.json");

    fs.mkdirSync(vscodeDir, { recursive: true });
    fs.writeFileSync(privatePath, JSON.stringify({ tasks: [{ id: "only-private" }] }), "utf8");

    assert.strictEqual(getActiveSchedulerReadPath(workspaceRoot), privatePath);
  });
});