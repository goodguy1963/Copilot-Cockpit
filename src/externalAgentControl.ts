import * as fs from "fs";
import * as net from "net";
import * as os from "os";
import * as path from "path";

export type ExternalAgentControlRequest = {
  type?: string;
  repoId?: string;
  key?: string;
  pid?: number;
};

export type ExternalAgentAuthorizationInput = {
  request: ExternalAgentControlRequest;
  expectedRepoId?: string;
  expectedKey?: string;
  workspaceOpen: boolean;
  cockpitActivated: boolean;
  externalAgentEnabled: boolean;
  extensionEnabled: boolean;
};

export type ExternalAgentAuthorizationResult = {
  ok: boolean;
  error?: string;
};

type WorkspaceServerState = {
  controlSocketPath: string;
  server: net.Server;
  connections: Set<net.Socket>;
};

function sanitizeSocketToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 80);
}

function isNamedPipePath(socketPath: string): boolean {
  return socketPath.startsWith("\\\\.\\pipe\\");
}

function maybeRemoveUnixSocket(socketPath: string): void {
  if (isNamedPipePath(socketPath)) {
    return;
  }

  try {
    if (fs.existsSync(socketPath)) {
      fs.unlinkSync(socketPath);
    }
  } catch {
  }
}

function createLineReader(onLine: (line: string) => void): (chunk: Buffer | string) => void {
  let buffer = "";
  return (chunk) => {
    buffer += String(chunk ?? "");
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line.length > 0) {
        onLine(line);
      }
      newlineIndex = buffer.indexOf("\n");
    }
  };
}

function sendJson(socket: net.Socket, message: Record<string, unknown>): void {
  if (!socket.destroyed) {
    socket.write(`${JSON.stringify(message)}\n`);
  }
}

export function buildExternalAgentControlSocketPath(options: {
  repoId: string;
  sessionId: string;
  platform?: NodeJS.Platform;
  tempDir?: string;
}): string {
  const repoToken = sanitizeSocketToken(options.repoId);
  const sessionToken = sanitizeSocketToken(options.sessionId);
  const platform = options.platform ?? process.platform;

  if (platform === "win32") {
    return `\\\\.\\pipe\\copilot-cockpit-external-agent-${sessionToken}-${repoToken}`;
  }

  return path.posix.join(
    (options.tempDir ?? os.tmpdir()).replace(/\\/g, "/"),
    `copilot-cockpit-external-agent-${sessionToken}-${repoToken}.sock`,
  );
}

export function evaluateExternalAgentAuthorization(
  input: ExternalAgentAuthorizationInput,
): ExternalAgentAuthorizationResult {
  if (input.workspaceOpen !== true) {
    return { ok: false, error: "workspace is not currently open in VS Code" };
  }

  if (input.extensionEnabled !== true) {
    return { ok: false, error: "Copilot Cockpit is disabled for this workspace" };
  }

  if (input.cockpitActivated !== true) {
    return { ok: false, error: "workspace access has not been approved for Copilot Cockpit" };
  }

  if (input.externalAgentEnabled !== true) {
    return { ok: false, error: "external-agent access is disabled for this workspace" };
  }

  if (!input.expectedRepoId || !input.expectedKey) {
    return { ok: false, error: "external-agent access is not configured for this workspace" };
  }

  if (input.request.type !== "auth" && input.request.type !== "heartbeat") {
    return { ok: false, error: "unsupported control request" };
  }

  if (input.request.repoId !== input.expectedRepoId) {
    return { ok: false, error: "repoId does not match this workspace" };
  }

  if (input.request.type === "auth" && input.request.key !== input.expectedKey) {
    return { ok: false, error: "invalid repo key" };
  }

  return { ok: true };
}

export class ExternalAgentControlServerManager {
  private readonly workspaceServers = new Map<string, WorkspaceServerState>();

  constructor(
    private readonly logError: (message: string, error?: unknown) => void,
  ) {
  }

  async ensureWorkspaceServer(options: {
    workspaceRoot: string;
    controlSocketPath: string;
    authorize: (request: ExternalAgentControlRequest) => Promise<ExternalAgentAuthorizationResult>;
  }): Promise<void> {
    const current = this.workspaceServers.get(options.workspaceRoot);
    if (current && current.controlSocketPath === options.controlSocketPath) {
      return;
    }

    if (current) {
      await this.stopWorkspaceServer(options.workspaceRoot, "connector settings changed");
    }

    maybeRemoveUnixSocket(options.controlSocketPath);
    const connections = new Set<net.Socket>();
    const server = net.createServer((socket) => {
      connections.add(socket);
      socket.setEncoding("utf8");
      let authenticated = false;

      const cleanup = () => {
        connections.delete(socket);
      };

      socket.on("close", cleanup);
      socket.on("error", (error) => {
        this.logError("[CopilotCockpit] External-agent control socket error", error);
      });

      socket.on("data", createLineReader(async (line) => {
        let request: ExternalAgentControlRequest;
        try {
          request = JSON.parse(line) as ExternalAgentControlRequest;
        } catch {
          sendJson(socket, { type: authenticated ? "revoked" : "auth-denied", error: "invalid request payload" });
          socket.destroy();
          return;
        }

        let authorization: ExternalAgentAuthorizationResult;
        try {
          authorization = await options.authorize(request);
        } catch (error) {
          this.logError("[CopilotCockpit] External-agent authorization failed", error);
          sendJson(
            socket,
            {
              type: authenticated ? "revoked" : "auth-denied",
              error: "authorization failed",
            },
          );
          socket.destroy();
          return;
        }

        if (!authorization.ok) {
          sendJson(
            socket,
            {
              type: authenticated ? "revoked" : "auth-denied",
              error: authorization.error ?? "access denied",
            },
          );
          socket.destroy();
          return;
        }

        if (!authenticated) {
          authenticated = true;
          sendJson(socket, { type: "auth-ok" });
          return;
        }

        sendJson(socket, { type: "heartbeat-ok" });
      }));
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.controlSocketPath, () => {
        server.removeListener("error", reject);
        resolve();
      });
    });

    this.workspaceServers.set(options.workspaceRoot, {
      controlSocketPath: options.controlSocketPath,
      server,
      connections,
    });
  }

  async stopWorkspaceServer(workspaceRoot: string, reason = "access revoked"): Promise<void> {
    const current = this.workspaceServers.get(workspaceRoot);
    if (!current) {
      return;
    }

    this.workspaceServers.delete(workspaceRoot);
    for (const socket of current.connections) {
      sendJson(socket, { type: "revoked", error: reason });
      socket.destroy();
    }

    await new Promise<void>((resolve) => {
      current.server.close(() => resolve());
    });
    maybeRemoveUnixSocket(current.controlSocketPath);
  }

  async dispose(reason = "extension shutting down"): Promise<void> {
    const workspaceRoots = Array.from(this.workspaceServers.keys());
    for (const workspaceRoot of workspaceRoots) {
      await this.stopWorkspaceServer(workspaceRoot, reason);
    }
  }
}