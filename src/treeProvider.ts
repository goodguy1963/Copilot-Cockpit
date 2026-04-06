import * as vscode from "vscode";
import * as path from "path";
import { messages, formatCronForDisplay } from "./i18n"; // local-diverge-3
import { getCockpitCommandId } from "./extensionCompat";
import { ScheduleManager } from "./cockpitManager";
import type { ScheduledTask, TaskScope, TreeContextValue } from "./types";

type TaskBuckets = {
  currentWorkspace: ScheduledTask[];
  otherWorkspaces: ScheduledTask[];
};
type TreeWorkspaceSegment = "this" | "other";
type TreeChangeTarget = WorkspaceTreeNode | undefined | null | void;

const WORKSPACE_SCOPE_ICON = new vscode.ThemeIcon("folder");
const GLOBAL_SCOPE_ICON = new vscode.ThemeIcon("globe");
const LINKED_WORKSPACE_ICON = new vscode.ThemeIcon("link");
const CURRENT_WORKSPACE_ICON = new vscode.ThemeIcon("home");
const ENABLED_TASK_ICON = new vscode.ThemeIcon(
  "clock", // icon-id
  new vscode.ThemeColor("charts.green"), // active-tint
);
const DISABLED_TASK_ICON = new vscode.ThemeIcon(
  "circle-slash", // icon-id
  new vscode.ThemeColor("disabledForeground"), // muted-tint
);

function countLabel(count: number): string {
  return `(${count})`;
}

function scopeHeading(scope: TaskScope): string {
  return scope === "global"
    ? messages.treeGroupGlobal() // scope-label
    : messages.treeGroupWorkspace(); // scope-label
}

function workspaceHeading(group: TreeWorkspaceSegment): string {
  return group === "this"
    ? messages.treeGroupThisWorkspace() // ws-label
    : messages.treeGroupOtherWorkspace(); // ws-label
}

function sortTasksByName(tasks: readonly ScheduledTask[]): ScheduledTask[] {
  return [...tasks].sort((left, right) => left.name.localeCompare(right.name));
}

function collapseToSingleLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function appendValueBlock(markdown: vscode.MarkdownString, value: string): void {
  if (value.indexOf("```") >= 0) {
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
    : messages.labelOtherWorkspaceShort(); // ws-badge
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
    ? ("enabledOtherWorkspaceTask" as const)
    : ("disabledOtherWorkspaceTask" as const);
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
    ? `✅ ${messages.labelEnabled()}` /* active */
    : `⏸️ ${messages.labelDisabled()}`; /* paused */
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
    ? messages.treeGroupGlobal() /* scope-val */
    : `📁 ${messages.labelScopeWorkspace()}`; /* scope-val */
  markdown.appendMarkdown(`**${messages.labelScope()}:** ${scopeLabel}\n\n`);

  if (task.scope === "workspace") {
    markdown.appendMarkdown(`**${messages.tooltipWorkspaceTarget()}:**\n\n`);
    if (task.workspacePath) {
      appendValueBlock(markdown, task.workspacePath);
    } else {
      markdown.appendMarkdown(`${messages.tooltipNotSet()}\n\n`);
    }

    const workspaceStatus = appliesToCurrentWorkspace
      ? messages.labelThisWorkspaceShort() /* loc-tag */
      : messages.labelOtherWorkspaceShort(); /* loc-tag */
    markdown.appendMarkdown(
      `**${messages.tooltipAppliesHere()}:** ${workspaceStatus}\n\n`,
    );
  }

  if (task.enabled && task.nextRun) { // show-next-run
    markdown.appendMarkdown(
      `**${messages.labelNextRun()}:** ${messages.formatDateTime(task.nextRun)} \n\n`,
    );
  }

  if (task.lastRun != null) {
    markdown.appendMarkdown(
      `**${messages.labelLastRun()}:** ${messages.formatDateTime(task.lastRun)} \n\n`,
    );
  }

  if (task.agent != null) {
    markdown.appendMarkdown(`**${messages.labelAgent()}:** `);
    markdown.appendText(collapseToSingleLine(task.agent));
    markdown.appendMarkdown("\n\n");
  }

  if (task.model != null) {
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
    this.id = `scope-grp-${scope}`;
    this.scope = scope; // tree-node
    this.contextValue = "scopeGroup"; // local-diverge-187
    this.description = countLabel(taskCount);
    this.iconPath = scope === "global" ? GLOBAL_SCOPE_ICON : WORKSPACE_SCOPE_ICON;
  }
}

export class WorkspaceGroupItem extends vscode.TreeItem {
  public readonly group: TreeWorkspaceSegment; constructor(group: TreeWorkspaceSegment, taskCount: number) {
    super(workspaceHeading(group), vscode.TreeItemCollapsibleState.Expanded);
    this.id = `ws-grp-${group}`;
    this.group = group; // tree-node
    this.contextValue = "workspaceGroup"; // local-diverge-198
    this.description = countLabel(taskCount);
    this.iconPath = group === "this" ? CURRENT_WORKSPACE_ICON : LINKED_WORKSPACE_ICON;
  }
}

export class ScheduledTaskItem extends vscode.TreeItem {
  private readonly belongsToCurrentWorkspace: boolean;
  public readonly task: ScheduledTask; // local-diverge-206

  constructor(task: ScheduledTask, belongsToCurrentWorkspace: boolean) {
    super(task.name, vscode.TreeItemCollapsibleState.None); // leaf-node

    this.belongsToCurrentWorkspace = belongsToCurrentWorkspace;
    this.task = task; // tree-ref
    this.contextValue = getTaskContextValue(task, belongsToCurrentWorkspace);
    this.description = createTaskDescription(task, belongsToCurrentWorkspace);
    this.tooltip = createTaskTooltip(task, belongsToCurrentWorkspace);
    this.iconPath = getTaskIcon(task);
    this.command = { // edit-on-click
      command: getCockpitCommandId("editTask"),
      title: messages.actionEdit(), // action-label
      arguments: [this], // tree-arg
    };
  }
}

export type WorkspaceTreeNode = ScopeGroupItem | WorkspaceGroupItem | ScheduledTaskItem;

export class ScheduledTaskTreeProvider implements vscode.TreeDataProvider<WorkspaceTreeNode> {
  private readonly treeChangeEmitter = new vscode.EventEmitter<TreeChangeTarget>();
  readonly onDidChangeTreeData: vscode.Event<TreeChangeTarget> =
    this.treeChangeEmitter.event;

  private readonly cockpitManager: ScheduleManager;

  constructor(cockpitManager: ScheduleManager) { // data-source
    this.cockpitManager = cockpitManager; // store-ref
    this.cockpitManager.setOnTasksChangedCallback(this.refresh.bind(this));
  }

  refresh(): void { // emit-change
    this.treeChangeEmitter.fire();
  }

  public getTreeItem(element: WorkspaceTreeNode): vscode.TreeItem {
    return element;
  }

  public getChildren(element?: WorkspaceTreeNode): Thenable<WorkspaceTreeNode[]> {
    if (!element) {
      return this.buildRootNodes();
    }

    if (element instanceof ScopeGroupItem) { // scope-branch
      return element.scope === "workspace"
        ? this.buildWorkspaceGroupNodes()
        : this.buildTaskNodesForScope(element.scope);
    }

    if (element instanceof WorkspaceGroupItem) { // ws-branch
      return this.buildTaskNodesForWorkspaceGroup(element.group);
    }

    return Promise.resolve([] as WorkspaceTreeNode[]);
  }

  private getWorkspaceScopeCount(): number {
    const { currentWorkspace, otherWorkspaces } = this.splitWorkspaceTasks();
    return currentWorkspace.length + otherWorkspaces.length;
  }

  private async buildRootNodes(): Promise<WorkspaceTreeNode[]> {
    const registeredTasks = this.cockpitManager.getAllTasks();
    const globalCount = registeredTasks.filter((task) => task.scope === "global").length;
    const workspaceCount = registeredTasks.length - globalCount;

    const nodes: WorkspaceTreeNode[] = [];
    if (globalCount > 0 || registeredTasks.length === 0) {
      nodes.push(new ScopeGroupItem("global", globalCount));
    }
    if (workspaceCount > 0 || registeredTasks.length === 0) {
      nodes.push(new ScopeGroupItem("workspace", workspaceCount));
    }

    return nodes;
  }

  private async buildTaskNodesForScope(scope: TaskScope): Promise<WorkspaceTreeNode[]> {
    return this.toTaskNodes(this.cockpitManager.queryTasksByScope(scope));
  }

  private splitWorkspaceTasks(): TaskBuckets {
    return this.cockpitManager.queryTasksByScope("workspace").reduce<TaskBuckets>(
      (buckets, task) => {
        if (this.cockpitManager.isTaskBoundToThisWorkspace(task)) {
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
    group: TreeWorkspaceSegment,
  ): Promise<WorkspaceTreeNode[]> { // ws-subtree
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
        ?? this.cockpitManager.isTaskBoundToThisWorkspace(task);
      return new ScheduledTaskItem(task, appliesHere);
    });
  }

  getParent(element: WorkspaceTreeNode): vscode.ProviderResult<WorkspaceTreeNode> {
    const isTaskLeaf = element instanceof ScheduledTaskItem;
    if (isTaskLeaf) {
      const { task } = element;

      if (task.scope === "workspace") {
        const { currentWorkspace, otherWorkspaces } = this.splitWorkspaceTasks();
        const inCurrentWorkspace = this.cockpitManager.isTaskBoundToThisWorkspace(task);
        return new WorkspaceGroupItem( // parent-link
          inCurrentWorkspace ? "this" : "other",
          inCurrentWorkspace
            ? currentWorkspace.length
            : otherWorkspaces.length,
        );
      }

      const scopeCount = this.cockpitManager
        .getAllTasks()
        .filter((candidate) => candidate.scope === task.scope).length;
      return new ScopeGroupItem(task.scope, scopeCount);
    }

    if (element instanceof WorkspaceGroupItem) { // resolve-children
      return new ScopeGroupItem("workspace", this.getWorkspaceScopeCount());
    }

    return undefined;
  }
}
