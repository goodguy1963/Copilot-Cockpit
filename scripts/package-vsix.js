const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function fail(message) {
  console.error(message);
  process.exit(1);
}

const workspaceRoot = process.cwd();
const packageJsonPath = path.join(workspaceRoot, "package.json");

if (!fs.existsSync(packageJsonPath)) {
  fail("package.json was not found in the current working directory.");
}

const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const vsixPath = path.join(workspaceRoot, `${pkg.name}-${pkg.version}.vsix`);
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const result =
  process.platform === "win32"
    ? spawnSync(
        `${npxCommand} --yes @vscode/vsce package -o "${vsixPath}"`,
        {
          stdio: "inherit",
          shell: true,
        },
      )
    : spawnSync(
        npxCommand,
        ["--yes", "@vscode/vsce", "package", "-o", vsixPath],
        { stdio: "inherit" },
      );

if (result.error) {
  fail(`Failed to run vsce packaging: ${result.error.message}`);
}

if (typeof result.status === "number" && result.status !== 0) {
  process.exit(result.status);
}

console.log(vsixPath);