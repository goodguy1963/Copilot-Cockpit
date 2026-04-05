/**
 * Copilot Cockpit - Internationalization (i18n)
 */

import * as vscode from "vscode";
import type { CronPreset } from "./types";
import { getCompatibleConfigurationValue } from "./extensionCompat";

export type ConfiguredUiLanguage = "auto" | "en" | "ja" | "de";
export type UiLanguage = Exclude<ConfiguredUiLanguage, "auto">;

export function getConfiguredLanguage(): ConfiguredUiLanguage {
  const lang = getCompatibleConfigurationValue<string>("language", "auto");
  return lang === "auto" || lang === "en" || lang === "ja" || lang === "de"
    ? lang
    : "auto";
}

export function getCurrentLanguage(): UiLanguage {
  const configured = getConfiguredLanguage();
  if (configured !== "auto") {
    return configured;
  }

  const detected = vscode.env.language.toLowerCase();
  if (detected.startsWith("ja")) {
    return "ja";
  }
  if (detected.startsWith("de")) {
    return "de";
  }
  return "en";
}

export function getCurrentLocaleTag(): string {
  switch (getCurrentLanguage()) {
    case "ja":
      return "ja-JP";
    case "de":
      return "de-DE";
    default:
      return "en-US";
  }
}

/**
 * Check if the current language is Japanese
 */
export function isJapanese(): boolean {
  return getCurrentLanguage() === "ja";
}

function t(en: string, ja: string, de = en): string {
  switch (getCurrentLanguage()) {
    case "ja":
      return ja;
    case "de":
      return de;
    default:
      return en;
  }
}

type LocalizedText = readonly [english: string, japanese: string, german?: string];

function localize(entry: LocalizedText): string {
  return t(entry[0], entry[1], entry[2] ?? entry[0]);
}

function buildStaticMessageMap<T extends Record<string, LocalizedText>>(
  entries: T,
): { [K in keyof T]: () => string } {
  const built = {} as { [K in keyof T]: () => string };

  for (const key of Object.keys(entries) as Array<keyof T>) {
    const localized = entries[key];
    built[key] = () => localize(localized);
  }

  return built;
}

const agentAndModelMessageEntries = {
  agentNoneName: ["None", "なし"],
  agentNoneDesc: ["Default behavior", "デフォルトの動作"],
  agentAgentName: ["Agent", "エージェント"],
  agentAskName: ["Ask", "質問"],
  agentEditName: ["Edit", "編集"],
  agentModeDesc: ["Agent mode with tool use", "ツール利用のエージェントモード"],
  agentAskDesc: ["Questions about code", "コードに関する質問"],
  agentEditDesc: ["AI code editing", "AIでコード編集"],
  agentWorkspaceDesc: ["Codebase search", "コードベース検索"],
  agentTerminalDesc: ["Terminal operations", "ターミナル操作"],
  agentVscodeDesc: ["VS Code settings and commands", "VS Code設定とコマンド"],
  agentCustomDesc: ["Custom agent", "カスタムエージェント"],
  agentAgentsMdDesc: ["Defined in AGENTS.md", "AGENTS.mdで定義"],
  agentGlobalDesc: ["Global agent", "グローバルエージェント"],
  modelDefaultName: ["Default", "デフォルト"],
  modelDefaultDesc: ["Use default model", "デフォルトモデルを使用"],
} as const satisfies Record<string, LocalizedText>;

const tabMessageEntries = {
  tabCreate: ["Create Task", "タスク作成"],
  tabEdit: ["Edit Task", "タスク編集"],
  tabList: ["Task List", "タスク一覧"],
  tabHowTo: ["How To Use", "使い方"],
} as const satisfies Record<string, LocalizedText>;

const schedulerUiMessageEntries = {
  promptCopied: ["Prompt copied to clipboard", "プロンプトをクリップボードにコピーしました"],
  labelTaskName: ["Task Name", "タスク名", "Task-Name"],
  labelPromptType: ["Prompt Type", "プロンプト種別", "Prompt-Typ"],
  labelPromptInline: ["Free Input", "自由入力", "Freie Eingabe"],
  labelPromptLocal: ["Local Template", "ローカルテンプレート", "Lokales Template"],
  labelPromptGlobal: ["Global Template", "グローバルテンプレート", "Globales Template"],
  labelPrompt: ["Prompt", "プロンプト", "Prompt"],
  labelSchedule: ["Schedule", "スケジュール", "Zeitplan"],
  labelCronExpression: ["Cron Expression", "Cron式", "Cron-Ausdruck"],
  labelPreset: ["Preset", "プリセット", "Preset"],
  labelCustom: ["Custom", "カスタム", "Benutzerdefiniert"],
  labelAdvanced: ["Advanced", "詳細設定", "Erweitert"],
  labelFrequency: ["Frequency", "頻度", "Häufigkeit"],
  labelFrequencyMinute: ["Every X minutes", "X分ごと", "Alle X Minuten"],
  labelFrequencyHourly: ["Hourly", "毎時", "Stündlich"],
  labelFrequencyDaily: ["Daily", "毎日", "Täglich"],
  labelFrequencyWeekly: ["Weekly", "毎週", "Wöchentlich"],
  labelFrequencyMonthly: ["Monthly", "毎月", "Monatlich"],
  labelSelectDays: ["Select days", "曜日を選択", "Tage auswählen"],
  labelSelectTime: ["Time", "時刻", "Uhrzeit"],
  labelSelectHour: ["Hour", "時", "Stunde"],
  labelSelectMinute: ["Minute", "分", "Minute"],
  labelSelectDay: ["Day of month", "日", "Tag des Monats"],
  labelInterval: ["Interval", "間隔", "Intervall"],
  labelAgent: ["Agent", "エージェント", "agent"],
  labelModel: ["Model", "モデル", "model"],
  labelScope: ["Scope", "スコープ", "Scope"],
  labelScopeGlobal: ["Global (All Workspaces)", "グローバル（全ワークスペース）", "Global (alle Workspaces)"],
  labelScopeWorkspace: ["Workspace Only", "ワークスペースのみ", "Nur Workspace"],
  labelEnabled: ["Enabled", "有効", "Aktiv"],
  labelDisabled: ["Disabled", "無効", "Inaktiv"],
  labelStatus: ["Status", "ステータス", "Status"],
  labelNextRun: ["Next Run", "次回実行", "Nächster Lauf"],
  labelLastRun: ["Last Run", "前回実行", "Letzter Lauf"],
  labelNever: ["Never", "なし", "Nie"],
  labelRunFirstInOneMinute: ["Run first execution in 3 minutes", "3分後に初回実行する", "Erste Ausführung in 3 Minuten starten"],
  labelOneTime: ["Run once and delete", "一度だけ実行して削除", "Einmal ausführen und löschen"],
  labelChatSession: ["Recurring chat session", "繰り返しタスクのチャットセッション", "Wiederkehrende Chat-Session"],
  labelChatSessionNew: ["Start a new chat every run", "毎回新しいチャットを開始", "Bei jedem Lauf einen neuen Chat starten"],
  labelChatSessionContinue: ["Continue the active chat", "現在のチャットを継続", "Aktiven Chat fortsetzen"],
  labelChatSessionBadgeNew: ["Chat: New", "チャット: 新規", "Chat: Neu"],
  labelChatSessionBadgeContinue: ["Chat: Continue", "チャット: 継続", "Chat: Fortsetzen"],
  labelManualSession: ["Manual session", "手動セッション", "Manuelle Session"],
  labelManualSessions: ["Manual Sessions", "手動セッション", "Manuelle Sessions"],
  labelAllTasks: ["All", "すべて", "Alle"],
  labelJobTasks: ["Jobs", "ジョブ", "Jobs"],
  labelRecurringTasks: ["Recurring Tasks", "繰り返しタスク", "Wiederkehrende Tasks"],
  labelTodoTaskDrafts: ["Todo Task Drafts", "Todo Task Draft", "Todo-Task-Entwürfe"],
  labelOneTimeTasks: ["One-time Tasks", "一度きりタスク", "Einmalige Tasks"],
  labelJitterSeconds: ["Jitter (max seconds, 0=off)", "ジッター(最大秒数, 0=無効)", "Jitter (max. Sekunden, 0=aus)"],
  webviewJitterNote: ["0 disables jitter. Adds a random delay between 0 and the specified seconds before execution.", "0で無効。値を入れると0〜その秒数でランダム遅延します。"],
  daySun: ["Sun", "日", "So"],
  dayMon: ["Mon", "月", "Mo"],
  dayTue: ["Tue", "火", "Di"],
  dayWed: ["Wed", "水", "Mi"],
  dayThu: ["Thu", "木", "Do"],
  dayFri: ["Fri", "金", "Fr"],
  daySat: ["Sat", "土", "Sa"],
  labelFriendlyBuilder: ["Friendly cron builder", "かんたんCron", "Friendly Cron Builder"],
  labelFriendlyGenerate: ["Generate", "生成する", "Generieren"],
  labelFriendlyPreview: ["Preview", "プレビュー", "Vorschau"],
  labelFriendlyFallback: ["Preview unavailable for this expression", "このCronの説明はありません", "Für diesen Ausdruck ist keine Vorschau verfügbar"],
  labelFriendlySelect: ["Select frequency", "頻度を選択", "Häufigkeit auswählen"],
  labelEveryNMinutes: ["Every N minutes", "N分ごと", "Alle N Minuten"],
  labelHourlyAtMinute: ["Hourly at minute", "毎時 指定分", "Stündlich zur Minute"],
  labelDailyAtTime: ["Daily at time", "毎日 時刻", "Täglich um"],
  labelWeeklyAtTime: ["Weekly at day/time", "毎週 曜日+時刻", "Wöchentlich an Tag/Uhrzeit"],
  labelMonthlyAtTime: ["Monthly on day/time", "毎月 日付+時刻", "Monatlich an Tag/Uhrzeit"],
  labelMinute: ["Minute", "分", "Minute"],
  labelHour: ["Hour", "時", "Stunde"],
  labelDayOfMonth: ["Day of month", "実行日", "Tag des Monats"],
  labelDayOfWeek: ["Day of week", "曜日", "Wochentag"],
  labelOpenInGuru: ["Open in crontab.guru", "crontab.guruを開く", "In crontab.guru öffnen"],
  cronPreviewEveryNMinutes: ["Every {n} minutes", "{n}分ごと", "Alle {n} Minuten"],
  cronPreviewHourlyAtMinute: ["Hourly at minute {m}", "毎時 {m}分", "Stündlich zur Minute {m}"],
  cronPreviewDailyAt: ["Daily at {t}", "毎日 {t}", "Täglich um {t}"],
  cronPreviewWeekdaysAt: ["Weekdays at {t}", "平日 {t}", "Werktags um {t}"],
  cronPreviewWeeklyOnAt: ["Weekly on {d} at {t}", "毎週 {d} {t}", "Wöchentlich am {d} um {t}"],
  cronPreviewMonthlyOnAt: ["Monthly on day {dom} at {t}", "毎月{dom}日 {t}", "Monatlich am Tag {dom} um {t}"],
  placeholderTaskName: ["Enter task name...", "タスク名を入力...", "Task-Namen eingeben..."],
  labelSkills: ["Skills", "スキル", "Skills"],
  placeholderCron: ["e.g., 0 9 * * 1-5", "例: 0 9 * * 1-5"],
  treeGroupGlobal: ["🌐 Global", "🌐 グローバル"],
  treeGroupWorkspace: ["📁 Workspace", "📁 ワークスペース"],
  treeGroupThisWorkspace: ["🏠 This workspace", "🏠 このワークスペース"],
  treeGroupOtherWorkspace: ["📎 Other workspaces", "📎 他のワークスペース"],
  treeNoTasks: ["No tasks", "タスクなし"],
  reloadNow: ["Reload Now", "今すぐリロード"],
  tooltipWorkspaceTarget: ["Target Workspace", "対象ワークスペース"],
  tooltipNotSet: ["(not set)", "(未設定)"],
  tooltipAppliesHere: ["Applies here", "このワークスペース"],
  storageWriteTimeout: ["Timed out while saving tasks. Your environment may be blocking VS Code extension storage.", "タスクの保存がタイムアウトしました。環境により VS Code の拡張ストレージがブロックされている可能性があります。"],
  disclaimerTitle: ["⚠️ Important Notice", "⚠️ 重要なお知らせ"],
  disclaimerAccept: ["I understand the risks", "リスクを理解しました"],
  disclaimerDecline: ["Cancel", "キャンセル"],
} as const satisfies Record<string, LocalizedText>;

type CronPresetSpec = {
  id: string;
  expression: string;
  name: LocalizedText;
  description: LocalizedText;
};

const cronPresetSpecs: readonly CronPresetSpec[] = [
  { id: "every-3min", expression: "*/3 * * * *", name: ["Every 3 Minutes", "3分ごと", "Alle 3 Minuten"], description: ["Every 3 minutes", "3分ごと", "Alle 3 Minuten"] },
  { id: "every-5min", expression: "*/5 * * * *", name: ["Every 5 Minutes", "5分ごと", "Alle 5 Minuten"], description: ["Every 5 minutes", "5分ごと", "Alle 5 Minuten"] },
  { id: "every-10min", expression: "*/10 * * * *", name: ["Every 10 Minutes", "10分ごと", "Alle 10 Minuten"], description: ["Every 10 minutes", "10分ごと", "Alle 10 Minuten"] },
  { id: "every-15min", expression: "*/15 * * * *", name: ["Every 15 Minutes", "15分ごと", "Alle 15 Minuten"], description: ["Every 15 minutes", "15分ごと", "Alle 15 Minuten"] },
  { id: "every-30min", expression: "*/30 * * * *", name: ["Every 30 Minutes", "30分ごと", "Alle 30 Minuten"], description: ["Every 30 minutes", "30分ごと", "Alle 30 Minuten"] },
  { id: "hourly", expression: "0 * * * *", name: ["Hourly", "毎時", "Stündlich"], description: ["Every hour at minute 0", "毎時0分", "Zu jeder Stunde bei Minute 0"] },
  { id: "daily-9am", expression: "0 9 * * *", name: ["Daily 9:00 AM", "毎日 9:00", "Täglich 9:00"], description: ["Every day at 9:00 AM", "毎日9時", "Jeden Tag um 9:00"] },
  { id: "daily-12pm", expression: "0 12 * * *", name: ["Daily 12:00 PM", "毎日 12:00", "Täglich 12:00"], description: ["Every day at 12:00 PM", "毎日12時", "Jeden Tag um 12:00"] },
  { id: "daily-6pm", expression: "0 18 * * *", name: ["Daily 6:00 PM", "毎日 18:00", "Täglich 18:00"], description: ["Every day at 6:00 PM", "毎日18時", "Jeden Tag um 18:00"] },
  { id: "weekday-9am", expression: "0 9 * * 1-5", name: ["Weekdays 9:00 AM", "平日 9:00", "Werktags 9:00"], description: ["Monday to Friday at 9:00 AM", "月曜〜金曜の9時", "Montag bis Freitag um 9:00"] },
  { id: "weekday-6pm", expression: "0 18 * * 1-5", name: ["Weekdays 6:00 PM", "平日 18:00", "Werktags 18:00"], description: ["Monday to Friday at 6:00 PM", "月曜〜金曜の18時", "Montag bis Freitag um 18:00"] },
  { id: "weekly-monday", expression: "0 9 * * 1", name: ["Every Monday 9:00 AM", "毎週月曜 9:00", "Jeden Montag 9:00"], description: ["Every Monday at 9:00 AM", "毎週月曜日の9時", "Jeden Montag um 9:00"] },
  { id: "weekly-friday", expression: "0 18 * * 5", name: ["Every Friday 6:00 PM", "毎週金曜 18:00", "Jeden Freitag 18:00"], description: ["Every Friday at 6:00 PM", "毎週金曜日の18時", "Jeden Freitag um 18:00"] },
  { id: "monthly-1st", expression: "0 9 1 * *", name: ["1st of Month 9:00 AM", "毎月1日 9:00", "Am 1. des Monats 9:00"], description: ["1st day of every month at 9:00 AM", "毎月1日の9時", "Am 1. Tag jedes Monats um 9:00"] },
];

/**
 * All localized messages
 */
export const messages = {
  // ==================== General ====================
  webviewTitle: () => t("Copilot Cockpit", "Copilot Cockpit"),
  extensionActive: () =>
    t(
      "Copilot Cockpit is now active",
      "Copilot Cockpit が有効になりました",
    ),
  extensionDeactivated: () =>
    t(
      "Copilot Cockpit has been deactivated",
      "Copilot Cockpit が無効になりました",
    ),
  ...buildStaticMessageMap({
    schedulerStarted: ["Scheduler started", "スケジューラーが開始されました"],
    schedulerStopped: ["Scheduler stopped", "スケジューラーが停止されました"],
  }),

  // ==================== Task Operations ====================
  taskCreated: (name: string) =>
    t(`Task "${name}" created successfully`, `タスク「${name}」を作成しました`),
  taskUpdated: (name: string) =>
    t(`Task "${name}" updated successfully`, `タスク「${name}」を更新しました`),
  taskDeleted: (name: string) =>
    t(`Task "${name}" deleted`, `タスク「${name}」を削除しました`),
  taskDuplicated: (name: string) =>
    t(`Task duplicated as "${name}"`, `タスクを「${name}」として複製しました`),
  ...buildStaticMessageMap({ taskCopySuffix: ["(Copy)", "(コピー)"] }),
  taskMovedToCurrentWorkspace: (name: string) =>
    t(
      `Task "${name}" moved to the current workspace`,
      `タスク「${name}」を現在のワークスペースへ移動しました`,
    ),
  taskEnabled: (name: string) =>
    t(`Task "${name}" enabled`, `タスク「${name}」を有効にしました`),
  taskDisabled: (name: string) =>
    t(`Task "${name}" disabled`, `タスク「${name}」を無効にしました`),
  taskRescheduled: (name: string, minutes: number) =>
    t(
      `Task "${name}" rescheduled to run in ${minutes} minutes`,
      `タスク「${name}」を${minutes}分後に再スケジュールしました`,
    ),
  taskDeferredToNextCycle: (name: string) =>
    t(
      `Task "${name}" will wait until the next cycle`,
      `タスク「${name}」は次の周期まで待機します`,
    ),
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
  ...buildStaticMessageMap({
    taskNotFound: ["Task not found", "タスクが見つかりません"],
    noTasksFound: ["No scheduled tasks found", "スケジュールされたタスクがありません"],
  }),

  // ==================== Validation ====================
  ...buildStaticMessageMap({
    invalidCronExpression: ["Invalid cron expression", "無効なcron式です"],
    taskNameRequired: ["Task name is required", "タスク名を入力してください"],
    promptRequired: ["Prompt is required", "プロンプトを入力してください"],
    templateRequired: ["Prompt template is required", "プロンプトテンプレートを選択してください"],
    cronExpressionRequired: ["Cron expression is required", "cron式を入力してください"],
  }),

  // ==================== Prompts ====================
  ...buildStaticMessageMap({
    enterTaskName: ["Enter task name", "タスク名を入力"],
    enterPrompt: ["Enter prompt to send to Copilot", "Copilotに送信するプロンプトを入力"],
    enterCronExpression: [
      "Enter cron expression (e.g., '0 9 * * 1-5' for weekdays at 9am)",
      "cron式を入力（例: '0 9 * * 1-5' で平日9時）",
      "Cron-Ausdruck eingeben (z. B. '0 9 * * 1-5' für werktags um 9 Uhr)",
    ],
    selectAgent: ["Select agent", "エージェントを選択", "agent auswählen"],
    selectModel: ["Select model", "モデルを選択", "model auswählen"],
    selectScope: ["Select scope", "スコープを選択", "Scope auswählen"],
    selectTask: ["Select a task", "タスクを選択", "Task auswählen"],
    selectPromptTemplate: ["Select prompt template", "プロンプトテンプレートを選択", "Prompt-Template auswählen"],
  }),

  // ==================== Actions ====================
  ...buildStaticMessageMap({
    actionRun: ["Run", "実行", "Ausführen"],
    actionEdit: ["Edit", "編集", "Bearbeiten"],
    actionDelete: ["Delete", "削除", "Löschen"],
    actionDuplicate: ["Duplicate", "複製", "Duplizieren"],
    actionMoveToCurrentWorkspace: ["Move to Current Workspace", "現在のワークスペースへ移動", "In aktuellen Workspace verschieben"],
    actionEnable: ["Enable", "有効化", "Aktivieren"],
    actionDisable: ["Disable", "無効化", "Deaktivieren"],
    actionCancel: ["Cancel", "キャンセル", "Abbrechen"],
    actionOpenScheduler: ["Open Cockpit", "Cockpit を開く", "Cockpit öffnen"],
    actionReschedule: ["Reschedule", "再スケジュール", "Neu planen"],
    actionWaitNextCycle: ["Wait for Next Cycle", "次の周期まで待機", "Auf nächsten Zyklus warten"],
    actionCopyPrompt: ["Copy Prompt", "プロンプトをコピー", "Prompt kopieren"],
    actionTestRun: ["Test Run", "テスト実行", "Testlauf"],
    actionSave: ["Update", "更新", "Aktualisieren"],
    actionCreate: ["Create", "作成", "Erstellen"],
    actionNewTask: ["New Task", "新規タスク", "Neuer Task"],
    actionRefresh: ["Refresh", "再読込", "Aktualisieren"],
    actionRestoreBackup: ["Restore Backup", "バックアップを復元", "Backup wiederherstellen"],
    actionInsertSkill: ["Insert Skill", "スキルを挿入", "Skill einfügen"],
  }),

  // Webview-only runtime strings (used in media/schedulerWebview.js)
  ...buildStaticMessageMap({
    webviewScriptErrorPrefix: ["Script error: ", "スクリプトエラー: "],
    webviewUnhandledErrorPrefix: ["Unhandled error: ", "未処理のエラー: "],
    webviewLinePrefix: [" (line ", "（行 "],
    webviewLineSuffix: [")", "）"],
    webviewUnknown: ["unknown", "不明"],
  }),
  webviewApiUnavailable: () =>
    t(
      "VS Code Webview API (acquireVsCodeApi) is unavailable. Check CSP/initialization.",
      "VS Code Webview API (acquireVsCodeApi) が利用できません。CSP/初期化を確認してください。",
    ),
  ...buildStaticMessageMap({
    webviewClientErrorPrefix: ["Webview error: ", "画面処理でエラーが発生しました: "],
    webviewSuccessPrefix: ["✔ ", "✔ "],
  }),

  // ==================== Webview Placeholders ====================
  ...buildStaticMessageMap({
    webviewSelectAgentPlaceholder: ["Select agent", "エージェントを選択", "agent auswählen"],
    webviewNoAgentsAvailable: ["No agents available", "利用可能なエージェントがありません", "Keine agents verfügbar"],
    webviewSelectModelPlaceholder: ["Select model", "モデルを選択", "model auswählen"],
    webviewNoModelsAvailable: ["No models available", "利用可能なモデルがありません", "Keine models verfügbar"],
    webviewSelectTemplatePlaceholder: ["Select template", "テンプレートを選択", "Template auswählen"],
    placeholderSelectSkill: ["Select skill", "スキルを選択", "Skill auswählen"],
  }),

  // ==================== Confirmations ====================
  confirmDelete: (name: string) =>
    t(
      `Are you sure you want to delete task "${name}"?`,
      `タスク「${name}」を削除しますか？`,
    ),
  confirmDeleteYes: () => t("Yes, delete", "はい、削除します", "Ja, löschen"),
  confirmDeleteNo: () => t("No, keep", "いいえ、残します", "Nein, behalten"),

  confirmMoveToCurrentWorkspace: (name: string) =>
    t(
      `Move task "${name}" to the current workspace?`,
      `タスク「${name}」を現在のワークスペースへ移動しますか？`,
    ),
  confirmMoveYes: () => t("Move", "移動する", "Verschieben"),

  confirmRunOutsideWorkspace: (name: string) =>
    t(
      `Task "${name}" is scoped to a different workspace. Run it here anyway?`,
      `タスク「${name}」は別のワークスペース用です。このワークスペースで実行しますか？`,
    ),
  confirmRunAnyway: () => t("Run anyway", "実行する", "Trotzdem ausführen"),

  labelThisWorkspaceShort: () => t("This workspace", "このWS", "Dieser Workspace"),
  labelOtherWorkspaceShort: () => t("Other workspace", "他のWS", "Anderer Workspace"),
  autoShowOnStartupEnabled: () =>
    t("Auto-open on startup: On", "起動時に自動表示: オン"),
  autoShowOnStartupDisabled: () =>
    t("Auto-open on startup: Off", "起動時に自動表示: オフ"),
  autoShowOnStartupToggleEnabled: () =>
    t("Disable Auto Open", "自動表示を無効化"),
  autoShowOnStartupToggleDisabled: () =>
    t("Enable Auto Open", "自動表示を有効化"),
  autoShowOnStartupUpdated: (enabled: boolean) =>
    enabled
      ? t(
          "Scheduler will open automatically on startup for this repo",
          "このリポジトリでは起動時に Scheduler を自動表示します",
        )
      : t(
          "Scheduler auto-open on startup was disabled for this repo",
          "このリポジトリの起動時自動表示を無効化しました",
        ),
  scheduleHistoryLabel: () => t("Backup History", "バックアップ履歴", "Backup-Verlauf"),
  scheduleHistoryPlaceholder: () =>
    t("Select a backup version", "復元するバックアップを選択"),
  scheduleHistoryEmpty: () =>
    t("No backup versions yet", "まだバックアップはありません"),
  scheduleHistoryNote: () =>
    t(
      "The scheduler keeps the last 100 workspace schedule changes in .vscode/scheduler-history.",
      "Scheduler はワークスペースの直近100件の変更を .vscode/scheduler-history に保存します。",
    ),
  scheduleHistoryRestoreSelectRequired: () =>
    t("Select a backup version first", "先にバックアップを選択してください"),
  scheduleHistoryRestoreConfirm: (createdAt: string) =>
    t(
      `Restore the repo schedule from ${createdAt}? The current state will be backed up first.`,
      `${createdAt} のバックアップでリポジトリのスケジュールを復元しますか？ 現在の状態は先にバックアップされます。`,
    ),
  scheduleHistoryRestored: (createdAt: string) =>
    t(
      `Repo schedule restored from backup ${createdAt}`,
      `バックアップ ${createdAt} からリポジトリのスケジュールを復元しました`,
    ),
  scheduleHistorySnapshotNotFound: () =>
    t("The selected backup version was not found", "選択したバックアップが見つかりません"),

  cannotDeleteOtherWorkspaceTask: (name: string) =>
    t(
      `Task "${name}" belongs to a different workspace. Please delete it from that workspace.`,
      `タスク「${name}」は別のワークスペース用です。元のワークスペースで削除してください。`,
    ),

  // ==================== Clipboard ====================
  ...buildStaticMessageMap({ promptCopied: schedulerUiMessageEntries.promptCopied }),

  // ==================== Agent / Model Descriptions ====================
  ...buildStaticMessageMap(agentAndModelMessageEntries),

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
  ...buildStaticMessageMap(tabMessageEntries),

  helpIntroTitle: () =>
    t(
      "🚀 Schedule Copilot prompts to run automatically",
      "🚀 Copilot プロンプトを自動実行するスケジューラ",
      "🚀 Copilot-Prompts automatisch planen und ausführen",
    ),
  helpIntroBody: () =>
    t(
      "Write a prompt, set a cron schedule, and this extension sends it to Copilot on time — every time. Schedules are stored per repo in .vscode so teams can share them via git. Chain tasks into Jobs for multi-step workflows, add pause checkpoints for human review, or run bounded Research loops that stop themselves automatically.",
      "プロンプトを書いてcronスケジュールを設定すれば、この拡張機能が毎回定刻にCopilotへ送信します。スケジュールはリポジトリごとに.vscodeへ保存されるため、gitで共有できます。Jobsでタスクを連結したり、レビュー用の一時停止チェックポイントを追加したり、自動終了するResearchループを実行できます。",
      "Schreiben Sie einen Prompt, legen Sie einen Cron-Zeitplan fest, und diese Erweiterung sendet ihn jedes Mal pünktlich an Copilot. Zeitpläne werden pro Repository in .vscode gespeichert, damit Teams sie über Git teilen können. Sie können Aufgaben zu Jobs für mehrstufige Abläufe verketten, Pause Checkpoints für menschliche Freigaben einfügen oder begrenzte Research-Schleifen ausführen, die sich selbst beenden.",
    ),
  helpTodoTitle: () =>
    t(
      "1. 🧭 Todo (Cockpit) - Communication Hub",
      "1. 🧭 Todo (Cockpit) - エージェントとの連携ハブ",
      "1. 🧭 Todo (Cockpit) - Kommunikations-Hub"
    ),
  helpTodoBody: () =>
    t(
      "The Todo board is the planning hub. Active cards should carry one workflow flag such as new, needs-bot-review, needs-user-review, ready, ON-SCHEDULE-LIST, or FINAL-USER-CHECK. Use ready for explicit draft preparation, ON-SCHEDULE-LIST for linked active execution, and FINAL-USER-CHECK when the task work has finished and needs acceptance.",
      "Todoボードは計画ハブです。アクティブなカードは new、needs-bot-review、needs-user-review、ready、ON-SCHEDULE-LIST、FINAL-USER-CHECK のいずれか1つのワークフローフラグを持つ想定です。ready は明示的な下書き準備、ON-SCHEDULE-LIST はリンク済みの実行中状態、FINAL-USER-CHECK はタスク作業完了後の承認待ちに使います。",
      "Das Todo-Board ist der Planungsknoten. Aktive Karten sollen genau ein Workflow-Flag wie new, needs-bot-review, needs-user-review, ready, ON-SCHEDULE-LIST oder FINAL-USER-CHECK tragen. Verwenden Sie ready für die explizite Draft-Vorbereitung, ON-SCHEDULE-LIST für verknüpfte aktive Ausführung und FINAL-USER-CHECK, wenn die Task-Arbeit abgeschlossen ist und abgenommen werden muss."
    ),
  helpSwitchTabSettingsBtn: () => t("Switch to Settings", "設定を表示", "Zu Einstellungen wechseln"),
  helpSwitchTabTodoBtn: () => t("Switch to Todo Board", "Todoボードを表示", "Zum Todo-Board wechseln"),
  helpSwitchTabCreateBtn: () => t("Switch to Create Task", "タスク作成を表示", "Zu Task erstellen wechseln"),
  helpSwitchTabListBtn: () => t("Switch to Task List", "タスクリストを表示", "Zur Task-Liste wechseln"),
  helpSwitchTabJobsBtn: () => t("Switch to Jobs", "Jobsを表示", "Zu Jobs wechseln"),
  helpSwitchTabResearchBtn: () => t("Switch to Research", "Researchを表示", "Zu Research wechseln"),
  helpCreateTitle: () => t("2. ✍️ Create a Task", "2. ✍️ タスクを作成", "2. ✍️ Einen Task erstellen"),
  helpCreateItemName: () =>
    t(
      "Open the Create Task tab. Enter a name, write your prompt, set a cron schedule (or use the friendly schedule builder), and choose a scope.",
      "Create Task タブを開き、名前・プロンプト・cronスケジュール（またはフレンドリービルダー）・スコープを設定します。",
      "Öffnen Sie den Tab Create Task. Geben Sie einen Namen ein, schreiben Sie Ihren Prompt, legen Sie einen Cron-Zeitplan fest oder verwenden Sie den Friendly Schedule Builder, und wählen Sie einen Scope.",
    ),
  helpCreateItemTemplates: () =>
    t(
      "For the prompt, choose Free Input to type directly, Local Template to load a file from .github/prompts/, or Global Template from your VS Code prompts folder.",
      "プロンプトは、直接入力のFree Input、.github/prompts/からのLocal Template、VS CodeプロンプトフォルダーのGlobal Templateから選べます。",
      "Für den Prompt können Sie Free Input für direkte Eingabe, Local Template zum Laden einer Datei aus .github/prompts/ oder Global Template aus Ihrem VS Code prompts-Ordner verwenden.",
    ),
  helpCreateItemSkills: () =>
    t(
      "Click Insert Skill to append a skill instruction to the prompt. Skills are .md files in .github/skills/ — they are only available when that repo is open, and they are not used automatically just by being present.",
      "Insert Skillをクリックすると、スキル指示文をプロンプトへ追加できます。スキルは.github/skills/内の.mdファイルで、そのリポジトリが開いているときのみ有効です。ファイルがあるだけでは自動適用されません。",
      "Klicken Sie auf Insert Skill, um eine Skill-Anweisung an den Prompt anzuhängen. Skills sind .md-Dateien in .github/skills/ und nur verfügbar, wenn dieses Repository geöffnet ist. Allein ihre Existenz aktiviert sie nicht automatisch.",
    ),
  helpCreateItemAgentModel: () =>
    t(
      "Leave agent and model blank to use your current VS Code defaults. Set them explicitly on a task to lock a specific agent and model for that task only.",
      "エージェントとモデルは空白のままにするとVS Codeのデフォルトが使われます。タスクごとに明示的に指定すると、そのタスク専用に固定できます。",
      "Lassen Sie agent und model leer, um die aktuellen VS Code-Standardeinstellungen zu verwenden. Wenn Sie sie direkt am Task setzen, werden sie nur für diesen Task festgelegt.",
    ),
  helpCreateItemRunFirst: () =>
    t(
      "Check Run First to fire the task 3 minutes after saving. Check One-Time for Todo Task Drafts and other single-use executions; after a successful one-time run, the linked Todo should move from ON-SCHEDULE-LIST to FINAL-USER-CHECK.",
      "Run Firstにチェックすると保存から3分後に初回実行します。One-Time は Todo Task Drafts や単発実行向けです。one-time 実行が成功すると、リンクされた Todo は ON-SCHEDULE-LIST から FINAL-USER-CHECK へ進む想定です。",
      "Aktivieren Sie Run First, damit der Task 3 Minuten nach dem Speichern startet. Aktivieren Sie One-Time für Todo Task Drafts und andere Einmal-Ausführungen; nach einem erfolgreichen One-Time-Lauf sollte das verknüpfte Todo von ON-SCHEDULE-LIST zu FINAL-USER-CHECK wechseln.",
    ),
  helpListTitle: () => t("3. 📋 Manage Your Tasks", "3. 📋 タスクを管理", "3. 📋 Ihre Tasks verwalten"),
  helpListItemSections: () =>
    t(
      "The Task List separates recurring tasks, one-time tasks, and Todo Task Drafts. A linked one-time draft keeps its source Todo in ready until you enable or schedule it, and completed one-time execution should return the source Todo to FINAL-USER-CHECK for acceptance.",
      "Task List では繰り返しタスク、一度きりタスク、Todo Task Drafts を分けて表示します。リンクされた one-time の下書きは、有効化またはスケジュールされるまで元の Todo を ready のまま保ち、完了後は元の Todo を FINAL-USER-CHECK に戻して承認待ちにします。",
      "Die Task List trennt wiederkehrende Tasks, einmalige Tasks und Todo Task Drafts. Ein verknüpfter One-Time-Draft hält sein Ursprungstodo in ready, bis Sie ihn aktivieren oder planen; nach erfolgreicher Ausführung sollte das Ursprungstodo zu FINAL-USER-CHECK für die Abnahme zurückkehren.",
    ),
  helpListItemActions: () =>
    t(
      "Click a task's action buttons to run it now, open it in the editor, duplicate it, enable or disable it, or delete it. You can also move a task to another open workspace.",
      "タスクのアクションボタンから、即時実行・エディターで開く・複製・有効化/無効化・削除ができます。別のワークスペースへの移動も可能です。",
      "Über die Aktionsschaltflächen eines Tasks können Sie ihn sofort ausführen, im Editor öffnen, duplizieren, aktivieren oder deaktivieren oder löschen. Sie können einen Task auch in einen anderen geöffneten Workspace verschieben.",
    ),
  helpListItemStartup: () =>
    t(
      "Use the toolbar to refresh the list or toggle whether the Scheduler opens automatically whenever this repo opens in VS Code.",
      "ツールバーからリストの更新や、このリポジトリを開いたときにSchedulerを自動表示するかの切り替えができます。",
      "Über die Toolbar können Sie die Liste aktualisieren oder umschalten, ob der Scheduler automatisch geöffnet wird, wenn dieses Repository in VS Code geöffnet wird.",
    ),
  helpJobsTitle: () => t("4. 🔗 Chain Tasks with Jobs", "4. 🔗 Jobsでタスクを連結", "4. 🔗 Tasks mit Jobs verketten"),
  helpJobsItemBoard: () =>
    t(
      "Open the Jobs tab to build multi-step workflows. Add tasks as steps, drag to reorder them, and organize workflows into folders.",
      "Jobs タブでマルチステップのワークフローを作成します。タスクをステップとして追加し、ドラッグで並べ替え、フォルダーで整理できます。",
      "Öffnen Sie den Jobs-Tab, um mehrstufige Abläufe zu bauen. Fügen Sie Tasks als Schritte hinzu, ordnen Sie sie per Drag-and-Drop neu an und organisieren Sie Abläufe in Ordnern.",
    ),
  helpJobsItemPause: () =>
    t(
      "Add a Pause Checkpoint between steps to stop the workflow and wait for your approval before continuing. Reject to reopen the previous task in the editor for fixes.",
      "ステップ間にPause Checkpointを追加すると、次のステップへ進む前に承認を待ちます。却下すると直前のタスクがエディターで開きます。",
      "Fügen Sie zwischen Schritten einen Pause Checkpoint ein, damit der Ablauf stoppt und auf Ihre Freigabe wartet. Mit Reject öffnen Sie den vorherigen Task zur Korrektur erneut im Editor.",
    ),
  helpJobsItemCompile: () =>
    t(
      "Use Compile To Task to collapse the entire Job into a single combined prompt task. The original Job moves to a Bundled Jobs folder and becomes inactive.",
      "Compile To Taskを使うとJob全体を1つのプロンプトタスクにまとめます。元のJobはBundled Jobsフォルダーへ移動し非アクティブになります。",
      "Mit Compile To Task können Sie einen gesamten Job in einen einzigen kombinierten Prompt-Task umwandeln. Der ursprüngliche Job wird in den Ordner Bundled Jobs verschoben und inaktiv.",
    ),
  helpJobsItemLabels: () =>
    t(
      "A Job's name becomes a label on all its steps. Filter the Task List by that label to see only the tasks that belong to that workflow.",
      "Job名はすべてのステップのラベルになります。Task ListでそのラベルをフィルターするとそのJobのタスクだけを表示できます。",
      "Der Name eines Jobs wird als Label auf alle Schritte angewendet. Filtern Sie die Task List nach diesem Label, um nur die Tasks dieses Ablaufs zu sehen.",
    ),
  helpJobsItemFolders: () =>
    t(
      "Drag jobs into folders to organize them. The banner at the top shows which folder you are currently viewing.",
      "ジョブをフォルダーへドラッグして整理できます。上部のバナーで現在どのフォルダーを表示しているか確認できます。",
      "Ziehen Sie Jobs in Ordner, um sie zu organisieren. Das Banner oben zeigt, welchen Ordner Sie gerade ansehen.",
    ),
  helpJobsItemDelete: () =>
    t(
      "Deleting a step from a Job also removes that task from the Task List. A confirmation prompt appears first.",
      "JobからステップをDeleteするとTask Listからも削除されます。実行前に確認が表示されます。",
      "Wenn Sie einen Schritt aus einem Job löschen, wird dieser Task auch aus der Task List entfernt. Vorher erscheint eine Bestätigung.",
    ),
  helpResearchTitle: () => t("5. 🔬 Run Bounded Research", "5. 🔬 制限付きResearchを実行", "5. 🔬 Begrenzte Research-Läufe ausführen"),
  helpResearchItemProfiles: () =>
    t(
      "Go to the Research tab and create a profile. Set your instructions, the file paths the agent may edit, a benchmark command, a metric pattern, and your agent/model choice.",
      "Researchタブでプロファイルを作成します。指示文・編集可能なファイルパス・ベンチマークコマンド・指標パターン・エージェント/モデルを設定します。",
      "Gehen Sie zum Research-Tab und erstellen Sie ein Profil. Legen Sie die Anweisungen, die editierbaren Dateipfade, einen Benchmark-Befehl, ein Metric-Muster und agent/model fest.",
    ),
  helpResearchItemBounds: () =>
    t(
      "Set hard limits on how long a run can go: maximum iterations, maximum minutes, benchmark timeout, edit wait time, and consecutive failure limit.",
      "実行の上限を設定します：最大反復回数・最大分数・ベンチマークタイムアウト・編集待機時間・連続失敗上限。",
      "Setzen Sie harte Grenzen dafür, wie lange ein Lauf dauern darf: maximale Iterationen, maximale Minuten, Benchmark-Timeout, Wartezeit für Edits und Limit für aufeinanderfolgende Fehler.",
    ),
  helpResearchItemHistory: () =>
    t(
      "After a run, check the history to review attempts, scores, which files changed, and the benchmark output — before deciding whether to keep the result.",
      "実行後はHistoryを確認して、試行・スコア・変更ファイル・ベンチマーク出力を検証してから結果を採用するか判断できます。",
      "Prüfen Sie nach einem Lauf die History, um Versuche, Scores, geänderte Dateien und Benchmark-Ausgaben zu überprüfen, bevor Sie entscheiden, ob das Ergebnis behalten werden soll.",
    ),
  helpStorageTitle: () => t("6. 💾 Where Files Are Saved", "6. 💾 ファイルの保存場所", "6. 💾 Wo Dateien gespeichert werden"),
  helpStorageItemRepo: () =>
    t(
      "Tasks are saved in .vscode/scheduler.json inside the open repo. Todo Cockpit items go to .vscode/scheduler.private.json and are never synced via git.",
      "タスクは開いているリポジトリの.vscode/scheduler.jsonに保存されます。Todo Cockpitは.vscode/scheduler.private.jsonに保存され、gitで同期されません。",
      "Tasks werden in .vscode/scheduler.json im geöffneten Repository gespeichert. Elemente aus dem Todo Cockpit landen in .vscode/scheduler.private.json und werden niemals über Git synchronisiert.",
    ),
  helpStorageItemBackups: () =>
    t(
      "Inline prompts are backed up to .vscode/cockpit-prompt-backups/ as Markdown files. Full snapshots of the scheduler state go to .vscode/scheduler-history/.",
      "インラインプロンプトは.vscode/cockpit-prompt-backups/にMarkdownとしてバックアップされます。スケジューラ全体のスナップショットは.vscode/scheduler-history/に保存されます。",
      "Inline-Prompts werden als Markdown-Dateien nach .vscode/cockpit-prompt-backups/ gesichert. Vollständige Snapshots des Scheduler-Zustands landen in .vscode/scheduler-history/.",
    ),
  helpStorageItemIsolation: () =>
    t(
      "Each repo keeps its own schedule. Opening a parent folder does not pull in schedules from nested repos inside it.",
      "各リポジトリは独自のスケジュールを持ちます。親フォルダーを開いても、内部のネストされたリポジトリのスケジュールは読み込まれません。",
      "Jedes Repository behält seinen eigenen Zeitplan. Beim Öffnen eines übergeordneten Ordners werden keine Zeitpläne aus verschachtelten Repositories übernommen.",
    ),
  helpStorageItemGlobal: () =>
    t(
      "Global tasks are kept in extension storage as a fallback, but the .vscode files in the open repo always take priority.",
      "グローバルタスクは拡張ストレージにフォールバックとして保存されますが、開いているリポジトリの.vscodeファイルが常に優先されます。",
      "Globale Tasks werden als Fallback im Erweiterungsspeicher gehalten, aber die .vscode-Dateien im geöffneten Repository haben immer Vorrang.",
    ),
  helpOverdueTitle: () => t("7. ⏰ Handling Overdue Tasks", "7. ⏰ 期限超過タスクの処理", "7. ⏰ Überfällige Tasks behandeln"),
  helpOverdueItemReview: () =>
    t(
      "If VS Code was closed while tasks were scheduled, they won't run automatically on restart. Instead, you'll be asked what to do with each overdue task one at a time.",
      "VS Codeを閉じている間にスケジュールされたタスクは、再起動時に自動実行されません。代わりに、期限超過のタスクを1件ずつ確認するプロンプトが表示されます。",
      "Wenn VS Code geschlossen war, während Tasks geplant waren, werden sie beim Neustart nicht automatisch ausgeführt. Stattdessen werden Sie nacheinander gefragt, was mit jedem überfälligen Task geschehen soll.",
    ),
  helpOverdueItemRecurring: () =>
    t(
      "For overdue recurring tasks: choose to run now or skip to the next scheduled cycle.",
      "繰り返しの期限超過タスク：今すぐ実行するか、次のcyclまで待機するかを選べます。",
      "Bei überfälligen wiederkehrenden Tasks können Sie entscheiden, ob sie jetzt ausgeführt oder bis zum nächsten geplanten Zyklus übersprungen werden sollen.",
    ),
  helpOverdueItemOneTime: () =>
    t(
      "For overdue one-time tasks: choose to run now or enter a number of minutes from now to reschedule it.",
      "一度きりの期限超過タスク：今すぐ実行するか、何分後に実行するかを入力して再スケジュールできます。",
      "Bei überfälligen einmaligen Tasks können Sie entscheiden, ob sie jetzt ausgeführt oder um eine bestimmte Anzahl Minuten verschoben werden sollen.",
    ),
  helpSessionTitle: () => t("8. 💬 Chat Session Options", "8. 💬 チャットセッション設定", "8. 💬 Chat Session-Optionen"),
  helpSessionItemPerTask: () =>
    t(
      "Each recurring task can override the global new-session setting. Find the option in the Create/Edit Task form.",
      "繰り返しタスクはCreate/Edit Taskフォームでグローバルのnew-session設定を上書きできます。",
      "Jeder wiederkehrende Task kann die globale New Session-Einstellung überschreiben. Sie finden diese Option im Formular Create/Edit Task.",
    ),
  helpSessionItemNewChat: () =>
    t(
      "Enable New Chat Session on a task to start a fresh Copilot chat before each run, rather than continuing in the same conversation.",
      "タスクのNew Chat Sessionを有効にすると、毎回の実行前に新しいCopilotチャットを開きます（同じ会話を続けません）。",
      "Aktivieren Sie New Chat Session für einen Task, wenn vor jeder Ausführung ein neuer Copilot-Chat gestartet werden soll, statt dieselbe Unterhaltung fortzusetzen.",
    ),
  helpSessionItemCareful: () =>
    t(
      "Use this carefully: a scheduled run in new-session mode can deliberately open another AI session and chain into it.",
      "注意して使用してください：new-sessionモードのスケジュール実行は意図的に別のAIセッションを開いて連鎖できます。",
      "Verwenden Sie diese Option mit Bedacht: Eine geplante Ausführung im New Session-Modus kann absichtlich eine weitere AI-Sitzung öffnen und in sie weiterleiten.",
    ),
  helpSessionItemSeparate: () =>
    t(
      "If scheduler MCP tools are enabled, an AI model can create or trigger tasks that open new sessions — meaning one LLM can chain into another.",
      "scheduler MCPツールが有効な場合、AIモデルが新規セッションを開くタスクを作成・実行できます。つまり1つのLLMが別のLLMを連鎖起動できます。",
      "Wenn scheduler MCP tools aktiviert sind, kann ein AI-Modell Tasks erstellen oder auslösen, die neue Sitzungen öffnen. Das bedeutet, dass sich ein LLM in ein anderes weiterverkettet.",
    ),
  helpMcpItemEmbedded: () =>
    t(
      "MCP is built in. The scheduler's MCP server starts alongside the extension — no separate install needed.",
      "MCPは組み込みです。SchedulerのMCPサーバーは拡張機能と一緒に起動します。別途インストールは不要です。",
      "MCP ist integriert. Der MCP-Server des Scheduler startet zusammen mit der Erweiterung. Eine separate Installation ist nicht nötig.",
    ),
  helpMcpItemConfig: () =>
    t(
      "MCP tools are not active by default. Add a launcher entry (e.g. .vscode/mcp.json) to register the scheduler server in this workspace, and keep third-party secrets in top-level MCP inputs instead of inline tokens.",
      "MCPツールはデフォルトで有効になっていません。.vscode/mcp.jsonなどのランチャー設定を追加してこのワークスペースに登録し、外部サービスのシークレットはインラインで書かずにMCPのトップレベルinputsに保存します。",
      "MCP tools sind standardmäßig nicht aktiv. Fügen Sie einen Launcher-Eintrag hinzu, zum Beispiel in .vscode/mcp.json, um den Scheduler-Server in diesem Workspace zu registrieren, und halten Sie Secrets externer Dienste in MCP-Inputs statt als Inline-Token.",
    ),
  helpMcpItemAutoConfig: () =>
    t(
      "Click the Setup MCP button below to automatically create or update the scheduler entry in .vscode/mcp.json for this repo without dropping other MCP servers.",
      "下のSetup MCPボタンをクリックすると、このリポジトリの.vscode/mcp.jsonにある他のMCPサーバーを消さずにschedulerエントリを自動で作成または更新します。",
      "Klicken Sie unten auf Setup MCP, um den scheduler-Eintrag in .vscode/mcp.json für dieses Repository automatisch zu erstellen oder zu aktualisieren, ohne andere MCP-Server zu entfernen.",
    ),
  helpMcpItemDanger: () =>
    t(
      "Warning: once Copilot can see these MCP tools, it can read your schedule, modify tasks, and trigger runs — including ones that open new AI sessions. Only enable this if you understand the risk.",
      "警告：CopilotがこれらのMCPツールを参照できると、スケジュールの読み取り・タスクの変更・実行のトリガー（新しいAIセッションを開くものも含む）が可能になります。リスクを理解した上で有効にしてください。",
      "Warnung: Sobald Copilot diese MCP tools sehen kann, kann es Ihren Zeitplan lesen, Tasks ändern und Läufe auslösen, auch solche, die neue AI-Sitzungen öffnen. Aktivieren Sie das nur, wenn Sie das Risiko verstehen.",
    ),
  helpMcpItemInspect: () =>
    t(
      "Read tools: list all tasks, fetch a single task's details, get overdue tasks, and view run history.",
      "読み取りツール：全タスクの一覧・単一タスクの詳細取得・期限超過タスクの確認・実行履歴の表示。",
      "Read tools: alle Tasks auflisten, Details zu einem einzelnen Task abrufen, überfällige Tasks anzeigen und die Run History einsehen.",
    ),
  helpMcpItemWrite: () =>
    t(
      "Write tools: add, update, duplicate, remove, or toggle tasks. Job tools create and edit workflows and their steps.",
      "書き込みツール：タスクの追加・更新・複製・削除・切り替え。JobツールはワークフローとそのステップをCRUD操作します。",
      "Write tools: Tasks hinzufügen, aktualisieren, duplizieren, entfernen oder umschalten. Job tools erstellen und bearbeiten Workflows und deren Schritte.",
    ),
  helpMcpItemTools: () =>
    t(
      "Action tools: run a task immediately, restore a scheduler snapshot, manage pause checkpoints in Jobs, and start or review Research profile runs.",
      "アクションツール：タスクの即時実行・スナップショット復元・Jobsの一時停止チェックポイント管理・Researchプロファイル実行の開始と確認。",
      "Action tools: einen Task sofort ausführen, einen Scheduler-Snapshot wiederherstellen, Pause Checkpoints in Jobs verwalten und Läufe von Research-Profilen starten oder prüfen.",
    ),
  helpMcpTitle: () => t("9. 🧩 MCP Integration", "9. 🧩 MCPインテグレーション", "9. 🧩 MCP-Integration"),
  helpTipsTitle: () => t("10. 💡 Tips", "10. 💡 ヒント", "10. 💡 Tipps"),
  helpTipsItem1: () =>
    t(
      "Enable auto-open only for repos where you want the Scheduler panel to appear every time the repo opens in VS Code.",
      "VS Codeでリポジトリを開くたびにSchedulerパネルを表示したいリポジトリにだけ自動表示を有効にしてください。",
      "Aktivieren Sie Auto-Open nur für Repositories, in denen das Scheduler-Panel jedes Mal beim Öffnen in VS Code erscheinen soll.",
    ),
  helpTipsItem2: () =>
    t(
      "Set reasonable cron intervals. Use jitter and daily run limits to avoid burning through your AI quota with runaway automation.",
      "無理のないcron間隔を設定し、ジッターと1日の実行上限を使って自動化のリスクとAIクォータの消費を抑えてください。",
      "Wählen Sie sinnvolle Cron-Intervalle. Nutzen Sie Jitter und tägliche Ausführungslimits, damit eine außer Kontrolle geratene Automatisierung Ihre AI-Quote nicht aufbraucht.",
    ),
  helpTipsItem3: () =>
    t(
      "Use the restore dropdown to roll back schedule changes. Skills in .github/skills/ must be inserted into the prompt manually — they are not applied automatically. The Settings tab stores the default agent and model used when a task leaves those fields blank.",
      "復元ドロップダウンでスケジュール変更を巻き戻せます。.github/skills/のスキルは手動でプロンプトへ挿入する必要があり、自動適用されません。Settingsタブには、タスクでエージェント/モデルが未指定のときに使うデフォルト値を保存できます。",
      "Mit dem Restore-Dropdown können Sie Zeitplanänderungen zurücksetzen. Skills in .github/skills/ müssen manuell in den Prompt eingefügt werden und werden nicht automatisch angewendet. Im Settings-Tab werden der Standard-Agent und das Standard-Modell gespeichert, die verwendet werden, wenn ein Task diese Felder leer lässt.",
    ),

  webviewMessageHandlingFailed: (error: string) =>
    t(
      `Failed to handle the requested action: ${error}`,
      `操作の処理に失敗しました: ${error}`,
    ),

  ...buildStaticMessageMap({
    labelTaskName: schedulerUiMessageEntries.labelTaskName,
    labelPromptType: schedulerUiMessageEntries.labelPromptType,
    labelPromptInline: schedulerUiMessageEntries.labelPromptInline,
    labelPromptLocal: schedulerUiMessageEntries.labelPromptLocal,
    labelPromptGlobal: schedulerUiMessageEntries.labelPromptGlobal,
    labelPrompt: schedulerUiMessageEntries.labelPrompt,
    labelSchedule: schedulerUiMessageEntries.labelSchedule,
    labelCronExpression: schedulerUiMessageEntries.labelCronExpression,
    labelPreset: schedulerUiMessageEntries.labelPreset,
    labelCustom: schedulerUiMessageEntries.labelCustom,
    labelAdvanced: schedulerUiMessageEntries.labelAdvanced,
    labelFrequency: schedulerUiMessageEntries.labelFrequency,
    labelFrequencyMinute: schedulerUiMessageEntries.labelFrequencyMinute,
    labelFrequencyHourly: schedulerUiMessageEntries.labelFrequencyHourly,
    labelFrequencyDaily: schedulerUiMessageEntries.labelFrequencyDaily,
    labelFrequencyWeekly: schedulerUiMessageEntries.labelFrequencyWeekly,
    labelFrequencyMonthly: schedulerUiMessageEntries.labelFrequencyMonthly,
    labelSelectDays: schedulerUiMessageEntries.labelSelectDays,
    labelSelectTime: schedulerUiMessageEntries.labelSelectTime,
    labelSelectHour: schedulerUiMessageEntries.labelSelectHour,
    labelSelectMinute: schedulerUiMessageEntries.labelSelectMinute,
    labelSelectDay: schedulerUiMessageEntries.labelSelectDay,
    labelInterval: schedulerUiMessageEntries.labelInterval,
    labelAgent: schedulerUiMessageEntries.labelAgent,
    labelModel: schedulerUiMessageEntries.labelModel,
  }),
  labelModelNote: () =>
    t(
      "Model selection is a preview feature and may not apply in all environments. The dropdown labels show the API source, such as Copilot or OpenRouter. If needed, pick the model directly in the Copilot Chat panel.",
      "モデルの選択はプレビュー機能で、環境によって反映されない場合があります。ドロップダウンのラベルには Copilot や OpenRouter などの API ソースが表示されます。必要に応じて Copilot Chat パネルでも確認してください。",
    ),
  ...buildStaticMessageMap({
    labelScope: schedulerUiMessageEntries.labelScope,
    labelScopeGlobal: schedulerUiMessageEntries.labelScopeGlobal,
    labelScopeWorkspace: schedulerUiMessageEntries.labelScopeWorkspace,
    labelEnabled: schedulerUiMessageEntries.labelEnabled,
    labelDisabled: schedulerUiMessageEntries.labelDisabled,
    labelStatus: schedulerUiMessageEntries.labelStatus,
    labelNextRun: schedulerUiMessageEntries.labelNextRun,
    labelLastRun: schedulerUiMessageEntries.labelLastRun,
    labelNever: schedulerUiMessageEntries.labelNever,
    labelRunFirstInOneMinute: schedulerUiMessageEntries.labelRunFirstInOneMinute,
    labelOneTime: schedulerUiMessageEntries.labelOneTime,
    labelChatSession: schedulerUiMessageEntries.labelChatSession,
    labelChatSessionNew: schedulerUiMessageEntries.labelChatSessionNew,
    labelChatSessionContinue: schedulerUiMessageEntries.labelChatSessionContinue,
    labelChatSessionBadgeNew: schedulerUiMessageEntries.labelChatSessionBadgeNew,
    labelChatSessionBadgeContinue: schedulerUiMessageEntries.labelChatSessionBadgeContinue,
  }),
  labelChatSessionRecurringOnly: () =>
    t(
      "Recurring tasks only. One-time tasks do not store a task-level chat session mode.",
      "繰り返しタスク専用です。一度きりタスクにはタスク単位のチャットセッション設定は保存されません。",
      "Nur für wiederkehrende Tasks. Einmalige Tasks speichern keinen Chat-Session-Modus auf Task-Ebene.",
    ),
  ...buildStaticMessageMap({
    labelManualSession: schedulerUiMessageEntries.labelManualSession,
    labelManualSessions: schedulerUiMessageEntries.labelManualSessions,
  }),
  labelManualSessionNote: () =>
    t(
      "Manual sessions stay grouped separately in the task list and do not become one-time tasks.",
      "手動セッションはタスクリストで別グループになり、一度きりタスクにはなりません。",
      "Manuelle Sessions bleiben in der Taskliste separat gruppiert und werden nicht zu einmaligen Tasks.",
    ),
  ...buildStaticMessageMap({
    labelAllTasks: schedulerUiMessageEntries.labelAllTasks,
    labelJobTasks: schedulerUiMessageEntries.labelJobTasks,
    labelRecurringTasks: schedulerUiMessageEntries.labelRecurringTasks,
    labelTodoTaskDrafts: schedulerUiMessageEntries.labelTodoTaskDrafts,
    labelOneTimeTasks: schedulerUiMessageEntries.labelOneTimeTasks,
    labelJitterSeconds: schedulerUiMessageEntries.labelJitterSeconds,
    webviewJitterNote: schedulerUiMessageEntries.webviewJitterNote,
    daySun: schedulerUiMessageEntries.daySun,
    dayMon: schedulerUiMessageEntries.dayMon,
    dayTue: schedulerUiMessageEntries.dayTue,
    dayWed: schedulerUiMessageEntries.dayWed,
    dayThu: schedulerUiMessageEntries.dayThu,
    dayFri: schedulerUiMessageEntries.dayFri,
    daySat: schedulerUiMessageEntries.daySat,
    labelFriendlyBuilder: schedulerUiMessageEntries.labelFriendlyBuilder,
    labelFriendlyGenerate: schedulerUiMessageEntries.labelFriendlyGenerate,
    labelFriendlyPreview: schedulerUiMessageEntries.labelFriendlyPreview,
    labelFriendlyFallback: schedulerUiMessageEntries.labelFriendlyFallback,
    labelFriendlySelect: schedulerUiMessageEntries.labelFriendlySelect,
    labelEveryNMinutes: schedulerUiMessageEntries.labelEveryNMinutes,
    labelHourlyAtMinute: schedulerUiMessageEntries.labelHourlyAtMinute,
    labelDailyAtTime: schedulerUiMessageEntries.labelDailyAtTime,
    labelWeeklyAtTime: schedulerUiMessageEntries.labelWeeklyAtTime,
    labelMonthlyAtTime: schedulerUiMessageEntries.labelMonthlyAtTime,
    labelMinute: schedulerUiMessageEntries.labelMinute,
    labelHour: schedulerUiMessageEntries.labelHour,
    labelDayOfMonth: schedulerUiMessageEntries.labelDayOfMonth,
    labelDayOfWeek: schedulerUiMessageEntries.labelDayOfWeek,
    labelOpenInGuru: schedulerUiMessageEntries.labelOpenInGuru,
    cronPreviewEveryNMinutes: schedulerUiMessageEntries.cronPreviewEveryNMinutes,
    cronPreviewHourlyAtMinute: schedulerUiMessageEntries.cronPreviewHourlyAtMinute,
    cronPreviewDailyAt: schedulerUiMessageEntries.cronPreviewDailyAt,
    cronPreviewWeekdaysAt: schedulerUiMessageEntries.cronPreviewWeekdaysAt,
    cronPreviewWeeklyOnAt: schedulerUiMessageEntries.cronPreviewWeeklyOnAt,
    cronPreviewMonthlyOnAt: schedulerUiMessageEntries.cronPreviewMonthlyOnAt,
    placeholderTaskName: schedulerUiMessageEntries.placeholderTaskName,
  }),
  placeholderPrompt: () =>
    t(
      "Enter prompt to send to Copilot...",
      "Copilotに送信するプロンプトを入力...",
      "Prompt eingeben, der an Copilot gesendet werden soll...",
    ),
  ...buildStaticMessageMap({ labelSkills: schedulerUiMessageEntries.labelSkills }),
  skillInsertNote: () =>
    t(
      "Insert a skill reference sentence into the prompt with one click. This switches the prompt to inline mode so the inserted instruction is preserved.",
      "ワンクリックでスキル参照文をプロンプトへ挿入します。挿入した指示が保持されるよう、プロンプトは inline モードへ切り替わります。",
      "Fügen Sie mit einem Klick einen Skill-Hinweissatz in den Prompt ein. Dadurch wechselt der Prompt in den Inline-Modus, damit die eingefügte Anweisung erhalten bleibt.",
    ),
  skillSentenceTemplate: (skill: string) =>
    t(
      `Use ${skill} to know how things must be done.`,
      `${skill} を使って、どのように進めるべきかを理解してください。`,
      `Verwende ${skill}, um zu verstehen, wie Dinge erledigt werden sollen.`,
    ),
  ...buildStaticMessageMap({ placeholderCron: schedulerUiMessageEntries.placeholderCron }),

  // ==================== TreeView ====================
  treeGroupGlobal: () => t("🌐 Global", "🌐 グローバル"),
  treeGroupWorkspace: () => t("📁 Workspace", "📁 ワークスペース"),
  treeGroupThisWorkspace: () => t("🏠 This workspace", "🏠 このワークスペース"),
  treeGroupOtherWorkspace: () =>
    t("📎 Other workspaces", "📎 他のワークスペース"),
  treeNoTasks: () => t("No tasks", "タスクなし"),

  // ==================== Version Info ====================
  versionInfo: (version: string) =>
    t(`Copilot Cockpit v${version}`, `Copilot Cockpit v${version}`),
  reloadAfterUpdate: (version: string) =>
    t(
      `Copilot Cockpit has been updated to v${version}. Reload to activate the new version.`,
      `Copilot Cockpit が v${version} に更新されました。新しいバージョンを有効にするにはリロードしてください。`,
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
    return date.toLocaleString(getCurrentLocaleTag(), options);
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
  bundledSkillsSyncWorkspaceRequired: () =>
    t(
      "Open a workspace folder before syncing bundled skills.",
      "同梱スキルを同期する前に、ワークスペースフォルダーを開いてください。",
      "Öffnen Sie einen Workspace-Ordner, bevor Sie gebündelte Skills synchronisieren.",
    ),
  bundledSkillsSyncNoChanges: () =>
    t(
      "Bundled skills are already present and up to date.",
      "同梱スキルはすでに存在し、最新です。",
      "Gebündelte Skills sind bereits vorhanden und aktuell.",
    ),
  bundledSkillsSyncCompleted: (
    created: number,
    updated: number,
    skipped: number,
  ) =>
    t(
      `Bundled skill sync finished. Created ${created}, updated ${updated}, skipped ${skipped} customized files.`,
      `同梱スキルの同期が完了しました。作成 ${created} 件、更新 ${updated} 件、スキップ ${skipped} 件です。`,
      `Die Synchronisierung der gebündelten Skills ist abgeschlossen. Erstellt: ${created}, aktualisiert: ${updated}, übersprungen: ${skipped} angepasste Dateien.`,
    ),
  mcpSetupWorkspaceRequired: () =>
    t(
      "Open a workspace folder before setting up the scheduler MCP config.",
      "scheduler MCP 設定を作成する前に、ワークスペースフォルダーを開いてください。",
    ),
  mcpSetupPrompt: () =>
    t(
      "This repo does not have the scheduler MCP entry yet. Add or merge it into .vscode/mcp.json now?",
      "このリポジトリにはまだ scheduler MCP 設定がありません。今すぐ .vscode/mcp.json に追加またはマージしますか？",
    ),
  mcpSetupAction: () => t("Set Up MCP", "MCP をセットアップ"),
  mcpSetupCompleted: (configPath: string) =>
    t(
      `Scheduler MCP config updated: ${configPath}`,
      `Scheduler MCP 設定を更新しました: ${configPath}`,
    ),
  mcpSetupFailed: (reason: string) =>
    t(
      `Failed to update .vscode/mcp.json: ${reason}`,
      `.vscode/mcp.json の更新に失敗しました: ${reason}`,
    ),
  workspaceSupportRepairPrompt: (
    mcpRepoCount: number,
    includeSkillRefresh: boolean,
  ) =>
    t(
      mcpRepoCount > 0
        ? `Scheduler support files need repair in ${mcpRepoCount} workspace repo(s)${includeSkillRefresh ? ", and bundled skills may need a refresh after this update" : ""}. Allow the extension to fix them now?`
        : "Bundled scheduler support files may need a refresh after this update. Allow the extension to fix them now?",
      mcpRepoCount > 0
        ? `Scheduler サポートファイルを ${mcpRepoCount} 個のワークスペース リポジトリで修復する必要があります${includeSkillRefresh ? "。この更新後は同梱スキルの再同期も必要になる可能性があります" : ""}。今すぐ拡張機能に修復を許可しますか？`
        : "この更新後は同梱された scheduler サポートファイルの再同期が必要になる可能性があります。今すぐ拡張機能に修復を許可しますか？",
      mcpRepoCount > 0
        ? `Scheduler-Supportdateien müssen in ${mcpRepoCount} Workspace-Repository(s) repariert werden${includeSkillRefresh ? ", und die gebündelten Skills müssen nach diesem Update möglicherweise aktualisiert werden" : ""}. Darf die Erweiterung das jetzt beheben?`
        : "Gebündelte Scheduler-Supportdateien müssen nach diesem Update möglicherweise aktualisiert werden. Darf die Erweiterung das jetzt beheben?",
    ),
  workspaceSupportRepairAction: () =>
    t(
      "Repair Support Files",
      "サポートファイルを修復",
      "Supportdateien reparieren",
    ),
  workspaceSupportRepairCompleted: (
    repairedMcpRepos: number,
    createdSkills: number,
    updatedSkills: number,
  ) =>
    t(
      `Workspace support repair complete. MCP repos updated: ${repairedMcpRepos}. Bundled skills created: ${createdSkills}, updated: ${updatedSkills}.`,
      `ワークスペース サポートの修復が完了しました。更新した MCP リポジトリ: ${repairedMcpRepos}。作成した同梱スキル: ${createdSkills}、更新した同梱スキル: ${updatedSkills}。`,
      `Die Reparatur der Workspace-Supportdateien ist abgeschlossen. Aktualisierte MCP-Repositories: ${repairedMcpRepos}. Erstellte gebündelte Skills: ${createdSkills}, aktualisierte gebündelte Skills: ${updatedSkills}.`,
    ),
  workspaceSupportRepairFailed: (reason: string) =>
    t(
      `Failed to repair workspace support files: ${reason}`,
      `ワークスペース サポートファイルの修復に失敗しました: ${reason}`,
      `Die Reparatur der Workspace-Supportdateien ist fehlgeschlagen: ${reason}`,
    ),
  jobCreateTitle: () => t("New Job", "新規ジョブ", "Neuer Job"),
  jobNamePrompt: () => t("Enter job name", "ジョブ名を入力してください", "Job-Namen eingeben"),
  jobScheduleTitle: () => t("Job schedule", "ジョブのスケジュール", "Job-Zeitplan"),
  jobSchedulePrompt: () =>
    t(
      "Enter a cron expression for this job",
      "このジョブの cron 式を入力してください",
      "Cron-Ausdruck für diesen Job eingeben",
    ),
  jobFolderCreateTitle: () => t("New Folder", "新規フォルダー", "Neuer Ordner"),
  jobFolderRenameTitle: () => t("Rename Folder", "フォルダー名の変更", "Ordner umbenennen"),
  jobFolderNamePrompt: () =>
    t("Enter folder name", "フォルダー名を入力してください", "Ordnernamen eingeben"),
  jobsPauseTitle: () => t("Pause checkpoints", "停止チェックポイント", "Pause Checkpoints"),
  jobsPauseName: () => t("Pause title", "停止タイトル", "Pause-Titel"),
  jobsPauseDefaultTitle: () => t("Manual review", "手動確認", "Manuelle Prüfung"),
  confirmDeleteJobFolder: (name: string) =>
    t(
      `Delete folder "${name}"? Jobs and subfolders inside it will move to the parent folder.`,
      `フォルダー「${name}」を削除しますか？ 中のジョブとサブフォルダーは親フォルダーへ移動します。`,
    ),
  confirmDeleteJobStep: (name: string) =>
    t(
      `Delete step "${name}"? You can remove it only from this workflow or delete the task from the Task List too.`,
      `ステップ「${name}」を削除しますか？ このワークフローからのみ外すか、タスクリストからも削除するかを選べます。`,
    ),
  confirmDeleteJobStepDetachOnly: () =>
    t(
      "Remove from workflow only",
      "ワークフローからのみ削除",
      "Nur aus Workflow entfernen",
    ),
  confirmDeleteJobStepDeleteTask: () =>
    t(
      "Delete task everywhere",
      "タスク自体を完全に削除",
      "Task komplett löschen",
    ),
  moveOnlyWorkspaceTasks: () =>
    t(
      "Only workspace-scoped tasks can be moved",
      "移動できるのはワークスペーススコープのタスクのみです",
      "Nur Tasks im Workspace-Scope können verschoben werden",
    ),
  // ==================== Tooltip ====================
  ...buildStaticMessageMap({
    tooltipWorkspaceTarget: schedulerUiMessageEntries.tooltipWorkspaceTarget,
    tooltipNotSet: schedulerUiMessageEntries.tooltipNotSet,
    tooltipAppliesHere: schedulerUiMessageEntries.tooltipAppliesHere,
  }),

  // ==================== Safety / Rate Limiting ====================
  dailyLimitReached: (limit: number) =>
    t(
      `Daily execution limit (${limit}) reached. No more automatic executions today. You can increase this limit in settings.`,
      `1日の実行回数上限（${limit}回）に達しました。本日はこれ以上の自動実行は行われません。設定で上限を変更できます。`,
    ),
  overdueTaskPromptRecurring: (name: string, dueAt: string) =>
    t(
      `Task "${name}" became overdue while VS Code was closed. It was scheduled for ${dueAt}. Run it now or wait for the next cycle?`,
      `タスク「${name}」は VS Code が閉じている間に期限を過ぎました。予定時刻は ${dueAt} です。今すぐ実行するか、次の周期まで待機しますか？`,
    ),
  overdueTaskPromptOneTime: (name: string, dueAt: string) =>
    t(
      `One-time task "${name}" became overdue while VS Code was closed. It was scheduled for ${dueAt}. Run it now or reschedule it?`,
      `一度きりタスク「${name}」は VS Code が閉じている間に期限を過ぎました。予定時刻は ${dueAt} です。今すぐ実行するか、再スケジュールしますか？`,
    ),
  overdueTaskReschedulePrompt: (name: string) =>
    t(
      `How many minutes from now should "${name}" run?`,
      `タスク「${name}」を何分後に実行しますか？`,
    ),
  overdueTaskReschedulePlaceholder: () => t("Minutes from now", "今から何分後"),
  overdueTaskRescheduleValidation: () =>
    t(
      "Enter a whole number of minutes between 1 and 10080",
      "1〜10080 の整数分を入力してください",
    ),
  ...buildStaticMessageMap({ storageWriteTimeout: schedulerUiMessageEntries.storageWriteTimeout }),
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
  ...buildStaticMessageMap({ disclaimerTitle: schedulerUiMessageEntries.disclaimerTitle }),
  disclaimerMessage: () =>
    t(
      "This extension automates Copilot Chat interactions via scheduled prompts. GitHub's Acceptable Use Policies prohibit 'excessive automated bulk activity' and 'scripted interactions' with Copilot. Using this extension may violate GitHub's Terms of Service and could result in your Copilot access being restricted or your account being suspended. Use at your own risk.",
      "この拡張機能は、スケジュールされたプロンプトによりCopilot Chatの操作を自動化します。GitHubの利用規約（Acceptable Use Policies）は「過度な自動化された一括活動」および「スクリプトによるCopilotとのやり取り」を禁止しています。この拡張機能の使用はGitHubの利用規約に違反する可能性があり、Copilotへのアクセス制限やアカウント停止につながる恐れがあります。ご利用は自己責任でお願いします。",
    ),
  ...buildStaticMessageMap({
    disclaimerAccept: schedulerUiMessageEntries.disclaimerAccept,
    disclaimerDecline: schedulerUiMessageEntries.disclaimerDecline,
  }),
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
  return cronPresetSpecs.map((preset) => ({
    id: preset.id,
    name: localize(preset.name),
    expression: preset.expression,
    description: localize(preset.description),
  }));
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
