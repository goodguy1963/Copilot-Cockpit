const fs = require("fs");
const path = require("path");

const OUTPUT_SESSIONS_DIRECTORY_NAME = "output_sessions";

const TEMP_ARTIFACTS = [
  ".tmp-install-vsix-insiders.log",
  ".tmp-npm-test-rerun.log",
  ".tmp-npm-test.log",
  ".tmp-package-vsix.log",
  ".tmp-playwright",
  ".tmp-pretest.log",
  "full_test_output.txt",
  "log_temp.txt",
  "npm-test-output.log",
  "npm-test-output.txt",
  "npm-test.log",
  "show_temp.txt",
  "test_output.txt",
  "test-output.txt",
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function getOutputSessionsDirectory(workspaceRoot) {
  return ensureDirectory(path.join(workspaceRoot, OUTPUT_SESSIONS_DIRECTORY_NAME));
}

function getOutputSessionArtifactPath(workspaceRoot, fileName) {
  return path.join(getOutputSessionsDirectory(workspaceRoot), fileName);
}

function removePath(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return;
  }
  try {
    fs.rmSync(targetPath, { recursive: true, force: true });
  } catch (error) {
    if (error.code === "EBUSY") {
      console.warn(`Warning: cannot remove locked file ${path.basename(targetPath)}, skipping`);
      return;
    }
    throw error;
  }
}

function cleanupTempArtifacts(workspaceRoot) {
  const outputSessionsDirectory = path.join(
    workspaceRoot,
    OUTPUT_SESSIONS_DIRECTORY_NAME,
  );
  TEMP_ARTIFACTS.forEach((name) => {
    removePath(path.join(workspaceRoot, name));
    removePath(path.join(outputSessionsDirectory, name));
  });
}

function parseVersion(version) {
  const parts = String(version || "0.0.0")
    .split(".")
    .map((value) => Number.parseInt(value, 10));
  while (parts.length < 3) {
    parts.push(0);
  }
  return parts.slice(0, 3).map((value) => (Number.isFinite(value) ? value : 0));
}

function incrementPatchVersion(version) {
  const parts = parseVersion(version);
  parts[2] += 1;
  return parts.join(".");
}

function normalizeReleaseTag(releaseTag) {
  const trimmed = String(releaseTag || "").trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.startsWith("v") ? trimmed.slice(1) : trimmed;
}

function assertReleaseTagMatchesVersion(releaseTag, version) {
  const normalizedTag = normalizeReleaseTag(releaseTag);
  if (!normalizedTag) {
    return;
  }
  const normalizedVersion = String(version || "").trim();
  if (normalizedTag !== normalizedVersion) {
    throw new Error(
      `Release tag '${String(releaseTag)}' does not match packaged version '${normalizedVersion}'.`,
    );
  }
}

function extractTopChangelogSection(changelogText) {
  const text = String(changelogText || "");
  const headingMatch = text.match(/^## \[[^\n]+\][^\n]*$/m);
  if (!headingMatch || typeof headingMatch.index !== "number") {
    return "See CHANGELOG.md for details.";
  }

  const sectionStart = headingMatch.index + headingMatch[0].length;
  const remaining = text.slice(sectionStart).replace(/^\r?\n+/, "");
  const nextHeadingIndex = remaining.search(/\r?\n## \[/);
  const sectionText =
    nextHeadingIndex >= 0 ? remaining.slice(0, nextHeadingIndex) : remaining;
  const normalized = sectionText.trim();
  return normalized || "See CHANGELOG.md for details.";
}

function updateBuildNotesVersion(workspaceRoot, version) {
  const buildNotesPath = path.join(workspaceRoot, "BUILD_NOTES.md");
  if (!fs.existsSync(buildNotesPath)) {
    return;
  }
  const content = fs.readFileSync(buildNotesPath, "utf8");
  const next = content.replace(
    /Current local fork version:\s*`[^`]+`/,
    `Current local fork version: \`${version}\``,
  );
  if (next !== content) {
    fs.writeFileSync(buildNotesPath, next, "utf8");
  }
}

function bumpWorkspaceVersion(workspaceRoot) {
  const packageJsonPath = path.join(workspaceRoot, "package.json");
  const packageLockPath = path.join(workspaceRoot, "package-lock.json");
  const pkg = readJson(packageJsonPath);
  const nextVersion = incrementPatchVersion(pkg.version);
  pkg.version = nextVersion;
  writeJson(packageJsonPath, pkg);

  if (fs.existsSync(packageLockPath)) {
    const packageLock = readJson(packageLockPath);
    packageLock.version = nextVersion;
    if (packageLock.packages && packageLock.packages[""]) {
      packageLock.packages[""].version = nextVersion;
    }
    writeJson(packageLockPath, packageLock);
  }

  updateBuildNotesVersion(workspaceRoot, nextVersion);

  return { pkg, version: nextVersion };
}

function getLatestVsixDirectory(workspaceRoot) {
  return ensureDirectory(path.join(workspaceRoot, "archive", "vsix", "latest"));
}

function getDefaultVsixPath(workspaceRoot, packageName, version) {
  return path.join(
    getLatestVsixDirectory(workspaceRoot),
    `${packageName}-${version}.vsix`,
  );
}

function getInstallExecutables(channel) {
  const normalized = String(channel || "stable").trim().toLowerCase();
  if (normalized === "both") {
    return ["code", "code-insiders"];
  }
  if (normalized === "insiders") {
    return ["code-insiders"];
  }
  if (normalized === "stable") {
    return ["code"];
  }
  throw new Error(
    `Unknown VSIX install channel '${channel}'. Expected stable, insiders, or both.`,
  );
}

function collectVsixArtifacts(workspaceRoot) {
  const results = [];
  const searchRoots = [workspaceRoot, path.join(workspaceRoot, "archive", "vsix")];
  const visited = new Set();

  function walk(currentPath) {
    if (!fs.existsSync(currentPath)) {
      return;
    }
    const normalized = path.resolve(currentPath);
    if (visited.has(normalized)) {
      return;
    }
    visited.add(normalized);
    const stat = fs.statSync(currentPath);
    if (stat.isFile()) {
      if (currentPath.toLowerCase().endsWith(".vsix")) {
        results.push(currentPath);
      }
      return;
    }
    fs.readdirSync(currentPath).forEach((entry) => {
      walk(path.join(currentPath, entry));
    });
  }

  searchRoots.forEach((root) => walk(root));
  return results;
}

function cleanupVsixArtifacts(workspaceRoot, keepPaths = []) {
  const keepSet = new Set(keepPaths.map((value) => path.resolve(value)));
  collectVsixArtifacts(workspaceRoot).forEach((artifactPath) => {
    if (!keepSet.has(path.resolve(artifactPath))) {
      removePath(artifactPath);
    }
  });
}

module.exports = {
  assertReleaseTagMatchesVersion,
  bumpWorkspaceVersion,
  cleanupTempArtifacts,
  cleanupVsixArtifacts,
  ensureDirectory,
  extractTopChangelogSection,
  getDefaultVsixPath,
  getInstallExecutables,
  getLatestVsixDirectory,
  getOutputSessionArtifactPath,
  getOutputSessionsDirectory,
  incrementPatchVersion,
  normalizeReleaseTag,
  parseVersion,
  readJson,
};