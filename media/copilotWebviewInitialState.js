function readArray(value) {
  return Array.isArray(value) ? value : [];
}

export function createInitialSchedulerWebviewState(initialData, normalizeStorageSettings) {
  var data = initialData || {};
  return {
    storageSettings: normalizeStorageSettings(data.storageSettings),
    researchProfiles: readArray(data.researchProfiles),
    activeResearchRun: data.activeResearchRun || null,
    recentResearchRuns: readArray(data.recentResearchRuns),
    agents: readArray(data.agents),
    models: readArray(data.models),
    promptTemplates: readArray(data.promptTemplates),
    skills: readArray(data.skills),
    copilotHistory: readArray(data.copilotHistory),
    defaultChatSession:
      data.defaultChatSession === "continue" ? "continue" : "new",
    autoShowOnStartup: !!data.autoShowOnStartup,
    workspacePaths: readArray(data.workspacePaths),
    caseInsensitivePaths: !!data.caseInsensitivePaths,
  };
}
