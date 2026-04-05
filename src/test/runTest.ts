import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { downloadAndUnzipVSCode, runTests } from "@vscode/test-electron";

type TestPaths = {
  aliasRoot?: string;
  extensionDevelopmentPath: string;
  extensionTestsPath: string;
};

function getProductJsonCandidates(vscodeExecutablePath: string): Promise<string[]> {
  const appRoot = path.dirname(vscodeExecutablePath);
  const primaryCandidate = path.join(appRoot, "resources", "app", "product.json");

  return fs.promises.readdir(appRoot, { withFileTypes: true })
    .then((entries) => {
      const nestedCandidates = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(appRoot, entry.name, "resources", "app", "product.json"));
      return [primaryCandidate, ...nestedCandidates];
    })
    .catch(() => [primaryCandidate]);
}

async function disableWindowsVersionedUpdate(vscodeExecutablePath: string): Promise<void> {
  try {
    const candidates = await getProductJsonCandidates(vscodeExecutablePath);
    const existingFiles = [...new Set(candidates.filter((candidate) => fs.existsSync(candidate)))];

    for (const productJsonPath of existingFiles) {
      const raw = await fs.promises.readFile(productJsonPath, "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed.win32VersionedUpdate !== true) {
        continue;
      }

      parsed.win32VersionedUpdate = false;
      await fs.promises.writeFile(productJsonPath, JSON.stringify(parsed, null, 2), "utf8");
    }
  } catch {
    // Best effort only.
  }
}

async function createTestPaths(): Promise<TestPaths> {
  const extensionDevelopmentPath = path.resolve(__dirname, "../../");
  const extensionTestsPath = path.resolve(__dirname, "./suite/index");

  if (process.platform !== "win32") {
    return { extensionDevelopmentPath, extensionTestsPath };
  }

  const aliasRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "copilot-cockpit-test-"));
  const aliasedExtensionPath = path.join(aliasRoot, "extension-under-test");
  await fs.promises.symlink(extensionDevelopmentPath, aliasedExtensionPath, "junction");

  return {
    aliasRoot,
    extensionDevelopmentPath: aliasedExtensionPath,
    extensionTestsPath: path.join(aliasedExtensionPath, "out", "test", "suite", "index"),
  };
}

async function cleanupAlias(aliasRoot?: string): Promise<void> {
  if (!aliasRoot) {
    return;
  }

  try {
    await fs.promises.rm(aliasRoot, { recursive: true, force: true });
  } catch {
    // Cleanup failure is non-fatal for test execution reporting.
  }
}

function getTestLaunchArgs(): string[] {
  const workspaceTrustArg = "--disable-workspace-trust";
  const basicArgs = ["--disable-updates", "--skip-welcome"];
  return [
    ...basicArgs,
    "--skip-release-notes",
    workspaceTrustArg,
  ];
}

async function main(): Promise<void> {
  const paths = await createTestPaths();

  try {
    const vscodeExecutablePath = await downloadAndUnzipVSCode();
    await disableWindowsVersionedUpdate(vscodeExecutablePath);

    await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath: paths.extensionDevelopmentPath,
      extensionTestsPath: paths.extensionTestsPath,
      launchArgs: getTestLaunchArgs(),
    });
  } catch (error) {
    console.error("Failed to run tests:", error);
    process.exit(1);
  } finally {
    await cleanupAlias(paths.aliasRoot);
  }
}

void main();
