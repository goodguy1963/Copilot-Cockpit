import * as vscode from "vscode";
import * as path from "path";
import { messages, formatCronForDisplay } from "./i18n";
import { getCockpitCommandId } from "./extensionCompat";
import { ScheduleManager } from "./scheduleManager";
import type { ScheduledTask, TaskScope, TreeContextValue } from "./types";

type TaskBuckets = {
  currentWorkspace: ScheduledTask[];
  otherWorkspaces: ScheduledTask[];
};
type WorkspaceTaskGroup = "this" | "other";
type TreeRefreshTarget = WorkspaceTreeNode | undefined | null | void;

const WORKSPACE_SCOPE_ICON = new vscode.ThemeIcon("folder");
const GLOBAL_SCOPE_ICON = new vscode.ThemeIcon("globe");
const LINKED_WORKSPACE_ICON = new vscode.ThemeIcon("link");
const CURRENT_WORKSPACE_ICON = new vscode.ThemeIcon("home");
const ENABLED_TASK_ICON = new vscode.ThemeIcon(
  "clock",
  new vscode.ThemeColor("charts.green"),
);
const DISABLED_TASK_ICON = new vscode.ThemeIcon(
  "circle-slash",
  new vscode.ThemeColor("disabledForeground"),
);

function countLabel(count: number): string {
  return `(${count})`;
}

function scopeHeading(scope: TaskScope): string {
  return scope === "global"
    ? messages.treeGroupGlobal()
    : messages.treeGroupWorkspace();
}

function workspaceHeading(group: WorkspaceTaskGroup): string {
  return group === "this"
    ? messages.treeGroupThisWorkspace()
    : messages.treeGroupOtherWorkspace();
}

function sortTasksByName(tasks: readonly ScheduledTask[]): ScheduledTask[] {
  return [...tasks].sort((left, right) => left.name.localeCompare(right.name));
}

function collapseToSingleLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function appendValueBlock(markdown: vscode.MarkdownString, value: string): void {
  if (value.includes("```")) {
    markdown.appendText(value);
    return;
  }

  markdown.appendCodeblock(value);
}

function createTaskDescription(
  task: ScheduledTask,
  appliesToCurrentWorkspace: boolean,
): string {
  const scheduleLabel = formatCronForDisplay(task.cronExpression);
  const nextRunLabel = task.nextRun && task.enabled
    ? `${scheduleLabel} → ${messages.formatDateTime(task.nextRun)}`
    : scheduleLabel;

  if (task.scope !== "workspace" || appliesToCurrentWorkspace) {
    return nextRunLabel;
  }

  const workspaceName = task.workspacePath
    ? path.basename(task.workspacePath)
    : messages.labelOtherWorkspaceShort();
  return `${nextRunLabel} • ${workspaceName}`;
}

function getTaskContextValue(
  task: ScheduledTask,
  appliesToCurrentWorkspace: boolean,
): TreeContextValue {
  if (task.scope !== "workspace") {
    return task.enabled ? "enabledTask" : "disabledTask";
  }

  if (appliesToCurrentWorkspace) {
    return task.enabled ? "enabledWorkspaceTask" : "disabledWorkspaceTask";
  }

  return task.enabled
    ? "enabledOtherWorkspaceTask"
    : "disabledOtherWorkspaceTask";
}

function getTaskIcon(task: ScheduledTask): vscode.ThemeIcon {
  return task.enabled ? ENABLED_TASK_ICON : DISABLED_TASK_ICON;
}

function createTaskTooltip(
  task: ScheduledTask,
  appliesToCurrentWorkspace: boolean,
): vscode.MarkdownString {
  const markdown = new vscode.MarkdownString();
  markdown.isTrusted = false;

  markdown.appendMarkdown("### ");
  markdown.appendText(collapseToSingleLine(task.name));
  markdown.appendMarkdown("\n\n");

  const statusLabel = task.enabled
    ? `✅ ${messages.labelEnabled()}`
    : `⏸️ ${messages.labelDisabled()}`;
  markdown.appendMarkdown(`**${messages.labelStatus()}:** ${statusLabel}\n\n`);

  const schedule = collapseToSingleLine(task.cronExpression);
  if (schedule.includes("`")) {
    markdown.appendMarkdown(`**${messages.labelSchedule()}:**\n\n`);
    appendValueBlock(markdown, schedule);
    markdown.appendMarkdown("\n");
  } else {
    markdown.appendMarkdown(`**${messages.labelSchedule()}:** \``);
    markdown.appendText(schedule);
    markdown.appendMarkdown("`\n\n");
  }

  const scopeLabel = task.scope === "global"
    ? messages.treeGroupGlobal()
    : `📁 ${messages.labelScopeWorkspace()}`;
  markdown.appendMarkdown(`**${messages.labelScope()}:** ${scopeLabel}\n\n`);

  if (task.scope === "workspace") {
    markdown.appendMarkdown(`**${messages.tooltipWorkspaceTarget()}:**\n\n`);
    if (task.workspacePath) {
      appendValueBlock(markdown, task.workspacePath);
    } else {
      markdown.appendMarkdown(`${messages.tooltipNotSet()}\n\n`);
    }

    const workspaceStatus = appliesToCurrentWorkspace
      ? messages.labelThisWorkspaceShort()
      : messages.labelOtherWorkspaceShort();
    markdown.appendMarkdown(
      `**${messages.tooltipAppliesHere()}:** ${workspaceStatus}\n\n`,
    );
  }

  if (task.nextRun && task.enabled) {
    markdown.appendMarkdown(
      `**${messages.labelNextRun()}:** ${messages.formatDateTime(task.nextRun)}\n\n`,
    );
  }

  if (task.lastRun) {
    markdown.appendMarkdown(
      `**${messages.labelLastRun()}:** ${messages.formatDateTime(task.lastRun)}\n\n`,
    );
  }

  if (task.agent) {
    markdown.appendMarkdown(`**${messages.labelAgent()}:** `);
    markdown.appendText(collapseToSingleLine(task.agent));
    markdown.appendMarkdown("\n\n");
  }

  if (task.model) {
    markdown.appendMarkdown(`**${messages.labelModel()}:** `);
    markdown.appendText(collapseToSingleLine(task.model));
    markdown.appendMarkdown("\n\n");
  }

  const promptPreview = task.prompt.length > 100
    ? `${task.prompt.slice(0, 100)}...`
    : task.prompt;
  markdown.appendMarkdown(`**${messages.labelPrompt()}:**\n\n`);
  appendValueBlock(markdown, promptPreview);

  return markdown;
}

export class ScopeGroupItem extends vscode.TreeItem {
  public readonly scope: TaskScope; constructor(scope: TaskScope, taskCount: number) {
    super(scopeHeading(scope), vscode.TreeItemCollapsibleState.Expanded);
    this.id = `scope-${scope}`;
    this.scope = scope;
    this.contextValue = "scopeGroup";
    this.description = countLabel(taskCount);
    this.iconPath = scope === "global" ? GLOBAL_SCOPE_ICON : WORKSPACE_SCOPE_ICON;
  }
}

export class WorkspaceGroupItem extends vscode.TreeItem {
  public readonly group: WorkspaceTaskGroup; constructor(group: WorkspaceTaskGroup, taskCount: number) {
    super(workspaceHeading(group), vscode.TreeItemCollapsibleState.Expanded);
    this.id = `workspace-group-${group}`;
    this.group = group;
    this.contextValue = "workspaceGroup";
    this.description = countLabel(taskCount);
    this.iconPath = group === "this" ? CURRENT_WORKSPACE_ICON : LINKED_WORKSPACE_ICON;
  }
}

export class ScheduledTaskItem extends vscode.TreeItem {
  private readonly inThisWorkspace: boolean;
  public readonly task: ScheduledTask;

  constructor(task: ScheduledTask, inThisWorkspace: boolean) {
    super(task.name, vscode.TreeItemCollapsibleState.None);

    this.inThisWorkspace = inThisWorkspace;
    this.task = task;
    this.contextValue = getTaskContextValue(task, inThisWorkspace);
    this.description = createTaskDescription(task, inThisWorkspace);
    this.tooltip = createTaskTooltip(task, inThisWorkspace);
    this.iconPath = getTaskIcon(task);
    this.command = {
      command: getCockpitCommandId("editTask"),
      title: messages.actionEdit(),
      arguments: [this],
    };
  }
}

export type WorkspaceTreeNode = ScopeGroupItem | WorkspaceGroupItem | ScheduledTaskItem;

export class ScheduledTaskTreeProvider implements vscode.TreeDataProvider<WorkspaceTreeNode> {
  private readonly treeChangeEmitter = new vscode.EventEmitter<TreeRefreshTarget>();
  readonly onDidChangeTreeData: vscode.Event<TreeRefreshTarget> =
    this.treeChangeEmitter.event;

  private readonly scheduleManager: ScheduleManager;

  constructor(scheduleManager: ScheduleManager) {
    this.scheduleManager = scheduleManager;
    this.scheduleManager.setOnTasksChangedCallback(this.refresh.bind(this));
  }

  refresh(): void {
    this.treeChangeEmitter.fire();
  }

  getTreeItem(element: WorkspaceTreeNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: WorkspaceTreeNode): Thenable<WorkspaceTreeNode[]> {
    if (!element) {
      return this.buildRootNodes();
    }

    if (element instanceof ScopeGroupItem) {
      return element.scope === "workspace"
        ? this.buildWorkspaceGroupNodes()
        : this.buildTaskNodesForScope(element.scope);
    }

    if (element instanceof WorkspaceGroupItem) {
      return this.buildTaskNodesForWorkspaceGroup(element.group);
    }

    return Promise.resolve([]);
  }

  private getWorkspaceScopeCount(): number {
    const { currentWorkspace, otherWorkspaces } = this.splitWorkspaceTasks();
    return currentWorkspace.length + otherWorkspaces.length;
  }

  private async buildRootNodes(): Promise<WorkspaceTreeNode[]> {
    const allTasks = this.scheduleManager.getAllTasks();
    const globalCount = allTasks.filter((task) => task.scope === "global").length;
    const workspaceCount = allTasks.length - globalCount;

    const nodes: WorkspaceTreeNode[] = [];
    if (globalCount > 0 || allTasks.length === 0) {
      nodes.push(new ScopeGroupItem("global", globalCount));
    }
    if (workspaceCount > 0 || allTasks.length === 0) {
      nodes.push(new ScopeGroupItem("workspace", workspaceCount));
    }

    return nodes;
  }

  private async buildTaskNodesForScope(scope: TaskScope): Promise<WorkspaceTreeNode[]> {
    return this.toTaskNodes(this.scheduleManager.getTasksByScope(scope));
  }

  private splitWorkspaceTasks(): TaskBuckets {
    return this.scheduleManager.getTasksByScope("workspace").reduce<TaskBuckets>(
      (buckets, task) => {
        if (this.scheduleManager.shouldTaskRunInCurrentWorkspace(task)) {
          buckets.currentWorkspace.push(task);
        } else {
          buckets.otherWorkspaces.push(task);
        }
        return buckets;
      },
      { currentWorkspace: [], otherWorkspaces: [] },
    );
  }

  private async buildWorkspaceGroupNodes(): Promise<WorkspaceTreeNode[]> {
    const { currentWorkspace, otherWorkspaces } = this.splitWorkspaceTasks();
    const nodes: WorkspaceTreeNode[] = [];

    if (currentWorkspace.length > 0) {
      nodes.push(new WorkspaceGroupItem("this", currentWorkspace.length));
    }
    if (otherWorkspaces.length > 0) {
      nodes.push(new WorkspaceGroupItem("other", otherWorkspaces.length));
    }

    return nodes;
  }

  private async buildTaskNodesForWorkspaceGroup(
    group: WorkspaceTaskGroup,
  ): Promise<WorkspaceTreeNode[]> {
    const { currentWorkspace, otherWorkspaces } = this.splitWorkspaceTasks();
    const tasks = group === "this" ? currentWorkspace : otherWorkspaces;
    return this.toTaskNodes(tasks, group === "this");
  }

  private toTaskNodes(
    tasks: readonly ScheduledTask[],
    appliesToCurrentWorkspace?: boolean,
  ): ScheduledTaskItem[] {
    return sortTasksByName(tasks).map((task) => {
      const appliesHere = appliesToCurrentWorkspace
        ?? this.scheduleManager.shouldTaskRunInCurrentWorkspace(task);
      return new ScheduledTaskItem(task, appliesHere);
    });
  }

  getParent(element: WorkspaceTreeNode): vscode.ProviderResult<WorkspaceTreeNode> {
    const isTaskLeaf = element instanceof ScheduledTaskItem;
    if (isTaskLeaf) {
      const task = element.task;

      if (task.scope === "workspace") {
        const { currentWorkspace, otherWorkspaces } = this.splitWorkspaceTasks();
        const inCurrentWorkspace = this.scheduleManager.shouldTaskRunInCurrentWorkspace(task);
        return new WorkspaceGroupItem(
          inCurrentWorkspace ? "this" : "other",
          inCurrentWorkspace
            ? currentWorkspace.length
            : otherWorkspaces.length,
        );
      }

      const scopeCount = this.scheduleManager
        .getAllTasks()
        .filter((candidate) => candidate.scope === task.scope).length;
      return new ScopeGroupItem(task.scope, scopeCount);
    }

    if (element instanceof WorkspaceGroupItem) {
      return new ScopeGroupItem("workspace", this.getWorkspaceScopeCount());
    }

    return undefined;
  }
}
