# Source Scheduler

このファイルは、日本語向けの Todo Cockpit / MCP / Skill まわりの要点をまとめた補足ガイドです。英語の詳細な全体ドキュメントは `README.md` を参照してください。

## Todo (Cockpit) - コミュニケーションハブ

- `Todo Cockpit` タブは、ユーザーと AI エージェントの中心的なコミュニケーションハブです。従来の外部 Todoist 連携の代わりに、リポジトリ内で計画と承認を完結させます。
- Todo は計画と対話のオブジェクトです。スケジュールされた task は実行用の別オブジェクトであり、承認済み Todo から必要に応じて作成されます。
- 既定のセクションは `Unsorted`、`Bugs`、`Features`、`Ops/DevOps`、`Marketing/Growth`、`Automation`、`Future` です。
- コメントは `human-form`、`bot-mcp`、`bot-manual`、`system-event` などの出所情報を保持し、ユーザーと AI の会話ログとして機能します。
- ラベルは複数付与できる共有パレット方式です。フラグは 1 枚のカードにつき 1 つの agent-state を表す単一値です。
- Todo は `active`、`ready`、`completed`、`rejected` の状態を持ちます。`Approve` は `ready`、`Final Accept` は完了アーカイブ、`Delete` は拒否アーカイブとして扱われます。
- `How To` タブの最初の項目は Todo Cockpit になっており、そこから Board / Create / List / Jobs / Research / Settings へ直接移動できるボタンを配置しています。

## MCP 対応状況

- Todo Cockpit は MCP から利用できます。AI はカードの作成、更新、コメント追加、状態遷移、セクション移動、フィルター更新を行えます。
- 利用できる Todo 系ツール: `cockpit_get_board`、`cockpit_list_todos`、`cockpit_get_todo`、`cockpit_create_todo`、`cockpit_add_todo_comment`、`cockpit_update_todo`、`cockpit_delete_todo`、`cockpit_approve_todo`、`cockpit_finalize_todo`、`cockpit_reject_todo`、`cockpit_move_todo`、`cockpit_set_filters`、`cockpit_seed_todos_from_tasks`。
- ラベル設定とフラグ設定も MCP から操作できます: `cockpit_save_label_definition`、`cockpit_delete_label_definition`、`cockpit_save_flag_definition`、`cockpit_delete_flag_definition`。
- Todo Cockpit のデータは `.vscode/scheduler.private.json` のみに保存され、公開用の scheduler ファイルには混ざりません。

## Skill 対応状況

- `.github/skills/cockpit-todo-agent/SKILL.md` は、Todo Cockpit をユーザーと AI の正式な連携ハブとして扱うためのルールを定義します。
- `.github/skills/cockpit-scheduler-agent/SKILL.md` は、task / jobs / research / label / flag など、どの MCP ツールを選ぶべきかを整理します。
- `.github/skills/copilot-scheduler-intro/SKILL.md` は、プラグイン全体を説明する導入ガイドです。
- `.github/skills/copilot-scheduler-setup/SKILL.md` は、既存の agent system や task 管理基盤から Todo Cockpit へ移行する場合の質問と設計フローを含みます。
# ⏰ Copilot Scheduler

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/yamapan.copilot-scheduler?label=VS%20Code%20Marketplace&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=yamapan.copilot-scheduler)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/yamapan.copilot-scheduler?label=Installs&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=yamapan.copilot-scheduler)
[![License CC BY-NC-SA 4.0](https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-lightgrey.svg)](LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-Repository-181717?logo=github)](https://github.com/aktsmm/vscode-copilot-scheduler)
[![GitHub Stars](https://img.shields.io/github/stars/aktsmm/vscode-copilot-scheduler?style=social)](https://github.com/aktsmm/vscode-copilot-scheduler)

VS Code で Cron 式を使って AI プロンプトを自動スケジュール実行

[**📥 VS Code Marketplace からインストール**](https://marketplace.visualstudio.com/items?itemName=yamapan.copilot-scheduler)

[English / 英語版はこちら](README.md)

## 🎬 デモ

![Copilot Scheduler Demo](images/demo-static.png)

## ✨ 機能

🗓️ **Cron スケジューリング** - Cron 式で特定の時刻にプロンプトを実行

🤖 **エージェント & モデル選択** - 組み込みエージェント (@workspace, @terminal) と AI モデル (GPT-4o, Claude Sonnet 4) を選択可能

🌐 **多言語対応** - 英語・日本語 UI を自動検出

📊 **サイドバー TreeView** - サイドバーからすべてのタスクを管理

🖥️ **Webview GUI** - タスクの作成・編集用の使いやすい GUI

📁 **プロンプトテンプレート** - ローカルまたはグローバルのテンプレートファイルを使用

## 🚀 クイックスタート

1. Copilot Scheduler サイドバーを開く（アクティビティバーの時計アイコンをクリック）
2. 「+」ボタンをクリックして新規タスクを作成
3. タスク名、プロンプト、Cron スケジュールを入力
4. スケジュールされた時刻に自動で Copilot にプロンプトが送信されます

## ⏰ Cron 式の例

| 式             | 説明            |
| -------------- | --------------- |
| `0 9 * * 1-5`  | 平日 9:00       |
| `0 18 * * 1-5` | 平日 18:00      |
| `0 9 * * *`    | 毎日 9:00       |
| `0 9 * * 1`    | 毎週月曜日 9:00 |
| `*/30 * * * *` | 30 分ごと       |
| `0 * * * *`    | 1 時間ごと      |

## 📋 コマンド

| コマンド                                           | 説明                         |
| -------------------------------------------------- | ---------------------------- |
| `Copilot Scheduler: Create Scheduled Prompt`       | 新規タスク作成 (CLI)         |
| `Copilot Scheduler: Create Scheduled Prompt (GUI)` | 新規タスク作成 (GUI)         |
| `Copilot Scheduler: List Scheduled Tasks`          | すべてのタスクを表示         |
| `Copilot Scheduler: Edit Task`                     | タスクを編集                 |
| `Copilot Scheduler: Delete Task`                   | タスクを削除                 |
| `Copilot Scheduler: Toggle Task (Enable/Disable)`  | タスクの有効/無効を切り替え  |
| `Copilot Scheduler: Run Now`                       | タスクを即座に実行           |
| `Copilot Scheduler: Copy Prompt to Clipboard`      | プロンプトをクリップボードに |
| `Copilot Scheduler: Enable Task`                   | タスクを有効にする           |
| `Copilot Scheduler: Disable Task`                  | タスクを無効にする           |
| `Copilot Scheduler: Duplicate Task`                | タスクを複製                 |
| `Copilot Scheduler: Move Task to Current Workspace` | タスクを現在のWSへ移動       |
| `Copilot Scheduler: Open Settings`                 | 設定を開く                   |
| `Copilot Scheduler: Show Version`                  | バージョン情報を表示         |

## ⚙️ 設定

| 設定                                      | デフォルト  | 説明                                                                                                  |
| ----------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------- |
| `copilotScheduler.enabled`                | `true`      | スケジュール実行の有効/無効                                                                           |
| `copilotScheduler.showNotifications`      | `true`      | タスク実行時に通知を表示                                                                              |
| `copilotScheduler.notificationMode`       | `sound`     | 通知モード (sound/silentToast/silentStatus)                                                           |
| `copilotScheduler.logLevel`               | `info`      | ログレベル (none/error/info/debug)                                                                    |
| `copilotScheduler.language`               | `auto`      | UI 言語 (auto/en/ja)                                                                                  |
| `copilotScheduler.timezone`               | `""`        | スケジュール用タイムゾーン                                                                            |
| `copilotScheduler.chatSession`            | `new`       | チャットセッション (new/continue)                                                                     |
| `copilotScheduler.defaultScope`           | `workspace` | デフォルトスコープ                                                                                    |
| `copilotScheduler.globalPromptsPath`      | `""`        | グローバルプロンプトフォルダのパス（未指定時: VS Code ユーザープロンプトフォルダ）                    |
| `copilotScheduler.globalAgentsPath`       | `""`        | グローバルエージェントフォルダのパス                                                                  |
| `copilotScheduler.jitterSeconds`          | `600`       | タスク実行前に入れるランダム遅延の最大秒数 (0〜1800、0=無効、タスクごとに上書き可)                    |
| `copilotScheduler.maxDailyExecutions`     | `24`        | 1日のスケジュール実行回数上限（全タスク合計、0=無制限、1〜100）。⚠️ 無制限はAPIレート制限のリスクあり |
| `copilotScheduler.minimumIntervalWarning` | `true`      | 30分未満のcron間隔を設定するときに警告表示                                                            |

## 📝 プロンプトプレースホルダー

プロンプトで使用できるプレースホルダー:

| プレースホルダー | 説明             |
| ---------------- | ---------------- |
| `{{date}}`       | 現在の日付       |
| `{{time}}`       | 現在の時刻       |
| `{{datetime}}`   | 現在の日時       |
| `{{workspace}}`  | ワークスペース名 |
| `{{file}}`       | 現在のファイル名 |
| `{{filepath}}`   | ファイルパス     |

## 📂 タスクスコープ

- **グローバル**: すべてのワークスペースでタスクを実行
- **ワークスペース**: 作成したワークスペースでのみ実行

## 📄 プロンプトテンプレート

再利用可能なプロンプトテンプレート:

- **ローカル**: ワークスペース内の `.github/prompts/*.md`
- **グローバル**: VS Code ユーザープロンプトフォルダ（または `copilotScheduler.globalPromptsPath` で指定したフォルダ）

## 📋 要件

- VS Code 1.80.0 以上
- GitHub Copilot 拡張機能

## ⚠️ 既知の問題

- Copilot Chat API は開発中のため、API の安定化に伴い更新が必要になる場合があります
- 一部の構成ではモデル選択が機能しない場合があります

**免責:** この拡張機能は Copilot Chat を自動操作します。GitHub の [Acceptable Use Policies](https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies#4-spam-and-inauthentic-activity-on-github) は「過度な自動化された一括活動」を、[利用規約 セクション H (API Terms)](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service#h-api-terms) は API の過剰利用によるアカウント停止を明記しています。また [GitHub Copilot の追加製品規約](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features#github-copilot) により、これらの規約は Copilot にも直接適用されます。リスクを理解した上でご利用ください。ジッターや1日上限、長めの間隔はリスク低減になりますが、アカウント制限を防ぐ保証はありません。

※ 自動化ツールを使っていなくても Copilot アクセスが制限された[事例](https://github.com/orgs/community/discussions/160013)があります。本拡張の緩和策はリスクを下げるだけで、リスクをゼロにはできません。

🐛 [バグを報告](https://github.com/aktsmm/vscode-copilot-scheduler/issues)

## 📄 ライセンス

[CC-BY-NC-SA-4.0](LICENSE) © [aktsmm](https://github.com/aktsmm)

---

**Copilot プロンプトのスケジュール実行をお楽しみください！** 🚀
