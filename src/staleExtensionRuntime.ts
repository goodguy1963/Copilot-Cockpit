import * as fs from "fs";
import * as path from "path";

type ExtensionPackageJsonLike = {
  version?: unknown;
  publisher?: unknown;
  name?: unknown;
};

type DirectoryEntryLike = {
  name: string;
  isDirectory: () => boolean;
};

export type ExtensionRuntimeGuardFs = {
  existsSync: (filePath: string) => boolean;
  readdirSync: (
    dirPath: string,
    options: { withFileTypes: true },
  ) => DirectoryEntryLike[];
};

export type ExtensionRuntimeContextLike = {
  extensionUri?: {
    fsPath?: string;
  };
  extension?: {
    packageJSON?: ExtensionPackageJsonLike;
  };
};

export type StaleExtensionRuntimeStatus = {
  activeVersion: string;
  latestInstalledVersion?: string;
  latestInstalledRoot?: string;
  isStale: boolean;
};

const defaultFsImpl: ExtensionRuntimeGuardFs = {
  existsSync: fs.existsSync,
  readdirSync: fs.readdirSync as ExtensionRuntimeGuardFs["readdirSync"],
};

function parseVersionParts(version: string): number[] | undefined {
  if (typeof version !== "string" || !/^\d+(\.\d+)*$/.test(version)) {
    return undefined;
  }

  return version.split(".").map((value) => Number.parseInt(value, 10));
}

function compareVersionParts(left: number[], right: number[]): number {
  const maxLength = Math.max(left.length, right.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    if (leftValue !== rightValue) {
      return leftValue - rightValue;
    }
  }

  return 0;
}

function getInstalledExtensionIdPrefix(
  activeExtensionRoot: string,
  packageJson: ExtensionPackageJsonLike,
): string | undefined {
  if (typeof packageJson.publisher === "string" && typeof packageJson.name === "string") {
    return `${packageJson.publisher}.${packageJson.name}-`;
  }

  const baseName = path.basename(activeExtensionRoot);
  const match = baseName.match(/^(.*)-(\d+\.\d+\.\d+)$/);
  return match ? `${match[1]}-` : undefined;
}

export function detectStaleExtensionRuntime(options: {
  activeExtensionRoot: string;
  activeVersion: string;
  extensionIdPrefix?: string;
  fsImpl?: ExtensionRuntimeGuardFs;
}): StaleExtensionRuntimeStatus {
  const fsImpl = options.fsImpl ?? defaultFsImpl;
  const activeVersion = options.activeVersion;
  const activeVersionParts = parseVersionParts(activeVersion);
  if (!activeVersionParts || !options.extensionIdPrefix) {
    return { activeVersion, isStale: false };
  }

  const searchRoot = path.dirname(path.resolve(options.activeExtensionRoot));
  if (!fsImpl.existsSync(searchRoot)) {
    return { activeVersion, isStale: false };
  }

  let latestInstalledVersion: string | undefined;
  let latestInstalledRoot: string | undefined;
  let latestVersionParts: number[] | undefined;

  try {
    const entries = fsImpl.readdirSync(searchRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith(options.extensionIdPrefix)) {
        continue;
      }

      const candidateVersion = entry.name.slice(options.extensionIdPrefix.length);
      const candidateVersionParts = parseVersionParts(candidateVersion);
      if (!candidateVersionParts || compareVersionParts(candidateVersionParts, activeVersionParts) <= 0) {
        continue;
      }

      const candidateRoot = path.join(searchRoot, entry.name);
      if (!fsImpl.existsSync(path.join(candidateRoot, "package.json"))) {
        continue;
      }

      if (!latestVersionParts || compareVersionParts(candidateVersionParts, latestVersionParts) > 0) {
        latestInstalledVersion = candidateVersion;
        latestInstalledRoot = candidateRoot;
        latestVersionParts = candidateVersionParts;
      }
    }
  } catch {
    return { activeVersion, isStale: false };
  }

  return {
    activeVersion,
    latestInstalledVersion,
    latestInstalledRoot,
    isStale: Boolean(latestInstalledVersion),
  };
}

export function shouldSuppressSqliteWorkForExtensionContext(options: {
  context: ExtensionRuntimeContextLike;
  fsImpl?: ExtensionRuntimeGuardFs;
  onStaleRuntimeDetected?: (status: StaleExtensionRuntimeStatus) => void;
}): boolean {
  const activeExtensionRoot = options.context.extensionUri?.fsPath;
  if (typeof activeExtensionRoot !== "string" || activeExtensionRoot.trim().length === 0) {
    return false;
  }

  const packageJson = options.context.extension?.packageJSON ?? {};
  const activeVersion = typeof packageJson.version === "string"
    ? packageJson.version
    : "0.0.0";
  const status = detectStaleExtensionRuntime({
    activeExtensionRoot,
    activeVersion,
    extensionIdPrefix: getInstalledExtensionIdPrefix(activeExtensionRoot, packageJson),
    fsImpl: options.fsImpl,
  });

  if (!status.isStale) {
    return false;
  }

  options.onStaleRuntimeDetected?.(status);
  return true;
}