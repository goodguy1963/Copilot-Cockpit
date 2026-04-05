import * as path from "path";

const FILE_URI_PREFIX = /^file:\/\/\/?/i;
const WINDOWS_ABSOLUTE = /^[A-Za-z]:(\\|\/)/;
const UNC_ABSOLUTE = /^\\\\/;
const POSIX_ABSOLUTE = /^\//;

function stringify(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function isWindowsPath(candidate: string): boolean {
  return WINDOWS_ABSOLUTE.test(candidate) || UNC_ABSOLUTE.test(candidate);
}

function getBasename(candidate: string): string {
  if (!candidate) {
    return "";
  }

  if (FILE_URI_PREFIX.test(candidate)) {
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol === "file:") {
        const decodedPath = decodeURIComponent(parsed.pathname || "");
        const localPath = decodedPath.replace(/^\/([A-Za-z]:[\\/])/, "$1");
        return getBasename(localPath);
      }
    } catch {
      return getBasename(candidate.replace(FILE_URI_PREFIX, ""));
    }
  }

  if (isWindowsPath(candidate)) {
    return path.win32.basename(candidate);
  }

  if (POSIX_ABSOLUTE.test(candidate)) {
    return path.posix.basename(candidate);
  }

  return path.basename(candidate);
}

function replaceQuotedContent(
  input: string,
  pattern: RegExp,
  transform: (candidate: string) => string,
): string {
  return input.replace(
    pattern,
    (_match: string, quote: string, candidate: string) =>
      `${quote}${transform(candidate)}${quote}`,
  );
}

function trimAbsolutePathDetails(input: string): string {
  let output = input;

  output = replaceQuotedContent(
    output,
    /(['"])(file:\/\/[^"'`\s]+)\1/gi,
    getBasename,
  );
  output = output.replace(/file:\/\/[^\s"'`]+/gi, getBasename);

  output = replaceQuotedContent(
    output,
    /(['"])((?:[A-Za-z]:(?:\\|\/)|\\\\)[^"'`]+)\1/g,
    getBasename,
  );
  output = output.replace(
    /(^|[^A-Za-z0-9_])((?:[A-Za-z]:(?:\\|\/)|\\\\)[^\s"'`]+)/g,
    (_match: string, prefix: string, candidate: string) =>
      `${prefix}${getBasename(candidate)}`,
  );

  output = replaceQuotedContent(output, /(['"])(\/[^"'`]+)\1/g, getBasename);
  output = output.replace(
    /(^|[\s(])(\/[^\s"'`]+)/g,
    (_match: string, prefix: string, candidate: string) =>
      `${prefix}${getBasename(candidate)}`,
  );

  return output;
}

export function sanitizeAbsolutePathDetails(message: string): string {
  const text = stringify(message);
  return text ? trimAbsolutePathDetails(text) : "";
}
