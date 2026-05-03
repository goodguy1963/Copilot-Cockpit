import * as childProcess from "child_process";
import { sanitizeAbsolutePathDetails } from "./errorSanitizer";
import { logDebug } from "./logger";

type CodexProcessFactory = (
  command: string,
  args: string[],
  options: childProcess.SpawnOptionsWithoutStdio,
) => childProcess.ChildProcess;

export interface CodexExecuteOptions {
  cwd?: string;
  model?: string;
}

export interface CodexJsonlSummary {
  threadId?: string;
  finalMessage?: string;
  errorMessage?: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readNestedString(
  source: Record<string, unknown>,
  firstKey: string,
  secondKey: string,
): string | undefined {
  const nested = asRecord(source[firstKey]);
  return nested ? readString(nested[secondKey]) : undefined;
}

export function summarizeCodexJsonlOutput(output: string): CodexJsonlSummary {
  const summary: CodexJsonlSummary = {};

  for (const line of output.split(/\r?\n/u)) {
    const trimmedLine = line.trim();
    if (!trimmedLine) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmedLine) as unknown;
    } catch {
      continue;
    }

    const event = asRecord(parsed);
    if (!event) {
      continue;
    }

    if (event.type === "thread.started") {
      summary.threadId = readString(event.thread_id) ?? summary.threadId;
      continue;
    }

    if (event.type === "error") {
      summary.errorMessage = readNestedString(event, "error", "message")
        ?? readString(event.message)
        ?? summary.errorMessage;
      continue;
    }

    if (event.type === "turn.completed") {
      const turn = asRecord(event.turn);
      const error = turn ? asRecord(turn.error) : undefined;
      summary.errorMessage = error
        ? readString(error.message) ?? summary.errorMessage
        : summary.errorMessage;
      continue;
    }

    if (event.type === "turn.failed") {
      summary.errorMessage = readNestedString(event, "error", "message")
        ?? summary.errorMessage;
      continue;
    }

    if (event.type === "item.completed") {
      const item = asRecord(event.item);
      const itemType = item ? readString(item.type) : undefined;
      if (item && (itemType === "agent_message" || itemType === "agentMessage")) {
        summary.finalMessage = readString(item.text) ?? summary.finalMessage;
      }
    }
  }

  return summary;
}

function sanitizeCodexError(message: string): string {
  return sanitizeAbsolutePathDetails(message) || message;
}

export class CodexExecutor {
  constructor(
    private readonly spawnProcess: CodexProcessFactory = childProcess.spawn,
  ) {}

  async executePrompt(prompt: string, options: CodexExecuteOptions = {}): Promise<void> {
    const cwd = options.cwd || process.cwd();
    const command = "codex";
    const model = options.model?.trim();
    const args = ["exec"];

    if (model) {
      args.push("--model", model);
    }

    args.push("--json", "-");

    logDebug("[CopilotScheduler] Starting Codex CLI execution.", JSON.stringify({ cwd }));

    await new Promise<void>((resolve, reject) => {
      const proc = this.spawnProcess(command, args, {
        cwd,
        env: process.env,
        shell: false,
      });
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let settled = false;

      const finish = (error?: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (error) {
          reject(error);
          return;
        }
        resolve();
      };

      proc.stdout?.on("data", (chunk: Buffer | string) => {
        stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });

      proc.stderr?.on("data", (chunk: Buffer | string) => {
        stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });

      proc.on("error", (error) => {
        const baseMessage = error && (error as NodeJS.ErrnoException).code === "ENOENT"
          ? "Unable to start Codex CLI. Install @openai/codex and ensure `codex` is available on PATH."
          : `Unable to start Codex CLI: ${error instanceof Error ? error.message : String(error)}`;
        finish(new Error(sanitizeCodexError(baseMessage)));
      });

      proc.on("close", (exitCode) => {
        const stdout = Buffer.concat(stdoutChunks).toString("utf8");
        const stderr = Buffer.concat(stderrChunks).toString("utf8");
        const summary = summarizeCodexJsonlOutput(stdout);
        if (summary.threadId) {
          logDebug(`[CopilotScheduler] Codex thread started: ${summary.threadId}`);
        }

        if (exitCode === 0 && !summary.errorMessage) {
          logDebug("[CopilotScheduler] Codex CLI execution completed.");
          finish();
          return;
        }

        const stderrMessage = stderr.trim();
        const detail = summary.errorMessage || stderrMessage || `Codex CLI exited with code ${exitCode ?? "unknown"}.`;
        finish(new Error(sanitizeCodexError(detail)));
      });

      proc.stdin?.end(prompt);
    });
  }
}