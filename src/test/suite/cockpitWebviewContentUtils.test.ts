import * as assert from "assert";
import {
  buildSchedulerWebviewInitialData,
  escapeHtml,
  escapeHtmlAttr,
  formatModelLabel,
  getModelSourceLabel,
  getWebviewNonce,
  serializeForWebview,
} from "../../cockpitWebviewContentUtils";

suite("SchedulerWebviewContentUtils Tests", () => {
  test("getWebviewNonce returns a 32 character alphanumeric token", () => {
    const nonce = getWebviewNonce();

    assert.strictEqual(nonce.length, 32);
    assert.match(nonce, /^[A-Za-z0-9]{32}$/);
  });

  test("serializeForWebview escapes script-breaking characters", () => {
    const serialized = serializeForWebview({
      tag: "<script>",
      lineSeparator: "before\u2028after",
      paragraphSeparator: "before\u2029after",
    });

    assert.ok(serialized.includes('"tag":"\\u003cscript>"'));
    assert.ok(serialized.includes('"lineSeparator":"before\\u2028after"'));
    assert.ok(serialized.includes('"paragraphSeparator":"before\\u2029after"'));
    assert.ok(!serialized.includes("<script>"));
  });

  test("escapeHtmlAttr escapes attribute-sensitive characters", () => {
    const escaped = escapeHtmlAttr(`A&B\"'<tag>`);

    assert.strictEqual(escaped, "A&amp;B&quot;&#39;&lt;tag&gt;");
  });

  test("escapeHtml escapes text-node-sensitive characters", () => {
    const escaped = escapeHtml("A&B<tag>");

    assert.strictEqual(escaped, "A&amp;B&lt;tag&gt;");
  });

  test("getModelSourceLabel detects OpenRouter and Copilot sources from normalized metadata", () => {
    assert.strictEqual(
      getModelSourceLabel({
        id: "openrouter/gpt-5",
        name: "GPT-5",
        vendor: "",
        description: "Hosted via OPENROUTER",
      }),
      "OpenRouter",
    );

    assert.strictEqual(
      getModelSourceLabel({
        id: "gpt-5",
        name: "GPT-5",
        vendor: "Microsoft",
        description: "GitHub Copilot model",
      }),
      "Copilot",
    );
  });

  test("formatModelLabel appends the source when it differs from the model name", () => {
    assert.strictEqual(
      formatModelLabel({
        id: "gpt-5",
        name: "GPT-5",
        vendor: "OpenAI",
        description: "",
      }),
      "GPT-5 • OpenAI",
    );

    assert.strictEqual(
      formatModelLabel({
        id: "copilot",
        name: "Copilot",
        vendor: "GitHub",
        description: "",
      }),
      "Copilot",
    );
  });

  test("buildSchedulerWebviewInitialData assembles the expected host payload", () => {
    const tasks = [{ id: "task-1", name: "Task 1" }] as any[];
    const jobs = [{ id: "job-1", name: "Job 1" }] as any[];
    const jobFolders = [{ id: "folder-1", name: "Folder 1" }] as any[];
    const cockpitBoard = { sections: [] } as any;
    const telegramNotification = { enabled: true } as any;
    const executionDefaults = { agent: "agent" } as any;
    const reviewDefaults = {
      needsBotReviewCommentTemplate: "Needs bot review",
      needsBotReviewPromptTemplate: "Review {{todo_context}}",
      needsBotReviewAgent: "agent",
      needsBotReviewModel: "gpt-5",
      needsBotReviewChatSession: "new",
      readyPromptTemplate: "Ready {{todo_context}}",
    } as any;
    const storageSettings = { mode: "json" } as any;
    const researchProfiles = [{ id: "profile-1" }] as any[];
    const activeResearchRun = { id: "run-1" } as any;
    const recentResearchRuns = [{ id: "run-2" }] as any[];
    const agents = [{ id: "agent", name: "Agent" }] as any[];
    const models = [{ id: "model", name: "Model" }] as any[];
    const promptTemplates = [{ id: "template-1", label: "Template" }] as any[];
    const skills = [{ id: "skill-1", name: "Skill" }] as any[];
    const workspacePaths = ["f:/workspace"];
    const cockpitHistory = [{ id: "snapshot-1" }] as any[];
    const strings = { title: "Scheduler" };

    const payload = buildSchedulerWebviewInitialData({
      initialTasks: tasks as any,
      currentJobs: jobs as any,
      currentJobFolders: jobFolders as any,
      currentCockpitBoard: cockpitBoard,
      currentTelegramNotification: telegramNotification,
      currentExecutionDefaults: executionDefaults,
      currentReviewDefaults: reviewDefaults,
      currentStorageSettings: storageSettings,
      currentResearchProfiles: researchProfiles as any,
      currentActiveResearchRun: activeResearchRun,
      currentRecentResearchRuns: recentResearchRuns as any,
      initialAgents: agents as any,
      initialModels: models as any,
      initialTemplates: promptTemplates as any,
      cachedSkillReferences: skills as any,
      workspacePaths,
      defaultJitterSeconds: 45,
      defaultChatSession: "continue",
      currentScheduleHistory: cockpitHistory as any,
      autoShowOnStartup: true,
      currentLogLevel: "debug",
      currentLogDirectory: "f:/workspace/.copilot-cockpit-logs",
      configuredLanguage: "de",
      locale: "de-DE",
      strings,
    });

    assert.deepStrictEqual(payload.tasks, tasks);
    assert.deepStrictEqual(payload.jobs, jobs);
    assert.deepStrictEqual(payload.jobFolders, jobFolders);
    assert.deepStrictEqual(payload.cockpitBoard, cockpitBoard);
    assert.deepStrictEqual(payload.telegramNotification, telegramNotification);
    assert.deepStrictEqual(payload.executionDefaults, executionDefaults);
    assert.deepStrictEqual(payload.reviewDefaults, reviewDefaults);
    assert.deepStrictEqual(payload.storageSettings, storageSettings);
    assert.deepStrictEqual(payload.researchProfiles, researchProfiles);
    assert.deepStrictEqual(payload.activeResearchRun, activeResearchRun);
    assert.deepStrictEqual(payload.recentResearchRuns, recentResearchRuns);
    assert.deepStrictEqual(payload.agents, agents);
    assert.deepStrictEqual(payload.models, models);
    assert.deepStrictEqual(payload.promptTemplates, promptTemplates);
    assert.deepStrictEqual(payload.skills, skills);
    assert.deepStrictEqual(payload.workspacePaths, workspacePaths);
    assert.strictEqual(payload.caseInsensitivePaths, process.platform === "win32");
    assert.strictEqual(payload.defaultJitterSeconds, 45);
    assert.strictEqual(payload.defaultChatSession, "continue");
    assert.deepStrictEqual(payload.cockpitHistory, cockpitHistory);
    assert.strictEqual(payload.initialTab, "help");
    assert.strictEqual(payload.autoShowOnStartup, true);
    assert.strictEqual(payload.logLevel, "debug");
    assert.strictEqual(payload.logDirectory, "f:/workspace/.copilot-cockpit-logs");
    assert.strictEqual(payload.languageSetting, "de");
    assert.strictEqual(payload.locale, "de-DE");
    assert.deepStrictEqual(payload.strings, strings);
  });
});