import * as assert from "assert";
import { SchedulerWebview } from "../../schedulerWebview";

type WebviewLike = {
  postMessage: (message: unknown) => Thenable<boolean>;
};

type WebviewPanelLike = {
  webview: WebviewLike;
};

suite("SchedulerWebview Message Queue Tests", () => {
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
