function pickPathLeaf(value) {
  if (!value) {
    return "";
  }
  var normalized = String(value);
  var lastBackslash = normalized.lastIndexOf("\\");
  var lastSlash = normalized.lastIndexOf("/");
  return normalized.substring(Math.max(lastBackslash, lastSlash) + 1);
}

function decodeFileLikePath(value) {
  if (!value) {
    return "";
  }
  var normalized = String(value);
  if (!/^file:\/\/\/?/i.test(normalized)) {
    return pickPathLeaf(normalized);
  }

  try {
    var parsed = new URL(normalized);
    if (parsed.protocol === "file:") {
      return pickPathLeaf(decodeURIComponent(parsed.pathname || ""));
    }
  } catch (_error) {
    // fall through to string-based cleanup
  }

  return pickPathLeaf(normalized.replace(/^file:\/\/\/?/i, ""));
}

function inferModelSourceName(model) {
  var fragments = [
    model && model.id,
    model && model.name,
    model && model.vendor,
    model && model.description,
  ]
    .filter(Boolean)
    .map(function (value) {
      return String(value).trim().toLowerCase();
    })
    .join(" ");

  if (fragments.indexOf("openrouter") >= 0) {
    return "OpenRouter";
  }

  if (
    fragments.indexOf("copilot") >= 0 ||
    fragments.indexOf("codex") >= 0 ||
    fragments.indexOf("github") >= 0 ||
    fragments.indexOf("microsoft") >= 0
  ) {
    return "Copilot";
  }

  return model && model.vendor ? String(model.vendor).trim() : "";
}

export function formatModelLabel(model) {
  var displayName =
    model && (model.name || model.id)
      ? String(model.name || model.id).trim()
      : "";
  var sourceName = inferModelSourceName(model);
  return !sourceName || sourceName.toLowerCase() === displayName.toLowerCase()
    ? displayName
    : displayName + " • " + sourceName;
}

export function formatCountdown(totalSeconds) {
  var remainingSeconds = Math.max(0, Math.floor(totalSeconds));
  var units = [
    ["y", 365 * 24 * 60 * 60],
    ["mo", 30 * 24 * 60 * 60],
    ["w", 7 * 24 * 60 * 60],
    ["d", 24 * 60 * 60],
    ["h", 60 * 60],
    ["m", 60],
    ["s", 1],
  ];
  var parts = [];

  units.forEach(function (entry) {
    var label = entry[0];
    var seconds = entry[1];
    if (remainingSeconds < seconds) {
      return;
    }
    var count = Math.floor(remainingSeconds / seconds);
    remainingSeconds -= count * seconds;
    parts.push(String(count) + label);
  });

  return parts.length > 0 ? parts.join(" ") : "0s";
}

export function getNextRunCountdownText(enabled, nextRunMs, nowMs) {
  if (!enabled || !isFinite(nextRunMs) || nextRunMs <= 0) {
    return "";
  }

  var referenceNow = typeof nowMs === "number" ? nowMs : Date.now();
  var remainingMs = nextRunMs - referenceNow;
  return remainingMs > 0
    ? " (in " + formatCountdown(Math.floor(remainingMs / 1000)) + ")"
    : " (due now)";
}

export function sanitizeAbsolutePaths(text) {
  if (!text) {
    return "";
  }

  return String(text)
    .replace(/'(file:\/\/[^']+)'/gi, function (_match, captured) {
      return "'" + decodeFileLikePath(captured) + "'";
    })
    .replace(/"(file:\/\/[^"]+)"/gi, function (_match, captured) {
      return '"' + decodeFileLikePath(captured) + '"';
    })
    .replace(/file:\/\/[^\s"'`]+/gi, function (captured) {
      return decodeFileLikePath(captured);
    })
    .replace(/'((?:[A-Za-z]:(?:\\|\/)|\\\\)[^']+)'/g, function (_match, captured) {
      return "'" + decodeFileLikePath(captured) + "'";
    })
    .replace(/"((?:[A-Za-z]:(?:\\|\/)|\\\\)[^"]+)"/g, function (_match, captured) {
      return '"' + decodeFileLikePath(captured) + '"';
    })
    .replace(/(^|[^A-Za-z0-9_])((?:[A-Za-z]:(?:\\|\/)|\\\\)[^\s"'`]+)/g, function (_match, prefix, captured) {
      return String(prefix) + decodeFileLikePath(captured);
    })
    .replace(/'(\/[^']+)'/g, function (_match, captured) {
      return "'" + decodeFileLikePath(captured) + "'";
    })
    .replace(/"(\/[^\"]+)"/g, function (_match, captured) {
      return '"' + decodeFileLikePath(captured) + '"';
    })
    .replace(/(^|[\s(])(\/[^\s"'`]+)/g, function (_match, prefix, captured) {
      return String(prefix) + decodeFileLikePath(captured);
    });
}

export function normalizeDefaultJitterSeconds(rawValue) {
  var parsed = typeof rawValue === "number" ? rawValue : Number(rawValue);
  if (!isFinite(parsed)) {
    return 600;
  }
  return Math.max(0, Math.min(1800, Math.floor(parsed)));
}
