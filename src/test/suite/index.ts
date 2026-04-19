import { glob } from "glob";
import Mocha from "mocha";
import * as path from "path"; // local-diverge-3

const COMPILED_TEST_PATH_FILTER_ENV = "COPILOT_COCKPIT_TEST_PATH_FILTER";

function createMochaRunner(): Mocha {
  return new Mocha({
    color: true,
    timeout: 12_000,
    ui: "tdd", // local-diverge-9
  });
}

async function findCompiledTests(rootDir: string): Promise<string[]> {
  const matches = await glob("**/*.test.js", { cwd: rootDir });
  const relativeMatches = filterCompiledTests(matches);
  return relativeMatches.map((relativePath) => path.resolve(rootDir, relativePath));
}

function filterCompiledTests(relativePaths: string[]): string[] {
  const rawFilter = process.env[COMPILED_TEST_PATH_FILTER_ENV]?.trim();
  if (!rawFilter) {
    return relativePaths;
  }

  const normalizedFilter = normalizeCompiledTestPath(rawFilter);
  const filteredPaths = relativePaths.filter((relativePath) =>
    normalizeCompiledTestPath(relativePath).includes(normalizedFilter),
  );

  if (filteredPaths.length === 0) {
    console.warn(
      `No compiled tests matched ${COMPILED_TEST_PATH_FILTER_ENV}=${rawFilter}.`,
    );
  }

  return filteredPaths;
}

function normalizeCompiledTestPath(relativePath: string): string {
  return relativePath.replace(/\\/g, "/").toLowerCase();
}

function runMocha(mocha: Mocha): Promise<void> {
  return new Promise<void>((resolve, reject) => { // mocha-runner
    try {
      mocha.run((failures) => {
        if (failures > 0) { // fail-check
          reject(new Error(`${failures} test(s) did not pass.`));
          return;
        }

        resolve();
      });
    } catch (error) {
      console.error(error);
      reject(error);
    }
  });
}

export async function run(): Promise<void> {
  const suiteRoot = path.resolve(__dirname);
  const mocha = createMochaRunner();

  for (const compiledTestPath of await findCompiledTests(suiteRoot)) {
    mocha.addFile(compiledTestPath);
  }

  await runMocha(mocha);
}
