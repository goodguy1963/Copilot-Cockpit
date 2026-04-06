import * as assert from "assert";
import { messages } from "../../i18n";
import { buildSchedulerWebviewStrings } from "../../copilotWebviewStrings";

suite("SchedulerWebviewStrings Tests", () => {
  test("falls back to English for unsupported languages", () => {
    const strings = buildSchedulerWebviewStrings("fr");

    assert.strictEqual(strings.title, messages.webviewTitle());
    assert.strictEqual(strings.tabTodoEditor, "Create Todo");
    assert.strictEqual(strings.helpLanguageTitle, "Language");
    assert.strictEqual(strings.settingsStorageModeSqlite, "SQLite as primary store");
  });

  test("returns localized German and Japanese labels for representative keys", () => {
    const german = buildSchedulerWebviewStrings("de");
    const japanese = buildSchedulerWebviewStrings("ja");

    assert.strictEqual(german.tabTaskEditor, "Task erstellen");
    assert.strictEqual(german.helpLanguageTitle, "Sprache");
    assert.strictEqual(german.telegramTitle, "Telegram-Benachrichtigungen");

    assert.strictEqual(japanese.tabTaskEditor, "タスクを作成");
    assert.strictEqual(japanese.helpLanguageTitle, "言語");
    assert.strictEqual(japanese.telegramTitle, "Telegram 通知");
  });

  test("builds a non-empty string catalog for the webview", () => {
    const strings = buildSchedulerWebviewStrings("en");

    assert.ok(Object.keys(strings).length > 200);
    for (const [key, value] of Object.entries(strings)) {
      assert.strictEqual(typeof value, "string", `Expected ${key} to be a string`);
      assert.ok(value.length > 0, `Expected ${key} to be non-empty`);
    }
  });
});