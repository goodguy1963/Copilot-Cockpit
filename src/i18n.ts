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
  actionOpenScheduler: () => t("Open Scheduler", "Scheduler を開く"),
  actionReschedule: () => t("Reschedule", "再スケジュール"),
  actionWaitNextCycle: () => t("Wait for Next Cycle", "次の周期まで待機"),
  actionCopyPrompt: () => t("Copy Prompt", "プロンプトをコピー"),
  actionTestRun: () => t("Test Run", "テスト実行"),
  actionSave: () => t("Update", "更新"),
  actionCreate: () => t("Create", "作成"),
  actionNewTask: () => t("New Task", "新規タスク"),
  actionRefresh: () => t("Refresh", "再読込"),
  actionRestoreBackup: () => t("Restore Backup", "バックアップを復元"),
  actionInsertSkill: () => t("Insert Skill", "スキルを挿入"),

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
  placeholderSelectSkill: () => t("Select skill", "スキルを選択"),

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
  scheduleHistoryLabel: () => t("Backup History", "バックアップ履歴"),
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
  tabHowTo: () => t("How To Use", "使い方"),

  helpIntroTitle: () => t("How This Fork Works", "このフォークの動作"),
  helpIntroBody: () =>
    t(
      "This local fork keeps repo schedules inside each repo's .vscode folder, runs the scheduler inside VS Code, and adds repo-specific startup behavior, Jobs workflows built in columns of chained tasks, pause checkpoints, compile/Bundled Jobs flow, and bounded Research runs.",
      "このローカルフォークは、各リポジトリの .vscode フォルダーにスケジュールを保存し、Scheduler を VS Code 内で動作させ、リポジトリ単位の起動時動作に加えて、列状に連鎖した Jobs ワークフロー、停止チェックポイント、コンパイル/Bundled Jobs 機能、制限付きの Research 実行を追加しています。",
    ),
  helpCreateTitle: () => t("1. Create Tasks", "1. タスクを作成"),
  helpCreateItemName: () =>
    t(
      "Use the Create tab to set the task name, prompt, cron schedule, scope, and optional agent/model.",
      "Create タブでタスク名、プロンプト、cron スケジュール、スコープ、必要ならエージェントとモデルを設定します。",
    ),
  helpCreateItemTemplates: () =>
    t(
      "Prompt sources can be inline text, local templates from .github/prompts, or global templates from your VS Code prompts folder.",
      "プロンプトソースは自由入力、.github/prompts のローカルテンプレート、または VS Code の prompts フォルダーにあるグローバルテンプレートを使えます。",
    ),
  helpCreateItemSkills: () =>
    t(
      "Use the skill picker to insert a fixed skill instruction sentence into the prompt with one click.",
      "スキルピッカーを使うと、固定のスキル指示文をワンクリックでプロンプトへ挿入できます。",
    ),
  helpCreateItemAgentModel: () =>
    t(
      "Task-specific agent and model selections now run in a dedicated chat context when needed so they do not silently reuse the currently active setup.",
      "タスクごとのエージェント/モデル指定は、必要に応じて専用のチャットコンテキストで実行されるため、現在アクティブな設定を黙って再利用しません。",
    ),
  helpCreateItemRunFirst: () =>
    t(
      "Run-first starts the first execution after 3 minutes; one-time tasks delete themselves after a successful run.",
      "初回実行を有効にすると3分後に最初の実行を行い、一度きりタスクは成功後に自動削除されます。",
    ),
  helpListTitle: () => t("2. Manage Tasks", "2. タスクを管理"),
  helpListItemSections: () =>
    t(
      "The Task List keeps recurring and one-time tasks in separate sections and shows a live countdown to the next run.",
      "Task List では繰り返しタスクと一度きりタスクを別セクションで表示し、次回実行までのライブカウントダウンも表示します。",
    ),
  helpListItemActions: () =>
    t(
      "Tasks can be run immediately, edited, duplicated, copied, enabled, disabled, deleted, or moved to the current workspace.",
      "タスクは即時実行、編集、複製、コピー、有効化、無効化、削除、現在のワークスペースへの移動ができます。",
    ),
  helpListItemStartup: () =>
    t(
      "Use the Task List toolbar to refresh data and toggle repo-scoped auto-open on startup without leaving the UI.",
      "Task List のツールバーから、UI を離れずに再読込やリポジトリ単位の起動時自動表示の切り替えができます。",
    ),
  helpJobsTitle: () => t("3. Jobs Board", "3. JOBS ボード"),
  helpJobsItemBoard: () =>
    t(
      "Use the Jobs tab to build workflows in columns of chained tasks with folders, step windows, and drag-drop reordering.",
      "Jobs タブでは、フォルダー・ステップ時間枠・ドラッグ&ドロップ並び替え付きで、列状に連鎖したワークフローを作成できます。",
    ),
  helpJobsItemPause: () =>
    t(
      "Dedicated pause checkpoints block all downstream steps until you approve the previous result; rejecting the pause opens the previous task in the editor.",
      "専用の停止チェックポイントは、前の結果を承認するまで後続ステップをすべて止めます。却下すると、直前のタスクがエディターで開きます。",
    ),
  helpJobsItemCompile: () =>
    t(
      "Use Compile To Task to merge the whole job into one combined prompt task, then move the source job into the Bundled Jobs folder in an inactive state.",
      "Compile To Task を使うと、ジョブ全体を1つの結合プロンプトタスクへまとめたうえで、元のジョブを Bundled Jobs フォルダーへ非アクティブ状態で移動できます。",
    ),
  helpJobsItemLabels: () =>
    t(
      "Job names become effective task labels, so you can filter the Task List by workflow and still add your own manual labels.",
      "ジョブ名は実効タスクラベルとして扱われるため、Task List をワークフロー単位で絞り込みつつ、手動ラベルも追加できます。",
    ),
  helpJobsItemFolders: () =>
    t(
      "You can drag jobs into folders, drag them back to All jobs, and use the current-folder banner to see exactly where the board is filtered.",
      "ジョブはフォルダーへドラッグして移動でき、All jobs に戻すこともできます。現在どのフォルダーで絞り込まれているかは、上部の現在フォルダーバナーで確認できます。",
    ),
  helpJobsItemDelete: () =>
    t(
      "Deleting a step from Jobs now asks for confirmation and also removes that task from the Task List.",
      "Jobs からステップを削除するときは確認が入り、そのタスクは Task List からも削除されます。",
    ),
  helpResearchTitle: () => t("4. Research Tab", "4. Research タブ"),
  helpResearchItemProfiles: () =>
    t(
      "Use the Research tab to save repo-local benchmark profiles with instructions, editable paths, benchmark command, metric regex, and agent/model choices.",
      "Research タブでは、指示文、編集可能パス、ベンチマークコマンド、指標用正規表現、エージェント/モデル指定を含むリポジトリ単位のベンチマークプロファイルを保存できます。",
    ),
  helpResearchItemBounds: () =>
    t(
      "Runs are bounded by max iterations, max minutes, benchmark timeout, edit wait time, and consecutive failure limits.",
      "実行は、最大反復回数、最大分数、ベンチマークタイムアウト、編集待機時間、連続失敗上限で制限されます。",
    ),
  helpResearchItemHistory: () =>
    t(
      "Recent runs show attempts, scores, changed files, outcomes, and benchmark output so you can inspect what happened before keeping a result.",
      "最近の実行には、試行、スコア、変更ファイル、結果、ベンチマーク出力が表示されるため、結果を採用する前に内容を確認できます。",
    ),
  helpStorageTitle: () => t("5. Where Data Lives", "5. データ保存場所"),
  helpStorageItemRepo: () =>
    t(
      "Workspace tasks are stored in .vscode/scheduler.json and .vscode/scheduler.private.json inside the repo that is open in VS Code.",
      "ワークスペースタスクは、VS Code で開いているリポジトリ内の .vscode/scheduler.json と .vscode/scheduler.private.json に保存されます。",
    ),
  helpStorageItemIsolation: () =>
    t(
      "Nested repos do not inherit schedules from the parent folder anymore; each repo keeps its own schedule.",
      "ネストされたリポジトリは親フォルダーのスケジュールを継承しません。各リポジトリが独自のスケジュールを持ちます。",
    ),
  helpStorageItemGlobal: () =>
    t(
      "Global tasks still exist in extension storage, but repo schedules are authoritative in the repo's .vscode files.",
      "グローバルタスクは拡張ストレージにも存在しますが、リポジトリのスケジュールはそのリポジトリ内の .vscode ファイルが正本です。",
    ),
  helpOverdueTitle: () => t("6. Overdue Tasks", "6. 期限超過タスク"),
  helpOverdueItemReview: () =>
    t(
      "If VS Code was closed and tasks became overdue, the extension reviews them one by one on startup instead of auto-running them silently.",
      "VS Code を閉じている間にタスクが期限超過になると、自動で黙って実行せず、起動時に1件ずつ確認します。",
    ),
  helpOverdueItemRecurring: () =>
    t(
      "Recurring overdue tasks can run now or wait for the next cycle.",
      "繰り返しの期限超過タスクは、今すぐ実行するか次の周期まで待機できます。",
    ),
  helpOverdueItemOneTime: () =>
    t(
      "One-time overdue tasks can run now or be rescheduled by entering how many minutes from now they should run.",
      "一度きりの期限超過タスクは、今すぐ実行するか、何分後に実行するかを入力して再スケジュールできます。",
    ),
  helpSessionTitle: () => t("7. Session Behavior", "7. セッション動作"),
  helpSessionItemPerTask: () =>
    t(
      "Recurring tasks can override the global chatSession setting directly in the Create/Edit form.",
      "繰り返しタスクは Create/Edit フォームでグローバル chatSession 設定を上書きできます。",
    ),
  helpSessionItemNewChat: () =>
    t(
      "Scheduled runs can be configured to start a brand-new Copilot chat session before sending the prompt.",
      "スケジュール実行では、プロンプト送信前に新しい Copilot チャットセッションを開始する設定が使えます。",
    ),
  helpSessionItemCareful: () =>
    t(
      "Use the new-session mode with extreme care. One scheduled AI run can intentionally open another AI session and continue from there.",
      "新規セッションモードは最大限の注意を払って使ってください。1つの AI 実行が、意図的に別の AI セッションを開いて続行できます。",
    ),
  helpSessionItemSeparate: () =>
    t(
      "MCP is a different launch path, but it can still trigger new sessions indirectly. Once the scheduler MCP tools are exposed, a model can create, modify, or run tasks that use new-session mode, so one LLM can open another.",
      "MCP は別の起動経路ですが、間接的に新規セッションを起動できます。scheduler MCP ツールが公開されると、モデルは new-session モードのタスクを作成・変更・実行できるため、1つの LLM が別の LLM を開けます。",
    ),
  helpMcpItemEmbedded: () =>
    t(
      "Yes, MCP is built into this fork. The scheduler MCP server is implemented in server.ts and packaged as out/server.js.",
      "はい。このフォークには MCP が組み込まれています。Scheduler MCP サーバーは server.ts に実装され、out/server.js としてパッケージされます。",
    ),
  helpMcpItemConfig: () =>
    t(
      "Installing the extension does not register scheduler MCP tools globally. A workspace still needs an MCP launcher entry such as .vscode/mcp.json.",
      "拡張機能をインストールしても scheduler MCP ツールがグローバル登録されるわけではありません。ワークスペースには .vscode/mcp.json などの MCP ランチャー設定が必要です。",
    ),
  helpMcpItemAutoConfig: () =>
    t(
      "Use the setup button to create or merge the scheduler server entry into .vscode/mcp.json for this repo.",
      "セットアップボタンを使うと、このリポジトリ用の scheduler サーバー設定を .vscode/mcp.json に作成またはマージできます。",
    ),
  helpMcpItemDanger: () =>
    t(
      "Treat MCP exposure as high risk. Once Copilot can see these tools, it can inspect scheduler state, change tasks, and trigger runs that may open more AI sessions.",
      "MCP 公開は高リスクとして扱ってください。Copilot がこれらのツールを見える状態になると、scheduler 状態の確認、タスク変更、さらに別の AI セッションを開く可能性がある実行のトリガーまで行えます。",
    ),
  helpMcpItemInspect: () =>
    t(
      "scheduler_list_tasks and scheduler_get_task inspect the current scheduler state and a single saved task.",
      "scheduler_list_tasks と scheduler_get_task は、現在の scheduler 状態と単一タスクの内容を確認します。",
    ),
  helpMcpItemWrite: () =>
    t(
      "scheduler_add_task, scheduler_update_task, scheduler_duplicate_task, scheduler_remove_task, and scheduler_toggle_task create or change saved tasks.",
      "scheduler_add_task、scheduler_update_task、scheduler_duplicate_task、scheduler_remove_task、scheduler_toggle_task は、保存済みタスクの作成や変更を行います。",
    ),
  helpMcpItemTools: () =>
    t(
      "scheduler_run_task triggers a task, while scheduler_list_history, scheduler_restore_snapshot, and scheduler_get_overdue_tasks inspect recovery state and due work.",
      "scheduler_run_task はタスクを起動し、scheduler_list_history、scheduler_restore_snapshot、scheduler_get_overdue_tasks は復旧履歴や期限超過状態を確認します。",
    ),
  helpMcpTitle: () => t("8. MCP Support", "8. MCP 対応"),
  helpTipsTitle: () => t("9. Recommended Workflow", "9. 推奨ワークフロー"),
  helpTipsItem1: () =>
    t(
      "Enable auto-open only for repos where you want the scheduler UI every time the repo opens.",
      "起動時に毎回 Scheduler UI を出したいリポジトリだけ、自動表示を有効にしてください。",
    ),
  helpTipsItem2: () =>
    t(
      "Keep recurring tasks at reasonable intervals and use jitter plus daily limits to reduce automation risk.",
      "繰り返しタスクは無理のない間隔にし、ジッターと1日上限を使って自動化リスクを下げてください。",
    ),
  helpTipsItem3: () =>
    t(
      "Use the restore dropdown to roll back repo-local schedule changes, and use the README for the full setup details.",
      "復元ドロップダウンでリポジトリ単位のスケジュール変更を巻き戻し、詳細なセットアップは README を参照してください。",
    ),

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
  labelChatSession: () =>
    t("Recurring chat session", "繰り返しタスクのチャットセッション"),
  labelChatSessionNew: () =>
    t("Start a new chat every run", "毎回新しいチャットを開始"),
  labelChatSessionContinue: () =>
    t("Continue the active chat", "現在のチャットを継続"),
  labelChatSessionBadgeNew: () =>
    t("Chat: New", "チャット: 新規"),
  labelChatSessionBadgeContinue: () =>
    t("Chat: Continue", "チャット: 継続"),
  labelChatSessionRecurringOnly: () =>
    t(
      "Recurring tasks only. One-time tasks do not store a task-level chat session mode.",
      "繰り返しタスク専用です。一度きりタスクにはタスク単位のチャットセッション設定は保存されません。",
    ),
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
  labelSkills: () => t("Skills", "スキル"),
  skillInsertNote: () =>
    t(
      "Insert a skill reference sentence into the prompt with one click. This switches the prompt to inline mode so the inserted instruction is preserved.",
      "ワンクリックでスキル参照文をプロンプトへ挿入します。挿入した指示が保持されるよう、プロンプトは inline モードへ切り替わります。",
    ),
  skillSentenceTemplate: (skill: string) =>
    t(
      `Use ${skill} to know how things must be done.`,
      `${skill} を使って、どのように進めるべきかを理解してください。`,
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
  jobCreateTitle: () => t("New Job", "新規ジョブ"),
  jobNamePrompt: () => t("Enter job name", "ジョブ名を入力してください"),
  jobScheduleTitle: () => t("Job schedule", "ジョブのスケジュール"),
  jobSchedulePrompt: () =>
    t(
      "Enter a cron expression for this job",
      "このジョブの cron 式を入力してください",
    ),
  jobFolderCreateTitle: () => t("New Folder", "新規フォルダー"),
  jobFolderRenameTitle: () => t("Rename Folder", "フォルダー名の変更"),
  jobFolderNamePrompt: () =>
    t("Enter folder name", "フォルダー名を入力してください"),
  jobsPauseTitle: () => t("Pause checkpoints", "停止チェックポイント"),
  jobsPauseName: () => t("Pause title", "停止タイトル"),
  jobsPauseDefaultTitle: () => t("Manual review", "手動確認"),
  confirmDeleteJobFolder: (name: string) =>
    t(
      `Delete folder "${name}"? Jobs and subfolders inside it will move to the parent folder.`,
      `フォルダー「${name}」を削除しますか？ 中のジョブとサブフォルダーは親フォルダーへ移動します。`,
    ),
  confirmDeleteJobStep: (name: string) =>
    t(
      `Delete step "${name}"? This also deletes the task from the Task List.`,
      `ステップ「${name}」を削除しますか？ この操作はタスクリストからも削除します。`,
    ),
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
