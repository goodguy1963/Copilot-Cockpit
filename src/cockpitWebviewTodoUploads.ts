import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { sanitizeAbsolutePathDetails } from "./errorSanitizer";

export const MAX_TODO_UPLOAD_BYTES = 25 * 1024 * 1024;

export function sanitizeTodoUploadFileName(fileName: string): string {
  const parsed = path.parse(fileName || "upload");
  const rawBase = parsed.name || "upload";
  const safeBase =
    rawBase
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[-_.]+|[-_.]+$/g, "")
      .slice(0, 48) || "upload";
  const safeExt = (parsed.ext || "")
    .replace(/[^a-zA-Z0-9.]+/g, "")
    .slice(0, 12);
  return `${safeBase}${safeExt}`;
}

export async function handleTodoFileUploadRequest(options: {
  workspaceRoot: string | undefined;
  uploadsFolderName: string;
  strings: {
    boardUploadFilesError?: string;
    boardUploadFiles?: string;
    boardUploadFilesEmpty?: string;
    boardUploadFilesSuccess?: string;
  };
  postMessage: (message: { type: string; [key: string]: unknown }) => void;
  ensurePrivateConfigIgnoredForWorkspaceRoot: (workspaceRoot: string) => void;
  logError: (...args: unknown[]) => void;
}): Promise<void> {
  if (!options.workspaceRoot) {
    options.postMessage({
      type: "todoFileUploadResult",
      ok: false,
      message: options.strings.boardUploadFilesError || "File upload failed.",
    });
    return;
  }

  try {
    const selectedFiles = await vscode.window.showOpenDialog({
      canSelectMany: true,
      canSelectFiles: true,
      canSelectFolders: false,
      openLabel: options.strings.boardUploadFiles || "Upload Files",
    });

    if (!selectedFiles || selectedFiles.length === 0) {
      options.postMessage({
        type: "todoFileUploadResult",
        ok: false,
        cancelled: true,
        message: options.strings.boardUploadFilesEmpty || "No files selected.",
      });
      return;
    }

    const acceptedFiles: Array<{ sourcePath: string; size: number }> = [];
    const skipped: string[] = [];
    for (const fileUri of selectedFiles) {
      const sourcePath = fileUri.fsPath;
      const stat = await fs.promises.stat(sourcePath);
      if (!stat.isFile()) {
        skipped.push(`${path.basename(sourcePath)} is not a file.`);
        continue;
      }
      if (stat.size > MAX_TODO_UPLOAD_BYTES) {
        skipped.push(`${path.basename(sourcePath)} is too large.`);
        continue;
      }
      acceptedFiles.push({ sourcePath, size: stat.size });
    }

    if (acceptedFiles.length === 0) {
      options.postMessage({
        type: "todoFileUploadResult",
        ok: false,
        message: skipped.join(" ") || options.strings.boardUploadFilesError || "File upload failed.",
        skipped,
      });
      return;
    }

    const uploadFolderPath = path.join(
      options.workspaceRoot,
      ".vscode",
      options.uploadsFolderName,
    );
    await fs.promises.mkdir(uploadFolderPath, { recursive: true });
    options.ensurePrivateConfigIgnoredForWorkspaceRoot(options.workspaceRoot);

    const relativePaths: string[] = [];
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);

    for (const [index, file] of acceptedFiles.entries()) {
      const sourcePath = file.sourcePath;
      const safeName = sanitizeTodoUploadFileName(path.basename(sourcePath));
      const parsed = path.parse(safeName);
      const prefix = `${stamp}-${String(index + 1).padStart(2, "0")}`;
      let targetName = `${prefix}-${parsed.name}${parsed.ext}`;
      let targetPath = path.join(uploadFolderPath, targetName);
      let attempt = 2;

      while (fs.existsSync(targetPath)) {
        targetName = `${prefix}-${parsed.name}-${attempt}${parsed.ext}`;
        targetPath = path.join(uploadFolderPath, targetName);
        attempt += 1;
      }

      await fs.promises.copyFile(sourcePath, targetPath);
      relativePaths.push(
        path.relative(options.workspaceRoot as string, targetPath).split(path.sep).join("/"),
      );
    }

    const insertedText = [
      relativePaths.length === 1 ? "Attachment:" : "Attachments:",
      ...relativePaths.map((relativePath) => `- ${relativePath}`),
    ].join("\n");

    options.postMessage({
      type: "todoFileUploadResult",
      ok: true,
      message:
        options.strings.boardUploadFilesSuccess ||
        "Files copied into the workspace input folder and added to the description.",
      insertedText,
      relativePaths,
      skipped,
      folderRelativePath: `.vscode/${options.uploadsFolderName}`,
    });
  } catch (error) {
    options.logError("Todo file upload failed", error);
    options.postMessage({
      type: "todoFileUploadResult",
      ok: false,
      message:
        (options.strings.boardUploadFilesError || "File upload failed.") +
        " " +
        sanitizeAbsolutePathDetails(
          error instanceof Error ? error.message : String(error ?? ""),
        ),
    });
  }
}
