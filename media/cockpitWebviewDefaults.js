export function resolveInitialSchedulerCollections(initialData) {
  return {
    tasks: Array.isArray(initialData.tasks) ? initialData.tasks : [],
    jobs: Array.isArray(initialData.jobs) ? initialData.jobs : [],
    jobFolders: Array.isArray(initialData.jobFolders)
      ? initialData.jobFolders
      : [],
    cockpitBoard: initialData.cockpitBoard || {
      version: 4,
      sections: [],
      cards: [],
      labelCatalog: [],
      archives: { completedSuccessfully: [], rejected: [] },
      filters: {
        labels: [],
        priorities: [],
        statuses: [],
        archiveOutcomes: [],
        flags: [],
        sortBy: "manual",
        sortDirection: "asc",
        viewMode: "board",
        showArchived: false,
        showRecurringTasks: false,
      },
      updatedAt: "",
    },
    telegramNotification: initialData.telegramNotification || {
      enabled: false,
      hasBotToken: false,
      hookConfigured: false,
    },
    executionDefaults: initialData.executionDefaults || {
      agent: "agent",
      model: "",
    },
    reviewDefaults: initialData.reviewDefaults || {
      needsBotReviewCommentTemplate: "",
      needsBotReviewPromptTemplate: "",
      needsBotReviewAgent: "agent",
      needsBotReviewModel: "",
      needsBotReviewChatSession: "new",
      readyPromptTemplate: "",
    },
  };
}

function normalizeMcpSetupStatus(value, previousValue) {
  switch (value) {
    case "configured":
    case "missing":
    case "stale":
    case "invalid":
    case "workspace-required":
      return value;
    default:
      return previousValue || "workspace-required";
  }
}

export function createStorageSettingsNormalizer(normalizeTodoLabelKey) {
  return function normalizeStorageSettings(value, previousValue) {
    var disabledSystemFlagKeys = Array.isArray(value && value.disabledSystemFlagKeys)
      ? value.disabledSystemFlagKeys
        .map(function (entry) { return normalizeTodoLabelKey(entry); })
        .filter(function (entry, index, values) {
          return !!entry && values.indexOf(entry) === index;
        })
      : ((previousValue && previousValue.disabledSystemFlagKeys) || []).slice();
    return {
      mode:
        value && value.mode === "json"
          ? "json"
          : "sqlite",
      sqliteJsonMirror:
        !value || value.sqliteJsonMirror !== false,
      disabledSystemFlagKeys: disabledSystemFlagKeys,
      appVersion:
        value && typeof value.appVersion === "string"
          ? value.appVersion
          : (previousValue && previousValue.appVersion) || "",
      mcpSetupStatus: normalizeMcpSetupStatus(
        value && value.mcpSetupStatus,
        previousValue && previousValue.mcpSetupStatus,
      ),
      lastMcpSupportUpdateAt:
        value && typeof value.lastMcpSupportUpdateAt === "string"
          ? value.lastMcpSupportUpdateAt
          : (previousValue && previousValue.lastMcpSupportUpdateAt) || "",
      lastBundledSkillsSyncAt:
        value && typeof value.lastBundledSkillsSyncAt === "string"
          ? value.lastBundledSkillsSyncAt
          : (previousValue && previousValue.lastBundledSkillsSyncAt) || "",
      lastBundledAgentsSyncAt:
        value && typeof value.lastBundledAgentsSyncAt === "string"
          ? value.lastBundledAgentsSyncAt
          : (previousValue && previousValue.lastBundledAgentsSyncAt) || "",
    };
  };
}
