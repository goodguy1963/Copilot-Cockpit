/**
 * Copilot Cockpit - Internationalization (i18n)
 */

import * as vscode from "vscode";
import type { CronPreset } from "./types";
import { getCompatibleConfigurationValue } from "./extensionCompat";

/**
 * Check if the current language is Japanese
 */
export function isJapanese(): boolean {
  const lang = getCompatibleConfigurationValue<string>("language", "auto");

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
  actionOpenScheduler: () => t("Open Cockpit", "Cockpit を開く"),
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

  helpIntroTitle: () => t("Schedule Copilot prompts to run automatically", "Copilot プロンプトを自動実行するスケジューラ"),
  helpIntroBody: () =>
    t(
      "Write a prompt, set a cron schedule, and this extension sends it to Copilot on time — every time. Schedules are stored per repo in .vscode so teams can share them via git. Chain tasks into Jobs for multi-step workflows, add pause checkpoints for human review, or run bounded Research loops that stop themselves automatically.",
      "プロンプトを書いてcronスケジュールを設定すれば、この拡張機能が毎回定刻にCopilotへ送信します。スケジュールはリポジトリごとに.vscodeへ保存されるため、gitで共有できます。Jobsでタスクを連結したり、レビュー用の一時停止チェックポイントを追加したり、自動終了するResearchループを実行できます。",
    ),
  helpCreateTitle: () => t("1. Create a Task", "1. タスクを作成"),
  helpCreateItemName: () =>
    t(
      "Open the Create Task tab. Enter a name, write your prompt, set a cron schedule (or use the friendly schedule builder), and choose a scope.",
      "Create Task タブを開き、名前・プロンプト・cronスケジュール（またはフレンドリービルダー）・スコープを設定します。",
    ),
  helpCreateItemTemplates: () =>
    t(
      "For the prompt, choose Free Input to type directly, Local Template to load a file from .github/prompts/, or Global Template from your VS Code prompts folder.",
      "プロンプトは、直接入力のFree Input、.github/prompts/からのLocal Template、VS CodeプロンプトフォルダーのGlobal Templateから選べます。",
    ),
  helpCreateItemSkills: () =>
    t(
      "Click Insert Skill to append a skill instruction to the prompt. Skills are .md files in .github/skills/ — they are only available when that repo is open, and they are not used automatically just by being present.",
      "Insert Skillをクリックすると、スキル指示文をプロンプトへ追加できます。スキルは.github/skills/内の.mdファイルで、そのリポジトリが開いているときのみ有効です。ファイルがあるだけでは自動適用されません。",
    ),
  helpCreateItemAgentModel: () =>
    t(
      "Leave agent and model blank to use your current VS Code defaults. Set them explicitly on a task to lock a specific agent and model for that task only.",
      "エージェントとモデルは空白のままにするとVS Codeのデフォルトが使われます。タスクごとに明示的に指定すると、そのタスク専用に固定できます。",
    ),
  helpCreateItemRunFirst: () =>
    t(
      "Check Run First to fire the task 3 minutes after saving. Check One-Time to delete the task automatically after it runs once successfully.",
      "Run Firstにチェックすると保存から3分後に初回実行します。One-Timeにチェックすると1回成功後にタスクを自動削除します。",
    ),
  helpListTitle: () => t("2. Manage Your Tasks", "2. タスクを管理"),
  helpListItemSections: () =>
    t(
      "The Task List shows recurring tasks and one-time tasks in separate sections, with a live countdown to the next scheduled run.",
      "Task Listでは繰り返しタスクと一度きりタスクを別セクションで表示し、次回実行までのカウントダウンも表示します。",
    ),
  helpListItemActions: () =>
    t(
      "Click a task's action buttons to run it now, open it in the editor, duplicate it, enable or disable it, or delete it. You can also move a task to another open workspace.",
      "タスクのアクションボタンから、即時実行・エディターで開く・複製・有効化/無効化・削除ができます。別のワークスペースへの移動も可能です。",
    ),
  helpListItemStartup: () =>
    t(
      "Use the toolbar to refresh the list or toggle whether the Scheduler opens automatically whenever this repo opens in VS Code.",
      "ツールバーからリストの更新や、このリポジトリを開いたときにSchedulerを自動表示するかの切り替えができます。",
    ),
  helpJobsTitle: () => t("3. Chain Tasks with Jobs", "3. Jobsでタスクを連結"),
  helpJobsItemBoard: () =>
    t(
      "Open the Jobs tab to build multi-step workflows. Add tasks as steps, drag to reorder them, and organize workflows into folders.",
      "Jobs タブでマルチステップのワークフローを作成します。タスクをステップとして追加し、ドラッグで並べ替え、フォルダーで整理できます。",
    ),
  helpJobsItemPause: () =>
    t(
      "Add a Pause Checkpoint between steps to stop the workflow and wait for your approval before continuing. Reject to reopen the previous task in the editor for fixes.",
      "ステップ間にPause Checkpointを追加すると、次のステップへ進む前に承認を待ちます。却下すると直前のタスクがエディターで開きます。",
    ),
  helpJobsItemCompile: () =>
    t(
      "Use Compile To Task to collapse the entire Job into a single combined prompt task. The original Job moves to a Bundled Jobs folder and becomes inactive.",
      "Compile To Taskを使うとJob全体を1つのプロンプトタスクにまとめます。元のJobはBundled Jobsフォルダーへ移動し非アクティブになります。",
    ),
  helpJobsItemLabels: () =>
    t(
      "A Job's name becomes a label on all its steps. Filter the Task List by that label to see only the tasks that belong to that workflow.",
      "Job名はすべてのステップのラベルになります。Task ListでそのラベルをフィルターするとそのJobのタスクだけを表示できます。",
    ),
  helpJobsItemFolders: () =>
    t(
      "Drag jobs into folders to organize them. The banner at the top shows which folder you are currently viewing.",
      "ジョブをフォルダーへドラッグして整理できます。上部のバナーで現在どのフォルダーを表示しているか確認できます。",
    ),
  helpJobsItemDelete: () =>
    t(
      "Deleting a step from a Job also removes that task from the Task List. A confirmation prompt appears first.",
      "JobからステップをDeleteするとTask Listからも削除されます。実行前に確認が表示されます。",
    ),
  helpResearchTitle: () => t("4. Run Bounded Research", "4. 制限付きResearchを実行"),
  helpResearchItemProfiles: () =>
    t(
      "Go to the Research tab and create a profile. Set your instructions, the file paths the agent may edit, a benchmark command, a metric pattern, and your agent/model choice.",
      "Researchタブでプロファイルを作成します。指示文・編集可能なファイルパス・ベンチマークコマンド・指標パターン・エージェント/モデルを設定します。",
    ),
  helpResearchItemBounds: () =>
    t(
      "Set hard limits on how long a run can go: maximum iterations, maximum minutes, benchmark timeout, edit wait time, and consecutive failure limit.",
      "実行の上限を設定します：最大反復回数・最大分数・ベンチマークタイムアウト・編集待機時間・連続失敗上限。",
    ),
  helpResearchItemHistory: () =>
    t(
      "After a run, check the history to review attempts, scores, which files changed, and the benchmark output — before deciding whether to keep the result.",
      "実行後はHistoryを確認して、試行・スコア・変更ファイル・ベンチマーク出力を検証してから結果を採用するか判断できます。",
    ),
  helpStorageTitle: () => t("5. Where Files Are Saved", "5. ファイルの保存場所"),
  helpStorageItemRepo: () =>
    t(
      "Tasks are saved in .vscode/scheduler.json inside the open repo. Todo Cockpit items go to .vscode/scheduler.private.json and are never synced via git.",
      "タスクは開いているリポジトリの.vscode/scheduler.jsonに保存されます。Todo Cockpitは.vscode/scheduler.private.jsonに保存され、gitで同期されません。",
    ),
  helpStorageItemBackups: () =>
    t(
      "Inline prompts are backed up to .vscode/scheduler-prompt-backups/ as Markdown files. Full snapshots of the scheduler state go to .vscode/scheduler-history/.",
      "インラインプロンプトは.vscode/scheduler-prompt-backups/にMarkdownとしてバックアップされます。スケジューラ全体のスナップショットは.vscode/scheduler-history/に保存されます。",
    ),
  helpStorageItemIsolation: () =>
    t(
      "Each repo keeps its own schedule. Opening a parent folder does not pull in schedules from nested repos inside it.",
      "各リポジトリは独自のスケジュールを持ちます。親フォルダーを開いても、内部のネストされたリポジトリのスケジュールは読み込まれません。",
    ),
  helpStorageItemGlobal: () =>
    t(
      "Global tasks are kept in extension storage as a fallback, but the .vscode files in the open repo always take priority.",
      "グローバルタスクは拡張ストレージにフォールバックとして保存されますが、開いているリポジトリの.vscodeファイルが常に優先されます。",
    ),
  helpOverdueTitle: () => t("6. Handling Overdue Tasks", "6. 期限超過タスクの処理"),
  helpOverdueItemReview: () =>
    t(
      "If VS Code was closed while tasks were scheduled, they won't run automatically on restart. Instead, you'll be asked what to do with each overdue task one at a time.",
      "VS Codeを閉じている間にスケジュールされたタスクは、再起動時に自動実行されません。代わりに、期限超過のタスクを1件ずつ確認するプロンプトが表示されます。",
    ),
  helpOverdueItemRecurring: () =>
    t(
      "For overdue recurring tasks: choose to run now or skip to the next scheduled cycle.",
      "繰り返しの期限超過タスク：今すぐ実行するか、次のcyclまで待機するかを選べます。",
    ),
  helpOverdueItemOneTime: () =>
    t(
      "For overdue one-time tasks: choose to run now or enter a number of minutes from now to reschedule it.",
      "一度きりの期限超過タスク：今すぐ実行するか、何分後に実行するかを入力して再スケジュールできます。",
    ),
  helpSessionTitle: () => t("7. Chat Session Options", "7. チャットセッション設定"),
  helpSessionItemPerTask: () =>
    t(
      "Each recurring task can override the global new-session setting. Find the option in the Create/Edit Task form.",
      "繰り返しタスクはCreate/Edit Taskフォームでグローバルのnew-session設定を上書きできます。",
    ),
  helpSessionItemNewChat: () =>
    t(
      "Enable New Chat Session on a task to start a fresh Copilot chat before each run, rather than continuing in the same conversation.",
      "タスクのNew Chat Sessionを有効にすると、毎回の実行前に新しいCopilotチャットを開きます（同じ会話を続けません）。",
    ),
  helpSessionItemCareful: () =>
    t(
      "Use this carefully: a scheduled run in new-session mode can deliberately open another AI session and chain into it.",
      "注意して使用してください：new-sessionモードのスケジュール実行は意図的に別のAIセッションを開いて連鎖できます。",
    ),
  helpSessionItemSeparate: () =>
    t(
      "If scheduler MCP tools are enabled, an AI model can create or trigger tasks that open new sessions — meaning one LLM can chain into another.",
      "scheduler MCPツールが有効な場合、AIモデルが新規セッションを開くタスクを作成・実行できます。つまり1つのLLMが別のLLMを連鎖起動できます。",
    ),
  helpMcpItemEmbedded: () =>
    t(
      "MCP is built in. The scheduler's MCP server starts alongside the extension — no separate install needed.",
      "MCPは組み込みです。SchedulerのMCPサーバーは拡張機能と一緒に起動します。別途インストールは不要です。",
    ),
  helpMcpItemConfig: () =>
    t(
      "MCP tools are not active by default. Add a launcher entry (e.g. .vscode/mcp.json) to register the scheduler server in this workspace.",
      "MCPツールはデフォルトで有効になっていません。.vscode/mcp.jsonなどのランチャー設定を追加してこのワークスペースに登録します。",
    ),
  helpMcpItemAutoConfig: () =>
    t(
      "Click the Setup MCP button below to automatically create or update .vscode/mcp.json for this repo.",
      "下のSetup MCPボタンをクリックすると、このリポジトリの.vscode/mcp.jsonを自動的に作成または更新します。",
    ),
  helpMcpItemDanger: () =>
    t(
      "Warning: once Copilot can see these MCP tools, it can read your schedule, modify tasks, and trigger runs — including ones that open new AI sessions. Only enable this if you understand the risk.",
      "警告：CopilotがこれらのMCPツールを参照できると、スケジュールの読み取り・タスクの変更・実行のトリガー（新しいAIセッションを開くものも含む）が可能になります。リスクを理解した上で有効にしてください。",
    ),
  helpMcpItemInspect: () =>
    t(
      "Read tools: list all tasks, fetch a single task's details, get overdue tasks, and view run history.",
      "読み取りツール：全タスクの一覧・単一タスクの詳細取得・期限超過タスクの確認・実行履歴の表示。",
    ),
  helpMcpItemWrite: () =>
    t(
      "Write tools: add, update, duplicate, remove, or toggle tasks. Job tools create and edit workflows and their steps.",
      "書き込みツール：タスクの追加・更新・複製・削除・切り替え。JobツールはワークフローとそのステップをCRUD操作します。",
    ),
  helpMcpItemTools: () =>
    t(
      "Action tools: run a task immediately, restore a scheduler snapshot, manage pause checkpoints in Jobs, and start or review Research profile runs.",
      "アクションツール：タスクの即時実行・スナップショット復元・Jobsの一時停止チェックポイント管理・Researchプロファイル実行の開始と確認。",
    ),
  helpMcpTitle: () => t("8. MCP Integration", "8. MCPインテグレーション"),
  helpTipsTitle: () => t("9. Tips", "9. ヒント"),
  helpTipsItem1: () =>
    t(
      "Enable auto-open only for repos where you want the Scheduler panel to appear every time the repo opens in VS Code.",
      "VS Codeでリポジトリを開くたびにSchedulerパネルを表示したいリポジトリにだけ自動表示を有効にしてください。",
    ),
  helpTipsItem2: () =>
    t(
      "Set reasonable cron intervals. Use jitter and daily run limits to avoid burning through your AI quota with runaway automation.",
      "無理のないcron間隔を設定し、ジッターと1日の実行上限を使って自動化のリスクとAIクォータの消費を抑えてください。",
    ),
  helpTipsItem3: () =>
    t(
      "Use the restore dropdown to roll back schedule changes. Skills in .github/skills/ must be inserted into the prompt manually — they are not applied automatically. The Settings tab stores the default agent and model used when a task leaves those fields blank.",
      "復元ドロップダウンでスケジュール変更を巻き戻せます。.github/skills/のスキルは手動でプロンプトへ挿入する必要があり、自動適用されません。Settingsタブには、タスクでエージェント/モデルが未指定のときに使うデフォルト値を保存できます。",
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
      "Model selection is a preview feature and may not apply in all environments. The dropdown labels show the API source, such as Copilot or OpenRouter. If needed, pick the model directly in the Copilot Chat panel.",
      "モデルの選択はプレビュー機能で、環境によって反映されない場合があります。ドロップダウンのラベルには Copilot や OpenRouter などの API ソースが表示されます。必要に応じて Copilot Chat パネルでも確認してください。",
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
