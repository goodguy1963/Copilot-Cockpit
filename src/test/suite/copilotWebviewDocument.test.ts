import * as assert from "assert";
import { renderSchedulerWebviewDocument } from "../../copilotWebviewDocument";

suite("SchedulerWebviewDocument Tests", () => {
  test("renderSchedulerWebviewDocument injects CSP, nonce-bound scripts, and an escaped title", () => {
    const html = renderSchedulerWebviewDocument({
      uiLanguage: "de",
      cspSource: "vscode-webview-resource:",
      nonce: "nonce123",
      title: `A&B\"'<Scheduler>`,
      documentContent: "  <link rel=\"stylesheet\" href=\"styles.css\">",
      initialDataJson: '{"safe":"\\u003cscript>"}',
      scriptUri: "main.js",
    });

    assert.ok(html.startsWith("<!DOCTYPE html>"));
    assert.ok(html.includes('<html lang="de">'));
    assert.ok(html.includes("default-src 'none'; style-src vscode-webview-resource: 'unsafe-inline'; script-src 'nonce-nonce123'; img-src vscode-webview-resource:; font-src vscode-webview-resource:;"));
    assert.ok(html.includes("<title>A&amp;B&quot;&#39;&lt;Scheduler&gt;</title>"));
    assert.ok(html.includes("<link rel=\"stylesheet\" href=\"styles.css\">"));
    assert.ok(html.includes('<script nonce="nonce123" id="initial-data" type="application/json">{"safe":"\\u003cscript>"}</script>'));
    assert.ok(html.includes('<script nonce="nonce123" src="main.js"></script>'));
  });
});