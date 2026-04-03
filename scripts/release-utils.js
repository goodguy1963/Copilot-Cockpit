const fs = require("fs");
const path = require("path");

const TEMP_ARTIFACTS = [
  ".tmp-install-vsix-insiders.log",
  ".tmp-npm-test-rerun.log",
  ".tmp-npm-test.log",
  ".tmp-package-vsix.log",
  ".tmp-playwright",
  ".tmp-pretest.log",
  ".vscode-test",
  "npm-test-output.log",
  "npm-test-output.txt",
  "npm-test.log",
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

function removePath(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return;
  }
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function cleanupTempArtifacts(workspaceRoot) {
  TEMP_ARTIFACTS.forEach((name) => {
    removePath(path.join(workspaceRoot, name));
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
  bumpWorkspaceVersion,
  cleanupTempArtifacts,
  cleanupVsixArtifacts,
  ensureDirectory,
  getLatestVsixDirectory,
  readJson,
};