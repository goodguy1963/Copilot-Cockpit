export function activateSchedulerTab(document, tabName) {
  document.querySelectorAll(".tab-button").forEach(function (button) {
    button.classList.remove("active");
  });
  document.querySelectorAll(".tab-content").forEach(function (content) {
    content.classList.remove("active");
  });

  var targetButton = document.querySelector(
    '.tab-button[data-tab="' + tabName + '"]',
  );
  var targetContent = document.getElementById(tabName + "-tab");

  if (targetButton) {
    targetButton.classList.add("active");
  }
  if (targetContent) {
    targetContent.classList.add("active");
  }
}

export function bindSelectValueChange(control, onChange) {
  if (!control) {
    return;
  }

  control.addEventListener("change", function () {
    onChange(control);
  });
}

export function bindGenericChange(control, handler) {
  if (!control) {
    return;
  }

  control.addEventListener("change", handler);
}
