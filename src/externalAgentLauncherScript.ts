export function renderWorkspaceExternalAgentLauncherScript(): string {
  return String.raw`"use strict";

const fs = require("fs");
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");

function getStatePath() {
  return path.join(__dirname, "state.json");
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(getStatePath(), "utf8"));
  } catch {
    return {};
  }
}

function createLineReader(onLine) {
  let buffer = "";

  return (chunk) => {
    buffer += String(chunk || "");
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

function getRequiredString(state, key) {
  const value = state ? state[key] : undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Copilot Cockpit external-agent launcher is missing state field: " + key);
  }
  return value;
}

function getHeartbeatIntervalMs(state) {
  return typeof state.heartbeatIntervalMs === "number" && state.heartbeatIntervalMs >= 250
    ? state.heartbeatIntervalMs
    : 2000;
}

function getRepoId(state) {
  const repoId = getRequiredString(state, "repoId");
  const repoIdEnvVarName = getRequiredString(state, "repoIdEnvVarName");
  const configuredRepoId = process.env[repoIdEnvVarName];
  if (typeof configuredRepoId === "string" && configuredRepoId.length > 0 && configuredRepoId !== repoId) {
    throw new Error(
      "Copilot Cockpit external-agent repoId mismatch. Expected "
      + repoId
      + " from support files but received "
      + configuredRepoId
      + " via "
      + repoIdEnvVarName
      + ".",
    );
  }

  return repoId;
}

function getRepoKey(state) {
  const keyEnvVarName = getRequiredString(state, "keyEnvVarName");
  const repoKey = process.env[keyEnvVarName];
  if (typeof repoKey !== "string" || repoKey.length === 0) {
    throw new Error(
      "Copilot Cockpit external-agent key not found in environment variable " + keyEnvVarName + ".",
    );
  }

  return repoKey;
}

function createConnection(controlSocketPath) {
  return net.createConnection(controlSocketPath);
}

function messageToLine(message) {
  return JSON.stringify(message) + "\n";
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error || "unknown error");
}

function main() {
  const state = readState();
  const controlSocketPath = getRequiredString(state, "controlSocketPath");
  const innerLauncherPath = getRequiredString(state, "innerLauncherPath");
  const repoId = getRepoId(state);
  const repoKey = getRepoKey(state);
  const heartbeatIntervalMs = getHeartbeatIntervalMs(state);
  const socket = createConnection(controlSocketPath);

  let child;
  let heartbeatTimer;
  let authenticated = false;
  let exiting = false;

  if (typeof socket.setEncoding === "function") {
    socket.setEncoding("utf8");
  }

  function finish(code, message) {
    if (exiting) {
      return;
    }

    exiting = true;
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
    }

    if (message) {
      console.error(message);
    }

    if (socket && typeof socket.destroy === "function" && !socket.destroyed) {
      socket.destroy();
    }

    if (child && !child.killed) {
      child.kill("SIGTERM");
    }

    process.exit(code);
  }

  function sendMessage(message) {
    socket.write(messageToLine(message));
  }

  function startHeartbeat() {
    heartbeatTimer = setInterval(() => {
      sendMessage({ type: "heartbeat", repoId });
    }, heartbeatIntervalMs);

    if (heartbeatTimer && typeof heartbeatTimer.unref === "function") {
      heartbeatTimer.unref();
    }
  }

  function spawnInnerLauncher() {
    child = spawn(process.execPath, [innerLauncherPath], { stdio: "inherit" });

    child.on("error", (error) => {
      finish(
        1,
        "Failed to launch Copilot Cockpit external-agent MCP bridge: " + getErrorMessage(error),
      );
    });

    child.on("exit", (code) => {
      finish(code === null ? 1 : code);
    });
  }

  socket.on("data", createLineReader((line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      finish(1, "Copilot Cockpit external-agent auth failed: invalid control response.");
      return;
    }

    if (!authenticated) {
      if (message && message.type === "auth-ok") {
        authenticated = true;
        spawnInnerLauncher();
        startHeartbeat();
        return;
      }

      finish(
        1,
        "Copilot Cockpit external-agent auth failed: "
        + (message && typeof message.error === "string" ? message.error : "access denied."),
      );
      return;
    }

    if (message && (message.type === "revoked" || message.type === "heartbeat-denied")) {
      finish(
        1,
        "Copilot Cockpit external-agent access ended: "
        + (typeof message.error === "string" ? message.error : "access revoked."),
      );
    }
  }));

  socket.on("error", (error) => {
    finish(
      1,
      "Copilot Cockpit external-agent auth failed: " + getErrorMessage(error),
    );
  });

  socket.on("close", () => {
    finish(
      authenticated ? 1 : 1,
      authenticated
        ? "Copilot Cockpit external-agent access ended: control channel closed."
        : "Copilot Cockpit external-agent auth failed: control channel closed.",
    );
  });

  sendMessage({
    type: "auth",
    repoId,
    key: repoKey,
    pid: typeof process.pid === "number" ? process.pid : 0,
  });

  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
    process.on(signal, () => {
      finish(1);
    });
  }
}

main();
`;
}