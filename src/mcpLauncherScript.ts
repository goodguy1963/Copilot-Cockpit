export function renderWorkspaceMcpLauncherScript(): string {
  return String.raw`"use strict";

const fs = require("fs");
const path = require("path");
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

function uniquePaths(values) {
  const seen = new Set();
  const results = [];

  for (const value of values) {
    if (typeof value !== "string" || value.length === 0) {
      continue;
    }

    const normalized = path.resolve(value);
    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    results.push(normalized);
  }

  return results;
}

function getDefaultExtensionRoots() {
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const roots = [];

  if (process.env.VSCODE_EXTENSIONS) {
    roots.push(process.env.VSCODE_EXTENSIONS);
  }

  if (home) {
    roots.push(path.join(home, ".vscode", "extensions"));
    roots.push(path.join(home, ".vscode-insiders", "extensions"));
  }

  return uniquePaths(roots);
}

function parseVersionParts(version) {
  if (typeof version !== "string" || !/^\d+(\.\d+)*$/.test(version)) {
    return undefined;
  }

  return version.split(".").map((value) => Number.parseInt(value, 10));
}

function compareVersionParts(left, right) {
  const maxLength = Math.max(left.length, right.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = left[index] || 0;
    const rightValue = right[index] || 0;
    if (leftValue !== rightValue) {
      return leftValue - rightValue;
    }
  }

  return 0;
}

function getCandidateVersion(rootName, prefix) {
  if (typeof prefix !== "string" || prefix.length === 0) {
    return undefined;
  }
  if (!rootName.startsWith(prefix)) {
    return undefined;
  }

  return parseVersionParts(rootName.slice(prefix.length));
}

function listVersionedCandidates(searchRoot, prefix) {
  if (!fs.existsSync(searchRoot) || typeof prefix !== "string" || prefix.length === 0) {
    return [];
  }

  const entries = fs.readdirSync(searchRoot, { withFileTypes: true });
  const candidates = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const versionParts = getCandidateVersion(entry.name, prefix);
    if (!versionParts) {
      continue;
    }

    const extensionRoot = path.join(searchRoot, entry.name);
    const serverPath = path.join(extensionRoot, "out", "server.js");
    if (!fs.existsSync(serverPath)) {
      continue;
    }

    candidates.push({ extensionRoot, serverPath, versionParts });
  }

  candidates.sort((left, right) => compareVersionParts(right.versionParts, left.versionParts));
  return candidates;
}

function resolveServerPath() {
  const state = readState();
  const searchRoots = uniquePaths([
    state.preferredExtensionDir,
    ...getDefaultExtensionRoots(),
  ]);
  const candidates = [];

  for (const searchRoot of searchRoots) {
    candidates.push(...listVersionedCandidates(searchRoot, state.extensionIdPrefix));
  }

  if (candidates.length > 0) {
    return candidates[0].serverPath;
  }

  if (typeof state.lastKnownExtensionRoot === "string" && state.lastKnownExtensionRoot.length > 0) {
    const fallbackServerPath = path.join(state.lastKnownExtensionRoot, "out", "server.js");
    if (fs.existsSync(fallbackServerPath)) {
      return fallbackServerPath;
    }
  }

  if (typeof state.lastKnownServerPath === "string" && state.lastKnownServerPath.length > 0 && fs.existsSync(state.lastKnownServerPath)) {
    return state.lastKnownServerPath;
  }

  throw new Error(
    "Copilot Cockpit MCP launcher could not find an installed server runtime. Reload VS Code or run Setup MCP to refresh support files.",
  );
}

function main() {
  const serverPath = resolveServerPath();
  const child = spawn(process.execPath, [serverPath], { stdio: "inherit" });

  child.on("error", (error) => {
    const message = error instanceof Error ? error.message : String(error ?? "unknown error");
    console.error("Failed to launch Copilot Cockpit MCP server: " + message);
    process.exit(1);
  });

  child.on("exit", (code) => {
    process.exit(code === null ? 1 : code);
  });

  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
    process.on(signal, () => {
      if (!child.killed) {
        child.kill(signal);
      }
    });
  }
}

main();
`;
}