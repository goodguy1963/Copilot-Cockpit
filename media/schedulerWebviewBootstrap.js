export function readInitialWebviewBootstrap(documentRef) {
  var initialData = {};
  try {
    var initialScript = documentRef.getElementById("initial-data");
    if (initialScript && initialScript.textContent) {
      initialData = JSON.parse(initialScript.textContent) || {};
    }
  } catch (_error) {
    initialData = {};
  }

  return {
    initialData: initialData,
    strings: initialData.strings || {},
    currentLogLevel:
      typeof initialData.logLevel === "string" && initialData.logLevel
        ? initialData.logLevel
        : "info",
    currentLogDirectory:
      typeof initialData.logDirectory === "string"
        ? initialData.logDirectory
        : "",
  };
}

function firstErrorLine(reason, unknownText) {
  var raw = unknownText || "";
  if (reason) {
    if (typeof reason === "string") {
      raw = reason;
    } else if (typeof reason === "object" && reason.message) {
      raw = String(reason.message);
    } else {
      raw = String(reason);
    }
  }
  return String(raw).split(/\r?\n/)[0];
}

export function installGlobalErrorHandlers(params) {
  params.window.onerror = function (msg, _url, line) {
    var prefix = params.strings.webviewScriptErrorPrefix || "";
    var linePrefix = params.strings.webviewLinePrefix || "";
    var lineSuffix = params.strings.webviewLineSuffix || "";
    params.showGlobalError(
      prefix +
      params.sanitizeAbsolutePaths(String(msg)) +
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
