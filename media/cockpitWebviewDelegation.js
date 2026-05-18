/**
 * Declarative event delegation for simple click -> postMessage bindings.
 *
 * Install a single delegated click handler on a root container. Elements with
 * a `data-action` attribute automatically dispatch a postMessage of the
 * specified type when clicked.
 *
 * Complex bindings (form validation, user confirmation, multi-control gather,
 * state sync) remain as explicit functions in their respective binding files
 * and are intentionally NOT migrated here.
 */

export function installDelegatedActions(root, vscode) {
  if (!root || typeof root.addEventListener !== "function") {
    return;
  }

  root.addEventListener("click", function (event) {
    var target = event.target;
    if (!target) return;

    var actionElement = target.closest("[data-action]");
    if (!actionElement) return;

    var actionType = actionElement.getAttribute("data-action");
    if (!actionType) return;

    // Allow elements to opt out of delegation when they need explicit handling
    if (actionElement.hasAttribute("data-action-explicit")) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    // Gather optional extra payload attributes
    var payload = { type: actionType };
    var extraAttr = actionElement.getAttribute("data-action-payload");
    if (extraAttr) {
      try {
        var parsed = JSON.parse(extraAttr);
        for (var key in parsed) {
          if (Object.prototype.hasOwnProperty.call(parsed, key)) {
            payload[key] = parsed[key];
          }
        }
      } catch (_e) {
        // Silently ignore malformed JSON payload attributes
      }
    }

    // If a data-action-value attribute exists, include it as "value"
    var valueAttr = actionElement.getAttribute("data-action-value");
    if (valueAttr !== null) {
      payload.value = valueAttr;
    }

    vscode.postMessage(payload);
  });
}
