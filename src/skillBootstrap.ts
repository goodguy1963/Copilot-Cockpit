import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";
import {
  type ParsedSkillMetadata,
  listSkillMetadataInDirectory,
} from "./skillMetadata";

export const BUNDLED_SKILLS_RELATIVE_PATH = path.join(
  ".github",
  "skills",
);

export const BUNDLED_AGENTS_RELATIVE_PATH = path.join(
  ".github",
  "agents",
);

export const BUNDLED_REPO_KNOWLEDGE_RELATIVE_PATH = path.join(
  ".github",
  "repo-knowledge",
);

export const BUNDLED_REPO_KNOWLEDGE_TEMPLATE_RELATIVE_PATH = path.join(
  BUNDLED_AGENTS_RELATIVE_PATH,
  "system",
  "repo-knowledge-template",
);

export const PACKAGED_BUNDLED_AGENTS_ROOT_RELATIVE_PATH = path.join(
  "out",
  "bundled-agents",
);

export const PACKAGED_BUNDLED_AGENTS_RELATIVE_PATH = path.join(
  PACKAGED_BUNDLED_AGENTS_ROOT_RELATIVE_PATH,
  BUNDLED_AGENTS_RELATIVE_PATH,
);

export const PACKAGED_BUNDLED_REPO_KNOWLEDGE_RELATIVE_PATH = path.join(
  PACKAGED_BUNDLED_AGENTS_ROOT_RELATIVE_PATH,
  BUNDLED_REPO_KNOWLEDGE_RELATIVE_PATH,
);

export const BUNDLED_AGENTS_STAGE_SUPPORT_RELATIVE_PATH = path.join(
  ".vscode",
  "copilot-cockpit-support",
  "bundled-agents",
);

export const STAGED_BUNDLED_AGENTS_RELATIVE_PATH = path.join(
  BUNDLED_AGENTS_STAGE_SUPPORT_RELATIVE_PATH,
  BUNDLED_AGENTS_RELATIVE_PATH,
);

export const STAGED_BUNDLED_REPO_KNOWLEDGE_RELATIVE_PATH = path.join(
  BUNDLED_AGENTS_STAGE_SUPPORT_RELATIVE_PATH,
  BUNDLED_REPO_KNOWLEDGE_RELATIVE_PATH,
);

export const STAGED_BUNDLED_AGENTS_MANIFEST_RELATIVE_PATH = path.join(
  BUNDLED_AGENTS_STAGE_SUPPORT_RELATIVE_PATH,
  "manifest.json",
);

export const CODEX_SKILLS_RELATIVE_PATH = path.join(
  ".agents",
  "skills",
);

export const CODEX_AGENTS_RELATIVE_PATH = "AGENTS.md";

export const COCKPIT_SCHEDULER_SKILL_RELATIVE_PATH = path.join(
  ".github",
  "skills",
  "cockpit-scheduler-agent",
  "SKILL.md",
);

export const SCHEDULER_SKILL_RELATIVE_PATH =
  COCKPIT_SCHEDULER_SKILL_RELATIVE_PATH;

export const COCKPIT_TODO_SKILL_RELATIVE_PATH = path.join(
  ".github",
  "skills",
  "cockpit-todo-agent",
  "SKILL.md",
);

export type BundledSkillSyncState = Record<string, Record<string, string>>;

export interface BundledSkillSyncResult {
  createdPaths: string[];
  updatedPaths: string[];
  skippedPaths: string[];
  unchangedPaths: string[];
  nextState: BundledSkillSyncState;
}

export interface StagedBundledAgentsManifestEntry {
  sourceRelativePath: string;
  stagedRelativePath: string;
  liveRelativePath: string;
}

export interface StagedBundledAgentsManifest {
  manifestVersion: 1;
  workspaceRoot: string;
  sourceAgentsAbsolutePath: string;
  sourceAgentsRelativePath: string;
  sourceRepoKnowledgeAbsolutePath?: string;
  sourceRepoKnowledgeRelativePath?: string;
  liveAgentsAbsolutePath: string;
  liveAgentsRelativePath: string;
  liveRepoKnowledgeAbsolutePath: string;
  liveRepoKnowledgeRelativePath: string;
  stagedRootAbsolutePath: string;
  stagedRootRelativePath: string;
  stagedAgentsAbsolutePath: string;
  stagedAgentsRelativePath: string;
  stagedRepoKnowledgeAbsolutePath: string;
  stagedRepoKnowledgeRelativePath: string;
  manifestAbsolutePath: string;
  manifestRelativePath: string;
  files: StagedBundledAgentsManifestEntry[];
}

export interface StagedBundledAgentsResult {
  stagedRoots: string[];
  stagedPaths: string[];
  manifestPaths: string[];
}

interface BundledAgentsSource {
  absolutePath: string;
  relativePath: string;
}

interface BundledAgentSystemSources {
  bundledAgentsSource: BundledAgentsSource;
  bundledRepoKnowledgeSource?: BundledAgentsSource;
}

interface ParsedBundledAgentMetadata {
  description?: string;
  name: string;
  relativePath: string;
}

const BUNDLED_SKILL_CUSTOMIZE_FRONTMATTER_KEY = "copilotCockpitCustomize";
const CODEX_AGENTS_MANAGED_START = "<!-- copilot-cockpit-codex:start -->";
const CODEX_AGENTS_MANAGED_END = "<!-- copilot-cockpit-codex:end -->";
const STARTER_AGENT_FILE_NAMES = new Set([
  "ceo.agent.md",
  "planner.agent.md",
  "remediation-implementer.agent.md",
  "documentation-specialist.agent.md",
  "custom-agent-foundry.agent.md",
  "cockpit-todo-expert.agent.md",
]);
const LEGACY_BUNDLED_SKILL_RELATIVE_PATHS = new Set([
  path.join(BUNDLED_SKILLS_RELATIVE_PATH, "prefab-mcp", "SKILL.md"),
]);
const LEGACY_CUSTOM_AGENT_FILE_NAMES = new Set(["prefab.agent.md"]);
const BUNDLED_REPO_KNOWLEDGE_TEMPLATE_AGENTS_SUBTREE_RELATIVE_PATH = path.join(
  "system",
  "repo-knowledge-template",
);

function isLegacyBundledSkillRelativePath(relativePath: string): boolean {
  return LEGACY_BUNDLED_SKILL_RELATIVE_PATHS.has(path.normalize(relativePath));
}

function isLegacyCustomAgentRelativePath(relativePath: string): boolean {
  return LEGACY_CUSTOM_AGENT_FILE_NAMES.has(path.normalize(relativePath));
}

function isBundledRepoKnowledgeTemplateAgentRelativePath(relativePath: string): boolean {
  const normalizedRelativePath = path.normalize(relativePath);
  const normalizedTemplatePath = path.normalize(
    BUNDLED_REPO_KNOWLEDGE_TEMPLATE_AGENTS_SUBTREE_RELATIVE_PATH,
  );
  return normalizedRelativePath === normalizedTemplatePath
    || normalizedRelativePath.startsWith(`${normalizedTemplatePath}${path.sep}`);
}

function mapBundledSkillPathToCodex(relativePath: string): string {
  return path.join(
    CODEX_SKILLS_RELATIVE_PATH,
    path.relative(BUNDLED_SKILLS_RELATIVE_PATH, relativePath),
  );
}

function formatManagedSkillLine(
  label: string,
  skillMetadata: ParsedSkillMetadata[],
): string | undefined {
  if (skillMetadata.length === 0) {
    return undefined;
  }

  const details = skillMetadata
    .map((entry) => {
      const summary = entry.promptSummary?.trim();
      return summary ? `${entry.name} (${summary})` : entry.name;
    })
    .join(", ");

  return `- ${label}: ${details}.`;
}

function parseSimpleFrontmatterValues(content: string): Map<string, string> {
  const frontmatterMatch = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!frontmatterMatch) {
    return new Map<string, string>();
  }

  const values = new Map<string, string>();
  for (const line of frontmatterMatch[1].split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.+?)\s*$/.exec(line.trim());
    if (match) {
      values.set(match[1], match[2].trim().replace(/^['"]|['"]$/g, ""));
    }
  }

  return values;
}

function listBundledCustomAgentMetadata(extensionRoot: string): ParsedBundledAgentMetadata[] {
  const bundledAgentsSource = resolveBundledAgentsSource(extensionRoot);
  const bundledAgentsRoot = bundledAgentsSource.absolutePath;

  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(bundledAgentsRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isFile())
    .filter((entry) => entry.name.toLowerCase().endsWith(".agent.md"))
    .filter((entry) => !STARTER_AGENT_FILE_NAMES.has(entry.name))
    .filter((entry) => !LEGACY_CUSTOM_AGENT_FILE_NAMES.has(entry.name))
    .map((entry) => {
      const absolutePath = path.join(bundledAgentsRoot, entry.name);
      const frontmatterValues = parseSimpleFrontmatterValues(
        fs.readFileSync(absolutePath, "utf8"),
      );
      const name = frontmatterValues.get("name") || path.basename(entry.name, ".agent.md");
      const description = frontmatterValues.get("description");
      return {
        description,
        name,
        relativePath: path.join(BUNDLED_AGENTS_RELATIVE_PATH, entry.name),
      };
    })
    .filter((entry) => entry.name.length > 0)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function formatManagedCustomAgentLine(
  customAgents: ParsedBundledAgentMetadata[],
): string | undefined {
  if (customAgents.length === 0) {
    return undefined;
  }

  const details = customAgents
    .map((entry) => {
      const description = entry.description?.trim();
      const location = `\`${entry.relativePath.replace(/\\/g, "/")}\``;
      return description
        ? `\`${entry.name}\` in ${location} ${description}`
        : `\`${entry.name}\` in ${location}`;
    })
    .join(", ");

  return `- Repo-local custom agents: ${details}.`;
}

function buildManagedCodexAgentsBlock(extensionRoot: string): string {
  const bundledSkillsRoot = path.join(extensionRoot, BUNDLED_SKILLS_RELATIVE_PATH);
  const skillMetadata = listSkillMetadataInDirectory(bundledSkillsRoot);
  const customAgents = listBundledCustomAgentMetadata(extensionRoot);
  const operationalLine = formatManagedSkillLine(
    "Operational skills",
    skillMetadata.filter((entry) => entry.type === "operational"),
  );
  const supportLine = formatManagedSkillLine(
    "Support skills",
    skillMetadata.filter((entry) => entry.type === "support"),
  );
  const customAgentLine = formatManagedCustomAgentLine(customAgents);

  return [
    CODEX_AGENTS_MANAGED_START,
    "## Copilot Cockpit",
    "",
    "- Repo-local Codex skills for this project live under `.agents/skills`.",
    "- Repo-local Codex MCP config for this project lives in `.codex/config.toml`.",
    operationalLine,
    supportLine,
    customAgentLine,
    "- Codex cannot start a new session through the Copilot Cockpit task scheduler integration. Creating and running task drafts from Codex is still a manual step in this repo.",
    CODEX_AGENTS_MANAGED_END,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

function upsertManagedCodexAgentsDoc(
  extensionRoot: string,
  content: string | undefined,
): {
  content: string;
  changed: boolean;
  created: boolean;
} {
  const managedBlock = buildManagedCodexAgentsBlock(extensionRoot);
  const normalized = (content ?? "").replace(/\r\n/g, "\n");
  const pattern = new RegExp(
    `${CODEX_AGENTS_MANAGED_START}[\\s\\S]*?${CODEX_AGENTS_MANAGED_END}`,
    "m",
  );

  if (!normalized.trim()) {
    return {
      content: `${managedBlock}\n`,
      changed: true,
      created: true,
    };
  }

  if (pattern.test(normalized)) {
    const nextContent = normalized.replace(pattern, managedBlock);
    return {
      content: nextContent.endsWith("\n") ? nextContent : `${nextContent}\n`,
      changed: nextContent !== normalized,
      created: false,
    };
  }

  const separator = normalized.endsWith("\n") ? "\n" : "\n\n";
  const nextContent = `${normalized}${separator}${managedBlock}\n`;
  return {
    content: nextContent,
    changed: true,
    created: false,
  };
}

async function collectBundledSkillSyncResult(
  extensionRoot: string,
  workspaceRoots: string[],
  syncState: BundledSkillSyncState = {},
  applyChanges: boolean,
): Promise<BundledSkillSyncResult> {
  const normalizedState = normalizeSyncState(syncState);
  const result: BundledSkillSyncResult = {
    createdPaths: [],
    updatedPaths: [],
    skippedPaths: [],
    unchangedPaths: [],
    nextState: { ...normalizedState },
  };

  if (!extensionRoot || workspaceRoots.length === 0) {
    return result;
  }

  const bundledRelativePaths = await collectBundledRelativeFilePaths(
    extensionRoot,
    BUNDLED_SKILLS_RELATIVE_PATH,
  );
  if (bundledRelativePaths.length === 0) {
    return result;
  }

  const bundledContentByRelativePath = new Map<string, string>();

  for (const workspaceRoot of workspaceRoots) {
    if (!workspaceRoot) {
      continue;
    }

    const previousWorkspaceState = normalizedState[workspaceRoot] ?? {};
    const nextWorkspaceState: Record<string, string> = {};

    for (const relativePath of bundledRelativePaths) {
      let bundledContent = bundledContentByRelativePath.get(relativePath);
      if (bundledContent === undefined) {
        bundledContent = await fs.promises.readFile(
          path.join(extensionRoot, relativePath),
          "utf8",
        );
        bundledContentByRelativePath.set(relativePath, bundledContent);
      }

      const bundledHash = createContentHash(bundledContent);
      const targetPath = path.join(workspaceRoot, relativePath);
      const previousManagedHash = previousWorkspaceState[relativePath];

      let currentContent: string | undefined;
      try {
        currentContent = await fs.promises.readFile(targetPath, "utf8");
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error
          ? String((error as { code?: unknown }).code)
          : "";
        if (code && code !== "ENOENT") {
          throw error;
        }
      }

      if (currentContent === undefined) {
        if (applyChanges) {
          await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
          await fs.promises.writeFile(targetPath, bundledContent, "utf8");
        }
        result.createdPaths.push(targetPath);
        nextWorkspaceState[relativePath] = bundledHash;
        continue;
      }

      const currentHash = createContentHash(currentContent);
      if (currentHash === bundledHash) {
        result.unchangedPaths.push(targetPath);
        nextWorkspaceState[relativePath] = bundledHash;
        continue;
      }

      if (previousManagedHash && currentHash === previousManagedHash) {
        if (applyChanges) {
          await fs.promises.writeFile(targetPath, bundledContent, "utf8");
        }
        result.updatedPaths.push(targetPath);
        nextWorkspaceState[relativePath] = bundledHash;
        continue;
      }

      if (!isBundledSkillCustomizationProtected(currentContent)) {
        if (applyChanges) {
          await fs.promises.writeFile(targetPath, bundledContent, "utf8");
        }
        result.updatedPaths.push(targetPath);
        nextWorkspaceState[relativePath] = bundledHash;
        continue;
      }

      result.skippedPaths.push(targetPath);
      if (previousManagedHash) {
        nextWorkspaceState[relativePath] = previousManagedHash;
      }
    }

    if (Object.keys(nextWorkspaceState).length > 0) {
      result.nextState[workspaceRoot] = nextWorkspaceState;
    } else {
      delete result.nextState[workspaceRoot];
    }
  }

  return result;
}

export function getBundledSchedulerSkillPath(extensionRoot: string): string {
  return path.join(extensionRoot, SCHEDULER_SKILL_RELATIVE_PATH);
}

export function getBundledCockpitTodoSkillPath(extensionRoot: string): string {
  return path.join(extensionRoot, COCKPIT_TODO_SKILL_RELATIVE_PATH);
}

function createContentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function isBundledSkillCustomizationProtected(content: string): boolean {
  const frontmatterValues = parseSimpleFrontmatterValues(content);
  if (frontmatterValues.size === 0) {
    return false;
  }

  return /^true$/i.test(
    frontmatterValues.get(BUNDLED_SKILL_CUSTOMIZE_FRONTMATTER_KEY) || "false",
  );
}

function normalizeSyncState(
  syncState: BundledSkillSyncState | undefined,
): BundledSkillSyncState {
  if (!syncState || typeof syncState !== "object") {
    return {};
  }

  const nextState: BundledSkillSyncState = {};
  for (const [workspaceRoot, fileHashes] of Object.entries(syncState)) {
    if (!workspaceRoot || !fileHashes || typeof fileHashes !== "object") {
      continue;
    }

    const normalizedEntries = Object.entries(fileHashes).filter(
      ([relativePath, hash]) =>
        Boolean(relativePath) && typeof hash === "string" && hash.length > 0,
    );
    if (normalizedEntries.length === 0) {
      continue;
    }

    nextState[workspaceRoot] = Object.fromEntries(normalizedEntries);
  }

  return nextState;
}

async function collectBundledRelativeFilePaths(
  extensionRoot: string,
  relativeDirectory: string,
): Promise<string[]> {
  const directoryPath = path.join(extensionRoot, relativeDirectory);

  try {
    const stat = await fs.promises.stat(directoryPath);
    if (!stat.isDirectory()) {
      return [];
    }
  } catch {
    return [];
  }

  const relativePaths: string[] = [];
  const pendingDirectories = [directoryPath];

  while (pendingDirectories.length > 0) {
    const currentDirectory = pendingDirectories.pop();
    if (!currentDirectory) {
      continue;
    }

    const entries = await fs.promises.readdir(currentDirectory, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      const absoluteEntryPath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        pendingDirectories.push(absoluteEntryPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      const relativePath = path.relative(extensionRoot, absoluteEntryPath);
      if (isLegacyBundledSkillRelativePath(relativePath)) {
        continue;
      }

      relativePaths.push(relativePath);
    }
  }

  return relativePaths.sort((left, right) => left.localeCompare(right));
}

async function collectRelativeFilePaths(rootPath: string): Promise<string[]> {
  try {
    const stat = await fs.promises.stat(rootPath);
    if (!stat.isDirectory()) {
      return [];
    }
  } catch {
    return [];
  }

  const relativePaths: string[] = [];
  const pendingDirectories = [rootPath];

  while (pendingDirectories.length > 0) {
    const currentDirectory = pendingDirectories.pop();
    if (!currentDirectory) {
      continue;
    }

    const entries = await fs.promises.readdir(currentDirectory, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      const absoluteEntryPath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        pendingDirectories.push(absoluteEntryPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      relativePaths.push(path.relative(rootPath, absoluteEntryPath));
    }
  }

  return relativePaths.sort((left, right) => left.localeCompare(right));
}

export function resolveBundledAgentsSource(extensionRoot: string): BundledAgentsSource {
  const packagedAbsolutePath = path.join(
    extensionRoot,
    PACKAGED_BUNDLED_AGENTS_RELATIVE_PATH,
  );
  if (fs.existsSync(packagedAbsolutePath)) {
    return {
      absolutePath: packagedAbsolutePath,
      relativePath: PACKAGED_BUNDLED_AGENTS_RELATIVE_PATH,
    };
  }

  return {
    absolutePath: path.join(extensionRoot, BUNDLED_AGENTS_RELATIVE_PATH),
    relativePath: BUNDLED_AGENTS_RELATIVE_PATH,
  };
}

export function resolveBundledRepoKnowledgeSource(
  extensionRoot: string,
): BundledAgentsSource | undefined {
  const packagedAbsolutePath = path.join(
    extensionRoot,
    PACKAGED_BUNDLED_REPO_KNOWLEDGE_RELATIVE_PATH,
  );
  if (fs.existsSync(packagedAbsolutePath)) {
    return {
      absolutePath: packagedAbsolutePath,
      relativePath: PACKAGED_BUNDLED_REPO_KNOWLEDGE_RELATIVE_PATH,
    };
  }

  const templateAbsolutePath = path.join(
    extensionRoot,
    BUNDLED_REPO_KNOWLEDGE_TEMPLATE_RELATIVE_PATH,
  );
  if (fs.existsSync(templateAbsolutePath)) {
    return {
      absolutePath: templateAbsolutePath,
      relativePath: BUNDLED_REPO_KNOWLEDGE_TEMPLATE_RELATIVE_PATH,
    };
  }

  return undefined;
}

interface BundledAgentSourceEntry {
  liveRelativePath: string;
  sourceAbsolutePath: string;
  sourceRelativePath: string;
  stagedRelativePath: string;
}

async function collectBundledAgentSourceEntries(
  extensionRoot: string,
): Promise<BundledAgentSystemSources & { entries: BundledAgentSourceEntry[] }> {
  const bundledAgentsSource = resolveBundledAgentsSource(extensionRoot);
  const bundledRepoKnowledgeSource = resolveBundledRepoKnowledgeSource(extensionRoot);
  const agentSourceRelativePaths = (await collectRelativeFilePaths(
    bundledAgentsSource.absolutePath,
  )).filter((sourceRelativePath) => {
    return !isLegacyCustomAgentRelativePath(sourceRelativePath)
      && !isBundledRepoKnowledgeTemplateAgentRelativePath(sourceRelativePath);
  });

  const repoKnowledgeRelativePaths = bundledRepoKnowledgeSource
    ? await collectRelativeFilePaths(bundledRepoKnowledgeSource.absolutePath)
    : [];

  const entries = [
    ...agentSourceRelativePaths.map((sourceRelativePath) => ({
      liveRelativePath: path.join(BUNDLED_AGENTS_RELATIVE_PATH, sourceRelativePath),
      sourceAbsolutePath: path.join(
        bundledAgentsSource.absolutePath,
        sourceRelativePath,
      ),
      sourceRelativePath: path.join(
        bundledAgentsSource.relativePath,
        sourceRelativePath,
      ),
      stagedRelativePath: path.join(
        STAGED_BUNDLED_AGENTS_RELATIVE_PATH,
        sourceRelativePath,
      ),
    })),
    ...repoKnowledgeRelativePaths.map((sourceRelativePath) => ({
      liveRelativePath: path.join(
        BUNDLED_REPO_KNOWLEDGE_RELATIVE_PATH,
        sourceRelativePath,
      ),
      sourceAbsolutePath: path.join(
        bundledRepoKnowledgeSource!.absolutePath,
        sourceRelativePath,
      ),
      sourceRelativePath: path.join(
        bundledRepoKnowledgeSource!.relativePath,
        sourceRelativePath,
      ),
      stagedRelativePath: path.join(
        STAGED_BUNDLED_REPO_KNOWLEDGE_RELATIVE_PATH,
        sourceRelativePath,
      ),
    })),
  ].sort((left, right) => left.sourceRelativePath.localeCompare(right.sourceRelativePath));

  return {
    bundledAgentsSource,
    bundledRepoKnowledgeSource,
    entries,
  };
}

function buildStagedBundledAgentsManifest(
  sources: BundledAgentSystemSources,
  workspaceRoot: string,
  bundledRelativePaths: BundledAgentSourceEntry[],
): StagedBundledAgentsManifest {
  const stagedRootAbsolutePath = path.join(
    workspaceRoot,
    BUNDLED_AGENTS_STAGE_SUPPORT_RELATIVE_PATH,
  );
  const stagedAgentsAbsolutePath = path.join(
    workspaceRoot,
    STAGED_BUNDLED_AGENTS_RELATIVE_PATH,
  );
  const stagedRepoKnowledgeAbsolutePath = path.join(
    workspaceRoot,
    STAGED_BUNDLED_REPO_KNOWLEDGE_RELATIVE_PATH,
  );
  const manifestAbsolutePath = path.join(
    workspaceRoot,
    STAGED_BUNDLED_AGENTS_MANIFEST_RELATIVE_PATH,
  );

  return {
    manifestVersion: 1,
    workspaceRoot,
    sourceAgentsAbsolutePath: sources.bundledAgentsSource.absolutePath,
    sourceAgentsRelativePath: sources.bundledAgentsSource.relativePath,
    sourceRepoKnowledgeAbsolutePath: sources.bundledRepoKnowledgeSource?.absolutePath,
    sourceRepoKnowledgeRelativePath: sources.bundledRepoKnowledgeSource?.relativePath,
    liveAgentsAbsolutePath: path.join(workspaceRoot, BUNDLED_AGENTS_RELATIVE_PATH),
    liveAgentsRelativePath: BUNDLED_AGENTS_RELATIVE_PATH,
    liveRepoKnowledgeAbsolutePath: path.join(
      workspaceRoot,
      BUNDLED_REPO_KNOWLEDGE_RELATIVE_PATH,
    ),
    liveRepoKnowledgeRelativePath: BUNDLED_REPO_KNOWLEDGE_RELATIVE_PATH,
    stagedRootAbsolutePath,
    stagedRootRelativePath: BUNDLED_AGENTS_STAGE_SUPPORT_RELATIVE_PATH,
    stagedAgentsAbsolutePath,
    stagedAgentsRelativePath: STAGED_BUNDLED_AGENTS_RELATIVE_PATH,
    stagedRepoKnowledgeAbsolutePath,
    stagedRepoKnowledgeRelativePath: STAGED_BUNDLED_REPO_KNOWLEDGE_RELATIVE_PATH,
    manifestAbsolutePath,
    manifestRelativePath: STAGED_BUNDLED_AGENTS_MANIFEST_RELATIVE_PATH,
    files: bundledRelativePaths.map((entry) => ({
      sourceRelativePath: entry.sourceRelativePath,
      stagedRelativePath: entry.stagedRelativePath,
      liveRelativePath: entry.liveRelativePath,
    })),
  };
}

export async function syncBundledSkillsForWorkspaceRoots(
  extensionRoot: string,
  workspaceRoots: string[],
  syncState: BundledSkillSyncState = {},
): Promise<BundledSkillSyncResult> {
  return collectBundledSkillSyncResult(
    extensionRoot,
    workspaceRoots,
    syncState,
    true,
  );
}

export async function previewBundledSkillSyncForWorkspaceRoots(
  extensionRoot: string,
  workspaceRoots: string[],
  syncState: BundledSkillSyncState = {},
): Promise<BundledSkillSyncResult> {
  return collectBundledSkillSyncResult(
    extensionRoot,
    workspaceRoots,
    syncState,
    false,
  );
}

export async function stageBundledAgentsForWorkspaceRoots(
  extensionRoot: string,
  workspaceRoots: string[],
): Promise<StagedBundledAgentsResult> {
  const result: StagedBundledAgentsResult = {
    stagedRoots: [],
    stagedPaths: [],
    manifestPaths: [],
  };

  if (!extensionRoot || workspaceRoots.length === 0) {
    return result;
  }

  const { bundledAgentsSource, bundledRepoKnowledgeSource, entries } = await collectBundledAgentSourceEntries(
    extensionRoot,
  );
  if (entries.length === 0) {
    return result;
  }

  for (const workspaceRoot of workspaceRoots) {
    if (!workspaceRoot) {
      continue;
    }

    const stagedRootPath = path.join(
      workspaceRoot,
      BUNDLED_AGENTS_STAGE_SUPPORT_RELATIVE_PATH,
    );
    await fs.promises.rm(stagedRootPath, { recursive: true, force: true });

    for (const entry of entries) {
      const bundledContent = await fs.promises.readFile(
        entry.sourceAbsolutePath,
        "utf8",
      );
      const stagedPath = path.join(workspaceRoot, entry.stagedRelativePath);
      await fs.promises.mkdir(path.dirname(stagedPath), { recursive: true });
      await fs.promises.writeFile(stagedPath, bundledContent, "utf8");
      result.stagedPaths.push(stagedPath);
    }

    const manifest = buildStagedBundledAgentsManifest(
      { bundledAgentsSource, bundledRepoKnowledgeSource },
      workspaceRoot,
      entries,
    );
    const manifestPath = path.join(
      workspaceRoot,
      STAGED_BUNDLED_AGENTS_MANIFEST_RELATIVE_PATH,
    );
    await fs.promises.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.promises.writeFile(
      manifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );

    result.stagedRoots.push(stagedRootPath);
    result.manifestPaths.push(manifestPath);
  }

  return result;
}

export async function syncBundledAgentsForWorkspaceRoots(
  extensionRoot: string,
  workspaceRoots: string[],
  syncState: BundledSkillSyncState = {},
): Promise<BundledSkillSyncResult> {
  const normalizedState = normalizeSyncState(syncState);
  const result: BundledSkillSyncResult = {
    createdPaths: [],
    updatedPaths: [],
    skippedPaths: [],
    unchangedPaths: [],
    nextState: { ...normalizedState },
  };

  if (!extensionRoot || workspaceRoots.length === 0) {
    return result;
  }

  const { entries } = await collectBundledAgentSourceEntries(extensionRoot);
  if (entries.length === 0) {
    return result;
  }

  const bundledContentByRelativePath = new Map<string, string>();

  for (const workspaceRoot of workspaceRoots) {
    if (!workspaceRoot) {
      continue;
    }

    const previousWorkspaceState = normalizedState[workspaceRoot] ?? {};
    const nextWorkspaceState: Record<string, string> = {};

    for (const entry of entries) {
      let bundledContent = bundledContentByRelativePath.get(entry.sourceRelativePath);
      if (bundledContent === undefined) {
        bundledContent = await fs.promises.readFile(
          entry.sourceAbsolutePath,
          "utf8",
        );
        bundledContentByRelativePath.set(entry.sourceRelativePath, bundledContent);
      }

      const bundledHash = createContentHash(bundledContent);
      const targetPath = path.join(workspaceRoot, entry.liveRelativePath);
      const previousManagedHash = previousWorkspaceState[entry.liveRelativePath];

      let currentContent: string | undefined;
      try {
        currentContent = await fs.promises.readFile(targetPath, "utf8");
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error
          ? String((error as { code?: unknown }).code)
          : "";
        if (code && code !== "ENOENT") {
          throw error;
        }
      }

      if (currentContent === undefined) {
        await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.promises.writeFile(targetPath, bundledContent, "utf8");
        result.createdPaths.push(targetPath);
        nextWorkspaceState[entry.liveRelativePath] = bundledHash;
        continue;
      }

      const currentHash = createContentHash(currentContent);
      if (currentHash === bundledHash) {
        result.unchangedPaths.push(targetPath);
        nextWorkspaceState[entry.liveRelativePath] = bundledHash;
        continue;
      }

      if (previousManagedHash && currentHash === previousManagedHash) {
        await fs.promises.writeFile(targetPath, bundledContent, "utf8");
        result.updatedPaths.push(targetPath);
        nextWorkspaceState[entry.liveRelativePath] = bundledHash;
        continue;
      }

      result.skippedPaths.push(targetPath);
      if (previousManagedHash) {
        nextWorkspaceState[entry.liveRelativePath] = previousManagedHash;
      }
    }

    if (Object.keys(nextWorkspaceState).length > 0) {
      result.nextState[workspaceRoot] = nextWorkspaceState;
    } else {
      delete result.nextState[workspaceRoot];
    }
  }

  return result;
}

export async function syncBundledCodexSkillsForWorkspaceRoots(
  extensionRoot: string,
  workspaceRoots: string[],
  syncState: BundledSkillSyncState = {},
): Promise<BundledSkillSyncResult> {
  const normalizedState = normalizeSyncState(syncState);
  const result: BundledSkillSyncResult = {
    createdPaths: [],
    updatedPaths: [],
    skippedPaths: [],
    unchangedPaths: [],
    nextState: { ...normalizedState },
  };

  if (!extensionRoot || workspaceRoots.length === 0) {
    return result;
  }

  const bundledRelativePaths = await collectBundledRelativeFilePaths(
    extensionRoot,
    BUNDLED_SKILLS_RELATIVE_PATH,
  );
  if (bundledRelativePaths.length === 0) {
    return result;
  }

  const bundledContentByRelativePath = new Map<string, string>();

  for (const workspaceRoot of workspaceRoots) {
    if (!workspaceRoot) {
      continue;
    }

    const previousWorkspaceState = normalizedState[workspaceRoot] ?? {};
    const nextWorkspaceState: Record<string, string> = {};

    for (const relativePath of bundledRelativePaths) {
      let bundledContent = bundledContentByRelativePath.get(relativePath);
      if (bundledContent === undefined) {
        bundledContent = await fs.promises.readFile(
          path.join(extensionRoot, relativePath),
          "utf8",
        );
        bundledContentByRelativePath.set(relativePath, bundledContent);
      }

      const targetRelativePath = mapBundledSkillPathToCodex(relativePath);
      const bundledHash = createContentHash(bundledContent);
      const targetPath = path.join(workspaceRoot, targetRelativePath);
      const previousManagedHash = previousWorkspaceState[targetRelativePath];

      let currentContent: string | undefined;
      try {
        currentContent = await fs.promises.readFile(targetPath, "utf8");
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error
          ? String((error as { code?: unknown }).code)
          : "";
        if (code && code !== "ENOENT") {
          throw error;
        }
      }

      if (currentContent === undefined) {
        await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.promises.writeFile(targetPath, bundledContent, "utf8");
        result.createdPaths.push(targetPath);
        nextWorkspaceState[targetRelativePath] = bundledHash;
        continue;
      }

      const currentHash = createContentHash(currentContent);
      if (currentHash === bundledHash) {
        result.unchangedPaths.push(targetPath);
        nextWorkspaceState[targetRelativePath] = bundledHash;
        continue;
      }

      if (previousManagedHash && currentHash === previousManagedHash) {
        await fs.promises.writeFile(targetPath, bundledContent, "utf8");
        result.updatedPaths.push(targetPath);
        nextWorkspaceState[targetRelativePath] = bundledHash;
        continue;
      }

      if (!isBundledSkillCustomizationProtected(currentContent)) {
        await fs.promises.writeFile(targetPath, bundledContent, "utf8");
        result.updatedPaths.push(targetPath);
        nextWorkspaceState[targetRelativePath] = bundledHash;
        continue;
      }

      result.skippedPaths.push(targetPath);
      if (previousManagedHash) {
        nextWorkspaceState[targetRelativePath] = previousManagedHash;
      }
    }

    const agentsPath = path.join(workspaceRoot, CODEX_AGENTS_RELATIVE_PATH);
    let currentAgentsContent: string | undefined;
    try {
      currentAgentsContent = await fs.promises.readFile(agentsPath, "utf8");
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";
      if (code && code !== "ENOENT") {
        throw error;
      }
    }

    const nextAgents = upsertManagedCodexAgentsDoc(extensionRoot, currentAgentsContent);
    if (nextAgents.changed) {
      await fs.promises.mkdir(path.dirname(agentsPath), { recursive: true });
      await fs.promises.writeFile(agentsPath, nextAgents.content, "utf8");
      if (nextAgents.created) {
        result.createdPaths.push(agentsPath);
      } else {
        result.updatedPaths.push(agentsPath);
      }
    } else {
      result.unchangedPaths.push(agentsPath);
    }

    if (Object.keys(nextWorkspaceState).length > 0) {
      result.nextState[workspaceRoot] = nextWorkspaceState;
    } else {
      delete result.nextState[workspaceRoot];
    }
  }

  return result;
}

async function ensureBundledFileForWorkspaceRoots(
  extensionRoot: string,
  workspaceRoots: string[],
  relativePath: string,
): Promise<string[]> {
  if (!extensionRoot || workspaceRoots.length === 0) {
    return [];
  }

  const bundledPath = path.join(extensionRoot, relativePath);
  let bundledContent: string | undefined;
  const createdPaths: string[] = [];

  for (const workspaceRoot of workspaceRoots) {
    if (!workspaceRoot) {
      continue;
    }

    const targetPath = path.join(workspaceRoot, relativePath);

    try {
      await fs.promises.access(targetPath, fs.constants.F_OK);
      continue;
    } catch {
      // Missing is expected; continue to create it from the bundled template.
    }

    if (bundledContent === undefined) {
      bundledContent = await fs.promises.readFile(bundledPath, "utf8");
    }

    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.promises.writeFile(targetPath, bundledContent, "utf8");
    createdPaths.push(targetPath);
  }

  return createdPaths;
}

export async function ensureSchedulerSkillForWorkspaceRoots(
  extensionRoot: string,
  workspaceRoots: string[],
): Promise<string[]> {
  return ensureBundledFileForWorkspaceRoots(
    extensionRoot,
    workspaceRoots,
    SCHEDULER_SKILL_RELATIVE_PATH,
  );
}

export async function ensureCockpitTodoSkillForWorkspaceRoots(
  extensionRoot: string,
  workspaceRoots: string[],
): Promise<string[]> {
  return ensureBundledFileForWorkspaceRoots(
    extensionRoot,
    workspaceRoots,
    COCKPIT_TODO_SKILL_RELATIVE_PATH,
  );
}