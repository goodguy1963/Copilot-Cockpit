const fs = require("fs");
const path = require("path");

const LIVE_BUNDLED_AGENTS_RELATIVE_PATH = path.join(".github", "agents");
const PACKAGED_BUNDLED_AGENTS_RELATIVE_PATH = path.join(
  "out",
  "bundled-agents",
  ".github",
  "agents",
);

const FORBIDDEN_BUNDLED_AGENT_TEXT = [
  ".github/repo-knowledge/",
  "repo-specific durable",
  "repo-local durable",
];
const LEGACY_BUNDLED_AGENT_RELATIVE_PATHS = new Set([
  "prefab.agent.md",
]);

function toPosixPath(value) {
  return String(value || "").split(path.sep).join("/");
}

function collectRelativeFiles(rootPath) {
  if (!fs.existsSync(rootPath)) {
    return [];
  }

  const stack = [rootPath];
  const files = [];
  while (stack.length > 0) {
    const currentPath = stack.pop();
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const relativePath = path.relative(rootPath, entryPath);
      if (LEGACY_BUNDLED_AGENT_RELATIVE_PATHS.has(relativePath)) {
        continue;
      }

      files.push(relativePath);
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

function sanitizeMarkdown(content) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const sanitizedLines = lines.filter((line) => {
    const normalized = line.toLowerCase();
    return !FORBIDDEN_BUNDLED_AGENT_TEXT.some((entry) => normalized.includes(entry));
  });

  return `${sanitizedLines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

function sanitizeBundledAgentContent(relativePath, content) {
  if (path.extname(relativePath).toLowerCase() !== ".md") {
    return content;
  }

  return sanitizeMarkdown(content);
}

function assertBundledAgentsPayloadSafe(rootPath) {
  for (const relativePath of collectRelativeFiles(rootPath)) {
    const absolutePath = path.join(rootPath, relativePath);
    const content = fs.readFileSync(absolutePath, "utf8").toLowerCase();
    for (const forbiddenText of FORBIDDEN_BUNDLED_AGENT_TEXT) {
      if (content.includes(forbiddenText)) {
        throw new Error(
          `Sanitized bundled agents still contain forbidden text '${forbiddenText}' in ${toPosixPath(relativePath)}.`,
        );
      }
    }
  }
}

function prepareBundledAgents(workspaceRoot) {
  const liveRoot = path.join(workspaceRoot, LIVE_BUNDLED_AGENTS_RELATIVE_PATH);
  const packagedRoot = path.join(workspaceRoot, PACKAGED_BUNDLED_AGENTS_RELATIVE_PATH);

  fs.rmSync(packagedRoot, { recursive: true, force: true });
  if (!fs.existsSync(liveRoot)) {
    return { liveRoot, packagedRoot, fileCount: 0 };
  }

  for (const relativePath of collectRelativeFiles(liveRoot)) {
    const sourcePath = path.join(liveRoot, relativePath);
    const targetPath = path.join(packagedRoot, relativePath);
    const content = fs.readFileSync(sourcePath, "utf8");
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, sanitizeBundledAgentContent(relativePath, content), "utf8");
  }

  assertBundledAgentsPayloadSafe(packagedRoot);
  return {
    liveRoot,
    packagedRoot,
    fileCount: collectRelativeFiles(packagedRoot).length,
  };
}

function main() {
  const workspaceRoot = process.cwd();
  const result = prepareBundledAgents(workspaceRoot);
  console.log(
    JSON.stringify(
      {
        bundledAgentsSource: toPosixPath(path.relative(workspaceRoot, result.liveRoot)),
        bundledAgentsOutput: toPosixPath(path.relative(workspaceRoot, result.packagedRoot)),
        fileCount: result.fileCount,
      },
      null,
      2,
    ),
  );
}

if (require.main === module) {
  main();
}

module.exports = {
  FORBIDDEN_BUNDLED_AGENT_TEXT,
  LIVE_BUNDLED_AGENTS_RELATIVE_PATH,
  PACKAGED_BUNDLED_AGENTS_RELATIVE_PATH,
  assertBundledAgentsPayloadSafe,
  collectRelativeFiles,
  prepareBundledAgents,
  sanitizeBundledAgentContent,
};