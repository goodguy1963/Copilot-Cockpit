import * as assert from "assert";
import { EventEmitter } from "events";
import { PassThrough } from "stream";
import type * as childProcess from "child_process";
import { CodexExecutor, summarizeCodexJsonlOutput } from "../../codexExecutor";

class FakeCodexProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin = new PassThrough();
}

suite("CodexExecutor Test Suite", () => {
  test("summarizes Codex JSONL events", () => {
    const summary = summarizeCodexJsonlOutput([
      JSON.stringify({ type: "thread.started", thread_id: "thread-1" }),
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Done" } }),
      "not-json",
      "",
    ].join("\n"));

    assert.deepStrictEqual(summary, {
      threadId: "thread-1",
      finalMessage: "Done",
    });
  });

  test("runs codex exec without model flag when the default is empty", async () => {
    const fakeProcess = new FakeCodexProcess();
    let capturedCommand = "";
    let capturedArgs: string[] = [];
    let capturedCwd: string | undefined;
    let capturedPrompt = "";

    fakeProcess.stdin.on("data", (chunk: Buffer | string) => {
      capturedPrompt += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
    });
    fakeProcess.stdin.on("finish", () => {
      fakeProcess.stdout.write(JSON.stringify({ type: "thread.started", thread_id: "thread-2" }) + "\n");
      fakeProcess.emit("close", 0);
    });

    const executor = new CodexExecutor((command, args, options) => {
      capturedCommand = command;
      capturedArgs = args;
      capturedCwd = typeof options.cwd === "string" ? options.cwd : options.cwd?.toString();
      return fakeProcess as unknown as childProcess.ChildProcess;
    });

    await executor.executePrompt("Summarize this repo", {
      cwd: "C:\\repo",
      model: "   ",
    });

    assert.strictEqual(capturedCommand, "codex");
    assert.deepStrictEqual(capturedArgs, ["exec", "--json", "-"]);
    assert.strictEqual(capturedCwd, "C:\\repo");
    assert.strictEqual(capturedPrompt, "Summarize this repo");
  });

  test("runs codex exec with model flag when provided", async () => {
    const fakeProcess = new FakeCodexProcess();
    let capturedArgs: string[] = [];

    fakeProcess.stdin.on("finish", () => {
      fakeProcess.stdout.write(JSON.stringify({ type: "thread.started", thread_id: "thread-3" }) + "\n");
      fakeProcess.emit("close", 0);
    });

    const executor = new CodexExecutor((_command, args) => {
      capturedArgs = args;
      return fakeProcess as unknown as childProcess.ChildProcess;
    });

    await executor.executePrompt("Summarize this repo", {
      model: "gpt-5-codex",
    });

    assert.deepStrictEqual(capturedArgs, ["exec", "--model", "gpt-5-codex", "--json", "-"]);
  });

  test("rejects with Codex JSONL error message", async () => {
    const fakeProcess = new FakeCodexProcess();
    fakeProcess.stdin.on("finish", () => {
      fakeProcess.stdout.write(JSON.stringify({
        type: "error",
        error: { message: "Codex authentication required" },
      }) + "\n");
      fakeProcess.emit("close", 1);
    });

    const executor = new CodexExecutor(() => fakeProcess as unknown as childProcess.ChildProcess);

    await assert.rejects(
      () => executor.executePrompt("Run tests"),
      /Codex authentication required/u,
    );
  });
});