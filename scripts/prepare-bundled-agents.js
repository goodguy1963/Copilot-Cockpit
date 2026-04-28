const fs = require("fs");
const path = require("path");

const LIVE_BUNDLED_AGENTS_RELATIVE_PATH = path.join(".github", "agents");
const LIVE_BUNDLED_REPO_KNOWLEDGE_TEMPLATE_RELATIVE_PATH = path.join(
  ".github",
  "agents",
  "system",
  "repo-knowledge-template",
);
const BUNDLED_REPO_KNOWLEDGE_TEMPLATE_AGENTS_SUBTREE_RELATIVE_PATH = path.join(
  "system",
  "repo-knowledge-template",
);
const PACKAGED_BUNDLED_AGENTS_RELATIVE_PATH = path.join(
  "out",
  "bundled-agents",
  ".github",
  "agents",
);
const PACKAGED_BUNDLED_REPO_KNOWLEDGE_RELATIVE_PATH = path.join(
  "out",
  "bundled-agents",
  ".github",
  "repo-knowledge",
);
const LEGACY_BUNDLED_AGENT_RELATIVE_PATHS = new Set([
  "prefab.agent.md",
]);

function toPosixPath(value) {
  return String(value || "").split(path.sep).join("/");
}

function isRepoKnowledgeTemplateAgentsRelativePath(relativePath) {
  const normalizedRelativePath = path.normalize(String(relativePath || ""));
  const normalizedTemplatePath = path.normalize(
    BUNDLED_REPO_KNOWLEDGE_TEMPLATE_AGENTS_SUBTREE_RELATIVE_PATH,
  );
  return normalizedRelativePath === normalizedTemplatePath
    || normalizedRelativePath.startsWith(`${normalizedTemplatePath}${path.sep}`);
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
      if (isRepoKnowledgeTemplateAgentsRelativePath(relativePath)) {
        continue;
      }

      files.push(relativePath);
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

function sanitizeBundledAgentContent(relativePath, content) {
  return content;
}

function assertBundledAgentsPayloadSafe(rootPath) {
  if (!fs.existsSync(rootPath)) {
    return;
  }

  const leakedLegacyPaths = [...LEGACY_BUNDLED_AGENT_RELATIVE_PATHS].filter((relativePath) =>
    fs.existsSync(path.join(rootPath, relativePath)),
  );
  if (leakedLegacyPaths.length > 0) {
    throw new Error(
      [
        "Packaged bundled agents still contain legacy skipped files:",
        ...leakedLegacyPaths.map((relativePath) => `- ${toPosixPath(relativePath)}`),
      ].join("\n"),
    );
  }

  const repoKnowledgeTemplateRoot = path.join(
    rootPath,
    BUNDLED_REPO_KNOWLEDGE_TEMPLATE_AGENTS_SUBTREE_RELATIVE_PATH,
  );
  if (fs.existsSync(repoKnowledgeTemplateRoot)) {
    const leakedTemplateFiles = collectRelativeFiles(repoKnowledgeTemplateRoot).map((relativePath) =>
      toPosixPath(
        path.join(
          BUNDLED_REPO_KNOWLEDGE_TEMPLATE_AGENTS_SUBTREE_RELATIVE_PATH,
          relativePath,
        ),
      ),
    );
    throw new Error(
      [
        "Packaged bundled agents still contain the repo-knowledge template agents subtree:",
        ...(leakedTemplateFiles.length > 0
          ? leakedTemplateFiles.map((relativePath) => `- ${relativePath}`)
          : [
              `- ${toPosixPath(
                BUNDLED_REPO_KNOWLEDGE_TEMPLATE_AGENTS_SUBTREE_RELATIVE_PATH,
              )}`,
            ]),
      ].join("\n"),
    );
  }
}

function copyBundledFiles(sourceRoot, targetRoot, options = {}) {
  const skipRelativePaths = options.skipRelativePaths ?? new Set();
  let copiedCount = 0;

  for (const relativePath of collectRelativeFiles(sourceRoot)) {
    if (skipRelativePaths.has(relativePath)) {
      continue;
    }

    const sourcePath = path.join(sourceRoot, relativePath);
    const targetPath = path.join(targetRoot, relativePath);
    const content = fs.readFileSync(sourcePath, "utf8");
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, sanitizeBundledAgentContent(relativePath, content), "utf8");
    copiedCount += 1;
  }

  return copiedCount;
}

function prepareBundledAgents(workspaceRoot) {
  const liveRoot = path.join(workspaceRoot, LIVE_BUNDLED_AGENTS_RELATIVE_PATH);
  const repoKnowledgeTemplateRoot = path.join(
    workspaceRoot,
    LIVE_BUNDLED_REPO_KNOWLEDGE_TEMPLATE_RELATIVE_PATH,
  );
  const packagedAgentsRoot = path.join(workspaceRoot, PACKAGED_BUNDLED_AGENTS_RELATIVE_PATH);
  const packagedRepoKnowledgeRoot = path.join(
    workspaceRoot,
    PACKAGED_BUNDLED_REPO_KNOWLEDGE_RELATIVE_PATH,
  );
  const packagedRoot = path.join(workspaceRoot, "out", "bundled-agents");

  fs.rmSync(packagedRoot, { recursive: true, force: true });
  if (!fs.existsSync(liveRoot) && !fs.existsSync(repoKnowledgeTemplateRoot)) {
    return { liveRoot, packagedRoot, fileCount: 0 };
  }

  if (fs.existsSync(liveRoot)) {
    copyBundledFiles(liveRoot, packagedAgentsRoot, {
      skipRelativePaths: LEGACY_BUNDLED_AGENT_RELATIVE_PATHS,
    });
  }

  if (fs.existsSync(repoKnowledgeTemplateRoot)) {
    copyBundledFiles(repoKnowledgeTemplateRoot, packagedRepoKnowledgeRoot);
  }

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
  LIVE_BUNDLED_AGENTS_RELATIVE_PATH,
  LIVE_BUNDLED_REPO_KNOWLEDGE_TEMPLATE_RELATIVE_PATH,
  PACKAGED_BUNDLED_AGENTS_RELATIVE_PATH,
  PACKAGED_BUNDLED_REPO_KNOWLEDGE_RELATIVE_PATH,
  assertBundledAgentsPayloadSafe,
  collectRelativeFiles,
  copyBundledFiles,
  prepareBundledAgents,
  sanitizeBundledAgentContent,
};