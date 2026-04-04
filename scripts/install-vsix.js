const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  getDefaultVsixPath,
  getInstallExecutables,
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
const vsixPath = explicitVsixPath
  ? path.resolve(explicitVsixPath)
  : getDefaultVsixPath(workspaceRoot, pkg.name, pkg.version);

if (!fs.existsSync(vsixPath)) {
  fail(`VSIX not found: ${vsixPath}. Run 'npm run package:vsix' first.`);
}

let executables;
try {
  executables = getInstallExecutables(channel);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

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
  "Reload this VS Code window now to activate the new Copilot Cockpit version here. Workspace MCP launcher entries now use a stable support path, so other unreloaded VS Code windows can keep starting MCP services until they reload too.",
);