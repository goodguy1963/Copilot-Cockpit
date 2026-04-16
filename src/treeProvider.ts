import * as vscode from "vscode";
import * as path from "path";
import { messages, formatCronForDisplay } from "./i18n"; // local-diverge-3
import { getCockpitCommandId } from "./extensionCompat";
import { ScheduleManager } from "./cockpitManager";
import { isTodoDraftTask } from "./todoDraftTasks";
import type { ScheduledTask, TaskScope, TreeContextValue } from "./types";

type TaskBuckets = {
  currentWorkspace: ScheduledTask[];
  otherWorkspaces: ScheduledTask[];
};
type TreeWorkspaceSegment = "this" | "other";
type TaskSectionKey = "manual" | "jobs" | "recurring" | "todo-draft" | "one-time";
type TreeChangeTarget = WorkspaceTreeNode | undefined | null | void;

const WORKSPACE_SCOPE_ICON = new vscode.ThemeIcon("folder");
const GLOBAL_SCOPE_ICON = new vscode.ThemeIcon("globe");
const LINKED_WORKSPACE_ICON = new vscode.ThemeIcon("link");
const CURRENT_WORKSPACE_ICON = new vscode.ThemeIcon("home");
const SECTION_ICONS: Record<TaskSectionKey, vscode.ThemeIcon> = {
  manual: new vscode.ThemeIcon("play-circle"),
  jobs: new vscode.ThemeIcon("repo"),
  recurring: new vscode.ThemeIcon("history"),
  "todo-draft": new vscode.ThemeIcon("edit"),
  "one-time": new vscode.ThemeIcon("run"),
};
const JOB_GROUP_ICON = new vscode.ThemeIcon("tools");
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

function isOneTimeTask(task: ScheduledTask): boolean {
  return task.oneTime === true || task.id.startsWith("exec-");
}

function isJobTask(task: ScheduledTask): boolean {
  return !!task.jobId;
}

function getTaskSectionKey(task: ScheduledTask): TaskSectionKey {
  const oneTime = isOneTimeTask(task);

  if (isJobTask(task)) {
    return "jobs";
  }

  if (!oneTime && task.manualSession === true) {
    return "manual";
  }

  if (!oneTime) {
    return "recurring";
  }

  if (isTodoDraftTask(task) && task.enabled === false) {
    return "todo-draft";
  }

  return "one-time";
}

function sectionHeading(section: TaskSectionKey): string {
  switch (section) {
    case "manual":
      return messages.labelManualSessions();
    case "jobs":
      return messages.labelJobTasks();
    case "recurring":
      return messages.labelRecurringTasks();
    case "todo-draft":
      return messages.labelTodoTaskDrafts();
    case "one-time":
      return messages.labelOneTimeTasks();
  }
}

function createTaskSectionBuckets(): Record<TaskSectionKey, ScheduledTask[]> {
  return {
    manual: [],
    jobs: [],
    recurring: [],
    "todo-draft": [],
    "one-time": [],
  };
}

const TASK_SECTION_ORDER: readonly TaskSectionKey[] = [
  "manual",
  "jobs",
  "recurring",
  "todo-draft",
  "one-time",
];

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

export class TaskSectionItem extends vscode.TreeItem {
  public readonly scope: TaskScope;
  public readonly section: TaskSectionKey;
  public readonly workspaceGroup?: TreeWorkspaceSegment;

  constructor(
    scope: TaskScope,
    section: TaskSectionKey,
    taskCount: number,
    workspaceGroup?: TreeWorkspaceSegment,
  ) {
    super(sectionHeading(section), vscode.TreeItemCollapsibleState.Expanded);
    this.id = [
      "section-grp",
      scope,
      workspaceGroup ?? "all",
      section,
    ].join("-");
    this.scope = scope;
    this.section = section;
    this.workspaceGroup = workspaceGroup;
    this.contextValue = "sectionGroup";
    this.description = countLabel(taskCount);
    this.iconPath = SECTION_ICONS[section];
  }
}

export class JobGroupItem extends vscode.TreeItem {
  public readonly scope: TaskScope;
  public readonly jobId: string;
  public readonly section: TaskSectionKey;
  public readonly workspaceGroup?: TreeWorkspaceSegment;

  constructor(
    scope: TaskScope,
    workspaceGroup: TreeWorkspaceSegment | undefined,
    jobId: string,
    title: string,
    taskCount: number,
  ) {
    super(title, vscode.TreeItemCollapsibleState.Expanded);
    this.id = ["job-grp", scope, workspaceGroup ?? "all", jobId].join("-");
    this.scope = scope;
    this.workspaceGroup = workspaceGroup;
    this.section = "jobs";
    this.jobId = jobId;
    this.contextValue = "jobGroup";
    this.description = countLabel(taskCount);
    this.iconPath = JOB_GROUP_ICON;
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

export type WorkspaceTreeNode =
  | ScopeGroupItem
  | WorkspaceGroupItem
  | TaskSectionItem
  | JobGroupItem
  | ScheduledTaskItem;

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
        : this.buildSectionNodesForScope(element.scope);
    }

    if (element instanceof WorkspaceGroupItem) { // ws-branch
      return this.buildSectionNodesForWorkspaceGroup(element.group);
    }

    if (element instanceof TaskSectionItem) {
      return element.section === "jobs"
        ? this.buildJobGroupNodes(element.scope, element.workspaceGroup)
        : this.buildTaskNodesForSection(
          element.scope,
          element.section,
          element.workspaceGroup,
        );
    }

    if (element instanceof JobGroupItem) {
      return this.buildTaskNodesForJobGroup(
        element.scope,
        element.jobId,
        element.workspaceGroup,
      );
    }

    return Promise.resolve([] as WorkspaceTreeNode[]);
  }

  private getTasksForScopeGroup(
    scope: TaskScope,
    workspaceGroup?: TreeWorkspaceSegment,
  ): ScheduledTask[] {
    if (scope !== "workspace") {
      return this.cockpitManager.queryTasksByScope(scope);
    }

    if (!workspaceGroup) {
      return this.cockpitManager.queryTasksByScope(scope);
    }

    const { currentWorkspace, otherWorkspaces } = this.splitWorkspaceTasks();
    return workspaceGroup === "this" ? currentWorkspace : otherWorkspaces;
  }

  private getTaskCountForScope(scope: TaskScope): number {
    return this.cockpitManager.queryTasksByScope(scope).length;
  }

  private getTaskCountForWorkspaceGroup(group: TreeWorkspaceSegment): number {
    const { currentWorkspace, otherWorkspaces } = this.splitWorkspaceTasks();
    return group === "this" ? currentWorkspace.length : otherWorkspaces.length;
  }

  private getSectionBuckets(
    tasks: readonly ScheduledTask[],
  ): Record<TaskSectionKey, ScheduledTask[]> {
    return tasks.reduce<Record<TaskSectionKey, ScheduledTask[]>>((buckets, task) => {
      buckets[getTaskSectionKey(task)].push(task);
      return buckets;
    }, createTaskSectionBuckets());
  }

  private getTasksForSection(
    scope: TaskScope,
    section: TaskSectionKey,
    workspaceGroup?: TreeWorkspaceSegment,
  ): ScheduledTask[] {
    return this.getTasksForScopeGroup(scope, workspaceGroup)
      .filter((task) => getTaskSectionKey(task) === section);
  }

  private getJobTitle(jobId: string): string {
    const job = this.cockpitManager.getAllJobs().find((candidate) => candidate.id === jobId);
    return job?.name?.trim() || jobId;
  }

  private getWorkspaceGroupForTask(task: ScheduledTask): TreeWorkspaceSegment | undefined {
    if (task.scope !== "workspace") {
      return undefined;
    }

    return this.cockpitManager.isTaskBoundToThisWorkspace(task) ? "this" : "other";
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

  private async buildSectionNodesForScope(scope: TaskScope): Promise<WorkspaceTreeNode[]> {
    return this.buildSectionNodes(scope);
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

  private async buildSectionNodesForWorkspaceGroup(
    group: TreeWorkspaceSegment,
  ): Promise<WorkspaceTreeNode[]> { // ws-subtree
    return this.buildSectionNodes("workspace", group);
  }

  private async buildSectionNodes(
    scope: TaskScope,
    workspaceGroup?: TreeWorkspaceSegment,
  ): Promise<WorkspaceTreeNode[]> {
    const buckets = this.getSectionBuckets(this.getTasksForScopeGroup(scope, workspaceGroup));

    return TASK_SECTION_ORDER
      .filter((section) => buckets[section].length > 0)
      .map((section) =>
        new TaskSectionItem(
          scope,
          section,
          buckets[section].length,
          workspaceGroup,
        ));
  }

  private async buildTaskNodesForSection(
    scope: TaskScope,
    section: TaskSectionKey,
    workspaceGroup?: TreeWorkspaceSegment,
  ): Promise<WorkspaceTreeNode[]> {
    const tasks = this.getTasksForSection(scope, section, workspaceGroup);
    return this.toTaskNodes(
      tasks,
      workspaceGroup ? workspaceGroup === "this" : undefined,
    );
  }

  private async buildJobGroupNodes(
    scope: TaskScope,
    workspaceGroup?: TreeWorkspaceSegment,
  ): Promise<WorkspaceTreeNode[]> {
    const jobBuckets = this.getTasksForSection(scope, "jobs", workspaceGroup).reduce<
      Map<string, ScheduledTask[]>
    >((buckets, task) => {
      const jobId = task.jobId?.trim();
      if (!jobId) {
        return buckets;
      }

      const items = buckets.get(jobId) ?? [];
      items.push(task);
      buckets.set(jobId, items);
      return buckets;
    }, new Map<string, ScheduledTask[]>());

    return Array.from(jobBuckets.entries())
      .sort((left, right) => this.getJobTitle(left[0]).localeCompare(this.getJobTitle(right[0])))
      .map(([jobId, tasks]) =>
        new JobGroupItem(
          scope,
          workspaceGroup,
          jobId,
          this.getJobTitle(jobId),
          tasks.length,
        ));
  }

  private async buildTaskNodesForJobGroup(
    scope: TaskScope,
    jobId: string,
    workspaceGroup?: TreeWorkspaceSegment,
  ): Promise<WorkspaceTreeNode[]> {
    const tasks = this.getTasksForSection(scope, "jobs", workspaceGroup)
      .filter((task) => task.jobId === jobId);
    return this.toTaskNodes(
      tasks,
      workspaceGroup ? workspaceGroup === "this" : undefined,
    );
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
      const section = getTaskSectionKey(task);
      const workspaceGroup = this.getWorkspaceGroupForTask(task);

      if (section === "jobs" && task.jobId) {
        const tasksInJob = this.getTasksForSection(task.scope, section, workspaceGroup)
          .filter((candidate) => candidate.jobId === task.jobId);
        return new JobGroupItem(
          task.scope,
          workspaceGroup,
          task.jobId,
          this.getJobTitle(task.jobId),
          tasksInJob.length,
        );
      }

      return new TaskSectionItem(
        task.scope,
        section,
        this.getTasksForSection(task.scope, section, workspaceGroup).length,
        workspaceGroup,
      );
    }

    if (element instanceof JobGroupItem) {
      return new TaskSectionItem(
        element.scope,
        element.section,
        this.getTasksForSection(element.scope, element.section, element.workspaceGroup).length,
        element.workspaceGroup,
      );
    }

    if (element instanceof TaskSectionItem) {
      if (element.scope === "workspace" && element.workspaceGroup) {
        return new WorkspaceGroupItem(
          element.workspaceGroup,
          this.getTaskCountForWorkspaceGroup(element.workspaceGroup),
        );
      }

      return new ScopeGroupItem(element.scope, this.getTaskCountForScope(element.scope));
    }

    if (element instanceof WorkspaceGroupItem) { // resolve-children
      return new ScopeGroupItem("workspace", this.getWorkspaceScopeCount());
    }

    return undefined;
  }
}
