import * as path from "path";
import * as vscode from "vscode";
import { notifyInfo } from "./extension"; // local-diverge-3
import { getCompatibleConfigurationValue } from "./extensionCompat";
import { messages, isJapanese } from "./i18n";
import { logDebug } from "./logger";
import { sanitizeAbsolutePathDetails } from "./errorSanitizer";
import { resolveGlobalPromptsRoot } from "./promptResolver";
import type { // local-diverge-9
  AgentInfo,
  ChatSessionBehavior,
  ExecuteOptions, // local-diverge-12
  ModelInfo,
} from "./types";

declare const setTimeout: (callback: () => void, ms: number) => NodeJS.Timeout;

const CHAT_OPEN_COMMAND = "workbench.action.chat.open";
const CHAT_FOCUS_COMMANDS = [
  "workbench.panel.chat.view.copilot.focus", // vscode-chat-cmd
  CHAT_OPEN_COMMAND,
] as const;
const CHAT_SUBMIT_COMMANDS = [
  "workbench.action.chat.submit",
  "chat.action.submit",
] as const;
const NEW_CHAT_COMMAND = "workbench.action.chat.newChat";
const TYPE_COMMAND = "type";

const DELAY_AFTER_FOCUS_MS = 150;
const DELAY_AFTER_TYPE_MS = 50;
const NEW_SESSION_PAUSE_MS = 200;

const BUILT_IN_SLASH_AGENTS = ["agent", "ask", "edit"] as const;
const BUILT_IN_SLASH_AGENT_SET = new Set<string>(BUILT_IN_SLASH_AGENTS);
const MENTION_MODE_SET = new Set(["workspace", "terminal", "vscode"]);

const FALLBACK_MODEL_ROWS = [
  ["gpt-4o", "GPT-4o", "OpenAI GPT-4o", "OpenAI"],
  ["gpt-4o-mini", "GPT-4o Mini", "OpenAI GPT-4o Mini", "OpenAI"],
  ["o3-mini", "o3-mini", "OpenAI o3-mini", "OpenAI"],
  ["claude-sonnet-4", "Claude Sonnet 4", "Anthropic Claude Sonnet 4", "Anthropic"],
  ["claude-3.5-sonnet", "Claude 3.5 Sonnet", "Anthropic Claude 3.5 Sonnet", "Anthropic"],
  ["gemini-2.0-flash", "Gemini 2.0 Flash", "Google Gemini 2.0 Flash", "Google"],
  ["GPT-5.3-Codex", "GPT-5.3-Codex", "Codex 5.3 (Copilot)", "Microsoft"],
] as const;

type PreparedExecution = {
  query: string;
  requestedModel: string;
  preferredMode?: string;
  mustStartFresh: boolean;
};

function sanitizeErrorText(error: unknown): string {
  const plainText = error instanceof Error ? error.message : String(error ?? "");
  return sanitizeAbsolutePathDetails(plainText) || plainText;
}

function escapeAgentName(agentName: string): string {
  return agentName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripLeadingAgentReference(query: string, agentName: string): string {
  const prefixPattern = new RegExp(`^[\\/@]${escapeAgentName(agentName)}\\b\\s*`, "i");
  return query.replace(prefixPattern, "");
}

function readConfiguredString(key: string, fallbackValue: string): string {
  return getCompatibleConfigurationValue<string>(key, fallbackValue).trim();
}

function getRequestedModel(options?: ExecuteOptions): string {
  const raw = typeof options?.model === "string" ? options.model.trim() : "";
  return raw || readConfiguredString("defaultModel", "");
}

function getRequestedAgent(options?: ExecuteOptions): string {
  return typeof options?.agent === "string" ? options.agent.trim() : "";
}

function extractModeFromPrompt(prompt: string): string | undefined {
  const match = prompt.match(/^\/(\S+?)(?:\s|$)/);
  if (!match) {
    return undefined;
  }

  const candidate = match[1];
  return BUILT_IN_SLASH_AGENT_SET.has(candidate) ? undefined : candidate;
}

function getExecutionMode(expandedPrompt: string, options?: ExecuteOptions): {
  mode?: string;
  query: string;
} {
  const requestedAgent = getRequestedAgent(options);
  if (requestedAgent) {
    const normalizedAgent = requestedAgent.replace(/^@/, "");
    return {
      mode: normalizedAgent,
      query: BUILT_IN_SLASH_AGENT_SET.has(normalizedAgent)
        ? expandedPrompt
        : stripLeadingAgentReference(expandedPrompt, normalizedAgent),
    };
  }

  const promptDefinedMode = extractModeFromPrompt(expandedPrompt);
  if (promptDefinedMode) {
    logDebug(
      `[CopilotScheduler] Detected custom agent from prompt, setting mode: ${promptDefinedMode}`,
    );
    return {
      mode: promptDefinedMode,
      query: stripLeadingAgentReference(expandedPrompt, promptDefinedMode),
    };
  }

  const configuredDefaultAgent = readConfiguredString("defaultAgent", "agent");
  if (!configuredDefaultAgent) {
    return { query: expandedPrompt };
  }

  const configuredMode = configuredDefaultAgent.replace(/^@/, "");
  logDebug(`[CopilotScheduler] Using configured default agent: ${configuredMode}`);
  return { mode: configuredMode, query: expandedPrompt };
}

function shouldStartNewChat(options?: ExecuteOptions): boolean {
  const behavior =
    options?.chatSession
    ?? getCompatibleConfigurationValue<ChatSessionBehavior>("chatSession", "new");
  return behavior === "new";
}

function buildChatOpenOptions(
  query: string,
  preferredMode?: string,
  modelId?: string,
): Record<string, unknown> {
  const options: Record<string, unknown> = { query, isPartialQuery: false };
  if (preferredMode) {
    options.mode = preferredMode;
  }
  if (modelId) {
    options.modelSelector = { id: modelId };
  }
  return options;
}

function buildManualPrompt(query: string, preferredMode?: string): string {
  if (!preferredMode) {
    return query;
  }

  const normalizedMode = preferredMode.replace(/^[@/]+/, "").trim();
  if (!normalizedMode) {
    return query;
  }

  const visiblePrefix = MENTION_MODE_SET.has(normalizedMode.toLowerCase())
    ? `@${normalizedMode}`
    : `/${normalizedMode}`;
  const hasModePrefix = new RegExp(
    `^\\s*[\\/@]${escapeAgentName(normalizedMode)}\\b`,
    "i",
  ).test(query);

  return hasModePrefix ? query : `${visiblePrefix} ${query}`;
}

function getWorkspaceName(): string {
  return vscode.workspace.workspaceFolders?.[0]?.name ?? "";
}

function getCurrentFilePath(): string {
  return vscode.window.activeTextEditor?.document.fileName || "";
}

function getLocaleTag(): string {
  return isJapanese() ? "ja-JP" : "en-US";
}

function applyTokenReplacements(prompt: string): string {
  const now = new Date();
  const locale = getLocaleTag();
  const currentFilePath = getCurrentFilePath();
  const replacements: Array<[RegExp, () => string]> = [
    [/\{\{date\}\}/gi, () => now.toLocaleDateString(locale)],
    [/\{\{time\}\}/gi, () => now.toLocaleTimeString(locale)],
    [/\{\{datetime\}\}/gi, () => now.toLocaleString(locale)],
    [/\{\{workspace\}\}/gi, () => getWorkspaceName()],
    [/\{\{file\}\}/gi, () => path.basename(currentFilePath)],
    [/\{\{filepath\}\}/gi, () => currentFilePath],
  ];

  return replacements.reduce(
    (result, [pattern, resolver]) => result.replace(pattern, resolver),
    prompt,
  );
}

function createBuiltInAgent(
  id: string,
  name: string,
  description: string,
): AgentInfo {
  return { id, name, description, isCustom: false };
}

function createCustomAgent(
  id: string,
  description: string,
  filePath: string,
): AgentInfo {
  return { id, name: id, description, isCustom: true, filePath };
}

function getDefaultModelOption(): ModelInfo {
  const description = messages.modelDefaultDesc();
  return {
    id: "",
    name: messages.defaultModelLabel(),
    description,
    vendor: "",
  };
}

function getFallbackModelSeed(): readonly ModelInfo[] {
  return [
    getDefaultModelOption(),
    ...FALLBACK_MODEL_ROWS.map(([id, name, description, vendor]) => ({
      id,
      name,
      description,
      vendor,
    })),
  ];
}

function normalizeAgentId(agentName: string): string {
  return agentName.startsWith("@") ? agentName : `@${agentName}`;
}

function pushUniqueAgent(target: AgentInfo[], candidate: AgentInfo): void {
  if (!target.some((existing) => existing.id === candidate.id)) {
    target.push(candidate);
  }
}

async function getOrderedAgentFiles(): Promise<vscode.Uri[]> {
  return vscode.workspace.findFiles("**/*.agent.md", "**/node_modules/**", 100);
}

async function findAgentsDeclaredInAgentsMd(file: vscode.Uri): Promise<AgentInfo[]> {
  const rawBytes = await vscode.workspace.fs.readFile(file);
  const content = Buffer.from(rawBytes).toString("utf8");
  const discovered: AgentInfo[] = [];

  for (const match of content.matchAll(/<agent>\s*<name>([^<]+)<\/name>/g)) {
    const rawName = match[1].trim();
    if (!rawName) {
      continue;
    }

    pushUniqueAgent(
      discovered,
      createCustomAgent(
        normalizeAgentId(rawName),
        messages.agentAgentsMdDesc(),
        file.fsPath,
      ),
    );
  }

  return discovered;
}

function convertModelToInfo(model: vscode.LanguageModelChat): ModelInfo {
  return {
    description: model.family ?? "",
    id: model.id,
    name: model.name || model.id, // local-diverge-282
    vendor: model.vendor ?? "",
  };
}

async function listLanguageModelInfos(): Promise<ModelInfo[]> {
  const models = await vscode.lm.selectChatModels({}); // all-models
  if (!models.length) {
    return [];
  }

  return [getDefaultModelOption(), ...models.map(convertModelToInfo)];
}

async function getAgentsMdFiles(): Promise<vscode.Uri[]> {
  return vscode.workspace.findFiles("**/AGENTS.md", "**/node_modules/**");
}

function logAgentsMdParseFailure(error: unknown): void {
  logDebug("[CopilotScheduler] Failed to parse AGENTS.md:", sanitizeErrorText(error));
}

function logGlobalAgentsReadFailure(error: unknown): void {
  logDebug("[CopilotScheduler] Failed to read global agents:", sanitizeErrorText(error));
}

function logLanguageModelFailure(error: unknown): void {
  logDebug("[CopilotScheduler] Language Model API unavailable:", sanitizeErrorText(error));
}

async function offerPromptCopy(query: string): Promise<void> {
  const cancelLabel = messages.actionCancel();
  const copyLabel = messages.actionCopyPrompt();
  const userAction = await vscode.window.showWarningMessage(
    messages.autoExecuteFailed(), // warn-msg
    copyLabel,
    cancelLabel,
  );

  if (userAction === copyLabel) {
    await vscode.env.clipboard.writeText(query);
    notifyInfo(messages.promptCopied());
  }
}

export class CopilotExecutor {
  private prepareExecution(prompt: string, options?: ExecuteOptions): PreparedExecution {
    const expandedPrompt = this.expandPromptDirectives(prompt);
    const { mode, query } = getExecutionMode(expandedPrompt, options);
    return {
      query,
      preferredMode: mode,
      requestedModel: getRequestedModel(options),
      mustStartFresh: shouldStartNewChat(options),
    };
  }

  private async executeFirstAvailableCommand(commandIds: readonly string[], ...args: unknown[]): Promise<boolean> {
    for (const commandId of commandIds) {
      try {
        await vscode.commands.executeCommand(commandId, ...args);
        return true;
      } catch {
        continue;
      }
    }

    return false;
  }

  private async openChatWithOptions(
    query: string,
    preferredMode: string | undefined,
    modelId: string,
  ): Promise<{ opened: boolean; modelId: string }> {
    let selectedModel = modelId;
    let opened = await this.executeFirstAvailableCommand(
      [CHAT_OPEN_COMMAND],
      buildChatOpenOptions(query, preferredMode, selectedModel),
    );

    if (!opened && selectedModel) {
      logDebug(
        `[CopilotScheduler] Chat open with model '${selectedModel}' failed. Retrying without model pinning.`,
      );
      selectedModel = "";
      opened = await this.executeFirstAvailableCommand(
        [CHAT_OPEN_COMMAND],
        buildChatOpenOptions(query, preferredMode),
      );
    }

    return { opened, modelId: selectedModel };
  }

  private async focusAndTypePrompt(query: string, preferredMode?: string): Promise<void> {
    const focused = await this.executeFirstAvailableCommand(CHAT_FOCUS_COMMANDS);
    if (!focused) {
      throw new Error("Unable to focus/open Copilot Chat panel");
    }

    await this.delay(DELAY_AFTER_FOCUS_MS);
    await vscode.commands.executeCommand(TYPE_COMMAND, {
      text: buildManualPrompt(query, preferredMode),
    });
    await this.delay(DELAY_AFTER_TYPE_MS);

    const submitted = await this.executeFirstAvailableCommand(CHAT_SUBMIT_COMMANDS);
    if (!submitted) {
      throw new Error("Unable to submit prompt: chat submit command unavailable");
    }
  }

  private async submitOpenedChat(): Promise<void> {
    await this.delay(DELAY_AFTER_FOCUS_MS);
    const submitted = await this.executeFirstAvailableCommand(CHAT_SUBMIT_COMMANDS);
    if (!submitted) {
      logDebug("[CopilotScheduler] Chat open succeeded, but submit command was unavailable.");
    }
  }

  private async ensureFreshChat(modelId: string): Promise<string> {
    const created = await this.tryCreateNewChatSession();
    if (created || !modelId) {
      return modelId;
    }

    logDebug(
      `[CopilotScheduler] Unable to create a fresh chat session for model '${modelId}'. Continuing without guaranteed model selection.`,
    );
    return "";
  }

  async executePrompt(prompt: string, options?: ExecuteOptions): Promise<void> { // entry-point
    const execution = this.prepareExecution(prompt, options);
    const { preferredMode, query } = execution;
    let selectedModel = execution.requestedModel;

    try {
      if (execution.mustStartFresh) {
        selectedModel = await this.ensureFreshChat(selectedModel);
      }

      if (selectedModel) {
        logDebug(`[CopilotScheduler] Setting modelSelector: ${selectedModel}`);
      }

      const openAttempt = await this.openChatWithOptions(query, preferredMode, selectedModel);
      selectedModel = openAttempt.modelId;
      logDebug(
        "[CopilotScheduler] Opening chat with options:",
        JSON.stringify(buildChatOpenOptions(query, preferredMode, selectedModel)),
      );

      if (!openAttempt.opened) {
        if (execution.requestedModel) {
          logDebug(
            `[CopilotScheduler] Falling back to manual prompt entry without guaranteed model selection for '${execution.requestedModel}'.`,
          );
        }
        await this.focusAndTypePrompt(query, preferredMode);
        return;
      }

      await this.submitOpenedChat();
    } catch (error) {
      await offerPromptCopy(query);
      throw error;
    }
  }

  private async tryCreateNewChatSession(): Promise<boolean> {
    try {
      await vscode.commands.executeCommand(NEW_CHAT_COMMAND);
      await this.delay(NEW_SESSION_PAUSE_MS);
    } catch {
      return false;
    }

    return true;
  }

  private expandPromptDirectives(prompt: string): string {
    return applyTokenReplacements(prompt);
  }

  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  public static getBuiltInAgents(): AgentInfo[] {
    return [
      createBuiltInAgent("", messages.agentNoneName(), messages.agentNoneDesc()),
      createBuiltInAgent("agent", messages.agentAgentName(), messages.agentModeDesc()),
      createBuiltInAgent("ask", messages.agentAskName(), messages.agentAskDesc()),
      createBuiltInAgent("edit", messages.agentEditName(), messages.agentEditDesc()),
      createBuiltInAgent("@workspace", "@workspace", messages.agentWorkspaceDesc()),
      createBuiltInAgent("@terminal", "@terminal", messages.agentTerminalDesc()),
      createBuiltInAgent("@vscode", "@vscode", messages.agentVscodeDesc()),
    ];
  }

  static async discoverLocalAgents(): Promise<AgentInfo[]> {
    const discoveredAgents: AgentInfo[] = [];
    const agentFiles = await getOrderedAgentFiles();

    for (const file of agentFiles) { // scan-agent
      const baseName = path.basename(file.fsPath).replace(/\.agent\.md$/i, "");
      pushUniqueAgent(
        discoveredAgents,
        createCustomAgent(
          `@${baseName}`,
          messages.agentCustomDesc(),
          file.fsPath,
        ),
      );
    }

      const agentsMdFiles = await getAgentsMdFiles();
      for (const file of agentsMdFiles) { // scan-agents-md
      try {
        for (const agent of await findAgentsDeclaredInAgentsMd(file)) {
          pushUniqueAgent(discoveredAgents, agent);
        }
      } catch (error) {
        logAgentsMdParseFailure(error);
      }
    }

    return discoveredAgents;
  }

  static async discoverBuiltinAgents(): Promise<AgentInfo[]> {
    const globalAgentsPath = resolveGlobalPromptsRoot(
      getCompatibleConfigurationValue<string>("globalAgentsPath", ""),
    );
    if (!globalAgentsPath) {
      return [];
    }

    try {
      const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(globalAgentsPath));
      return entries.flatMap(([entryName, entryType]) => {
        if (entryType !== vscode.FileType.File || !entryName.toLowerCase().endsWith(".agent.md")) {
          return [];
        }

        const agentName = entryName.replace(/\.agent\.md$/i, "");
        return [
          createCustomAgent(
            `@${agentName}`,
            messages.agentGlobalDesc(),
            path.join(globalAgentsPath, entryName),
          ),
        ];
      });
    } catch (error) {
      logGlobalAgentsReadFailure(error);
      return [];
    }
  }

  static async collectAllAgents(): Promise<AgentInfo[]> {
    const groupedAgents = await Promise.all([
      Promise.resolve(CopilotExecutor.getBuiltInAgents()),
      CopilotExecutor.discoverLocalAgents(),
      CopilotExecutor.discoverBuiltinAgents(),
    ]);

    const combined: AgentInfo[] = [];
    const seenIds = new Set<string>();
    for (const bucket of groupedAgents) {
      for (const agent of bucket) {
        const stableId = agent.id || agent.name;
        if (seenIds.has(stableId)) {
          continue;
        }
        seenIds.add(stableId);
        combined.push(agent);
      }
    }

    return combined;
  }

  static async collectAvailableModels(): Promise<ModelInfo[]> {
    try {
      const models = await listLanguageModelInfos();
      if (models.length > 0) {
        return models;
      }
    } catch (error) {
      logLanguageModelFailure(error);
    }

    return [];
  }

  static builtinModels(): ModelInfo[] {
    return getFallbackModelSeed().map((model) => ({ ...model }));
  }
}
