import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import * as vm from "vm";
import { messages } from "../../i18n";
import { SchedulerWebview } from "../../schedulerWebview";

type WebviewLike = {
  postMessage: (message: unknown) => Thenable<boolean>;
};

type WebviewPanelLike = {
  webview: WebviewLike;
};

suite("SchedulerWebview Message Queue Tests", () => {
  test("webview client script parses", () => {
    const scriptPath = path.resolve(
      __dirname,
      "../../../media/schedulerWebview.js",
    );
    const scriptSource = fs.readFileSync(scriptPath, "utf8");

    assert.doesNotThrow(() => {
      new vm.Script(scriptSource, { filename: scriptPath });
    });
  });

  test("Queues messages until ready and flushes (dedup by type)", () => {
    const wv = SchedulerWebview as unknown as {
      panel?: WebviewPanelLike;
      webviewReady?: boolean;
      pendingMessages?: unknown[];
      postMessage?: (message: unknown) => void;
      flushPendingMessages?: () => void;
    };

    const originalPanel = wv.panel;
    const originalReady = wv.webviewReady;
    const originalPending = wv.pendingMessages;

    const sent: unknown[] = [];

    try {
      wv.panel = {
        webview: {
          postMessage: (message: unknown) => {
            sent.push(message);
            return Promise.resolve(true);
          },
        },
      };

      wv.webviewReady = false;
      wv.pendingMessages = [];

      assert.ok(typeof wv.postMessage === "function");
      assert.ok(typeof wv.flushPendingMessages === "function");

      wv.postMessage({ type: "updateTasks", tasks: [1] });
      wv.postMessage({ type: "updateTasks", tasks: [2] });
      wv.postMessage({ type: "updateAgents", agents: ["a"] });

      const queued = wv.pendingMessages as Array<{
        type?: unknown;
        [k: string]: unknown;
      }>;
      assert.strictEqual(queued.length, 2);

      const updateTasks = queued.find((m) => m.type === "updateTasks") as
        | { tasks?: unknown }
        | undefined;
      assert.ok(updateTasks);
      assert.deepStrictEqual(updateTasks?.tasks, [2]);

      wv.webviewReady = true;
      wv.flushPendingMessages();

      assert.strictEqual(sent.length, 2);

      const sentMessages = sent as Array<{
        type?: unknown;
        [k: string]: unknown;
      }>;
      const sentUpdateTasks = sentMessages.find(
        (m) => m.type === "updateTasks",
      ) as { tasks?: unknown } | undefined;
      assert.ok(sentUpdateTasks);
      assert.deepStrictEqual(sentUpdateTasks?.tasks, [2]);

      const sentUpdateAgents = sentMessages.find(
        (m) => m.type === "updateAgents",
      ) as { agents?: unknown } | undefined;
      assert.ok(sentUpdateAgents);
      assert.deepStrictEqual(sentUpdateAgents?.agents, ["a"]);

      assert.strictEqual((wv.pendingMessages ?? []).length, 0);
    } finally {
      wv.panel = originalPanel;
      wv.webviewReady = originalReady;
      wv.pendingMessages = originalPending;
    }
  });

  test("Queues schedule history updates until ready", () => {
    const wv = SchedulerWebview as unknown as {
      panel?: WebviewPanelLike;
      webviewReady?: boolean;
      pendingMessages?: unknown[];
      updateScheduleHistory?: (entries: unknown[]) => void;
      flushPendingMessages?: () => void;
    };

    const originalPanel = wv.panel;
    const originalReady = wv.webviewReady;
    const originalPending = wv.pendingMessages;
    const sent: unknown[] = [];

    try {
      wv.panel = {
        webview: {
          postMessage: (message: unknown) => {
            sent.push(message);
            return Promise.resolve(true);
          },
        },
      };
      wv.webviewReady = false;
      wv.pendingMessages = [];

      assert.ok(typeof wv.updateScheduleHistory === "function");
      wv.updateScheduleHistory!([{ id: "1", createdAt: "2026-03-23T00:00:00.000Z", hasPrivate: true }]);

      const queued = wv.pendingMessages as Array<{ type?: unknown }>;
      assert.strictEqual(queued.length, 1);
      assert.strictEqual(queued[0]?.type, "updateScheduleHistory");

      wv.webviewReady = true;
      wv.flushPendingMessages!();

      assert.strictEqual(sent.length, 1);
      const message = sent[0] as { type?: unknown; entries?: unknown[] };
      assert.strictEqual(message.type, "updateScheduleHistory");
      assert.strictEqual(Array.isArray(message.entries), true);
    } finally {
      wv.panel = originalPanel;
      wv.webviewReady = originalReady;
      wv.pendingMessages = originalPending;
    }
  });

  test("Queues research state updates until ready", () => {
    const wv = SchedulerWebview as unknown as {
      panel?: WebviewPanelLike;
      webviewReady?: boolean;
      pendingMessages?: unknown[];
      updateResearchState?: (
        profiles: unknown[],
        activeRun: unknown,
        recentRuns: unknown[],
      ) => void;
      flushPendingMessages?: () => void;
    };

    const originalPanel = wv.panel;
    const originalReady = wv.webviewReady;
    const originalPending = wv.pendingMessages;
    const sent: unknown[] = [];

    try {
      wv.panel = {
        webview: {
          postMessage: (message: unknown) => {
            sent.push(message);
            return Promise.resolve(true);
          },
        },
      };
      wv.webviewReady = false;
      wv.pendingMessages = [];

      assert.ok(typeof wv.updateResearchState === "function");
      wv.updateResearchState!(
        [{ id: "profile-1", name: "Research" }],
        { id: "run-1", status: "running" },
        [{ id: "run-1", status: "running" }],
      );

      const queued = wv.pendingMessages as Array<{ type?: unknown }>;
      assert.strictEqual(queued.length, 1);
      assert.strictEqual(queued[0]?.type, "updateResearchState");

      wv.webviewReady = true;
      wv.flushPendingMessages!();

      assert.strictEqual(sent.length, 1);
      const message = sent[0] as {
        type?: unknown;
        profiles?: unknown[];
        recentRuns?: unknown[];
        activeRun?: { id?: string };
      };
      assert.strictEqual(message.type, "updateResearchState");
      assert.strictEqual(Array.isArray(message.profiles), true);
      assert.strictEqual(Array.isArray(message.recentRuns), true);
      assert.strictEqual(message.activeRun?.id, "run-1");
    } finally {
      wv.panel = originalPanel;
      wv.webviewReady = originalReady;
      wv.pendingMessages = originalPending;
    }
  });

  test("Queues Telegram notification updates until ready", () => {
    const wv = SchedulerWebview as unknown as {
      panel?: WebviewPanelLike;
      webviewReady?: boolean;
      pendingMessages?: unknown[];
      updateTelegramNotification?: (telegramNotification: unknown) => void;
      flushPendingMessages?: () => void;
    };

    const originalPanel = wv.panel;
    const originalReady = wv.webviewReady;
    const originalPending = wv.pendingMessages;
    const sent: unknown[] = [];

    try {
      wv.panel = {
        webview: {
          postMessage: (message: unknown) => {
            sent.push(message);
            return Promise.resolve(true);
          },
        },
      };
      wv.webviewReady = false;
      wv.pendingMessages = [];

      assert.ok(typeof wv.updateTelegramNotification === "function");
      wv.updateTelegramNotification!({
        enabled: true,
        chatId: "123456789",
        hasBotToken: true,
        hookConfigured: true,
      });

      const queued = wv.pendingMessages as Array<{ type?: unknown }>;
      assert.strictEqual(queued.length, 1);
      assert.strictEqual(queued[0]?.type, "updateTelegramNotification");

      wv.webviewReady = true;
      wv.flushPendingMessages!();

      assert.strictEqual(sent.length, 1);
      const message = sent[0] as {
        type?: unknown;
        telegramNotification?: { enabled?: boolean; hasBotToken?: boolean };
      };
      assert.strictEqual(message.type, "updateTelegramNotification");
      assert.strictEqual(message.telegramNotification?.enabled, true);
      assert.strictEqual(message.telegramNotification?.hasBotToken, true);
    } finally {
      wv.panel = originalPanel;
      wv.webviewReady = originalReady;
      wv.pendingMessages = originalPending;
    }
  });

  test("Queues execution default updates until ready", () => {
    const wv = SchedulerWebview as unknown as {
      panel?: WebviewPanelLike;
      webviewReady?: boolean;
      pendingMessages?: unknown[];
      updateExecutionDefaults?: (executionDefaults: unknown) => void;
      flushPendingMessages?: () => void;
    };

    const originalPanel = wv.panel;
    const originalReady = wv.webviewReady;
    const originalPending = wv.pendingMessages;
    const sent: unknown[] = [];

    try {
      wv.panel = {
        webview: {
          postMessage: (message: unknown) => {
            sent.push(message);
            return Promise.resolve(true);
          },
        },
      };
      wv.webviewReady = false;
      wv.pendingMessages = [];

      assert.ok(typeof wv.updateExecutionDefaults === "function");
      wv.updateExecutionDefaults!({
        agent: "agent",
        model: "gpt-test",
      });

      const queued = wv.pendingMessages as Array<{ type?: unknown }>;
      assert.strictEqual(queued.length, 1);
      assert.strictEqual(queued[0]?.type, "updateExecutionDefaults");

      wv.webviewReady = true;
      wv.flushPendingMessages!();

      assert.strictEqual(sent.length, 1);
      const message = sent[0] as {
        type?: unknown;
        executionDefaults?: { agent?: string; model?: string };
      };
      assert.strictEqual(message.type, "updateExecutionDefaults");
      assert.strictEqual(message.executionDefaults?.agent, "agent");
      assert.strictEqual(message.executionDefaults?.model, "gpt-test");
    } finally {
      wv.panel = originalPanel;
      wv.webviewReady = originalReady;
      wv.pendingMessages = originalPending;
    }
  });

  test("Queues cockpit board updates until ready", () => {
    const wv = SchedulerWebview as unknown as {
      panel?: WebviewPanelLike;
      webviewReady?: boolean;
      pendingMessages?: unknown[];
      updateCockpitBoard?: (cockpitBoard: unknown) => void;
      flushPendingMessages?: () => void;
    };

    const originalPanel = wv.panel;
    const originalReady = wv.webviewReady;
    const originalPending = wv.pendingMessages;
    const sent: unknown[] = [];

    try {
      wv.panel = {
        webview: {
          postMessage: (message: unknown) => {
            sent.push(message);
            return Promise.resolve(true);
          },
        },
      };
      wv.webviewReady = false;
      wv.pendingMessages = [];

      assert.ok(typeof wv.updateCockpitBoard === "function");
      wv.updateCockpitBoard!({
        version: 1,
        sections: [{ id: "section_0", title: "Bugs", order: 0 }],
        cards: [{ id: "card_1", title: "Fix config leak", sectionId: "section_0", order: 0 }],
      });

      const queued = wv.pendingMessages as Array<{ type?: unknown }>;
      assert.strictEqual(queued.length, 1);
      assert.strictEqual(queued[0]?.type, "updateCockpitBoard");

      wv.webviewReady = true;
      wv.flushPendingMessages!();

      assert.strictEqual(sent.length, 1);
      const message = sent[0] as {
        type?: unknown;
        cockpitBoard?: { sections?: unknown[]; cards?: unknown[] };
      };
      assert.strictEqual(message.type, "updateCockpitBoard");
      assert.strictEqual(message.cockpitBoard?.sections?.length, 1);
      assert.strictEqual(message.cockpitBoard?.cards?.length, 1);
    } finally {
      wv.panel = originalPanel;
      wv.webviewReady = originalReady;
      wv.pendingMessages = originalPending;
    }
  });
});

suite("SchedulerWebview Jobs Request Tests", () => {
  test("requestCreateJob uses VS Code input boxes and dispatches createJob", async () => {
    const wv = SchedulerWebview as unknown as {
      handleMessage?: (message: unknown) => Promise<void>;
      onTaskActionCallback?: ((action: unknown) => void) | undefined;
    };

    const originalAction = wv.onTaskActionCallback;
    const originalShowInputBox = (vscode.window as any).showInputBox;
    const actions: unknown[] = [];
    let promptCount = 0;

    try {
      wv.onTaskActionCallback = (action: unknown) => {
        actions.push(action);
      };
      (vscode.window as any).showInputBox = async () => {
        promptCount += 1;
        return "Morning Review";
      };

      assert.ok(typeof wv.handleMessage === "function");
      await wv.handleMessage!({
        type: "requestCreateJob",
        folderId: "folder-1",
      });

      assert.strictEqual(promptCount, 1);
      assert.strictEqual(actions.length, 1);
      assert.deepStrictEqual(actions[0], {
        action: "createJob",
        taskId: "__job__",
        jobData: {
          name: "Morning Review",
          cronExpression: "0 9 * * 1-5",
          folderId: "folder-1",
        },
      });
    } finally {
      wv.onTaskActionCallback = originalAction;
      (vscode.window as any).showInputBox = originalShowInputBox;
    }
  });

  test("requestDeleteJobFolder confirms before dispatching deleteJobFolder", async () => {
    const wv = SchedulerWebview as unknown as {
      handleMessage?: (message: unknown) => Promise<void>;
      onTaskActionCallback?: ((action: unknown) => void) | undefined;
      currentJobFolders?: Array<{ id: string; name: string }>;
    };

    const originalAction = wv.onTaskActionCallback;
    const originalFolders = wv.currentJobFolders;
    const originalShowWarningMessage = (vscode.window as any).showWarningMessage;
    const actions: unknown[] = [];

    try {
      wv.onTaskActionCallback = (action: unknown) => {
        actions.push(action);
      };
      wv.currentJobFolders = [{ id: "folder-1", name: "Ops" }];
      (vscode.window as any).showWarningMessage = async () => "Yes, delete";

      assert.ok(typeof wv.handleMessage === "function");
      await wv.handleMessage!({
        type: "requestDeleteJobFolder",
        folderId: "folder-1",
      });

      assert.strictEqual(actions.length, 1);
      assert.deepStrictEqual(actions[0], {
        action: "deleteJobFolder",
        taskId: "__jobfolder__",
        folderId: "folder-1",
      });
    } finally {
      wv.onTaskActionCallback = originalAction;
      wv.currentJobFolders = originalFolders;
      (vscode.window as any).showWarningMessage = originalShowWarningMessage;
    }
  });

  test("requestDeleteJobTask can detach from workflow without deleting the task", async () => {
    const wv = SchedulerWebview as unknown as {
      handleMessage?: (message: unknown) => Promise<void>;
      onTaskActionCallback?: ((action: unknown) => void) | undefined;
      currentJobs?: Array<{
        id: string;
        nodes: Array<{ id: string; taskId: string }>;
      }>;
      currentTasks?: Array<{ id: string; name: string }>;
    };

    const originalAction = wv.onTaskActionCallback;
    const originalJobs = wv.currentJobs;
    const originalTasks = wv.currentTasks;
    const originalShowWarningMessage = (vscode.window as any).showWarningMessage;
    const actions: unknown[] = [];

    try {
      wv.onTaskActionCallback = (action: unknown) => {
        actions.push(action);
      };
      wv.currentJobs = [{ id: "job-1", nodes: [{ id: "node-1", taskId: "task-1" }] }];
      wv.currentTasks = [{ id: "task-1", name: "Review prompt" }];
      (vscode.window as any).showWarningMessage = async () => messages.confirmDeleteJobStepDetachOnly();

      assert.ok(typeof wv.handleMessage === "function");
      await wv.handleMessage!({
        type: "requestDeleteJobTask",
        jobId: "job-1",
        nodeId: "node-1",
      });

      assert.strictEqual(actions.length, 1);
      assert.deepStrictEqual(actions[0], {
        action: "detachTaskFromJob",
        taskId: "__jobtask__",
        jobId: "job-1",
        nodeId: "node-1",
      });
    } finally {
      wv.onTaskActionCallback = originalAction;
      wv.currentJobs = originalJobs;
      wv.currentTasks = originalTasks;
      (vscode.window as any).showWarningMessage = originalShowWarningMessage;
    }
  });

  test("requestDeleteJobTask can delete the task entirely", async () => {
    const wv = SchedulerWebview as unknown as {
      handleMessage?: (message: unknown) => Promise<void>;
      onTaskActionCallback?: ((action: unknown) => void) | undefined;
      currentJobs?: Array<{
        id: string;
        nodes: Array<{ id: string; taskId: string }>;
      }>;
      currentTasks?: Array<{ id: string; name: string }>;
    };

    const originalAction = wv.onTaskActionCallback;
    const originalJobs = wv.currentJobs;
    const originalTasks = wv.currentTasks;
    const originalShowWarningMessage = (vscode.window as any).showWarningMessage;
    const actions: unknown[] = [];

    try {
      wv.onTaskActionCallback = (action: unknown) => {
        actions.push(action);
      };
      wv.currentJobs = [{ id: "job-1", nodes: [{ id: "node-1", taskId: "task-1" }] }];
      wv.currentTasks = [{ id: "task-1", name: "Review prompt" }];
      (vscode.window as any).showWarningMessage = async () => messages.confirmDeleteJobStepDeleteTask();

      assert.ok(typeof wv.handleMessage === "function");
      await wv.handleMessage!({
        type: "requestDeleteJobTask",
        jobId: "job-1",
        nodeId: "node-1",
      });

      assert.strictEqual(actions.length, 1);
      assert.deepStrictEqual(actions[0], {
        action: "deleteJobTask",
        taskId: "__jobtask__",
        jobId: "job-1",
        nodeId: "node-1",
      });
    } finally {
      wv.onTaskActionCallback = originalAction;
      wv.currentJobs = originalJobs;
      wv.currentTasks = originalTasks;
      (vscode.window as any).showWarningMessage = originalShowWarningMessage;
    }
  });

  test("createJobPause and compileJob forward the expected task actions", async () => {
    const wv = SchedulerWebview as unknown as {
      handleMessage?: (message: unknown) => Promise<void>;
      onTaskActionCallback?: ((action: unknown) => void) | undefined;
    };

    const originalAction = wv.onTaskActionCallback;
    const actions: unknown[] = [];

    try {
      wv.onTaskActionCallback = (action: unknown) => {
        actions.push(action);
      };

      assert.ok(typeof wv.handleMessage === "function");
      await wv.handleMessage!({
        type: "createJobPause",
        jobId: "job-1",
        data: { title: "Review checkpoint" },
      });
      await wv.handleMessage!({
        type: "compileJob",
        jobId: "job-1",
      });

      assert.deepStrictEqual(actions, [
        {
          action: "createJobPause",
          taskId: "__jobpause__",
          jobId: "job-1",
          pauseData: { title: "Review checkpoint" },
        },
        {
          action: "compileJob",
          taskId: "__job__",
          jobId: "job-1",
        },
      ]);
    } finally {
      wv.onTaskActionCallback = originalAction;
    }
  });

  test("requestRenameJobPause and requestDeleteJobPause prompt before dispatching", async () => {
    const wv = SchedulerWebview as unknown as {
      handleMessage?: (message: unknown) => Promise<void>;
      onTaskActionCallback?: ((action: unknown) => void) | undefined;
      currentJobs?: Array<{
        id: string;
        nodes: Array<{ id: string; type?: string; title?: string }>;
      }>;
    };

    const originalAction = wv.onTaskActionCallback;
    const originalJobs = wv.currentJobs;
    const originalShowInputBox = (vscode.window as any).showInputBox;
    const originalShowWarningMessage = (vscode.window as any).showWarningMessage;
    const actions: unknown[] = [];

    try {
      wv.onTaskActionCallback = (action: unknown) => {
        actions.push(action);
      };
      wv.currentJobs = [{
        id: "job-1",
        nodes: [{ id: "pause-1", type: "pause", title: "Review" }],
      }];
      (vscode.window as any).showInputBox = async () => "Updated Review";
      (vscode.window as any).showWarningMessage = async () => "Yes, delete";

      assert.ok(typeof wv.handleMessage === "function");
      await wv.handleMessage!({
        type: "requestRenameJobPause",
        jobId: "job-1",
        nodeId: "pause-1",
      });
      await wv.handleMessage!({
        type: "requestDeleteJobPause",
        jobId: "job-1",
        nodeId: "pause-1",
      });

      assert.deepStrictEqual(actions, [
        {
          action: "updateJobPause",
          taskId: "__jobpause__",
          jobId: "job-1",
          nodeId: "pause-1",
          pauseUpdateData: { title: "Updated Review" },
        },
        {
          action: "deleteJobPause",
          taskId: "__jobpause__",
          jobId: "job-1",
          nodeId: "pause-1",
        },
      ]);
    } finally {
      wv.onTaskActionCallback = originalAction;
      wv.currentJobs = originalJobs;
      (vscode.window as any).showInputBox = originalShowInputBox;
      (vscode.window as any).showWarningMessage = originalShowWarningMessage;
    }
  });
});

suite("SchedulerWebview Error Detail Sanitization Tests", () => {
  test("Sanitizes absolute paths to basenames (Windows and POSIX)", () => {
    const wv = SchedulerWebview as unknown as {
      sanitizeErrorDetailsForUser?: (message: string) => string;
    };

    assert.ok(typeof wv.sanitizeErrorDetailsForUser === "function");

    const sanitize = wv.sanitizeErrorDetailsForUser!;

    const win =
      "ENOENT: no such file or directory, open 'C:\\Users\\me\\secret folder\\a b.md'";
    const winOut = sanitize(win);
    assert.ok(!winOut.includes("C:\\Users\\me"));
    assert.ok(winOut.includes("'a b.md'"));

    const posix =
      "ENOENT: no such file or directory, open '/Users/me/secret folder/a b.md'";
    const posixOut = sanitize(posix);
    assert.ok(!posixOut.includes("/Users/me/secret folder"));
    assert.ok(posixOut.includes("'a b.md'"));

    const posixUnquoted = "open /Users/me/a.md";
    const posixUnquotedOut = sanitize(posixUnquoted);
    assert.ok(!posixUnquotedOut.includes("/Users/me/"));
    assert.ok(posixUnquotedOut.includes("a.md"));

    const posixParen = "at foo (/Users/me/a.md:1:2)";
    const posixParenOut = sanitize(posixParen);
    assert.ok(!posixParenOut.includes("/Users/me/"));
    assert.ok(posixParenOut.includes("(a.md:1:2)"));

    const winForward = "open C:/Users/me/a.md";
    const winForwardOut = sanitize(winForward);
    assert.ok(!winForwardOut.includes("C:/Users/me/"));
    assert.ok(winForwardOut.includes("a.md"));

    const uncPath = "open \\\\server\\share\\secret\\a.md";
    const uncOut = sanitize(uncPath);
    assert.ok(!uncOut.includes("\\\\server\\share"));
    assert.ok(uncOut.includes("a.md"));

    const fileUri = "open file:///C:/Users/me/secret%20folder/a%20b.md";
    const fileUriOut = sanitize(fileUri);
    assert.ok(!fileUriOut.includes("file:///C:/Users/me"));
    assert.ok(fileUriOut.includes("a b.md"));

    const fileUriHost = "open file://server/share/secret/a.md";
    const fileUriHostOut = sanitize(fileUriHost);
    assert.ok(!fileUriHostOut.includes("file://server/share"));
    assert.ok(fileUriHostOut.includes("a.md"));

    const webUrl = "see https://example.com/path";
    const webUrlOut = sanitize(webUrl);
    assert.strictEqual(webUrlOut, webUrl);
  });
});

suite("SchedulerWebview showError Sanitization Tests", () => {
  test("focusJob posts job selection message", () => {
    const wv = SchedulerWebview as unknown as {
      panel?: WebviewPanelLike;
      webviewReady?: boolean;
      pendingMessages?: unknown[];
    };

    const originalPanel = wv.panel;
    const originalReady = wv.webviewReady;
    const originalPending = wv.pendingMessages;

    const sent: unknown[] = [];

    try {
      wv.panel = {
        webview: {
          postMessage: (message: unknown) => {
            sent.push(message);
            return Promise.resolve(true);
          },
        },
      };
      wv.webviewReady = true;
      wv.pendingMessages = [];

      SchedulerWebview.focusJob("job-1", "folder-1");

      assert.strictEqual(sent.length, 1);
      const message = sent[0] as {
        type?: unknown;
        jobId?: unknown;
        folderId?: unknown;
      };
      assert.strictEqual(message.type, "focusJob");
      assert.strictEqual(message.jobId, "job-1");
      assert.strictEqual(message.folderId, "folder-1");
    } finally {
      wv.panel = originalPanel;
      wv.webviewReady = originalReady;
      wv.pendingMessages = originalPending;
    }
  });

  test("showError sanitizes absolute paths before posting", () => {
    const wv = SchedulerWebview as unknown as {
      panel?: WebviewPanelLike;
      webviewReady?: boolean;
      pendingMessages?: unknown[];
    };

    const originalPanel = wv.panel;
    const originalReady = wv.webviewReady;
    const originalPending = wv.pendingMessages;

    const sent: unknown[] = [];

    try {
      wv.panel = {
        webview: {
          postMessage: (message: unknown) => {
            sent.push(message);
            return Promise.resolve(true);
          },
        },
      };
      wv.webviewReady = true;
      wv.pendingMessages = [];

      SchedulerWebview.showError(
        "ENOENT: no such file or directory, open 'C:\\Users\\me\\secret folder\\a b.md'",
      );

      assert.strictEqual(sent.length, 1);
      const m = sent[0] as { type?: unknown; text?: unknown };
      assert.strictEqual(m.type, "showError");
      assert.ok(typeof m.text === "string");
      assert.ok(!(m.text as string).includes("C:\\Users\\me"));
      assert.ok((m.text as string).includes("a b.md"));
    } finally {
      wv.panel = originalPanel;
      wv.webviewReady = originalReady;
      wv.pendingMessages = originalPending;
    }
  });
});
