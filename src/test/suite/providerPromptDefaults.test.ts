import * as assert from "assert";

type TestOnlyExports = typeof import("../../extension").__testOnly;

let cachedTestOnlyExports: TestOnlyExports | undefined;

async function getTestOnlyExports(): Promise<TestOnlyExports> {
  if (!cachedTestOnlyExports) {
    const extensionModule = await import("../../extension");
    cachedTestOnlyExports = extensionModule.__testOnly;
  }

  return cachedTestOnlyExports;
}

suite("Provider prompt defaults", () => {
  test("needs-bot-review prompt guidance explains search vs deeper research providers", async () => {
    const testOnly = await getTestOnlyExports();

    assert.strictEqual(
      testOnly.buildDefaultNeedsBotReviewPromptTemplate("built-in", "none"),
      [
        "You are handling a Todo that just entered needs-bot-review.",
        "",
        "{{todo_context}}",
        "",
        "{{mcp_skill_guidance}}",
        "",
        "Research what is needed to review this item using available tools. If the user or request already includes a URL, inspect it with built-in and local tools first before using external research providers, especially Google grounded research, to minimize API calls. Use VS Code built-in web search for lightweight external search. If deeper research is still needed after built-in and local URL checks, stay on built-in/local tooling only.",
        "Return a plain-text review comment ready for direct Todo writeback with short titled sections and bullets:",
        "Review Summary:",
        "- 1-2 bullets on the request and current repo state",
        "Risks / Gaps:",
        "- bullets for missing context, risks, or unclear assumptions",
        "Recommendation:",
        "- one compact next step or blocking clarification; if the request is already clear, give two implementation options instead",
        "Use real line breaks. Do not emit JSON or escaped newline sequences such as \\n.",
        "When the review is complete, add that comment to this Todo using the cockpit MCP tools and set the flag to needs-user-review.",
      ].join("\n"),
    );

    assert.strictEqual(
      testOnly.buildDefaultNeedsBotReviewPromptTemplate("tavily", "google-grounded"),
      [
        "You are handling a Todo that just entered needs-bot-review.",
        "",
        "{{todo_context}}",
        "",
        "{{mcp_skill_guidance}}",
        "",
        "Research what is needed to review this item using available tools. If the user or request already includes a URL, inspect it with built-in and local tools first before using external research providers, especially Google grounded research, to minimize API calls. Use VS Code built-in web search for lightweight external search. If deeper research is still needed after built-in and local URL checks, use Google grounded research.",
        "Return a plain-text review comment ready for direct Todo writeback with short titled sections and bullets:",
        "Review Summary:",
        "- 1-2 bullets on the request and current repo state",
        "Risks / Gaps:",
        "- bullets for missing context, risks, or unclear assumptions",
        "Recommendation:",
        "- one compact next step or blocking clarification; if the request is already clear, give two implementation options instead",
        "Use real line breaks. Do not emit JSON or escaped newline sequences such as \\n.",
        "When the review is complete, add that comment to this Todo using the cockpit MCP tools and set the flag to needs-user-review.",
      ].join("\n"),
    );

    assert.deepStrictEqual(
      testOnly.resolveProviderSettings({
        searchProvider: "tavily",
        researchProvider: "perplexity",
        hasExplicitResearchProvider: true,
      }),
      {
        searchProvider: "built-in",
        researchProvider: "perplexity",
      },
    );
  });
});