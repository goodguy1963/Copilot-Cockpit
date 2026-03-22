/**
 * Copilot Scheduler - Internationalization (i18n)
 */

import * as vscode from "vscode";
import type { CronPreset } from "./types";

/**
 * Check if the current language is Japanese
 */
export function isJapanese(): boolean {
  const config = vscode.workspace.getConfiguration("copilotScheduler");
  const lang = config.get<string>("language", "auto");

  if (lang === "ja") {
    return true;
  }
  if (lang === "en") {
    return false;
  }

  // Auto-detect from VS Code language
  return vscode.env.language.startsWith("ja");
}

/**
 * Get localized string helper
 */
function t(en: string, ja: string): string {
  return isJapanese() ? ja : en;
}

/**
 * All localized messages
 */
export const messages = {
  // ==================== General ====================
  webviewTitle: () => t("Copilot Scheduler", "Copilot Scheduler"),
  extensionActive: () =>
    t(
      "Copilot Scheduler is now active",
      "Copilot Scheduler が有効になりました",
    ),
  extensionDeactivated: () =>
    t(
      "Copilot Scheduler has been deactivated",
      "Copilot Scheduler が無効になりました",
    ),
  schedulerStarted: () =>
    t("Scheduler started", "スケジューラーが開始されました"),
  schedulerStopped: () =>
    t("Scheduler stopped", "スケジューラーが停止されました"),

  // ==================== Task Operations ====================
  taskCreated: (name: string) =>
    t(`Task "${name}" created successfully`, `タスク「${name}」を作成しました`),
  taskUpdated: (name: string) =>
    t(`Task "${name}" updated successfully`, `タスク「${name}」を更新しました`),
  taskDeleted: (name: string) =>
    t(`Task "${name}" deleted`, `タスク「${name}」を削除しました`),
  taskDuplicated: (name: string) =>
    t(`Task duplicated as "${name}"`, `タスクを「${name}」として複製しました`),
  taskCopySuffix: () => t("(Copy)", "(コピー)"),
  taskMovedToCurrentWorkspace: (name: string) =>
    t(
      `Task "${name}" moved to the current workspace`,
      `タスク「${name}」を現在のワークスペースへ移動しました`,
    ),
  taskEnabled: (name: string) =>
    t(`Task "${name}" enabled`, `タスク「${name}」を有効にしました`),
  taskDisabled: (name: string) =>
    t(`Task "${name}" disabled`, `タスク「${name}」を無効にしました`),
  taskExecuting: (name: string) =>
    t(`Executing task "${name}"...`, `タスク「${name}」を実行中...`),
  taskExecuted: (name: string) =>
    t(
      `Task "${name}" executed successfully`,
      `タスク「${name}」を実行しました`,
    ),
  taskExecutionFailed: (name: string, error: string) =>
    t(
      `Task "${name}" execution failed: ${error}`,
      `タスク「${name}」の実行に失敗しました: ${error}`,
    ),
  taskNotFound: () => t("Task not found", "タスクが見つかりません"),
  noTasksFound: () =>
    t("No scheduled tasks found", "スケジュールされたタスクがありません"),

  // ==================== Validation ====================
  invalidCronExpression: () => t("Invalid cron expression", "無効なcron式です"),
  taskNameRequired: () =>
    t("Task name is required", "タスク名を入力してください"),
  promptRequired: () => t("Prompt is required", "プロンプトを入力してください"),
  templateRequired: () =>
    t(
      "Prompt template is required",
      "プロンプトテンプレートを選択してください",
    ),
  cronExpressionRequired: () =>
    t("Cron expression is required", "cron式を入力してください"),

  // ==================== Prompts ====================
  enterTaskName: () => t("Enter task name", "タスク名を入力"),
  enterPrompt: () =>
    t("Enter prompt to send to Copilot", "Copilotに送信するプロンプトを入力"),
  enterCronExpression: () =>
    t(
      "Enter cron expression (e.g., '0 9 * * 1-5' for weekdays at 9am)",
      "cron式を入力（例: '0 9 * * 1-5' で平日9時）",
    ),
  selectAgent: () => t("Select agent", "エージェントを選択"),
  selectModel: () => t("Select model", "モデルを選択"),
  selectScope: () => t("Select scope", "スコープを選択"),
  selectTask: () => t("Select a task", "タスクを選択"),
  selectPromptTemplate: () =>
    t("Select prompt template", "プロンプトテンプレートを選択"),

  // ==================== Actions ====================
  actionRun: () => t("Run", "実行"),
  actionEdit: () => t("Edit", "編集"),
  actionDelete: () => t("Delete", "削除"),
  actionDuplicate: () => t("Duplicate", "複製"),
  actionMoveToCurrentWorkspace: () =>
    t("Move to Current Workspace", "現在のワークスペースへ移動"),
  actionEnable: () => t("Enable", "有効化"),
  actionDisable: () => t("Disable", "無効化"),
  actionCancel: () => t("Cancel", "キャンセル"),
  actionCopyPrompt: () => t("Copy Prompt", "プロンプトをコピー"),
  actionTestRun: () => t("Test Run", "テスト実行"),
  actionSave: () => t("Update", "更新"),
  actionCreate: () => t("Create", "作成"),
  actionNewTask: () => t("New Task", "新規タスク"),
  actionRefresh: () => t("Refresh", "再読込"),

  // Webview-only runtime strings (used in media/schedulerWebview.js)
  webviewScriptErrorPrefix: () => t("Script error: ", "スクリプトエラー: "),
  webviewUnhandledErrorPrefix: () => t("Unhandled error: ", "未処理のエラー: "),
  webviewLinePrefix: () => t(" (line ", "（行 "),
  webviewLineSuffix: () => t(")", "）"),
  webviewUnknown: () => t("unknown", "不明"),
  webviewApiUnavailable: () =>
    t(
      "VS Code Webview API (acquireVsCodeApi) is unavailable. Check CSP/initialization.",
      "VS Code Webview API (acquireVsCodeApi) が利用できません。CSP/初期化を確認してください。",
    ),
  webviewClientErrorPrefix: () =>
    t("Webview error: ", "画面処理でエラーが発生しました: "),

  webviewSuccessPrefix: () => t("✔ ", "✔ "),

  // ==================== Webview Placeholders ====================
  webviewSelectAgentPlaceholder: () => t("Select agent", "エージェントを選択"),
  webviewNoAgentsAvailable: () =>
    t("No agents available", "利用可能なエージェントがありません"),
  webviewSelectModelPlaceholder: () => t("Select model", "モデルを選択"),
  webviewNoModelsAvailable: () =>
    t("No models available", "利用可能なモデルがありません"),
  webviewSelectTemplatePlaceholder: () =>
    t("Select template", "テンプレートを選択"),

  // ==================== Confirmations ====================
  confirmDelete: (name: string) =>
    t(
      `Are you sure you want to delete task "${name}"?`,
      `タスク「${name}」を削除しますか？`,
    ),
  confirmDeleteYes: () => t("Yes, delete", "はい、削除します"),
  confirmDeleteNo: () => t("No, keep", "いいえ、残します"),

  confirmMoveToCurrentWorkspace: (name: string) =>
    t(
      `Move task "${name}" to the current workspace?`,
      `タスク「${name}」を現在のワークスペースへ移動しますか？`,
    ),
  confirmMoveYes: () => t("Move", "移動する"),

  confirmRunOutsideWorkspace: (name: string) =>
    t(
      `Task "${name}" is scoped to a different workspace. Run it here anyway?`,
      `タスク「${name}」は別のワークスペース用です。このワークスペースで実行しますか？`,
    ),
  confirmRunAnyway: () => t("Run anyway", "実行する"),

  labelThisWorkspaceShort: () => t("This workspace", "このWS"),
  labelOtherWorkspaceShort: () => t("Other workspace", "他のWS"),

  cannotDeleteOtherWorkspaceTask: (name: string) =>
    t(
      `Task "${name}" belongs to a different workspace. Please delete it from that workspace.`,
      `タスク「${name}」は別のワークスペース用です。元のワークスペースで削除してください。`,
    ),

  // ==================== Clipboard ====================
  promptCopied: () =>
    t(
      "Prompt copied to clipboard",
      "プロンプトをクリップボードにコピーしました",
    ),

  // ==================== Agent / Model Descriptions ====================
  agentNoneName: () => t("None", "なし"),
  agentNoneDesc: () => t("Default behavior", "デフォルトの動作"),
  agentAgentName: () => t("Agent", "エージェント"),
  agentAskName: () => t("Ask", "質問"),
  agentEditName: () => t("Edit", "編集"),
  agentModeDesc: () =>
    t("Agent mode with tool use", "ツール利用のエージェントモード"),
  agentAskDesc: () => t("Questions about code", "コードに関する質問"),
  agentEditDesc: () => t("AI code editing", "AIでコード編集"),
  agentWorkspaceDesc: () => t("Codebase search", "コードベース検索"),
  agentTerminalDesc: () => t("Terminal operations", "ターミナル操作"),
  agentVscodeDesc: () =>
    t("VS Code settings and commands", "VS Code設定とコマンド"),
  agentCustomDesc: () => t("Custom agent", "カスタムエージェント"),
  agentAgentsMdDesc: () => t("Defined in AGENTS.md", "AGENTS.mdで定義"),
  agentGlobalDesc: () => t("Global agent", "グローバルエージェント"),
  modelDefaultName: () => t("Default", "デフォルト"),
  modelDefaultDesc: () => t("Use default model", "デフォルトモデルを使用"),

  // ==================== Execution Errors ====================
  autoExecuteFailed: () =>
    t(
      "Failed to automatically execute prompt. Would you like to copy it to clipboard?",
      "プロンプトの自動実行に失敗しました。クリップボードにコピーしますか？",
    ),
  copilotNotAvailable: () =>
    t(
      "GitHub Copilot Chat is not available",
      "GitHub Copilot Chat が利用できません",
    ),

  // ==================== Webview UI ====================
  tabCreate: () => t("Create Task", "タスク作成"),
  tabEdit: () => t("Edit Task", "タスク編集"),
  tabList: () => t("Task List", "タスク一覧"),

  webviewMessageHandlingFailed: (error: string) =>
    t(
      `Failed to handle the requested action: ${error}`,
      `操作の処理に失敗しました: ${error}`,
    ),

  labelTaskName: () => t("Task Name", "タスク名"),
  labelPromptType: () => t("Prompt Type", "プロンプト種別"),
  labelPromptInline: () => t("Free Input", "自由入力"),
  labelPromptLocal: () => t("Local Template", "ローカルテンプレート"),
  labelPromptGlobal: () => t("Global Template", "グローバルテンプレート"),
  labelPrompt: () => t("Prompt", "プロンプト"),
  labelSchedule: () => t("Schedule", "スケジュール"),
  labelCronExpression: () => t("Cron Expression", "Cron式"),
  labelPreset: () => t("Preset", "プリセット"),
  labelCustom: () => t("Custom", "カスタム"),
  labelAdvanced: () => t("Advanced", "詳細設定"),
  labelFrequency: () => t("Frequency", "頻度"),
  labelFrequencyMinute: () => t("Every X minutes", "X分ごと"),
  labelFrequencyHourly: () => t("Hourly", "毎時"),
  labelFrequencyDaily: () => t("Daily", "毎日"),
  labelFrequencyWeekly: () => t("Weekly", "毎週"),
  labelFrequencyMonthly: () => t("Monthly", "毎月"),
  labelSelectDays: () => t("Select days", "曜日を選択"),
  labelSelectTime: () => t("Time", "時刻"),
  labelSelectHour: () => t("Hour", "時"),
  labelSelectMinute: () => t("Minute", "分"),
  labelSelectDay: () => t("Day of month", "日"),
  labelInterval: () => t("Interval", "間隔"),
  labelAgent: () => t("Agent", "エージェント"),
  labelModel: () => t("Model", "モデル"),
  labelModelNote: () =>
    t(
      "Model selection is a preview feature and may not apply in all environments. If needed, pick the model directly in the Copilot Chat panel.",
      "モデルの選択はプレビュー機能で、環境によって反映されない場合があります。Copilot Chat パネルのモデルも確認してください。",
    ),
  labelScope: () => t("Scope", "スコープ"),
  labelScopeGlobal: () =>
    t("Global (All Workspaces)", "グローバル（全ワークスペース）"),
  labelScopeWorkspace: () => t("Workspace Only", "ワークスペースのみ"),
  labelEnabled: () => t("Enabled", "有効"),
  labelDisabled: () => t("Disabled", "無効"),
  labelStatus: () => t("Status", "ステータス"),
  labelNextRun: () => t("Next Run", "次回実行"),
  labelLastRun: () => t("Last Run", "前回実行"),
  labelNever: () => t("Never", "なし"),
  labelRunFirstInOneMinute: () =>
    t("Run first execution in 3 minutes", "3分後に初回実行する"),
  labelOneTime: () => t("Run once and delete", "一度だけ実行して削除"),
  labelAllTasks: () => t("All", "すべて"),
  labelRecurringTasks: () => t("Recurring Tasks", "繰り返しタスク"),
  labelOneTimeTasks: () => t("One-time Tasks", "一度きりタスク"),
  labelJitterSeconds: () =>
    t("Jitter (max seconds, 0=off)", "ジッター(最大秒数, 0=無効)"),
  webviewJitterNote: () =>
    t(
      "0 disables jitter. Adds a random delay between 0 and the specified seconds before execution.",
      "0で無効。値を入れると0〜その秒数でランダム遅延します。",
    ),

  // Friendly cron builder / day labels
  daySun: () => t("Sun", "日"),
  dayMon: () => t("Mon", "月"),
  dayTue: () => t("Tue", "火"),
  dayWed: () => t("Wed", "水"),
  dayThu: () => t("Thu", "木"),
  dayFri: () => t("Fri", "金"),
  daySat: () => t("Sat", "土"),
  labelFriendlyBuilder: () => t("Friendly cron builder", "かんたんCron"),
  labelFriendlyGenerate: () => t("Generate", "生成する"),
  labelFriendlyPreview: () => t("Preview", "プレビュー"),
  labelFriendlyFallback: () =>
    t("Preview unavailable for this expression", "このCronの説明はありません"),
  labelFriendlySelect: () => t("Select frequency", "頻度を選択"),
  labelEveryNMinutes: () => t("Every N minutes", "N分ごと"),
  labelHourlyAtMinute: () => t("Hourly at minute", "毎時 指定分"),
  labelDailyAtTime: () => t("Daily at time", "毎日 時刻"),
  labelWeeklyAtTime: () => t("Weekly at day/time", "毎週 曜日+時刻"),
  labelMonthlyAtTime: () => t("Monthly on day/time", "毎月 日付+時刻"),
  labelMinute: () => t("Minute", "分"),
  labelHour: () => t("Hour", "時"),
  labelDayOfMonth: () => t("Day of month", "実行日"),
  labelDayOfWeek: () => t("Day of week", "曜日"),
  labelOpenInGuru: () => t("Open in crontab.guru", "crontab.guruを開く"),

  // Cron preview templates (used in media/schedulerWebview.js)
  cronPreviewEveryNMinutes: () => t("Every {n} minutes", "{n}分ごと"),
  cronPreviewHourlyAtMinute: () => t("Hourly at minute {m}", "毎時 {m}分"),
  cronPreviewDailyAt: () => t("Daily at {t}", "毎日 {t}"),
  cronPreviewWeekdaysAt: () => t("Weekdays at {t}", "平日 {t}"),
  cronPreviewWeeklyOnAt: () => t("Weekly on {d} at {t}", "毎週 {d} {t}"),
  cronPreviewMonthlyOnAt: () =>
    t("Monthly on day {dom} at {t}", "毎月{dom}日 {t}"),

  placeholderTaskName: () => t("Enter task name...", "タスク名を入力..."),
  placeholderPrompt: () =>
    t(
      "Enter prompt to send to Copilot...",
      "Copilotに送信するプロンプトを入力...",
    ),
  placeholderCron: () => t("e.g., 0 9 * * 1-5", "例: 0 9 * * 1-5"),

  // ==================== TreeView ====================
  treeGroupGlobal: () => t("🌐 Global", "🌐 グローバル"),
  treeGroupWorkspace: () => t("📁 Workspace", "📁 ワークスペース"),
  treeGroupThisWorkspace: () => t("🏠 This workspace", "🏠 このワークスペース"),
  treeGroupOtherWorkspace: () =>
    t("📎 Other workspaces", "📎 他のワークスペース"),
  treeNoTasks: () => t("No tasks", "タスクなし"),

  // ==================== Version Info ====================
  versionInfo: (version: string) =>
    t(`Copilot Scheduler v${version}`, `Copilot Scheduler v${version}`),
  reloadAfterUpdate: (version: string) =>
    t(
      `Copilot Scheduler has been updated to v${version}. Reload to activate the new version.`,
      `Copilot Scheduler が v${version} に更新されました。新しいバージョンを有効にするにはリロードしてください。`,
    ),
  reloadNow: () => t("Reload Now", "今すぐリロード"),

  // ==================== Date/Time ====================
  formatDateTime: (date: Date) => {
    const options: Intl.DateTimeFormatOptions = {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    };
    return date.toLocaleString(isJapanese() ? "ja-JP" : "en-US", options);
  },

  // ==================== Cron Descriptions ====================
  cronNextRun: (date: Date) =>
    t(
      `Next run: ${messages.formatDateTime(date)}`,
      `次回実行: ${messages.formatDateTime(date)}`,
    ),
  cronInvalid: () => t("Invalid cron expression", "無効なcron式"),

  // ==================== Prompt Templates ====================
  noTemplatesFound: () =>
    t("No prompt templates found", "プロンプトテンプレートが見つかりません"),
  templateLoadError: () =>
    t("Failed to load template", "テンプレートの読み込みに失敗しました"),

  // ==================== Workspace ====================
  noWorkspaceOpen: () =>
    t("No workspace is open", "ワークスペースが開かれていません"),
  moveOnlyWorkspaceTasks: () =>
    t(
      "Only workspace-scoped tasks can be moved",
      "移動できるのはワークスペーススコープのタスクのみです",
    ),
  // ==================== Tooltip ====================
  tooltipWorkspaceTarget: () => t("Target Workspace", "対象ワークスペース"),
  tooltipNotSet: () => t("(not set)", "(未設定)"),
  tooltipAppliesHere: () => t("Applies here", "このワークスペース"),

  // ==================== Safety / Rate Limiting ====================
  dailyLimitReached: (limit: number) =>
    t(
      `Daily execution limit (${limit}) reached. No more automatic executions today. You can increase this limit in settings.`,
      `1日の実行回数上限（${limit}回）に達しました。本日はこれ以上の自動実行は行われません。設定で上限を変更できます。`,
    ),
  storageWriteTimeout: () =>
    t(
      "Timed out while saving tasks. Your environment may be blocking VS Code extension storage.",
      "タスクの保存がタイムアウトしました。環境により VS Code の拡張ストレージがブロックされている可能性があります。",
    ),
  jitterApplied: (seconds: number) =>
    t(
      `Applying ${seconds}s random delay to reduce detection risk...`,
      `検出リスク軽減のため ${seconds}秒のランダム遅延を適用中...`,
    ),
  minimumIntervalWarning: () =>
    t(
      "Cron intervals shorter than 30 minutes may increase the risk of being flagged by GitHub's abuse-detection system.",
      "30分未満のcron間隔は、GitHubの不正検出システムに検出されるリスクが高まる可能性があります。",
    ),
  disclaimerTitle: () => t("⚠️ Important Notice", "⚠️ 重要なお知らせ"),
  disclaimerMessage: () =>
    t(
      "This extension automates Copilot Chat interactions via scheduled prompts. GitHub's Acceptable Use Policies prohibit 'excessive automated bulk activity' and 'scripted interactions' with Copilot. Using this extension may violate GitHub's Terms of Service and could result in your Copilot access being restricted or your account being suspended. Use at your own risk.",
      "この拡張機能は、スケジュールされたプロンプトによりCopilot Chatの操作を自動化します。GitHubの利用規約（Acceptable Use Policies）は「過度な自動化された一括活動」および「スクリプトによるCopilotとのやり取り」を禁止しています。この拡張機能の使用はGitHubの利用規約に違反する可能性があり、Copilotへのアクセス制限やアカウント停止につながる恐れがあります。ご利用は自己責任でお願いします。",
    ),
  disclaimerAccept: () => t("I understand the risks", "リスクを理解しました"),
  disclaimerDecline: () => t("Cancel", "キャンセル"),
  unlimitedDailyWarning: () =>
    t(
      "⚠️ Daily execution limit is set to unlimited (0). Excessive automated usage may result in API rate-limiting or account restrictions by the provider. Use at your own risk.",
      "⚠️ 1日の実行回数上限が無制限（0）に設定されています。過度な自動利用はAPIプロバイダーによるレート制限やアカウント制限の原因となる可能性があります。自己責任でご利用ください。",
    ),
};

/**
 * Cron presets with localized names
 */
export function getCronPresets(): CronPreset[] {
  return [
    {
      id: "every-3min",
      name: t("Every 3 Minutes", "3分ごと"),
      expression: "*/3 * * * *",
      description: t("Every 3 minutes", "3分ごと"),
    },
    {
      id: "every-5min",
      name: t("Every 5 Minutes", "5分ごと"),
      expression: "*/5 * * * *",
      description: t("Every 5 minutes", "5分ごと"),
    },
    {
      id: "every-10min",
      name: t("Every 10 Minutes", "10分ごと"),
      expression: "*/10 * * * *",
      description: t("Every 10 minutes", "10分ごと"),
    },
    {
      id: "every-15min",
      name: t("Every 15 Minutes", "15分ごと"),
      expression: "*/15 * * * *",
      description: t("Every 15 minutes", "15分ごと"),
    },
    {
      id: "every-30min",
      name: t("Every 30 Minutes", "30分ごと"),
      expression: "*/30 * * * *",
      description: t("Every 30 minutes", "30分ごと"),
    },
    {
      id: "hourly",
      name: t("Hourly", "毎時"),
      expression: "0 * * * *",
      description: t("Every hour at minute 0", "毎時0分"),
    },
    {
      id: "daily-9am",
      name: t("Daily 9:00 AM", "毎日 9:00"),
      expression: "0 9 * * *",
      description: t("Every day at 9:00 AM", "毎日9時"),
    },
    {
      id: "daily-12pm",
      name: t("Daily 12:00 PM", "毎日 12:00"),
      expression: "0 12 * * *",
      description: t("Every day at 12:00 PM", "毎日12時"),
    },
    {
      id: "daily-6pm",
      name: t("Daily 6:00 PM", "毎日 18:00"),
      expression: "0 18 * * *",
      description: t("Every day at 6:00 PM", "毎日18時"),
    },
    {
      id: "weekday-9am",
      name: t("Weekdays 9:00 AM", "平日 9:00"),
      expression: "0 9 * * 1-5",
      description: t("Monday to Friday at 9:00 AM", "月曜〜金曜の9時"),
    },
    {
      id: "weekday-6pm",
      name: t("Weekdays 6:00 PM", "平日 18:00"),
      expression: "0 18 * * 1-5",
      description: t("Monday to Friday at 6:00 PM", "月曜〜金曜の18時"),
    },
    {
      id: "weekly-monday",
      name: t("Every Monday 9:00 AM", "毎週月曜 9:00"),
      expression: "0 9 * * 1",
      description: t("Every Monday at 9:00 AM", "毎週月曜日の9時"),
    },
    {
      id: "weekly-friday",
      name: t("Every Friday 6:00 PM", "毎週金曜 18:00"),
      expression: "0 18 * * 5",
      description: t("Every Friday at 6:00 PM", "毎週金曜日の18時"),
    },
    {
      id: "monthly-1st",
      name: t("1st of Month 9:00 AM", "毎月1日 9:00"),
      expression: "0 9 1 * *",
      description: t("1st day of every month at 9:00 AM", "毎月1日の9時"),
    },
  ];
}

/**
 * Format cron expression for display
 */
export function formatCronForDisplay(expression: string): string {
  const presets = getCronPresets();
  const preset = presets.find((p) => p.expression === expression);
  if (preset) {
    return preset.name;
  }
  return expression;
}
