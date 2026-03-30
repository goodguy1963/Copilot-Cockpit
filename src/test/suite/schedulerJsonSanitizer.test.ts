import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createDefaultCockpitBoard } from "../../cockpitBoard";
import {
  getPrivateSchedulerConfigPath,
  readSchedulerConfig,
  wasSchedulerConfigWrittenRecently,
  writeSchedulerConfig,
} from "../../schedulerJsonSanitizer";

suite("Scheduler Json Sanitizer Tests", () => {
  function createWorkspaceRoot(): string {
    return fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-sanitizer-"),
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

  test("keeps cockpit board state private while round-tripping it from the private config", () => {
    const workspaceRoot = createWorkspaceRoot();

    try {
      const board = createDefaultCockpitBoard("2026-03-27T10:00:00.000Z");
      board.cards.push({
        id: "card_1",
        title: "Ship cockpit board",
        sectionId: board.sections[1].id,
        order: 0,
        priority: "high",
        status: "active",
        labels: ["needs-user-review", "new-idea"],
        flags: ["go"],
        comments: [{
          id: "comment_1",
          author: "system",
          body: "Waiting for GO.",
          labels: ["needs-user-review"],
          source: "system-event",
          sequence: 1,
          createdAt: "2026-03-27T10:00:00.000Z",
        }],
        createdAt: "2026-03-27T10:00:00.000Z",
        updatedAt: "2026-03-27T10:00:00.000Z",
      });

      writeSchedulerConfig(workspaceRoot, {
        tasks: [],
        cockpitBoard: board,
        telegramNotification: {
          enabled: true,
          botToken: "123456:abcdefghijklmnopqrstuvwxyzABCDE",
          chatId: "123456789",
          updatedAt: "2026-03-27T10:00:00.000Z",
        },
      });

      const publicConfigPath = path.join(workspaceRoot, ".vscode", "scheduler.json");
      const privateConfigPath = getPrivateSchedulerConfigPath(publicConfigPath);
      const publicContent = fs.readFileSync(publicConfigPath, "utf8");
      const privateContent = fs.readFileSync(privateConfigPath, "utf8");
      const roundTripped = readSchedulerConfig(workspaceRoot);

      assert.ok(!publicContent.includes("cockpitBoard"));
      assert.ok(!publicContent.includes("Ship cockpit board"));
      assert.ok(privateContent.includes("cockpitBoard"));
      assert.ok(privateContent.includes("Ship cockpit board"));
      assert.strictEqual(roundTripped.cockpitBoard?.sections.length, board.sections.length);
      assert.strictEqual(roundTripped.cockpitBoard?.cards[0]?.title, "Ship cockpit board");
      assert.strictEqual(roundTripped.telegramNotification?.botToken, "123456:abcdefghijklmnopqrstuvwxyzABCDE");
    } finally {
      cleanup(workspaceRoot);
    }
  });

  test("tracks recent scheduler config writes for watcher suppression", () => {
    const workspaceRoot = createWorkspaceRoot();

    try {
      const result = writeSchedulerConfig(workspaceRoot, {
        tasks: [],
      });

      assert.strictEqual(result.publicChanged, true);
      assert.strictEqual(result.privateChanged, true);
      assert.strictEqual(
        wasSchedulerConfigWrittenRecently(result.publicPath),
        true,
      );
      assert.strictEqual(
        wasSchedulerConfigWrittenRecently(result.privatePath),
        true,
      );
    } finally {
      cleanup(workspaceRoot);
    }
  });
});