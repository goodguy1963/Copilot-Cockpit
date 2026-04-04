/**
 * Copilot Cockpit - Copilot Executor
 * Handles communication with GitHub Copilot Chat
 */

import * as vscode from "vscode";
import * as path from "path";
import { notifyInfo } from "./extension";
import type {
  AgentInfo,
  ModelInfo,
  ExecuteOptions,
  ChatSessionBehavior,
} from "./types";
import { messages, isJapanese } from "./i18n";
import { logDebug, logError } from "./logger";
import { sanitizeAbsolutePathDetails } from "./errorSanitizer";
import { getCompatibleConfigurationValue } from "./extensionCompat";
import { resolveGlobalPromptsRoot } from "./promptResolver";

// Node.js globals
declare const setTimeout: (callback: () => void, ms: number) => NodeJS.Timeout;

// Timing constants for Copilot Chat interaction delays (ms)
const DELAY_AFTER_FOCUS_MS = 150;
const DELAY_AFTER_MODEL_SELECT_MS = 100;
const DELAY_AFTER_TYPE_MS = 50;
const DELAY_NEW_SESSION_MS = 200;

/** Slash-command agents — prefixed with "/" instead of "@" */
const SLASH_COMMAND_AGENTS: ReadonlySet<string> = new Set([
  "agent",
  "ask",
  "edit",
]);

function toSafeErrorDetails(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  return sanitizeAbsolutePathDetails(raw) || raw;
}

/**
 * Executes prompts through GitHub Copilot Chat
 */
export class CopilotExecutor {
  private createOpenChatOptions(
    query: string,
    mode?: string,
    modelId?: string,
  ): Record<string, unknown> {
    const openOptions: Record<string, unknown> = {
      query,
      isPartialQuery: false,
    };

    if (mode) {
      openOptions.mode = mode;
    }

    if (modelId) {
      openOptions.modelSelector = { id: modelId };
    }

    return openOptions;
  }

  private async executeFirstAvailableCommand(
    commandIds: string[],
    ...args: unknown[]
  ): Promise<boolean> {
    for (const id of commandIds) {
      try {
        await vscode.commands.executeCommand(id, ...args);
        return true;
      } catch {
        // Try next candidate.
      }
    }
    return false;
  }

  /**
   * Strip a leading agent reference (@name or /name) from the query text.
   * Returns the query without the prefix so we can re-add it in the correct format.
   */
  private stripLeadingAgentRef(query: string, agentName: string): string {
    // Strip leading @agentName or /agentName (case-insensitive)
    const escaped = agentName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^[\\/@]${escaped}\\b\\s*`, 'i');
    return query.replace(re, '');
  }

  /**
   * Build a fallback inline mode prefix when chat.open options are unavailable.
   * - Mention agents use `@` (workspace/terminal/vscode)
   * - Built-in and custom chat modes use `/`
   */
  private getFallbackModePrefix(mode: string): string {
    const normalized = mode.replace(/^[@/]+/, "").trim();
    if (!normalized) return "";

    const mentionModes = new Set(["workspace", "terminal", "vscode"]);
    if (mentionModes.has(normalized.toLowerCase())) {
      return `@${normalized}`;
    }

    return `/${normalized}`;
  }

  /**
   * Execute a prompt in Copilot Chat
   */
  async executePrompt(prompt: string, options?: ExecuteOptions): Promise<void> {
    // Apply prompt commands/placeholders
    const processedPrompt = this.applyPromptCommands(prompt);
    const configuredDefaultAgent = getCompatibleConfigurationValue<string>(
      "defaultAgent",
      "agent",
    ).trim();
    const configuredDefaultModel = getCompatibleConfigurationValue<string>(
      "defaultModel",
      "",
    ).trim();
    const requestedAgent = typeof options?.agent === "string" ? options.agent.trim() : "";
    const effectiveModel = typeof options?.model === "string" && options.model.trim()
      ? options.model.trim()
      : configuredDefaultModel;

    // Build query (without agent prefix if we use mode parameter)
    let query = processedPrompt;
    let mode: string | undefined;

    // Handle agent selection
    if (requestedAgent) {
      const cleanAgent = requestedAgent.replace(/^@/, "");

      // Set mode to route chat to the correct agent
      mode = cleanAgent;
      console.log(`[CopilotExecutor] Setting mode to '${mode}'`);

      if (SLASH_COMMAND_AGENTS.has(cleanAgent)) {
        // It's a built-in mode, no query modification needed
      } else {
        // Custom agent (.agent.md) — mode handles routing, just strip agent prefix from query
        query = this.stripLeadingAgentRef(query, cleanAgent);
      }
    } else {
      // Auto-detect /agentName from prompt text and set mode accordingly
      const leadingSlash = processedPrompt.match(/^\/(\S+?)(?:\s|$)/);
      if (leadingSlash && !SLASH_COMMAND_AGENTS.has(leadingSlash[1])) {
        const detectedAgent = leadingSlash[1];
        mode = detectedAgent;
        query = this.stripLeadingAgentRef(query, detectedAgent);
        logDebug(`[CopilotScheduler] Detected custom agent from prompt, setting mode: ${detectedAgent}`);
      } else if (configuredDefaultAgent) {
        mode = configuredDefaultAgent.replace(/^@/, "");
        logDebug(`[CopilotScheduler] Using configured default agent: ${mode}`);
      }
    }

    // Get chat session behavior
    const chatSession =
      options?.chatSession ??
      getCompatibleConfigurationValue<ChatSessionBehavior>(
        "chatSession",
        "new",
      );
    let selectedModel = effectiveModel;
    const shouldForceNewChat = chatSession === "new";

    try {
      // Only force a fresh session when the task/config explicitly asks for it.
      // A recurring task configured with `continue` should stay in the current
      // chat flow even when it carries an agent or model preference.
      if (shouldForceNewChat) {
        const createdNewSession = await this.tryCreateNewChatSession();
        if (!createdNewSession && selectedModel) {
          logDebug(
            `[CopilotScheduler] Unable to create a fresh chat session for model '${selectedModel}'. Continuing without guaranteed model selection.`,
          );
          selectedModel = "";
        }
      }

      let openOptions = this.createOpenChatOptions(query, mode, selectedModel);

      if (selectedModel) {
        logDebug(`[CopilotScheduler] Setting modelSelector: ${selectedModel}`);
      }

      // "workbench.action.chat.open"
      logDebug(`[CopilotScheduler] Opening chat with options:`, JSON.stringify(openOptions));

      let openedWithQuery = await this.executeFirstAvailableCommand(
        ["workbench.action.chat.open"],
        openOptions,
      );

      if (!openedWithQuery && selectedModel) {
        logDebug(
          `[CopilotScheduler] Chat open with model '${selectedModel}' failed. Retrying without model pinning.`,
        );
        selectedModel = "";
        openOptions = this.createOpenChatOptions(query, mode);
        openedWithQuery = await this.executeFirstAvailableCommand(
          ["workbench.action.chat.open"],
          openOptions,
        );
      }

      if (!openedWithQuery) {
        // Fallback: focus chat and type prompt manually.
        // This likely means the version of VS Code is too old to support the options object fully
        // or the command failed.
        logDebug(`[CopilotScheduler] Failed to open with options, falling back to manual typing`);

        const focused = await this.executeFirstAvailableCommand([
          "workbench.panel.chat.view.copilot.focus",
          "workbench.action.chat.open",
        ]);
        if (!focused) {
          throw new Error("Unable to focus/open Copilot Chat panel");
        }
        await this.delay(DELAY_AFTER_FOCUS_MS);

        if (effectiveModel) {
          logDebug(
            `[CopilotScheduler] Falling back to manual prompt entry without guaranteed model selection for '${effectiveModel}'.`,
          );
        }

        // Type the prompt including agent if we fell back
        let fallbackPrompt = query;
        if (mode) {
          const modePrefix = this.getFallbackModePrefix(mode);
          const hasModeAlready = new RegExp(
            `^\\s*[\\/@]${mode.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`,
            "i",
          ).test(fallbackPrompt);
          if (modePrefix && !hasModeAlready) {
            fallbackPrompt = `${modePrefix} ${fallbackPrompt}`;
          }
        }

        await vscode.commands.executeCommand("type", { text: fallbackPrompt });
        await this.delay(DELAY_AFTER_TYPE_MS);

        // Submitting
        const submitted = await this.executeFirstAvailableCommand([
          "workbench.action.chat.submit",
          "chat.action.submit",
        ]);
        if (!submitted) {
          throw new Error("Unable to submit prompt: chat submit command unavailable");
        }
      } else {
        // Some VS Code/Copilot builds only prefill the query, so explicitly try
        // to submit after opening the chat.
        await this.delay(DELAY_AFTER_FOCUS_MS);
        const submitted = await this.executeFirstAvailableCommand([
          "workbench.action.chat.submit",
          "chat.action.submit",
        ]);
        if (!submitted) {
          logDebug(
            "[CopilotScheduler] Chat open succeeded, but submit command was unavailable.",
          );
        }
      }

    } catch (error) {
      // Show error and offer to copy to clipboard (this is the primary
      // user-facing notification for execution failures — callers should
      // avoid showing a second notification for the same error).
      const action = await vscode.window.showWarningMessage(
        messages.autoExecuteFailed(),
        messages.actionCopyPrompt(),
        messages.actionCancel(),
      );

      if (action === messages.actionCopyPrompt()) {
        await vscode.env.clipboard.writeText(query);
        notifyInfo(messages.promptCopied());
      }

      throw error;
    }
  }

  /**
   * Try to create a new chat session
   */
  private async tryCreateNewChatSession(): Promise<boolean> {
    try {
      await vscode.commands.executeCommand("workbench.action.chat.newChat");
      await this.delay(DELAY_NEW_SESSION_MS);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Apply prompt commands/placeholders
   */
  private applyPromptCommands(prompt: string): string {
    let result = prompt;

    // Replace {{date}} with current date
    // Use function replacers to prevent $& / $' / $` interpretation (U14)
    const now = new Date();
    // isJapanese() here is for locale-aware date/time formatting, not a UI label.
    const locale = isJapanese() ? "ja-JP" : "en-US";
    result = result.replace(/\{\{date\}\}/gi, () =>
      now.toLocaleDateString(locale),
    );

    // Replace {{time}} with current time
    result = result.replace(/\{\{time\}\}/gi, () =>
      now.toLocaleTimeString(locale),
    );

    // Replace {{datetime}} with current date and time
    result = result.replace(/\{\{datetime\}\}/gi, () =>
      now.toLocaleString(locale),
    );

    // Replace {{workspace}} with workspace name
    // Use function replacers to prevent $& / $' / $` interpretation in values
    const workspaceName = vscode.workspace.workspaceFolders?.[0]?.name || "";
    result = result.replace(/\{\{workspace\}\}/gi, () => workspaceName);

    // Replace {{file}} with current file name
    const currentFile = vscode.window.activeTextEditor?.document.fileName || "";
    const currentFileName = path.basename(currentFile);
    result = result.replace(/\{\{file\}\}/gi, () => currentFileName);

    // Replace {{filepath}} with current file path
    result = result.replace(/\{\{filepath\}\}/gi, () => currentFile);

    return result;
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get built-in agents
   */
  static getBuiltInAgents(): AgentInfo[] {
    const agents: AgentInfo[] = [
      {
        id: "",
        name: messages.agentNoneName(),
        description: messages.agentNoneDesc(),
        isCustom: false,
      },
      {
        id: "agent",
        name: messages.agentAgentName(),
        description: messages.agentModeDesc(),
        isCustom: false,
      },
      {
        id: "ask",
        name: messages.agentAskName(),
        description: messages.agentAskDesc(),
        isCustom: false,
      },
      {
        id: "edit",
        name: messages.agentEditName(),
        description: messages.agentEditDesc(),
        isCustom: false,
      },
      {
        id: "@workspace",
        name: "@workspace",
        description: messages.agentWorkspaceDesc(),
        isCustom: false,
      },
      {
        id: "@terminal",
        name: "@terminal",
        description: messages.agentTerminalDesc(),
        isCustom: false,
      },
      {
        id: "@vscode",
        name: "@vscode",
        description: messages.agentVscodeDesc(),
        isCustom: false,
      },
    ];

    return agents;
  }

  /**
   * Get custom agents from workspace
   */
  static async getCustomAgents(): Promise<AgentInfo[]> {
    const agents: AgentInfo[] = [];

    // Search for *.agent.md files
    const agentFiles = await vscode.workspace.findFiles(
      "**/*.agent.md",
      "**/node_modules/**",
      100,
    );

    for (const file of agentFiles) {
      const fileName = path.basename(file.fsPath).replace(/\.agent\.md$/i, "");
      agents.push({
        id: `@${fileName}`,
        name: `@${fileName}`,
        description: messages.agentCustomDesc(),
        isCustom: true,
        filePath: file.fsPath,
      });
    }

    // Parse AGENTS.md if exists
    const agentsMdFiles = await vscode.workspace.findFiles(
      "**/AGENTS.md",
      "**/node_modules/**",
    );

    for (const file of agentsMdFiles) {
      try {
        const bytes = await vscode.workspace.fs.readFile(file);
        const content = Buffer.from(bytes).toString("utf8");
        const agentMatches = content.matchAll(
          /<agent>\s*<name>([^<]+)<\/name>/g,
        );

        for (const match of agentMatches) {
          const agentName = match[1].trim();
          if (!agentName) continue;
          // Normalise to @-prefixed ID consistent with .agent.md agents (U32)
          const normalizedId = agentName.startsWith("@")
            ? agentName
            : `@${agentName}`;
          if (!agents.some((a) => a.id === normalizedId)) {
            agents.push({
              id: normalizedId,
              name: normalizedId,
              description: messages.agentAgentsMdDesc(),
              isCustom: true,
              filePath: file.fsPath,
            });
          }
        }
      } catch (error) {
        logDebug(
          "[CopilotScheduler] Failed to parse AGENTS.md:",
          toSafeErrorDetails(error),
        );
      }
    }

    return agents;
  }

  /**
   * Get global agents from VS Code User prompts folder
   */
  static async getGlobalAgents(): Promise<AgentInfo[]> {
    const agents: AgentInfo[] = [];

    // Reuse resolveGlobalPromptsRoot with the agents-specific setting
    const globalPath = resolveGlobalPromptsRoot(
      getCompatibleConfigurationValue<string>("globalAgentsPath", ""),
    );
    try {
      if (!globalPath) {
        return agents;
      }

      const entries = await vscode.workspace.fs.readDirectory(
        vscode.Uri.file(globalPath),
      );
      for (const [fileName, fileType] of entries) {
        if (fileType !== vscode.FileType.File) continue;
        if (fileName.toLowerCase().endsWith(".agent.md")) {
          const agentName = fileName.replace(/\.agent\.md$/i, "");
          agents.push({
            id: `@${agentName}`,
            name: `@${agentName}`,
            description: messages.agentGlobalDesc(),
            isCustom: true,
            filePath: path.join(globalPath, fileName),
          });
        }
      }
    } catch (error) {
      logDebug(
        "[CopilotScheduler] Failed to read global agents:",
        toSafeErrorDetails(error),
      );
    }

    return agents;
  }

  /**
   * Get all agents (built-in + custom + global), deduplicated by id
   */
  static async getAllAgents(): Promise<AgentInfo[]> {
    const builtIn = CopilotExecutor.getBuiltInAgents();
    const custom = await CopilotExecutor.getCustomAgents();
    const global = await CopilotExecutor.getGlobalAgents();

    const seen = new Set<string>();
    const result: AgentInfo[] = [];
    for (const agent of [...builtIn, ...custom, ...global]) {
      const key = agent.id || agent.name;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(agent);
    }
    return result;
  }

  /**
   * Get available models using VS Code API
   */
  static async getAvailableModels(): Promise<ModelInfo[]> {
    try {
      // Try to get models from VS Code Language Model API
      const models = await vscode.lm.selectChatModels({});

      if (models && models.length > 0) {
        const modelInfos: ModelInfo[] = [
          {
            id: "",
            name: messages.modelDefaultName(),
            description: messages.modelDefaultDesc(),
            vendor: "",
          },
        ];

        for (const model of models) {
          modelInfos.push({
            id: model.id,
            name: model.name || model.id,
            description: model.family || "",
            vendor: model.vendor || "",
          });
        }

        return modelInfos;
      }
    } catch (error) {
      // Language Model API may not be available
      logDebug(
        "[CopilotScheduler] Language Model API unavailable:",
        toSafeErrorDetails(error),
      );
    }

    // Fallback to static list
    return CopilotExecutor.getFallbackModels();
  }

  /**
   * Get fallback model list
   */
  static getFallbackModels(): ModelInfo[] {
    return [
      {
        id: "",
        name: messages.modelDefaultName(),
        description: messages.modelDefaultDesc(),
        vendor: "",
      },
      {
        id: "gpt-4o",
        name: "GPT-4o",
        description: "OpenAI GPT-4o",
        vendor: "OpenAI",
      },
      {
        id: "gpt-4o-mini",
        name: "GPT-4o Mini",
        description: "OpenAI GPT-4o Mini",
        vendor: "OpenAI",
      },
      {
        id: "o3-mini",
        name: "o3-mini",
        description: "OpenAI o3-mini",
        vendor: "OpenAI",
      },
      {
        id: "claude-sonnet-4",
        name: "Claude Sonnet 4",
        description: "Anthropic Claude Sonnet 4",
        vendor: "Anthropic",
      },
      {
        id: "claude-3.5-sonnet",
        name: "Claude 3.5 Sonnet",
        description: "Anthropic Claude 3.5 Sonnet",
        vendor: "Anthropic",
      },
      {
        id: "gemini-2.0-flash",
        name: "Gemini 2.0 Flash",
        description: "Google Gemini 2.0 Flash",
        vendor: "Google",
      },
      {
        id: "GPT-5.3-Codex",
        name: "GPT-5.3-Codex",
        description: "Codex 5.3 (Copilot)",
        vendor: "Microsoft",
      },
    ];
  }
}
