function forEachTabElement(document, selector, callback) {
  Array.prototype.forEach.call(document.querySelectorAll(selector), callback);
}

export function activateSchedulerTab(document, tabName) {
  forEachTabElement(document, ".tab-button", function (button) {
    button.classList.remove("active");
  });
  forEachTabElement(document, ".tab-content", function (content) {
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

export function bindTabButtons(document, switchTab) {
  Array.prototype.forEach.call(
    document.querySelectorAll(".tab-button[data-tab]"),
    function (button) {
      button.addEventListener("click", function (event) {
        event.preventDefault();
        var stopEvent = event.stopImmediatePropagation || event.stopPropagation;
        stopEvent.call(event);
        var selectedTabName = button.getAttribute("data-tab");
        if (selectedTabName) {
          switchTab(selectedTabName);
        }
      });
    },
  );
}

export function bindTaskFilterBar(taskFilterBar, options) {
  if (!taskFilterBar) {
    return;
  }

  options.syncTaskFilterButtons();
  taskFilterBar.addEventListener("click", function (event) {
    var target = event && event.target;
    var filterButton = target || null;
    while (filterButton && filterButton !== taskFilterBar) {
      if (
        filterButton.getAttribute &&
        filterButton.getAttribute("data-filter")
      ) {
        break;
      }
      filterButton = filterButton.parentElement;
    }
    if (!filterButton || filterButton === taskFilterBar) {
      return;
    }

    var filterValue = filterButton.getAttribute("data-filter");
    if (!options.isValidTaskFilter(filterValue)) {
      return;
    }

    options.setActiveTaskFilter(filterValue);
    options.syncTaskFilterButtons();
    options.persistTaskFilter();
    options.renderTaskList();
  });
}
