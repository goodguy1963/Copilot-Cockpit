/**
 * Copilot Cockpit - Test Runner
 */

import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { downloadAndUnzipVSCode, runTests } from "@vscode/test-electron";

async function disableWin32VersionedUpdateForTests(
  vscodeExecutablePath: string,
): Promise<void> {
  // VS Code on Windows checks a named mutex `${win32MutexName}setup` when
  // `win32VersionedUpdate` is true. In some environments that mutex can remain
  // active and prevents launching, breaking CI/tests. For integration tests we
  // can safely disable that behavior by toggling the product flag.
  try {
    const appRoot = path.dirname(vscodeExecutablePath);

    const candidateProductJsonPaths: string[] = [];

    // Common layout: <install>/resources/app/product.json
    candidateProductJsonPaths.push(
      path.join(appRoot, "resources", "app", "product.json"),
    );

    // Archive layout: <install>/<commit>/resources/app/product.json
    try {
      const entries = await fs.promises.readdir(appRoot, {
        withFileTypes: true,
      });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        candidateProductJsonPaths.push(
          path.join(appRoot, entry.name, "resources", "app", "product.json"),
        );
      }
    } catch {
      // ignore
    }

    const existingProductJsonPaths = Array.from(
      new Set(candidateProductJsonPaths.filter((p) => fs.existsSync(p))),
    );
    if (existingProductJsonPaths.length === 0) {
      return;
    }

    for (const productJsonPath of existingProductJsonPaths) {
      const raw = await fs.promises.readFile(productJsonPath, "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;

      if (parsed.win32VersionedUpdate === true) {
        parsed.win32VersionedUpdate = false;
        await fs.promises.writeFile(
          productJsonPath,
          JSON.stringify(parsed, null, 2),
          "utf8",
        );
      }
    }
  } catch {
    // Best effort: if we can't patch the downloaded VS Code, tests may still
    // fail with the "currently being updated" error.
  }
}

async function createWindowsTestPathAlias(
  extensionDevelopmentPath: string,
): Promise<{ aliasRoot: string; extensionDevelopmentPath: string; extensionTestsPath: string }> {
  const aliasRoot = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "copilot-scheduler-test-"),
  );
  const aliasedExtensionPath = path.join(aliasRoot, "extension-under-test");

  await fs.promises.symlink(
    extensionDevelopmentPath,
    aliasedExtensionPath,
    "junction",
  );

  return {
    aliasRoot,
    extensionDevelopmentPath: aliasedExtensionPath,
    extensionTestsPath: path.join(
      aliasedExtensionPath,
      "out",
      "test",
      "suite",
      "index",
    ),
  };
}

async function main(): Promise<void> {
  let aliasRoot: string | undefined;

  try {
    // The folder containing the Extension Manifest package.json
    let extensionDevelopmentPath = path.resolve(__dirname, "../../");

    // The path to the extension test script
    let extensionTestsPath = path.resolve(__dirname, "./suite/index");

    if (process.platform === "win32") {
      const aliasedPaths = await createWindowsTestPathAlias(
        extensionDevelopmentPath,
      );
      aliasRoot = aliasedPaths.aliasRoot;
      extensionDevelopmentPath = aliasedPaths.extensionDevelopmentPath;
      extensionTestsPath = aliasedPaths.extensionTestsPath;
    }

    // Download VS Code ourselves so we can patch product.json before launch.
    const vscodeExecutablePath = await downloadAndUnzipVSCode();
    await disableWin32VersionedUpdateForTests(vscodeExecutablePath);

    // Download VS Code, unzip it, and run the integration tests
    await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        "--disable-updates",
        "--skip-welcome",
        "--skip-release-notes",
        "--disable-workspace-trust",
      ],
    });
  } catch (err) {
    console.error("Failed to run tests:", err);
    process.exit(1);
  } finally {
    if (aliasRoot) {
      try {
        await fs.promises.rm(aliasRoot, {
          recursive: true,
          force: true,
        });
      } catch {
        // ignore cleanup failures
      }
    }
  }
}

main();
