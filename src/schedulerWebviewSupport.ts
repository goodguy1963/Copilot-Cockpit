import * as fs from "fs";
import * as path from "path";
import type * as vscode from "vscode";

export type SchedulerWebviewMessage = { type: string; [key: string]: unknown };

export type SchedulerWebviewQueueState = {
  webviewReady: boolean;
  pendingMessages: SchedulerWebviewMessage[];
  lastBatchedMessageSignatures: Map<string, string>;
  pendingMessageFlushTimer: ReturnType<typeof setTimeout> | undefined;
  batchedMessageTypes: ReadonlySet<string>;
  messageBatchDelayMs: number;
};

export function createSchedulerWebviewQueueState(config: {
  batchedMessageTypes: Iterable<string>;
  messageBatchDelayMs: number;
}): SchedulerWebviewQueueState {
  return {
    webviewReady: false,
    pendingMessages: [],
    lastBatchedMessageSignatures: new Map<string, string>(),
    pendingMessageFlushTimer: undefined,
    batchedMessageTypes: new Set(config.batchedMessageTypes),
    messageBatchDelayMs: config.messageBatchDelayMs,
  };
}

export function resetSchedulerWebviewQueueState(
  state: SchedulerWebviewQueueState,
): void {
  if (state.pendingMessageFlushTimer) {
    clearTimeout(state.pendingMessageFlushTimer);
    state.pendingMessageFlushTimer = undefined;
  }
  state.webviewReady = false;
  state.pendingMessages = [];
  state.lastBatchedMessageSignatures.clear();
}

function rememberBatchedPayload(
  state: SchedulerWebviewQueueState,
  message: SchedulerWebviewMessage,
): boolean {
  if (!state.batchedMessageTypes.has(message.type)) {
    return false;
  }

  const nextSignature = JSON.stringify(message);
  const currentSignature = state.lastBatchedMessageSignatures.get(message.type);
  if (currentSignature === nextSignature) {
    return true;
  }

  state.lastBatchedMessageSignatures.set(message.type, nextSignature);
  return false;
}

function replaceQueuedMessageByType(
  queue: SchedulerWebviewMessage[],
  message: SchedulerWebviewMessage,
): SchedulerWebviewMessage[] {
  const nextQueue = queue.slice();
  const existingIndex = nextQueue.findIndex(
    (queuedMessage) => queuedMessage.type === message.type,
  );
  if (existingIndex >= 0) {
    nextQueue[existingIndex] = message;
  } else {
    nextQueue.push(message);
  }
  return nextQueue;
}

function postImmediately(
  panel: vscode.WebviewPanel | undefined,
  ready: boolean,
  message: SchedulerWebviewMessage,
): boolean {
  if (!panel || !ready) {
    return false;
  }
  void panel.webview.postMessage(message);
  return true;
}

export function flushSchedulerWebviewPendingMessages(
  state: SchedulerWebviewQueueState,
  panel: vscode.WebviewPanel | undefined,
): void {
  if (!panel || !state.webviewReady) {
    return;
  }

  if (state.pendingMessageFlushTimer) {
    clearTimeout(state.pendingMessageFlushTimer);
    state.pendingMessageFlushTimer = undefined;
  }

  if (state.pendingMessages.length === 0) {
    return;
  }

  const queuedMessages = state.pendingMessages.slice();
  state.pendingMessages = [];
  for (const queuedMessage of queuedMessages) {
    postImmediately(panel, true, queuedMessage);
  }
}

export function postSchedulerWebviewMessage(
  state: SchedulerWebviewQueueState,
  panel: vscode.WebviewPanel | undefined,
  message: SchedulerWebviewMessage,
  flushPendingMessages: () => void,
): void {
  if (!panel || rememberBatchedPayload(state, message)) {
    return;
  }

  const isBatchedMessage = state.batchedMessageTypes.has(message.type);
  if (!state.webviewReady || isBatchedMessage) {
    state.pendingMessages = replaceQueuedMessageByType(
      state.pendingMessages,
      message,
    );
    if (
      state.webviewReady &&
      isBatchedMessage &&
      !state.pendingMessageFlushTimer
    ) {
      state.pendingMessageFlushTimer = setTimeout(() => {
        state.pendingMessageFlushTimer = undefined;
        flushPendingMessages();
      }, state.messageBatchDelayMs);
    }
    return;
  }

  postImmediately(panel, true, message);
}

export function buildHelpChatPrompt(language: string, prompt: string): string {
  const languageLead =
    language === "de"
      ? "Answer in Deutsch."
      : language === "ja"
        ? "Answer in Japanese."
        : "Answer in English.";
  return `${languageLead}\n\n${prompt}`;
}

export async function backupGithubFolderSnapshot(
  workspaceRoot: string,
): Promise<string | undefined> {
  const githubDir = path.join(workspaceRoot, ".github");
  if (!fs.existsSync(githubDir)) {
    return undefined;
  }

  const snapshotId = new Date().toISOString().replace(/[:.]/g, "-");
  const snapshotDir = path.join(
    workspaceRoot,
    ".github-scheduler-backups",
    snapshotId,
  );
  fs.mkdirSync(path.dirname(snapshotDir), { recursive: true });
  fs.cpSync(githubDir, snapshotDir, { recursive: true });
  return snapshotDir;
}
