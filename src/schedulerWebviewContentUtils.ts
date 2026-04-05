import type {
  AgentInfo,
  ChatSessionBehavior,
  CockpitBoard,
  ExecutionDefaultsView,
  JobDefinition,
  JobFolder,
  ModelInfo,
  PromptTemplate,
  ResearchProfile,
  ResearchRun,
  ReviewDefaultsView,
  ScheduleHistoryEntry,
  ScheduledTask,
  SkillReference,
  StorageSettingsView,
  LogLevel,
  TelegramNotificationView,
} from "./types";

export function getWebviewNonce(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const nonceChars: string[] = [];

  for (let index = 0; index < 32; index += 1) {
    const randomIndex = Math.floor(Math.random() * alphabet.length);
    nonceChars.push(alphabet[randomIndex] ?? "");
  }

  return nonceChars.join("");
}

export function serializeForWebview(value: unknown): string {
  const json = JSON.stringify(value ?? null) ?? "null";
  const escapes: Array<[pattern: RegExp, replacement: string]> = [
    [/</g, "\\u003c"],
    [/\u2028/g, "\\u2028"],
    [/\u2029/g, "\\u2029"],
  ];

  return escapes.reduce(
    (serialized, [pattern, replacement]) => serialized.replace(pattern, replacement),
    json,
  );
}

export function escapeHtmlAttr(str: string): string {
  const replacements: Array<[pattern: RegExp, replacement: string]> = [
    [/&/g, "&amp;"],
    [/"/g, "&quot;"],
    [/'/g, "&#39;"],
    [/</g, "&lt;"],
    [/>/g, "&gt;"],
  ];

  return replacements.reduce(
    (escaped, [pattern, replacement]) => escaped.replace(pattern, replacement),
    str,
  );
}

export function escapeHtml(str: string): string {
  return ["&", "<", ">"].reduce((escaped, char) => {
    switch (char) {
      case "&":
        return escaped.replace(/&/g, "&amp;");
      case "<":
        return escaped.replace(/</g, "&lt;");
      default:
        return escaped.replace(/>/g, "&gt;");
    }
  }, str);
}

export function getModelSourceLabel(model: ModelInfo): string {
  const id = String(model.id || "").trim();
  const name = String(model.name || "").trim();
  const vendor = String(model.vendor || "").trim();
  const description = String(model.description || "").trim();
  const normalized = [id, name, vendor, description].join(" ").toLowerCase();

  if (normalized.includes("openrouter")) {
    return "OpenRouter";
  }

  if (
    normalized.includes("copilot") ||
    normalized.includes("codex") ||
    normalized.includes("github") ||
    normalized.includes("microsoft")
  ) {
    return "Copilot";
  }

  return vendor;
}

export function formatModelLabel(model: ModelInfo): string {
  const name = String(model.name || model.id || "").trim();
  const source = getModelSourceLabel(model);
  if (!source || source.toLowerCase() === name.toLowerCase()) {
    return name;
  }

  return `${name} • ${source}`;
}

type BuildSchedulerWebviewInitialDataParams = {
  initialTasks: ScheduledTask[];
  currentJobs: JobDefinition[];
  currentJobFolders: JobFolder[];
  currentCockpitBoard: CockpitBoard;
  currentTelegramNotification: TelegramNotificationView;
  currentExecutionDefaults: ExecutionDefaultsView;
  currentReviewDefaults: ReviewDefaultsView;
  currentStorageSettings: StorageSettingsView;
  currentResearchProfiles: ResearchProfile[];
  currentActiveResearchRun: ResearchRun | undefined;
  currentRecentResearchRuns: ResearchRun[];
  initialAgents: AgentInfo[];
  initialModels: ModelInfo[];
  initialTemplates: PromptTemplate[];
  cachedSkillReferences: SkillReference[];
  workspacePaths: string[];
  defaultJitterSeconds: number;
  defaultChatSession: ChatSessionBehavior;
  currentScheduleHistory: ScheduleHistoryEntry[];
  autoShowOnStartup: boolean;
  currentLogLevel: LogLevel;
  currentLogDirectory: string;
  configuredLanguage: string;
  locale: string;
  strings: Record<string, unknown>;
};

export function buildSchedulerWebviewInitialData(
  params: BuildSchedulerWebviewInitialDataParams,
): Record<string, unknown> {
  return {
    tasks: params.initialTasks,
    jobs: params.currentJobs,
    jobFolders: params.currentJobFolders,
    cockpitBoard: params.currentCockpitBoard,
    telegramNotification: params.currentTelegramNotification,
    executionDefaults: params.currentExecutionDefaults,
    reviewDefaults: params.currentReviewDefaults,
    storageSettings: params.currentStorageSettings,
    researchProfiles: params.currentResearchProfiles,
    activeResearchRun: params.currentActiveResearchRun,
    recentResearchRuns: params.currentRecentResearchRuns,
    agents: params.initialAgents,
    models: params.initialModels,
    promptTemplates: params.initialTemplates,
    skills: params.cachedSkillReferences,
    workspacePaths: params.workspacePaths,
    caseInsensitivePaths: process.platform === "win32",
    defaultJitterSeconds: params.defaultJitterSeconds,
    defaultChatSession: params.defaultChatSession,
    scheduleHistory: params.currentScheduleHistory,
    initialTab: "help",
    autoShowOnStartup: params.autoShowOnStartup,
    logLevel: params.currentLogLevel,
    logDirectory: params.currentLogDirectory,
    languageSetting: params.configuredLanguage,
    locale: params.locale,
    strings: params.strings,
  };
}

type SchedulerWebviewStringMap = Record<string, unknown>;

function getWebviewString(
  strings: SchedulerWebviewStringMap,
  key: string,
): string {
  const value = strings[key];
  return typeof value === "string" ? value : "";
}

export function normalizeSchedulerWebviewJitterSeconds(
  rawValue: unknown,
  fallback = 600,
): number {
  const numericValue =
    typeof rawValue === "number" ? rawValue : Number(rawValue);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  const wholeSeconds = Math.floor(numericValue);
  return Math.min(Math.max(wholeSeconds, 0), 1800);
}

export function buildPromptSourceRadioGroupMarkup(
  strings: SchedulerWebviewStringMap,
): string {
  const choices: Array<{ value: string; labelKey: string; checked?: boolean }> = [
    { value: "inline", labelKey: "labelPromptInline", checked: true },
    { value: "local", labelKey: "labelPromptLocal" },
    { value: "global", labelKey: "labelPromptGlobal" },
  ];

  const radios = choices
    .map(
      ({ checked, labelKey, value }) => `<label>
                  <input type="radio" name="prompt-source" value="${escapeHtmlAttr(value)}" ${checked ? "checked" : ""}>
                  ${escapeHtml(getWebviewString(strings, labelKey))}
                </label>`,
    )
    .join("\n");

  return `<div class="form-group" style="margin:0;">
              <label>${escapeHtml(getWebviewString(strings, "labelPromptType"))}</label>
              <div class="radio-group">
                ${radios}
              </div>
            </div>`;
}

export function buildFriendlyCronBuilderMarkup(
  strings: SchedulerWebviewStringMap,
  idPrefix: string,
): string {
  const fieldPrefix = idPrefix.trim();
  const selectId = `${fieldPrefix}-frequency`;
  const intervalId = `${fieldPrefix}-interval`;
  const minuteId = `${fieldPrefix}-minute`;
  const hourId = `${fieldPrefix}-hour`;
  const dayOfWeekId = `${fieldPrefix}-dow`;
  const dayOfMonthId = `${fieldPrefix}-dom`;
  const generateButtonId = `${fieldPrefix}-generate`;

  const frequencyOptions: Array<{ value: string; labelKey: string }> = [
    { value: "", labelKey: "labelFriendlySelect" },
    { value: "every-n", labelKey: "labelEveryNMinutes" },
    { value: "hourly", labelKey: "labelHourlyAtMinute" },
    { value: "daily", labelKey: "labelDailyAtTime" },
    { value: "weekly", labelKey: "labelWeeklyAtTime" },
    { value: "monthly", labelKey: "labelMonthlyAtTime" },
  ];

  const weekDayOptions = [
    ["0", "daySun"],
    ["1", "dayMon"],
    ["2", "dayTue"],
    ["3", "dayWed"],
    ["4", "dayThu"],
    ["5", "dayFri"],
    ["6", "daySat"],
  ] as const;

  return `<div class="friendly-cron" id="${escapeHtmlAttr(fieldPrefix)}-builder">
                  <div class="section-title">${escapeHtml(getWebviewString(strings, "labelFriendlyBuilder"))}</div>
                  <div class="friendly-grid">
                    <div class="form-group">
                      <label for="${escapeHtmlAttr(selectId)}">${escapeHtml(getWebviewString(strings, "labelFrequency"))}</label>
                      <select id="${escapeHtmlAttr(selectId)}">
                        ${frequencyOptions
                          .map(
                            ({ labelKey, value }) =>
                              `<option value="${escapeHtmlAttr(value)}">${escapeHtml(getWebviewString(strings, labelKey))}</option>`,
                          )
                          .join("")}
                      </select></div><div class="form-group friendly-field" data-field="interval">
                      <label for="${escapeHtmlAttr(intervalId)}">${escapeHtml(getWebviewString(strings, "labelInterval"))}</label>
                      <input type="number" id="${escapeHtmlAttr(intervalId)}" min="1" max="59" value="5">
                    </div>
                    <div class="form-group friendly-field" data-field="minute">
                      <label for="${escapeHtmlAttr(minuteId)}">${escapeHtml(getWebviewString(strings, "labelMinute"))}</label>
                      <input type="number" id="${escapeHtmlAttr(minuteId)}" min="0" max="59" value="0">
                    </div>
                    <div class="form-group friendly-field" data-field="hour">
                      <label for="${escapeHtmlAttr(hourId)}">${escapeHtml(getWebviewString(strings, "labelHour"))}</label>
                      <input type="number" id="${escapeHtmlAttr(hourId)}" min="0" max="23" value="9">
                    </div>
                    <div class="form-group friendly-field" data-field="dow">
                      <label for="${escapeHtmlAttr(dayOfWeekId)}">${escapeHtml(getWebviewString(strings, "labelDayOfWeek"))}</label>
                      <select id="${escapeHtmlAttr(dayOfWeekId)}">
                        ${weekDayOptions
                          .map(
                            ([value, labelKey]) =>
                              `<option value="${escapeHtmlAttr(value)}">${escapeHtml(getWebviewString(strings, labelKey))}</option>`,
                          )
                          .join("")}
                      </select></div><div class="form-group friendly-field" data-field="dom">
                      <label for="${escapeHtmlAttr(dayOfMonthId)}">${escapeHtml(getWebviewString(strings, "labelDayOfMonth"))}</label>
                      <input type="number" id="${escapeHtmlAttr(dayOfMonthId)}" min="1" max="31" value="1">
                    </div></div><div class="friendly-actions">
                    <button type="button" class="btn-secondary" id="${escapeHtmlAttr(generateButtonId)}">${escapeHtml(getWebviewString(strings, "labelFriendlyGenerate"))}</button>
                  </div>
                </div>`;
}

export function buildTaskScopeRadioGroupMarkup(
  strings: SchedulerWebviewStringMap,
  defaultScope: "global" | "workspace",
): string {
  const options: Array<{ value: "workspace" | "global"; labelKey: string }> = [
    { value: "workspace", labelKey: "labelScopeWorkspace" },
    { value: "global", labelKey: "labelScopeGlobal" },
  ];

  return `<div class="form-group" style="margin:0;">
                <label>${escapeHtml(getWebviewString(strings, "labelScope"))}</label>
                <div class="radio-group">
                  ${options
                    .map(
                      ({ labelKey, value }) => `<label>
                    <input type="radio" name="scope" value="${escapeHtmlAttr(value)}" ${defaultScope === value ? "checked" : ""}>
                    ${escapeHtml(getWebviewString(strings, labelKey))}
                  </label>`,
                    )
                    .join("\n")}
                </div>
              </div>`;
}
