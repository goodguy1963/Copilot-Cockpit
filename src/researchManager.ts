import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { spawn, type ChildProcess } from "child_process";
import { CopilotExecutor } from "./copilotExecutor";
import { sanitizeAbsolutePathDetails } from "./errorSanitizer";
import { logError } from "./logger";
import { getResolvedWorkspaceRoots } from "./schedulerJsonSanitizer";
import {
  readWorkspaceResearchStateFromSqlite,
  syncWorkspaceResearchStateToSqlite,
} from "./sqliteBootstrap";
import {
  getConfiguredSchedulerStorageMode,
  SQLITE_STORAGE_MODE,
} from "./sqliteStorage";
import type {
  CreateResearchProfileInput,
  ResearchAttempt,
  ResearchAttemptOutcome,
  ResearchProfile,
  ResearchRun,
  ResearchSnapshotInfo,
  ResearchWorkspaceConfig,
} from "./types";

type SnapshotBufferMap = Map<string, Buffer | null>;

type CommandResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

const RESEARCH_CONFIG_FILE = "research.json";
const RESEARCH_HISTORY_DIR = "research-history";
const RESEARCH_CONFIG_VERSION = 1;
const OUTPUT_LIMIT = 12000;
const POLL_INTERVAL_MS = 500;
const QUIET_WINDOW_MS = 1500;

function toSafeErrorDetails(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  return sanitizeAbsolutePathDetails(raw) || raw;
}

function normalizeRelativePath(input: string): string {
  return input.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const normalized = Math.floor(parsed);
  return Math.min(Math.max(normalized, min), max);
}

function truncateOutput(value: string): string {
  if (value.length <= OUTPUT_LIMIT) {
    return value;
  }
  return `${value.slice(0, OUTPUT_LIMIT)}\n...[truncated]`;
}

export class ResearchManager {
  private profiles = new Map<string, ResearchProfile>();
  private runs: ResearchRun[] = [];
  private activeRunId: string | undefined;
  private onChangedCallback: (() => void) | undefined;
  private activeChild: ChildProcess | undefined;
  private stopRequested = false;
  private sqliteHydrationPromise: Promise<void> | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly copilotExecutor: CopilotExecutor,
  ) {
    this.loadState();
    this.scheduleSqliteResearchHydration();
  }

  setOnChangedCallback(callback: () => void): void {
    this.onChangedCallback = callback;
  }

  getAllProfiles(): ResearchProfile[] {
    return Array.from(this.profiles.values()).sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  }

  getActiveRun(): ResearchRun | undefined {
    if (!this.activeRunId) {
      return undefined;
    }
    return this.runs.find((run) => run.id === this.activeRunId);
  }

  getRecentRuns(limit = 12): ResearchRun[] {
    return this.runs.slice(0, limit);
  }

  getProfile(id: string): ResearchProfile | undefined {
    return this.profiles.get(id);
  }

  async createProfile(input: CreateResearchProfileInput): Promise<ResearchProfile> {
    const workspaceRoot = this.getPrimaryWorkspaceRoot();
    if (!workspaceRoot) {
      throw new Error("Open a workspace folder before creating a research profile.");
    }

    const profile = this.normalizeProfile(input, workspaceRoot);
    profile.id = this.createId("research");
    profile.createdAt = new Date().toISOString();
    profile.updatedAt = profile.createdAt;
    this.profiles.set(profile.id, profile);
    await this.saveState();
    return profile;
  }

  async updateProfile(
    id: string,
    input: Partial<CreateResearchProfileInput>,
  ): Promise<ResearchProfile | undefined> {
    const existing = this.profiles.get(id);
    const workspaceRoot = this.getPrimaryWorkspaceRoot();
    if (!existing || !workspaceRoot) {
      return undefined;
    }

    const next = this.normalizeProfile(
      {
        ...existing,
        ...input,
      },
      workspaceRoot,
    );
    next.id = existing.id;
    next.createdAt = existing.createdAt;
    next.updatedAt = new Date().toISOString();
    this.profiles.set(id, next);
    await this.saveState();
    return next;
  }

  async deleteProfile(id: string): Promise<boolean> {
    if (this.activeRunId) {
      const active = this.getActiveRun();
      if (active?.profileId === id && active.status === "running") {
        throw new Error("Stop the active research run before deleting its profile.");
      }
    }
    const deleted = this.profiles.delete(id);
    if (!deleted) {
      return false;
    }
    await this.saveState();
    return true;
  }

  async duplicateProfile(id: string): Promise<ResearchProfile | undefined> {
    const existing = this.profiles.get(id);
    if (!existing) {
      return undefined;
    }

    const duplicate: ResearchProfile = {
      ...existing,
      id: this.createId("research"),
      name: `${existing.name} Copy`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.profiles.set(duplicate.id, duplicate);
    await this.saveState();
    return duplicate;
  }

  async startRun(profileId: string): Promise<ResearchRun> {
    const profile = this.profiles.get(profileId);
    const workspaceRoot = this.getPrimaryWorkspaceRoot();
    if (!profile || !workspaceRoot) {
      throw new Error("Research profile not found.");
    }
    const active = this.getActiveRun();
    if (active && (active.status === "running" || active.status === "stopping")) {
      throw new Error("Only one research run can be active at a time.");
    }

    const now = new Date().toISOString();
    const run: ResearchRun = {
      id: this.createId("run"),
      profileId: profile.id,
      profileName: profile.name,
      status: "running",
      startedAt: now,
      completedIterations: 0,
      attempts: [],
    };
    this.runs.unshift(run);
    this.activeRunId = run.id;
    this.stopRequested = false;
    await this.saveState();

    void this.executeRun(profile, run, workspaceRoot).catch(async (error) => {
      logError("[CopilotScheduler] Research run failed:", toSafeErrorDetails(error));
      const target = this.runs.find((candidate) => candidate.id === run.id);
      if (!target) {
        return;
      }
      target.status = this.stopRequested ? "stopped" : "failed";
      target.finishedAt = new Date().toISOString();
      target.stopReason = toSafeErrorDetails(error);
      this.activeRunId = undefined;
      this.activeChild = undefined;
      await this.saveState();
    });

    return run;
  }

  async stopRun(): Promise<boolean> {
    const active = this.getActiveRun();
    if (!active || (active.status !== "running" && active.status !== "stopping")) {
      return false;
    }
    this.stopRequested = true;
    active.status = "stopping";
    active.stopReason = "Stop requested by user.";
    await this.saveState();

    if (this.activeChild?.pid) {
      await this.killChildProcess(this.activeChild);
    }
    return true;
  }

  private async executeRun(
    profile: ResearchProfile,
    run: ResearchRun,
    workspaceRoot: string,
  ): Promise<void> {
    const historyRoot = this.getHistoryRoot(workspaceRoot);
    fs.mkdirSync(historyRoot, { recursive: true });

    const baselineSnapshot = await this.readAllowlistedSnapshot(
      workspaceRoot,
      profile.editablePaths,
    );
    const keptSnapshotDir = await this.writeSnapshot(
      workspaceRoot,
      run.id,
      "baseline",
      baselineSnapshot,
    );

    const baseline = await this.executeBenchmarkAttempt(
      workspaceRoot,
      profile,
      run,
      0,
      "baseline",
    );
    baseline.snapshot = keptSnapshotDir;
    run.attempts.push(baseline);
    if (typeof baseline.score !== "number") {
      run.status = this.stopRequested ? "stopped" : "failed";
      run.finishedAt = new Date().toISOString();
      run.stopReason = baseline.summary || baseline.error || "Baseline benchmark failed.";
      this.activeRunId = undefined;
      await this.saveState();
      return;
    }

    run.baselineScore = baseline.score;
    run.bestScore = baseline.score;
    await this.saveState();

    let keptSnapshot = baselineSnapshot;
    let consecutiveFailures = 0;
    const deadline = Date.now() + profile.maxMinutes * 60_000;

    for (let iteration = 1; iteration <= profile.maxIterations; iteration += 1) {
      if (this.stopRequested) {
        break;
      }
      if (Date.now() >= deadline) {
        run.stopReason = "Reached max runtime budget.";
        break;
      }

      const changedBefore = await this.getGitChangedFiles(workspaceRoot);
      const prompt = this.buildIterationPrompt(profile, run.bestScore, iteration);
      try {
        await this.copilotExecutor.executePrompt(prompt, {
          agent: profile.agent,
          model: profile.model,
          chatSession: "new",
        });
      } catch (error) {
        const attempt = this.createAttempt(run, iteration, "crash", {
          summary: "Copilot edit request failed.",
          error: toSafeErrorDetails(error),
        });
        run.attempts.push(attempt);
        consecutiveFailures += 1;
        if (consecutiveFailures >= profile.maxConsecutiveFailures) {
          run.stopReason = "Reached maximum consecutive failures.";
          break;
        }
        await this.saveState();
        continue;
      }

      const waitResult = await this.waitForAllowlistedChanges(
        workspaceRoot,
        profile.editablePaths,
        keptSnapshot,
        profile.editWaitSeconds * 1000,
      );

      if (this.stopRequested) {
        break;
      }

      if (waitResult.changedPaths.length === 0) {
        run.attempts.push(this.createAttempt(run, iteration, "rejected", {
          summary: "No allowlisted file changes detected before the settle timeout.",
        }));
        consecutiveFailures += 1;
        if (consecutiveFailures >= profile.maxConsecutiveFailures) {
          run.stopReason = "Reached maximum consecutive failures.";
          break;
        }
        await this.saveState();
        continue;
      }

      const changedAfter = await this.getGitChangedFiles(workspaceRoot);
      const externalChanges = this.detectExternalChanges(
        changedBefore,
        changedAfter,
        profile.editablePaths,
      );
      if (externalChanges.length > 0) {
        await this.restoreSnapshot(workspaceRoot, keptSnapshot);
        run.attempts.push(this.createAttempt(run, iteration, "policy-violation", {
          summary: "Detected file changes outside the editable allowlist.",
          changedPaths: waitResult.changedPaths,
          policyViolationPaths: externalChanges,
        }));
        consecutiveFailures += 1;
        run.stopReason = "Stopped after an allowlist policy violation.";
        await this.saveState();
        break;
      }

      const benchmarkAttempt = await this.executeBenchmarkAttempt(
        workspaceRoot,
        profile,
        run,
        iteration,
        "candidate",
      );
      benchmarkAttempt.changedPaths = waitResult.changedPaths;

      if (typeof benchmarkAttempt.score !== "number") {
        await this.restoreSnapshot(workspaceRoot, keptSnapshot);
        run.attempts.push(benchmarkAttempt);
        consecutiveFailures += 1;
        if (consecutiveFailures >= profile.maxConsecutiveFailures) {
          run.stopReason = "Reached maximum consecutive failures.";
          break;
        }
        await this.saveState();
        continue;
      }

      const improved = this.isScoreImproved(
        benchmarkAttempt.score,
        run.bestScore,
        profile.metricDirection,
      );
      if (improved) {
        keptSnapshot = waitResult.snapshot;
        benchmarkAttempt.outcome = "kept";
        benchmarkAttempt.summary = `Improved score to ${benchmarkAttempt.score}.`;
        benchmarkAttempt.bestScoreAfter = benchmarkAttempt.score;
        run.bestScore = benchmarkAttempt.score;
        benchmarkAttempt.snapshot = await this.writeSnapshot(
          workspaceRoot,
          run.id,
          `kept-${iteration}`,
          keptSnapshot,
        );
        consecutiveFailures = 0;
      } else {
        await this.restoreSnapshot(workspaceRoot, keptSnapshot);
        benchmarkAttempt.outcome = "rejected";
        benchmarkAttempt.summary = `Candidate score ${benchmarkAttempt.score} did not beat ${run.bestScore}.`;
        benchmarkAttempt.bestScoreAfter = run.bestScore;
        consecutiveFailures += 1;
      }

      run.attempts.push(benchmarkAttempt);
      run.completedIterations = iteration;
      if (consecutiveFailures >= profile.maxConsecutiveFailures) {
        run.stopReason = "Reached maximum consecutive failures.";
        await this.saveState();
        break;
      }
      await this.saveState();
    }

    if (this.stopRequested) {
      run.status = "stopped";
      run.stopReason = run.stopReason || "Stopped by user.";
    } else if (run.status !== "failed") {
      run.status = "completed";
      if (!run.stopReason) {
        run.stopReason =
          run.completedIterations >= profile.maxIterations
            ? "Reached max iterations."
            : "Run finished.";
      }
    }
    run.finishedAt = new Date().toISOString();
    this.activeRunId = undefined;
    this.activeChild = undefined;
    this.stopRequested = false;
    await this.saveState();
  }

  private async executeBenchmarkAttempt(
    workspaceRoot: string,
    profile: ResearchProfile,
    run: ResearchRun,
    iteration: number,
    label: string,
  ): Promise<ResearchAttempt> {
    const startedAt = new Date().toISOString();
    const result = await this.runCommand(
      profile.benchmarkCommand,
      workspaceRoot,
      profile.benchmarkTimeoutSeconds * 1000,
    );
    const output = truncateOutput([result.stdout, result.stderr].filter(Boolean).join("\n"));
    const score = this.parseMetric(output, profile.metricPattern);

    if (result.timedOut) {
      return {
        id: this.createId("attempt"),
        iteration,
        startedAt,
        finishedAt: new Date().toISOString(),
        outcome: "crash",
        exitCode: result.exitCode,
        summary: `${label} benchmark timed out.`,
        output,
      };
    }

    if (result.exitCode !== 0) {
      return {
        id: this.createId("attempt"),
        iteration,
        startedAt,
        finishedAt: new Date().toISOString(),
        outcome: "crash",
        exitCode: result.exitCode,
        summary: `${label} benchmark exited with code ${result.exitCode}.`,
        output,
      };
    }

    if (typeof score !== "number") {
      return {
        id: this.createId("attempt"),
        iteration,
        startedAt,
        finishedAt: new Date().toISOString(),
        outcome: "parse-error",
        exitCode: result.exitCode,
        summary: `Could not parse a numeric score using ${profile.metricPattern}.`,
        output,
      };
    }

    return {
      id: this.createId("attempt"),
      iteration,
      startedAt,
      finishedAt: new Date().toISOString(),
      outcome: iteration === 0 ? "baseline" : "rejected",
      score,
      bestScoreAfter: iteration === 0 ? score : run.bestScore,
      exitCode: result.exitCode,
      summary: `${label} benchmark scored ${score}.`,
      output,
    };
  }

  private createAttempt(
    run: ResearchRun,
    iteration: number,
    outcome: ResearchAttemptOutcome,
    extras?: Partial<ResearchAttempt>,
  ): ResearchAttempt {
    return {
      id: this.createId("attempt"),
      iteration,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      outcome,
      bestScoreAfter: run.bestScore,
      ...extras,
    };
  }

  private buildIterationPrompt(
    profile: ResearchProfile,
    bestScore: number | undefined,
    iteration: number,
  ): string {
    const bestText = typeof bestScore === "number" ? String(bestScore) : "none";
    return [
      `You are running bounded repo-local benchmark research iteration ${iteration}.`,
      "Make one focused candidate change and then stop.",
      "Only modify the allowlisted workspace-relative files below. Do not touch any other file.",
      `Editable files: ${profile.editablePaths.join(", ")}`,
      `Benchmark command: ${profile.benchmarkCommand}`,
      `Metric regex: ${profile.metricPattern}`,
      `Optimization direction: ${profile.metricDirection}`,
      `Current best score: ${bestText}`,
      "After applying one candidate change, stop and wait for the benchmark.",
      "Instructions:",
      profile.instructions,
    ].join("\n\n");
  }

  private async waitForAllowlistedChanges(
    workspaceRoot: string,
    editablePaths: string[],
    baseline: SnapshotBufferMap,
    maxWaitMs: number,
  ): Promise<{ changedPaths: string[]; snapshot: SnapshotBufferMap }> {
    const deadline = Date.now() + maxWaitMs;
    let lastChangedAt = 0;
    let currentChanged: string[] = [];
    let currentSnapshot = baseline;

    while (Date.now() < deadline) {
      if (this.stopRequested) {
        break;
      }
      await this.delay(POLL_INTERVAL_MS);
      currentSnapshot = await this.readAllowlistedSnapshot(workspaceRoot, editablePaths);
      currentChanged = this.diffSnapshots(baseline, currentSnapshot);
      if (currentChanged.length === 0) {
        continue;
      }
      if (lastChangedAt === 0) {
        lastChangedAt = Date.now();
        continue;
      }
      if (Date.now() - lastChangedAt >= QUIET_WINDOW_MS) {
        return {
          changedPaths: currentChanged,
          snapshot: currentSnapshot,
        };
      }
      lastChangedAt = Date.now();
    }

    return {
      changedPaths: [],
      snapshot: baseline,
    };
  }

  private async runCommand(
    command: string,
    cwd: string,
    timeoutMs: number,
  ): Promise<CommandResult> {
    return await new Promise<CommandResult>((resolve, reject) => {
      const child = spawn(command, {
        cwd,
        shell: true,
        windowsHide: true,
        env: process.env,
      });
      this.activeChild = child;

      let stdout = "";
      let stderr = "";
      let finished = false;
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        void this.killChildProcess(child).finally(() => {
          if (finished) {
            return;
          }
          finished = true;
          resolve({ exitCode: null, stdout, stderr, timedOut: true });
        });
      }, timeoutMs);

      child.stdout?.on("data", (chunk: Buffer | string) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        if (finished) {
          return;
        }
        finished = true;
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (finished) {
          return;
        }
        finished = true;
        resolve({ exitCode: code, stdout, stderr, timedOut });
      });
    });
  }

  private parseMetric(output: string, pattern: string): number | undefined {
    try {
      const regex = new RegExp(pattern, "m");
      const match = regex.exec(output);
      if (!match) {
        return undefined;
      }
      const candidate = match[1] ?? match[0];
      const parsed = Number(candidate);
      return Number.isFinite(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  private isScoreImproved(
    score: number,
    bestScore: number | undefined,
    direction: ResearchProfile["metricDirection"],
  ): boolean {
    if (typeof bestScore !== "number") {
      return true;
    }
    return direction === "minimize" ? score < bestScore : score > bestScore;
  }

  private async readAllowlistedSnapshot(
    workspaceRoot: string,
    editablePaths: string[],
  ): Promise<SnapshotBufferMap> {
    const snapshot: SnapshotBufferMap = new Map();
    for (const relativePath of editablePaths) {
      const absolutePath = path.join(workspaceRoot, relativePath);
      if (!fs.existsSync(absolutePath)) {
        snapshot.set(relativePath, null);
        continue;
      }
      snapshot.set(relativePath, fs.readFileSync(absolutePath));
    }
    return snapshot;
  }

  private diffSnapshots(before: SnapshotBufferMap, after: SnapshotBufferMap): string[] {
    const changed = new Set<string>();
    for (const [relativePath, previous] of before.entries()) {
      const next = after.get(relativePath);
      const identical =
        previous === null
          ? next === null
          : next instanceof Buffer && previous.equals(next);
      if (!identical) {
        changed.add(relativePath);
      }
    }
    for (const relativePath of after.keys()) {
      if (!before.has(relativePath)) {
        changed.add(relativePath);
      }
    }
    return Array.from(changed.values()).sort();
  }

  private async writeSnapshot(
    workspaceRoot: string,
    runId: string,
    label: string,
    snapshot: SnapshotBufferMap,
  ): Promise<ResearchSnapshotInfo> {
    const snapshotId = this.createId("snapshot");
    const snapshotRoot = path.join(
      this.getHistoryRoot(workspaceRoot),
      runId,
      "snapshots",
      snapshotId,
    );
    fs.mkdirSync(snapshotRoot, { recursive: true });

    const manifest: Array<{ path: string; exists: boolean }> = [];
    for (const [relativePath, value] of snapshot.entries()) {
      manifest.push({ path: relativePath, exists: value instanceof Buffer });
      if (!(value instanceof Buffer)) {
        continue;
      }
      const targetPath = path.join(snapshotRoot, relativePath);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, value);
    }

    fs.writeFileSync(
      path.join(snapshotRoot, "manifest.json"),
      JSON.stringify({ label, manifest }, null, 2),
      "utf8",
    );

    return {
      id: snapshotId,
      createdAt: new Date().toISOString(),
      label,
    };
  }

  private async restoreSnapshot(
    workspaceRoot: string,
    snapshot: SnapshotBufferMap,
  ): Promise<void> {
    for (const [relativePath, value] of snapshot.entries()) {
      const absolutePath = path.join(workspaceRoot, relativePath);
      if (!(value instanceof Buffer)) {
        if (fs.existsSync(absolutePath)) {
          fs.rmSync(absolutePath, { force: true });
        }
        continue;
      }
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, value);
    }
  }

  private async getGitChangedFiles(workspaceRoot: string): Promise<string[] | undefined> {
    try {
      const result = await this.runCommand(
        "git status --porcelain=v1 -uall",
        workspaceRoot,
        15_000,
      );
      if (result.exitCode !== 0 || result.timedOut) {
        return undefined;
      }
      return result.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 3)
        .map((line) => {
          const payload = line.slice(3).trim();
          const renameIndex = payload.lastIndexOf(" -> ");
          const finalPath = renameIndex >= 0 ? payload.slice(renameIndex + 4) : payload;
          return normalizeRelativePath(finalPath);
        })
        .filter((line) => line.length > 0);
    } catch {
      return undefined;
    }
  }

  private detectExternalChanges(
    before: string[] | undefined,
    after: string[] | undefined,
    editablePaths: string[],
  ): string[] {
    if (!before || !after) {
      return [];
    }
    const beforeSet = new Set(before.map((entry) => normalizeRelativePath(entry)));
    const allowlist = new Set(editablePaths.map((entry) => normalizeRelativePath(entry)));
    return after
      .map((entry) => normalizeRelativePath(entry))
      .filter((entry) => !beforeSet.has(entry) && !allowlist.has(entry));
  }

  private normalizeProfile(
    input: Partial<CreateResearchProfileInput>,
    workspaceRoot: string,
  ): ResearchProfile {
    const name = String(input.name ?? "").trim();
    if (!name) {
      throw new Error("Research profile name is required.");
    }
    const benchmarkCommand = String(input.benchmarkCommand ?? "").trim();
    if (!benchmarkCommand) {
      throw new Error("Benchmark command is required.");
    }
    const metricPattern = String(input.metricPattern ?? "").trim();
    if (!metricPattern) {
      throw new Error("Metric regex is required.");
    }
    const normalizedPaths = Array.isArray(input.editablePaths)
      ? input.editablePaths
        .map((entry) => normalizeRelativePath(String(entry ?? "")))
        .filter((entry) => entry.length > 0)
      : [];
    if (normalizedPaths.length === 0) {
      throw new Error("Add at least one editable file path.");
    }

    for (const relativePath of normalizedPaths) {
      if (path.isAbsolute(relativePath)) {
        throw new Error("Editable paths must be workspace-relative.");
      }
      const absolutePath = path.resolve(workspaceRoot, relativePath);
      const relativeCheck = normalizeRelativePath(path.relative(workspaceRoot, absolutePath));
      if (!relativeCheck || relativeCheck.startsWith("../")) {
        throw new Error(`Editable path escapes the workspace: ${relativePath}`);
      }
    }

    return {
      id: "",
      name,
      instructions: String(input.instructions ?? "").trim(),
      editablePaths: Array.from(new Set(normalizedPaths)),
      benchmarkCommand,
      metricPattern,
      metricDirection: input.metricDirection === "minimize" ? "minimize" : "maximize",
      maxIterations: clampInteger(input.maxIterations, 3, 0, 25),
      maxMinutes: clampInteger(input.maxMinutes, 15, 1, 240),
      maxConsecutiveFailures: clampInteger(input.maxConsecutiveFailures, 2, 1, 10),
      benchmarkTimeoutSeconds: clampInteger(input.benchmarkTimeoutSeconds, 180, 5, 3600),
      editWaitSeconds: clampInteger(input.editWaitSeconds, 20, 5, 300),
      agent: typeof input.agent === "string" ? input.agent : undefined,
      model: typeof input.model === "string" ? input.model : undefined,
      createdAt: "",
      updatedAt: "",
    };
  }

  private loadState(): void {
    const workspaceRoot = this.getPrimaryWorkspaceRoot();
    if (!workspaceRoot) {
      this.profiles.clear();
      this.runs = [];
      this.activeRunId = undefined;
      return;
    }
    const configPath = this.getConfigPath(workspaceRoot);
    if (!fs.existsSync(configPath)) {
      this.profiles.clear();
      this.runs = [];
      this.activeRunId = undefined;
      return;
    }

    try {
      const raw = fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/, "");
      const parsed = this.normalizeResearchState(JSON.parse(raw) as Partial<ResearchWorkspaceConfig>);
      this.profiles = new Map(parsed.profiles.map((profile) => [profile.id, profile]));
      this.runs = parsed.runs;
      this.activeRunId = undefined;
    } catch (error) {
      logError("[CopilotScheduler] Failed to load research state:", toSafeErrorDetails(error));
      this.profiles.clear();
      this.runs = [];
      this.activeRunId = undefined;
    }
  }

  private isWorkspaceSqliteModeEnabled(): boolean {
    const workspaceRoot = this.getPrimaryWorkspaceRoot();
    if (!workspaceRoot) {
      return false;
    }
    return getConfiguredSchedulerStorageMode(vscode.Uri.file(workspaceRoot)) === SQLITE_STORAGE_MODE;
  }

  private scheduleSqliteResearchHydration(): void {
    const workspaceRoot = this.getPrimaryWorkspaceRoot();
    if (!workspaceRoot || !this.isWorkspaceSqliteModeEnabled() || this.sqliteHydrationPromise) {
      return;
    }

    this.sqliteHydrationPromise = this.hydrateResearchStateFromSqlite(workspaceRoot)
      .catch((error) =>
        logError("[CopilotScheduler] SQLite research hydration failed:", toSafeErrorDetails(error)),
      )
      .finally(() => {
        this.sqliteHydrationPromise = undefined;
      });
  }

  private async hydrateResearchStateFromSqlite(workspaceRoot: string): Promise<void> {
    const sqliteState = this.normalizeResearchState(
      await readWorkspaceResearchStateFromSqlite(workspaceRoot),
    );

    if (sqliteState.profiles.length === 0 && sqliteState.runs.length === 0) {
      return;
    }

    this.profiles = new Map(sqliteState.profiles.map((profile) => [profile.id, profile]));
    this.runs = sqliteState.runs;
    this.activeRunId = undefined;
    this.notifyChanged();
  }

  private normalizeResearchState(
    config: {
      profiles?: unknown[];
      runs?: unknown[];
    },
  ): { profiles: ResearchProfile[]; runs: ResearchRun[] } {
    const profiles = Array.isArray(config.profiles)
      ? config.profiles
        .filter((profile): profile is ResearchProfile => !!profile && typeof (profile as ResearchProfile).id === "string")
      : [];
    const runs = Array.isArray(config.runs)
      ? config.runs
        .filter((run): run is ResearchRun => !!run && typeof (run as ResearchRun).id === "string")
        .map((run): ResearchRun => {
          if (run.status === "running" || run.status === "stopping") {
            return {
              ...run,
              status: "stopped",
              finishedAt: run.finishedAt || new Date().toISOString(),
              stopReason: run.stopReason || "VS Code restarted during the run.",
            };
          }
          return run;
        })
        .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
      : [];

    return { profiles, runs };
  }

  private async saveState(): Promise<void> {
    const workspaceRoot = this.getPrimaryWorkspaceRoot();
    if (!workspaceRoot) {
      return;
    }
    const configPath = this.getConfigPath(workspaceRoot);
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    const payload: ResearchWorkspaceConfig = {
      version: RESEARCH_CONFIG_VERSION,
      profiles: this.getAllProfiles(),
      runs: this.runs.slice(0, 30),
    };
    fs.writeFileSync(configPath, JSON.stringify(payload, null, 2), "utf8");
    if (this.isWorkspaceSqliteModeEnabled()) {
      await syncWorkspaceResearchStateToSqlite(workspaceRoot, payload);
    }

    for (const run of this.runs.slice(0, 10)) {
      this.writeRunRecord(workspaceRoot, run);
    }
    this.notifyChanged();
  }

  private writeRunRecord(workspaceRoot: string, run: ResearchRun): void {
    const runRoot = path.join(this.getHistoryRoot(workspaceRoot), run.id);
    fs.mkdirSync(runRoot, { recursive: true });
    fs.writeFileSync(
      path.join(runRoot, "run.json"),
      JSON.stringify(run, null, 2),
      "utf8",
    );
  }

  private notifyChanged(): void {
    if (this.onChangedCallback) {
      this.onChangedCallback();
    }
  }

  private getPrimaryWorkspaceRoot(): string | undefined {
    const roots = getResolvedWorkspaceRoots(
      (vscode.workspace.workspaceFolders ?? [])
        .map((folder) => folder.uri.fsPath)
        .filter((folderPath): folderPath is string =>
          typeof folderPath === "string" && folderPath.trim().length > 0,
        ),
    );
    return roots[0];
  }

  private getConfigPath(workspaceRoot: string): string {
    return path.join(workspaceRoot, ".vscode", RESEARCH_CONFIG_FILE);
  }

  private getHistoryRoot(workspaceRoot: string): string {
    return path.join(workspaceRoot, ".vscode", RESEARCH_HISTORY_DIR);
  }

  private createId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async killChildProcess(child: ChildProcess): Promise<void> {
    const pid = child.pid;
    if (!pid) {
      return;
    }
    if (process.platform === "win32") {
      await new Promise<void>((resolve) => {
        const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
          windowsHide: true,
        });
        killer.on("close", () => resolve());
        killer.on("error", () => resolve());
      });
      return;
    }
    try {
      child.kill("SIGTERM");
    } catch {
      // ignore cleanup failures
    }
  }
}
