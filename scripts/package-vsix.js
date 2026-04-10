const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  assertReleaseTagMatchesVersion,
  bumpWorkspaceVersion,
  cleanupTempArtifacts,
  cleanupVsixArtifacts,
  getDefaultVsixPath,
  incrementPatchVersion,
  normalizeReleaseTag,
  readJson,
} = require("./release-utils");

function fail(message) {
  console.error(message);
  process.exit(1);
}

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

      files.push(toPosixPath(path.relative(rootPath, entryPath)));
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

function findEndOfCentralDirectoryOffset(buffer) {
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }

  throw new Error("Could not find the VSIX central directory.");
}

function listZipEntries(zipPath) {
  const buffer = fs.readFileSync(zipPath);
  const eocdOffset = findEndOfCentralDirectoryOffset(buffer);
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = [];
  let cursor = centralDirectoryOffset;

  for (let index = 0; index < totalEntries; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error("VSIX central directory is malformed.");
    }

    const fileNameLength = buffer.readUInt16LE(cursor + 28);
    const extraFieldLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const fileNameStart = cursor + 46;
    const fileNameEnd = fileNameStart + fileNameLength;
    entries.push(buffer.toString("utf8", fileNameStart, fileNameEnd));
    cursor = fileNameEnd + extraFieldLength + commentLength;
  }

  return entries;
}

function assertPackagedBundledSkills(vsixPath, rootPath) {
  const bundledSkillsRoot = path.join(rootPath, ".github", "skills");
  const expectedEntries = collectRelativeFiles(bundledSkillsRoot).map(
    (relativePath) => `extension/.github/skills/${relativePath}`,
  );
  const archiveEntries = new Set(listZipEntries(vsixPath));
  const missingEntries = expectedEntries.filter((entry) => !archiveEntries.has(entry));
  if (missingEntries.length > 0) {
    fail(
      [
        "VSIX is missing bundled skill files:",
        ...missingEntries.map((entry) => `- ${entry}`),
      ].join("\n"),
    );
  }

  const legacyAliasEntry = "extension/.github/skills/scheduler-mcp-agent/SKILL.md";
  if (archiveEntries.has(legacyAliasEntry)) {
    fail(`VSIX still contains deprecated legacy skill alias: ${legacyAliasEntry}`);
  }
}

const workspaceRoot = process.cwd();
const packageJsonPath = path.join(workspaceRoot, "package.json");

if (!fs.existsSync(packageJsonPath)) {
  fail("package.json was not found in the current working directory.");
}

cleanupTempArtifacts(workspaceRoot);
const currentPkg = readJson(packageJsonPath);
const releaseTag = process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME;
const normalizedReleaseTag = normalizeReleaseTag(releaseTag);
const version = normalizedReleaseTag || incrementPatchVersion(currentPkg.version);
try {
  assertReleaseTagMatchesVersion(
    releaseTag,
    version,
  );
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
const { pkg } = normalizedReleaseTag
  ? { pkg: currentPkg }
  : bumpWorkspaceVersion(workspaceRoot);
const vsixFileName = `${pkg.name}-${version}.vsix`;
const vsixPath = getDefaultVsixPath(workspaceRoot, pkg.name, version);
const tempVsixDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), `${pkg.name}-vsix-`),
);
const tempVsixPath = path.join(tempVsixDirectory, vsixFileName);
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const result =
  process.platform === "win32"
    ? spawnSync(
        `${npxCommand} --yes @vscode/vsce package -o "${tempVsixPath}"`,
        {
          stdio: "inherit",
          shell: true,
        },
      )
    : spawnSync(
        npxCommand,
        ["--yes", "@vscode/vsce", "package", "-o", tempVsixPath],
        { stdio: "inherit" },
      );

if (result.error) {
  fail(`Failed to run vsce packaging: ${result.error.message}`);
}

if (typeof result.status === "number" && result.status !== 0) {
  process.exit(result.status);
}

assertPackagedBundledSkills(tempVsixPath, workspaceRoot);

fs.copyFileSync(tempVsixPath, vsixPath);
fs.rmSync(tempVsixDirectory, { recursive: true, force: true });

cleanupVsixArtifacts(workspaceRoot, [vsixPath]);
console.log(vsixPath);