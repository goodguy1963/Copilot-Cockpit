import * as assert from "assert";
import { EventEmitter } from "events";
import { PassThrough } from "stream";
import type * as childProcess from "child_process";
import { OpenCodeExecutor, summarizeOpenCodeJsonOutput } from "../../openCodeExecutor";

class FakeOpenCodeProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
}

suite("OpenCodeExecutor Test Suite", () => {
  test("summarizes OpenCode JSON error output", () => {
    const summary = summarizeOpenCodeJsonOutput([
      JSON.stringify({ type: "session.started", id: "session-1" }),
      JSON.stringify({ type: "error", error: { message: "OpenCode authentication required" } }),
      "not-json",
      "",
    ].join("\n"));

    assert.deepStrictEqual(summary, {
      errorMessage: "OpenCode authentication required",
    });
  });

  test("runs opencode run without model or agent flags when defaults are empty", async () => {
    const fakeProcess = new FakeOpenCodeProcess();
    let capturedCommand = "";
    let capturedArgs: string[] = [];
    let capturedCwd: string | undefined;

    const executor = new OpenCodeExecutor((command, args, options) => {
      capturedCommand = command;
      capturedArgs = args;
      capturedCwd = typeof options.cwd === "string" ? options.cwd : options.cwd?.toString();
      process.nextTick(() => fakeProcess.emit("close", 0));
      return fakeProcess as unknown as childProcess.ChildProcess;
    });

    await executor.executePrompt("Summarize this repo", {
      cwd: "C:\\repo",
      model: "   ",
      agent: "",
    });

    assert.strictEqual(capturedCommand, "opencode");
    assert.deepStrictEqual(capturedArgs, ["run", "--format", "json", "Summarize this repo"]);
    assert.strictEqual(capturedCwd, "C:\\repo");
  });

  test("runs opencode run with model and agent flags when provided", async () => {
    const fakeProcess = new FakeOpenCodeProcess();
    let capturedArgs: string[] = [];

    const executor = new OpenCodeExecutor((_command, args) => {
      capturedArgs = args;
      process.nextTick(() => fakeProcess.emit("close", 0));
      return fakeProcess as unknown as childProcess.ChildProcess;
    });

    await executor.executePrompt("Summarize this repo", {
      model: "openrouter/gpt-5",
      agent: "planner",
    });

    assert.deepStrictEqual(capturedArgs, [
      "run",
      "--format",
      "json",
      "--model",
      "openrouter/gpt-5",
      "--agent",
      "planner",
      "Summarize this repo",
    ]);
  });

  test("rejects with OpenCode JSON error message", async () => {
    const fakeProcess = new FakeOpenCodeProcess();

    const executor = new OpenCodeExecutor(() => {
      process.nextTick(() => {
        fakeProcess.stdout.write(JSON.stringify({
          type: "error",
          error: { message: "OpenCode model is not configured" },
        }) + "\n");
        fakeProcess.emit("close", 1);
      });
      return fakeProcess as unknown as childProcess.ChildProcess;
    });

    await assert.rejects(
      () => executor.executePrompt("Run tests"),
      /OpenCode model is not configured/u,
    );
  });
});