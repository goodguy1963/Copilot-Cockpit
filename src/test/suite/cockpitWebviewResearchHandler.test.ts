import * as assert from "assert";
import { handleResearchWebviewMessage } from "../../cockpitWebviewResearchHandler";
import type { TaskAction, WebviewToExtensionMessage } from "../../types";

suite("Research Handler Tests", () => {
  function collectAction(message: WebviewToExtensionMessage): TaskAction | undefined {
    let captured: TaskAction | undefined;
    const handled = handleResearchWebviewMessage(message, (action) => {
      captured = action;
    });
    assert.ok(handled, `Expected message type '${message.type}' to be handled`);
    return captured;
  }

  test("createResearchProfile dispatches correct action", () => {
    const action = collectAction({
      type: "createResearchProfile",
      data: { name: "rp1", queries: [], schedule: "daily" },
    } as unknown as WebviewToExtensionMessage);
    assert.strictEqual(action?.action, "createResearchProfile");
    assert.strictEqual(action?.taskId, "__research__");
    assert.ok((action as unknown as Record<string, unknown>).researchData);
  });

  test("updateResearchProfile carries researchId", () => {
    const action = collectAction({
      type: "updateResearchProfile",
      researchId: "rp-1",
      data: { name: "updated" },
    } as unknown as WebviewToExtensionMessage);
    assert.strictEqual(action?.action, "updateResearchProfile");
    assert.strictEqual((action as unknown as Record<string, unknown>).researchId, "rp-1");
  });

  test("deleteResearchProfile dispatches delete", () => {
    const action = collectAction({
      type: "deleteResearchProfile",
      researchId: "rp-2",
    } as unknown as WebviewToExtensionMessage);
    assert.strictEqual(action?.action, "deleteResearchProfile");
    assert.strictEqual((action as unknown as Record<string, unknown>).researchId, "rp-2");
  });

  test("duplicateResearchProfile dispatches duplicate", () => {
    const action = collectAction({
      type: "duplicateResearchProfile",
      researchId: "rp-3",
    } as unknown as WebviewToExtensionMessage);
    assert.strictEqual(action?.action, "duplicateResearchProfile");
    assert.strictEqual((action as unknown as Record<string, unknown>).researchId, "rp-3");
  });

  test("startResearchRun dispatches start", () => {
    const action = collectAction({
      type: "startResearchRun",
      researchId: "rp-4",
    } as unknown as WebviewToExtensionMessage);
    assert.strictEqual(action?.action, "startResearchRun");
    assert.strictEqual((action as unknown as Record<string, unknown>).researchId, "rp-4");
  });

  test("stopResearchRun dispatches stop without researchId", () => {
    const action = collectAction({
      type: "stopResearchRun",
    } as unknown as WebviewToExtensionMessage);
    assert.strictEqual(action?.action, "stopResearchRun");
    assert.strictEqual(action?.taskId, "__research__");
  });

  test("returns false for unrelated message type", () => {
    const handled = handleResearchWebviewMessage(
      { type: "runTask", taskId: "t1" } as WebviewToExtensionMessage,
      () => {},
    );
    assert.strictEqual(handled, false);
  });

  test("tolerates undefined callback", () => {
    const handled = handleResearchWebviewMessage(
      { type: "startResearchRun", researchId: "rp-5" } as WebviewToExtensionMessage,
      undefined,
    );
    assert.strictEqual(handled, true);
  });
});
