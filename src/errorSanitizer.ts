import * as path from "path";

function basenameFromPathLike(raw: string): string {
  const value = typeof raw === "string" ? raw : String(raw ?? "");
  if (!value) return "";

  if (/^file:\/\/\/?/i.test(value)) {
    try {
      const url = new URL(value);
      if (url.protocol === "file:") {
        const decoded = decodeURIComponent(url.pathname || "");
        const normalized = decoded.replace(/^\/([A-Za-z]:[\\/])/, "$1");
        if (/^[A-Za-z]:(\\|\/)/.test(normalized)) {
          return path.win32.basename(normalized);
        }
        return path.posix.basename(normalized);
      }
    } catch {
      // Fall through to string-based handling below.
    }
    return basenameFromPathLike(value.replace(/^file:\/\/\/?/i, ""));
  }

  if (value.startsWith("\\\\")) {
    return path.win32.basename(value);
  }

  if (/^[A-Za-z]:(\\|\/)/.test(value)) {
    return path.win32.basename(value);
  }

  if (value.startsWith("/")) {
    return path.posix.basename(value);
  }

  return path.basename(value);
}

export function sanitizeAbsolutePathDetails(message: string): string {
  const text = typeof message === "string" ? message : String(message ?? "");
  if (!text) return "";

  return text
    .replace(
      /'(file:\/\/[^']+)'/gi,
      (_m, p1: string) => `'${basenameFromPathLike(p1)}'`,
    )
    .replace(
      /"(file:\/\/[^"]+)"/gi,
      (_m, p1: string) => `"${basenameFromPathLike(p1)}"`,
    )
    .replace(/file:\/\/[^\s"'`]+/gi, (m) => basenameFromPathLike(m))
    .replace(
      /'((?:[A-Za-z]:(?:\\|\/)|\\\\)[^']+)'/g,
      (_m, p1: string) => `'${basenameFromPathLike(p1)}'`,
    )
    .replace(
      /"((?:[A-Za-z]:(?:\\|\/)|\\\\)[^"]+)"/g,
      (_m, p1: string) => `"${basenameFromPathLike(p1)}"`,
    )
    .replace(
      /(^|[^A-Za-z0-9_])((?:[A-Za-z]:(?:\\|\/)|\\\\)[^\s"'`]+)/g,
      (_m, prefix: string, p1: string) =>
        `${prefix}${basenameFromPathLike(p1)}`,
    )
    .replace(
      /'(\/[^']+)'/g,
      (_m, p1: string) => `'${basenameFromPathLike(p1)}'`,
    )
    .replace(
      /"(\/[^"]+)"/g,
      (_m, p1: string) => `"${basenameFromPathLike(p1)}"`,
    )
    .replace(
      /(^|[\s(])(\/[^\s"'`]+)/g,
      (_m, prefix: string, p1: string) =>
        `${prefix}${basenameFromPathLike(p1)}`,
    );
}
