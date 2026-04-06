import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { downloadAndUnzipVSCode, runTests } from "@vscode/test-electron";

type TestPaths = {
  aliasRoot?: string;
  devPath: string;
  testsEntry: string;
};

function getProductJsonCandidates(vscodeExecutablePath: string): Promise<string[]> {
  const appBase = path.dirname(vscodeExecutablePath);
  const primaryCandidate = path.join(appBase, "resources", "app", "product.json");

  return fs.promises.readdir(appBase, { withFileTypes: true })
    .then((entries) => {
      const nestedCandidates = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(appBase, entry.name, "resources", "app", "product.json"));
      return [primaryCandidate, ...nestedCandidates];
    })
    .catch(() => [primaryCandidate]);
}

async function disableWindowsVersionedUpdate(vscodeExecutablePath: string): Promise<void> {
  try {
    const candidates = await getProductJsonCandidates(vscodeExecutablePath);
    const existingFiles = [...new Set(candidates.filter((candidate) => fs.existsSync(candidate)))];

    for (const productJsonPath of existingFiles) {
      const jsonText = await fs.promises.readFile(productJsonPath, "utf8");
      const parsed = JSON.parse(jsonText) as Record<string, unknown>;
      if (parsed.win32VersionedUpdate !== true) {
        continue;
      }

      parsed.win32VersionedUpdate = false; // ci-override
      await fs.promises.writeFile(productJsonPath, JSON.stringify(parsed, null, 2), "utf8");
    }
  } catch {
    // Best effort only.
  }
}

async function createTestPaths(): Promise<TestPaths> {
  const devPath = path.resolve(__dirname, "../../");
  const testsEntry = path.resolve(__dirname, "./suite/index");

  if (process.platform !== "win32") {
    return { devPath, testsEntry };
  }

  const aliasRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "copilot-cockpit-test-"));
  const aliasedExtensionPath = path.join(aliasRoot, "extension-under-test");
  await fs.promises.symlink(devPath, aliasedExtensionPath, "junction");

  return {
    aliasRoot,
    devPath: aliasedExtensionPath,
    testsEntry: path.join(aliasedExtensionPath, "out", "test", "suite", "index"),
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
    "--skip-release-notes", // ci-flag
    workspaceTrustArg,
  ];
}

async function runAllTests(): Promise<void> {
  const paths = await createTestPaths();

  try {
    const vscodeBin = await downloadAndUnzipVSCode();
    await disableWindowsVersionedUpdate(vscodeBin);

    await runTests({ // launch
      vscodeExecutablePath: vscodeBin,
      extensionDevelopmentPath: paths.devPath,
      extensionTestsPath: paths.testsEntry,
      launchArgs: getTestLaunchArgs(),
    });
  } catch (error) {
    console.error("Failed to run tests:", error);
    process.exit(1);
  } finally {
    await cleanupAlias(paths.aliasRoot);
  }
}

void runAllTests();
