import * as fs from "fs";
import * as https from "https";
import * as path from "path";
import {
  readSchedulerConfig,
  writeSchedulerConfig,
} from "./copilotJsonSanitizer";
import type {
  SaveTelegramNotificationInput,
  SchedulerWorkspaceConfig,
  TelegramNotificationConfig,
  TelegramNotificationView,
} from "./types";

const HOOK_DIRECTORY_PARTS = [".github", "hooks"] as const;
const TELEGRAM_STOP_HOOK_CONFIG_NAME = "scheduler-telegram-stop.json";
const TELEGRAM_STOP_HOOK_SCRIPT_NAME = "scheduler-telegram-stop.js";

function normalizeOptionalString(value: unknown): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? trimmed : undefined;
}

function getHookDirectory(workspaceRoot: string): string {
  return path.join(workspaceRoot, ...HOOK_DIRECTORY_PARTS);
}

function getHookConfigPath(workspaceRoot: string): string {
  return path.join(getHookDirectory(workspaceRoot), TELEGRAM_STOP_HOOK_CONFIG_NAME);
}

function getHookScriptPath(workspaceRoot: string): string {
  return path.join(getHookDirectory(workspaceRoot), TELEGRAM_STOP_HOOK_SCRIPT_NAME);
}

function hasHookFiles(workspaceRoot: string): boolean {
  return fs.existsSync(getHookConfigPath(workspaceRoot))
    && fs.existsSync(getHookScriptPath(workspaceRoot));
}

function toView(
  workspaceRoot: string,
  config: TelegramNotificationConfig | undefined,
): TelegramNotificationView {
  return {
    enabled: config?.enabled === true,
    chatId: normalizeOptionalString(config?.chatId),
    messagePrefix: normalizeOptionalString(config?.messagePrefix),
    hasBotToken: !!normalizeOptionalString(config?.botToken),
    updatedAt: normalizeOptionalString(config?.updatedAt),
    hookConfigured: hasHookFiles(workspaceRoot),
  };
}

function readWorkspaceConfig(workspaceRoot: string): SchedulerWorkspaceConfig {
  return readSchedulerConfig(workspaceRoot);
}

function getMergedConfig(
  existing: TelegramNotificationConfig | undefined,
  input: SaveTelegramNotificationInput,
): TelegramNotificationConfig | undefined {
  const enabled = input.enabled === true;
  const nextBotToken = normalizeOptionalString(input.botToken)
    ?? normalizeOptionalString(existing?.botToken);
  const nextChatId = normalizeOptionalString(input.chatId)
    ?? normalizeOptionalString(existing?.chatId);
  const nextMessagePrefix = normalizeOptionalString(input.messagePrefix)
    ?? normalizeOptionalString(existing?.messagePrefix);

  if (!nextBotToken && !nextChatId && !nextMessagePrefix && !existing) {
    return undefined;
  }

  if ((enabled || nextChatId || nextMessagePrefix) && !nextBotToken) {
    throw new Error("Telegram bot token is required.");
  }

  if ((enabled || nextBotToken || nextMessagePrefix) && !nextChatId) {
    throw new Error("Telegram chat ID is required.");
  }

  return {
    enabled,
    botToken: nextBotToken,
    chatId: nextChatId,
    messagePrefix: nextMessagePrefix,
    updatedAt: new Date().toISOString(),
  };
}

function buildHookConfigFileContent(): string {
  return `${JSON.stringify(
    {
      hooks: {
        Stop: [
          {
            type: "command",
            command: `node .github/hooks/${TELEGRAM_STOP_HOOK_SCRIPT_NAME}`,
            timeout: 15,
          },
        ],
      },
    },
    null,
    2,
  )}\n`;
}

function buildHookScriptContent(): string {
  return `const fs = require("fs");
const https = require("https");
const path = require("path");

const CONFIG_PATH = path.join(process.cwd(), ".vscode", "scheduler.private.json");

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(""));
  });
}

function readTelegramConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8").replace(/^\uFEFF/, "");
    const parsed = JSON.parse(raw);
    return parsed && parsed.telegramNotification && typeof parsed.telegramNotification === "object"
      ? parsed.telegramNotification
      : undefined;
  } catch {
    return undefined;
  }
}

function trimToLength(text, maxLength) {
  const normalized = String(text || "").trim();
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  return normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd() + "...";
}

function extractTextCandidate(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((item) => extractTextCandidate(item)).filter(Boolean).join("\n");
  }
  if (typeof value === "object") {
    if (typeof value.text === "string") return value.text;
    if (typeof value.message === "string") return value.message;
    if (typeof value.content === "string") return value.content;
    if (Array.isArray(value.content)) return extractTextCandidate(value.content);
  }
  return "";
}

function collectAssistantMessages(value, bucket) {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const item of value) {
      collectAssistantMessages(item, bucket);
    }
    return;
  }
  if (typeof value !== "object") {
    return;
  }

  const role = typeof value.role === "string" ? value.role.toLowerCase() : "";
  const type = typeof value.type === "string" ? value.type.toLowerCase() : "";
  const source = typeof value.source === "string" ? value.source.toLowerCase() : "";
  const isAssistant = role === "assistant" || role === "model" || role === "agent"
    || type === "assistant" || source === "assistant";

  if (isAssistant) {
    const text = extractTextCandidate(value);
    if (text) {
      bucket.push(text);
    }
  }

  for (const entry of Object.values(value)) {
    collectAssistantMessages(entry, bucket);
  }
}

function buildFallbackMessage(prefix) {
  const repoName = path.basename(process.cwd());
  const parts = [];
  if (prefix) parts.push(prefix);
  parts.push("Session finished in " + repoName + ".");
  return parts.join("\n\n");
}

function buildMessage(payload, prefix) {
  const assistantMessages = [];
  collectAssistantMessages(payload, assistantMessages);
  const lastAssistantMessage = assistantMessages.length > 0
    ? trimToLength(assistantMessages[assistantMessages.length - 1], 3500)
    : "";
  if (!lastAssistantMessage) {
    return buildFallbackMessage(prefix);
  }
  return prefix
    ? trimToLength(prefix, 300) + "\n\n" + lastAssistantMessage
    : lastAssistantMessage;
}

function sendTelegramMessage(botToken, chatId, text) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    });
    const request = https.request(
      {
        method: "POST",
        hostname: "api.telegram.org",
        path: "/bot" + botToken + "/sendMessage",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
            resolve();
            return;
          }
          reject(new Error("Telegram returned status " + (response.statusCode || "unknown") + "."));
        });
      },
    );
    request.on("error", reject);
    request.write(payload);
    request.end();
  });
}

(async function main() {
  try {
    const config = readTelegramConfig();
    if (!config || config.enabled !== true || !config.botToken || !config.chatId) {
      process.exit(0);
      return;
    }
    const rawPayload = await readStdin();
    let payload = {};
    if (rawPayload && rawPayload.trim()) {
      try {
        payload = JSON.parse(rawPayload);
      } catch {
        payload = { raw: rawPayload };
      }
    }
    const text = buildMessage(payload, config.messagePrefix || "");
    if (!text) {
      process.exit(0);
      return;
    }
    await sendTelegramMessage(config.botToken, config.chatId, text);
  } catch {
    // best-effort only
  }
  process.exit(0);
})();
`;
}

function syncHookFiles(
  workspaceRoot: string,
  config: TelegramNotificationConfig | undefined,
): void {
  const hookConfigPath = getHookConfigPath(workspaceRoot);
  const hookScriptPath = getHookScriptPath(workspaceRoot);

  if (!config || config.enabled !== true || !config.botToken || !config.chatId) {
    for (const filePath of [hookConfigPath, hookScriptPath]) {
      if (fs.existsSync(filePath)) {
        fs.rmSync(filePath, { force: true });
      }
    }
    return;
  }

  fs.mkdirSync(path.dirname(hookConfigPath), { recursive: true });
  fs.writeFileSync(hookConfigPath, buildHookConfigFileContent(), "utf8");
  fs.writeFileSync(hookScriptPath, buildHookScriptContent(), "utf8");
}

function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    });

    const request = https.request(
      {
        method: "POST",
        hostname: "api.telegram.org",
        path: `/bot${botToken}/sendMessage`,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
            resolve();
            return;
          }
          reject(
            new Error(
              `Telegram returned status ${response.statusCode || "unknown"}${body ? `: ${body}` : ""}`,
            ),
          );
        });
      },
    );

    request.on("error", reject);
    request.write(payload);
    request.end();
  });
}

export function getTelegramNotificationView(
  workspaceRoot: string,
): TelegramNotificationView {
  const config = readWorkspaceConfig(workspaceRoot);
  return toView(workspaceRoot, config.telegramNotification);
}

export function saveTelegramNotificationConfig(
  workspaceRoot: string,
  input: SaveTelegramNotificationInput,
): TelegramNotificationView {
  const config = readWorkspaceConfig(workspaceRoot);
  const nextTelegramConfig = getMergedConfig(config.telegramNotification, input);
  const nextConfig: SchedulerWorkspaceConfig = {
    ...config,
    tasks: Array.isArray(config.tasks) ? config.tasks : [],
    jobs: Array.isArray(config.jobs) ? config.jobs : [],
    jobFolders: Array.isArray(config.jobFolders) ? config.jobFolders : [],
    telegramNotification: nextTelegramConfig,
  };

  writeSchedulerConfig(workspaceRoot, nextConfig);
  syncHookFiles(workspaceRoot, nextTelegramConfig);
  return toView(workspaceRoot, nextTelegramConfig);
}

export async function sendTelegramNotificationTest(
  workspaceRoot: string,
  input: SaveTelegramNotificationInput,
): Promise<void> {
  const config = readWorkspaceConfig(workspaceRoot);
  const mergedConfig = getMergedConfig(config.telegramNotification, input);
  if (!mergedConfig?.botToken || !mergedConfig.chatId) {
    throw new Error("Telegram bot token and chat ID are required.");
  }

  const prefix = normalizeOptionalString(mergedConfig.messagePrefix);
  const lines = [];
  if (prefix) {
    lines.push(prefix, "");
  }
  lines.push(
    "Telegram test from Copilot Cockpit.",
    `Workspace: ${path.basename(workspaceRoot)}`,
    "This test confirms that the Stop hook can reach your bot.",
  );
  await sendTelegramMessage(
    mergedConfig.botToken,
    mergedConfig.chatId,
    lines.join("\n"),
  );
}