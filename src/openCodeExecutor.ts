import * as childProcess from "child_process";
import { sanitizeAbsolutePathDetails } from "./errorSanitizer";
import { logDebug } from "./logger";

type OpenCodeProcessFactory = (
  command: string,
  args: string[],
  options: childProcess.SpawnOptionsWithoutStdio,
) => childProcess.ChildProcess;

export interface OpenCodeExecuteOptions {
  cwd?: string;
  model?: string;
  agent?: string;
}

export interface OpenCodeJsonSummary {
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

function findErrorMessage(value: unknown): string | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const direct = readString(record.error) || readString(record.message);
  if (direct) {
    return direct;
  }

  const nestedError = findErrorMessage(record.error);
  if (nestedError) {
    return nestedError;
  }

  const info = asRecord(record.info);
  const infoError = info ? findErrorMessage(info.error) : undefined;
  if (infoError) {
    return infoError;
  }

  return undefined;
}

export function summarizeOpenCodeJsonOutput(output: string): OpenCodeJsonSummary {
  const summary: OpenCodeJsonSummary = {};
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

    summary.errorMessage = findErrorMessage(parsed) ?? summary.errorMessage;
  }

  return summary;
}

function sanitizeOpenCodeError(message: string): string {
  return sanitizeAbsolutePathDetails(message) || message;
}

export class OpenCodeExecutor {
  constructor(
    private readonly spawnProcess: OpenCodeProcessFactory = childProcess.spawn,
  ) {}

  async executePrompt(prompt: string, options: OpenCodeExecuteOptions = {}): Promise<void> {
    const cwd = options.cwd || process.cwd();
    const command = "opencode";
    const model = options.model?.trim();
    const agent = options.agent?.trim();
    const args = ["run", "--format", "json"];

    if (model) {
      args.push("--model", model);
    }

    if (agent) {
      args.push("--agent", agent);
    }

    args.push(prompt);

    logDebug("[CopilotScheduler] Starting OpenCode CLI execution.", JSON.stringify({ cwd }));

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
          ? "Unable to start OpenCode CLI. Install opencode-ai and ensure `opencode` is available on PATH."
          : `Unable to start OpenCode CLI: ${error instanceof Error ? error.message : String(error)}`;
        finish(new Error(sanitizeOpenCodeError(baseMessage)));
      });

      proc.on("close", (exitCode) => {
        const stdout = Buffer.concat(stdoutChunks).toString("utf8");
        const stderr = Buffer.concat(stderrChunks).toString("utf8");
        const summary = summarizeOpenCodeJsonOutput(stdout);

        if (exitCode === 0 && !summary.errorMessage) {
          logDebug("[CopilotScheduler] OpenCode CLI execution completed.");
          finish();
          return;
        }

        const stderrMessage = stderr.trim();
        const detail = summary.errorMessage || stderrMessage || `OpenCode CLI exited with code ${exitCode ?? "unknown"}.`;
        finish(new Error(sanitizeOpenCodeError(detail)));
      });
    });
  }
}