const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  bumpWorkspaceVersion,
  cleanupTempArtifacts,
  cleanupVsixArtifacts,
  getLatestVsixDirectory,
} = require("./release-utils");

function fail(message) {
  console.error(message);
  process.exit(1);
}

const workspaceRoot = process.cwd();
const packageJsonPath = path.join(workspaceRoot, "package.json");

if (!fs.existsSync(packageJsonPath)) {
  fail("package.json was not found in the current working directory.");
}

cleanupTempArtifacts(workspaceRoot);
const { pkg, version } = bumpWorkspaceVersion(workspaceRoot);
const latestVsixDirectory = getLatestVsixDirectory(workspaceRoot);
const vsixFileName = `${pkg.name}-${version}.vsix`;
const vsixPath = path.join(latestVsixDirectory, vsixFileName);
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

fs.copyFileSync(tempVsixPath, vsixPath);
fs.rmSync(tempVsixDirectory, { recursive: true, force: true });

cleanupVsixArtifacts(workspaceRoot, [vsixPath]);
console.log(vsixPath);