import { glob } from "glob";
import Mocha from "mocha";
import * as path from "path";

function createMochaRunner(): Mocha {
  return new Mocha({
    color: true,
    timeout: 10000,
    ui: "tdd",
  });
}

async function findCompiledTests(rootDir: string): Promise<string[]> {
  const matches = await glob("**/*.test.js", { cwd: rootDir });
  return matches.map((relativePath) => path.resolve(rootDir, relativePath));
}

function runMocha(mocha: Mocha): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    try {
      mocha.run((failures) => {
        if (failures > 0) {
          reject(new Error(`${failures} tests failed.`));
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
