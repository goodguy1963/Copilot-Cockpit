function parseBootstrapPayload(documentRef) {
  var scriptNode = documentRef.getElementById("initial-data");
  if (!scriptNode || !scriptNode.textContent) {
    return {};
  }

  try {
    return JSON.parse(scriptNode.textContent) || {};
  } catch (_error) {
    return {};
  }
}

function resolveLogLevel(payload) {
  return typeof payload.logLevel === "string" && payload.logLevel
    ? payload.logLevel
    : "info";
}

function resolveLogDirectory(payload) {
  return typeof payload.logDirectory === "string" ? payload.logDirectory : "";
}

export function readInitialWebviewBootstrap(documentRef) {
  var payload = parseBootstrapPayload(documentRef);
  var strings = payload && payload.strings ? payload.strings : {};

  return {
    initialData: payload,
    strings: strings,
    currentLogLevel: resolveLogLevel(payload),
    currentLogDirectory: resolveLogDirectory(payload),
  };
}

function firstErrorLine(reason, unknownText) {
  var raw = unknownText || "";
  var resolvedReason = reason;
  if (typeof resolvedReason === "string") {
    raw = resolvedReason;
  } else if (resolvedReason) {
    var reasonMessage =
      typeof resolvedReason === "object" &&
      "message" in resolvedReason
        ? resolvedReason.message
        : resolvedReason;
    raw = String(reasonMessage);
  }
  return String(raw).split(/\r?\n/)[0];
}

export function installGlobalErrorHandlers(params) {
  params.window.onerror = function (messageText, _url, line) {
    var prefix = params.strings.webviewScriptErrorPrefix || "";
    var linePrefix = params.strings.webviewLinePrefix || "";
    var lineSuffix = params.strings.webviewLineSuffix || "";
    params.showGlobalError(
      prefix +
      params.sanitizeAbsolutePaths(String(messageText)) +
      linePrefix +
      String(line) +
      lineSuffix,
    );
  };

  params.window.onunhandledrejection = function (event) {
    var prefix = params.strings.webviewUnhandledErrorPrefix || "";
    params.showGlobalError(
      prefix +
      params.sanitizeAbsolutePaths(
        firstErrorLine(
          event && event.reason ? event.reason : null,
          params.strings.webviewUnknown || "",
        ),
      ),
    );
  };
}
