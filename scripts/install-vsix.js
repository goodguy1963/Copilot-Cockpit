const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  getLatestVsixDirectory,
  readJson,
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

const pkg = readJson(packageJsonPath);
const channel = (process.argv[2] || "stable").toLowerCase();
const explicitVsixPath = process.argv[3];
const latestVsixDirectory = getLatestVsixDirectory(workspaceRoot);
const vsixPath = explicitVsixPath
  ? path.resolve(explicitVsixPath)
  : path.join(latestVsixDirectory, `${pkg.name}-${pkg.version}.vsix`);

if (!fs.existsSync(vsixPath)) {
  fail(`VSIX not found: ${vsixPath}. Run 'npm run package:vsix' first.`);
}

const executables =
  channel === "both"
    ? ["code", "code-insiders"]
    : channel === "insiders"
      ? ["code-insiders"]
      : ["code"];

for (const executable of executables) {
  const result =
    process.platform === "win32"
      ? spawnSync(
          `${executable} --install-extension "${vsixPath}" --force`,
          {
            stdio: "inherit",
            shell: true,
          },
        )
      : spawnSync(
          executable,
          ["--install-extension", vsixPath, "--force"],
          { stdio: "inherit" },
        );

  if (result.error) {
    fail(
      `Failed to run '${executable}'. Make sure the VS Code shell command is installed on this machine.`,
    );
  }

  if (typeof result.status === "number" && result.status !== 0) {
    process.exit(result.status);
  }
}

console.log(`Installed ${path.basename(vsixPath)} via ${executables.join(", ")}.`);
console.log(
  "Reload VS Code now to activate Copilot Cockpit. On first startup after install or update, the extension will create or repair .vscode/mcp.json and other workspace support files.",
);