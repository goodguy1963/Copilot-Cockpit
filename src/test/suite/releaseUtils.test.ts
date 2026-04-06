import * as fs from "fs";
import * as assert from "assert";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";

const releaseUtils = require("../../../scripts/release-utils.js") as {
  assertReleaseTagMatchesVersion: (tag: string | undefined, version: string) => void;
  bumpWorkspaceVersion: (workspaceRoot: string) => { pkg: { version: string }; version: string };
  cleanupVsixArtifacts: (workspaceRoot: string, keepPaths?: string[]) => void;
  extractTopChangelogSection: (text: string) => string;
  getDefaultVsixPath: (workspaceRoot: string, packageName: string, version: string) => string;
  getInstallExecutables: (channel: string) => string[];
};

suite("Release Pipeline Contract Tests", () => {
  test("bumpWorkspaceVersion updates package metadata and build notes", () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-cockpit-release-bump-"),
    );

    try {
      fs.writeFileSync(
        path.join(workspaceRoot, "package.json"),
        JSON.stringify({ name: "copilot-cockpit", version: "1.2.3" }, null, 2),
        "utf8",
      );
      fs.writeFileSync(
        path.join(workspaceRoot, "package-lock.json"),
        JSON.stringify(
          {
            name: "copilot-cockpit",
            version: "1.2.3",
            packages: {
              "": {
                version: "1.2.3",
              },
            },
          },
          null,
          2,
        ),
        "utf8",
      );
      fs.writeFileSync(
        path.join(workspaceRoot, "BUILD_NOTES.md"),
        "Current local fork version: `1.2.3`\n",
        "utf8",
      );

      const bumped = releaseUtils.bumpWorkspaceVersion(workspaceRoot);

      assert.strictEqual(bumped.version, "1.2.4");
      assert.strictEqual(
        JSON.parse(fs.readFileSync(path.join(workspaceRoot, "package.json"), "utf8")).version,
        "1.2.4",
      );
      const packageLock = JSON.parse(
        fs.readFileSync(path.join(workspaceRoot, "package-lock.json"), "utf8"),
      ) as { version: string; packages?: { "": { version: string } } };
      assert.strictEqual(packageLock.version, "1.2.4");
      assert.strictEqual(packageLock.packages?.[""].version, "1.2.4");
      assert.ok(
        fs
          .readFileSync(path.join(workspaceRoot, "BUILD_NOTES.md"), "utf8")
          .includes("Current local fork version: `1.2.4`"),
      );
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("release tag validation rejects mismatched package versions", () => {
    assert.doesNotThrow(() =>
      releaseUtils.assertReleaseTagMatchesVersion("v99.0.78", "99.0.78"),
    );
    assert.throws(
      () => releaseUtils.assertReleaseTagMatchesVersion("v99.0.78", "99.0.79"),
      /does not match packaged version/,
    );
  });

  test("install executable resolution rejects unknown channels", () => {
    assert.deepStrictEqual(releaseUtils.getInstallExecutables("stable"), ["code"]);
    assert.deepStrictEqual(releaseUtils.getInstallExecutables("insiders"), ["code-insiders"]);
    assert.deepStrictEqual(releaseUtils.getInstallExecutables("both"), ["code", "code-insiders"]);
    assert.throws(
      () => releaseUtils.getInstallExecutables("preview"),
      /Unknown VSIX install channel/,
    );
  });

  test("cleanupVsixArtifacts keeps only the current package artifact", () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-cockpit-release-cleanup-"),
    );

    try {
      const keptArtifact = releaseUtils.getDefaultVsixPath(
        workspaceRoot,
        "copilot-cockpit",
        "99.0.78",
      );
      const staleArtifact = path.join(workspaceRoot, "archive", "vsix", "2026-03-29", "copilot-cockpit-99.0.77.vsix");
      fs.mkdirSync(path.dirname(keptArtifact), { recursive: true });
      fs.mkdirSync(path.dirname(staleArtifact), { recursive: true });
      fs.writeFileSync(keptArtifact, "current", "utf8");
      fs.writeFileSync(staleArtifact, "stale", "utf8");

      releaseUtils.cleanupVsixArtifacts(workspaceRoot, [keptArtifact]);

      assert.ok(fs.existsSync(keptArtifact));
      assert.ok(!fs.existsSync(staleArtifact));
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("extractTopChangelogSection returns the leading release notes body", () => {
    const changelog = [
      "# Changelog",
      "",
      "## [99.0.78] - 2026-04-04",
      "",
      "- Fix release contract.",
      "- Add pipeline tests.",
      "",
      "## [99.0.77] - 2026-04-03",
      "",
      "- Previous release.",
    ].join("\n");

    assert.strictEqual(
      releaseUtils.extractTopChangelogSection(changelog),
      "- Fix release contract.\n- Add pipeline tests.",
    );
    assert.strictEqual(
      releaseUtils.extractTopChangelogSection("# Changelog\n"),
      "See CHANGELOG.md for details.",
    );
  });

  test("release-notes script writes fallback notes when changelog is missing", () => {
    const scriptPath = path.resolve(__dirname, "../../../scripts/release-notes.js");
    const missingChangelogPath = path.join(
      os.tmpdir(),
      `copilot-cockpit-missing-changelog-${Date.now()}.md`,
    );
    const outputPath = path.join(
      os.tmpdir(),
      `copilot-cockpit-release-notes-${Date.now()}.md`,
    );

    try {
      const result = spawnSync(process.execPath, [scriptPath, missingChangelogPath, outputPath], {
        encoding: "utf8",
      });

      assert.strictEqual(result.status, 0, result.stderr || result.stdout);
      assert.ok(fs.existsSync(outputPath));
      assert.strictEqual(
        fs.readFileSync(outputPath, "utf8"),
        "Release notes unavailable: CHANGELOG.md was not found for this build.\n",
      );
    } finally {
      fs.rmSync(outputPath, { force: true });
    }
  });

  test("GitHub release workflow enforces the tested release contract", () => {
    const workflowPath = path.resolve(__dirname, "../../../.github/workflows/release.yml");
    const workflow = fs.readFileSync(workflowPath, "utf8");

    assert.ok(workflow.includes("RELEASE_TAG: ${{ github.ref_name }}"));
    assert.ok(
      workflow.includes(
        "run: node ./scripts/release-notes.js CHANGELOG.md release-notes.md",
      ),
    );
    assert.ok(workflow.includes("gh release view \"${{ github.ref_name }}\" >/dev/null 2>&1"));
    assert.ok(workflow.includes("gh release upload \"${{ github.ref_name }}\" archive/vsix/latest/copilot-cockpit-*.vsix --clobber"));
    assert.ok(workflow.includes('gh release edit "${{ github.ref_name }}" \\'));
  });
});
