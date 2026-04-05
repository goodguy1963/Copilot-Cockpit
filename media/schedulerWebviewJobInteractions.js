export function handleSchedulerDetailClick(event, options) {
  var target = event && event.target;

  var researchProfileCard = options.getClosestEventTarget(event, "[data-research-id]");
  if (
    researchProfileCard &&
    options.researchProfileList &&
    options.researchProfileList.contains(researchProfileCard)
  ) {
    event.preventDefault();
    event.stopPropagation();
    options.selectResearchProfile(
      researchProfileCard.getAttribute("data-research-id") || "",
    );
    return true;
  }

  var researchRunCard = options.getClosestEventTarget(event, "[data-run-id]");
  if (
    researchRunCard &&
    options.researchRunList &&
    options.researchRunList.contains(researchRunCard)
  ) {
    event.preventDefault();
    event.stopPropagation();
    options.selectResearchRun(researchRunCard.getAttribute("data-run-id") || "");
    return true;
  }

  var folderItem = target && target.closest ? target.closest("[data-job-folder]") : null;
  if (folderItem && options.jobsFolderList && options.jobsFolderList.contains(folderItem)) {
    options.setSelectedJobFolderId(folderItem.getAttribute("data-job-folder") || "");
    options.setSelectedJobId("");
    options.persistTaskFilter();
    options.renderJobsTab();
    return true;
  }

  var openJobEditorButton =
    target && target.closest ? target.closest("[data-job-open-editor]") : null;
  if (
    openJobEditorButton &&
    options.jobsList &&
    options.jobsList.contains(openJobEditorButton)
  ) {
    options.openJobEditor(
      openJobEditorButton.getAttribute("data-job-open-editor") || "",
    );
    return true;
  }

  var jobItem = target && target.closest ? target.closest("[data-job-id]") : null;
  if (jobItem && options.jobsList && options.jobsList.contains(jobItem)) {
    options.setSelectedJobId(jobItem.getAttribute("data-job-id") || "");
    options.persistTaskFilter();
    options.renderJobsTab();
    return true;
  }

  var jobAction =
    target && target.getAttribute ? target.getAttribute("data-job-action") : "";
  if (!jobAction) {
    return false;
  }

  if (jobAction === "detach-node") {
    var detachNodeId = target.getAttribute("data-job-node-id") || "";
    if (options.getSelectedJobId() && detachNodeId) {
      options.vscode.postMessage({
        type: "requestDeleteJobTask",
        jobId: options.getSelectedJobId(),
        nodeId: detachNodeId,
      });
    }
    return true;
  }

  if (jobAction === "edit-task") {
    var editTaskId = target.getAttribute("data-job-task-id") || "";
    if (editTaskId && typeof options.editTask === "function") {
      options.editTask(editTaskId);
    }
    return true;
  }

  if (jobAction === "edit-pause") {
    var editPauseNodeId = target.getAttribute("data-job-node-id") || "";
    if (options.getSelectedJobId() && editPauseNodeId) {
      options.vscode.postMessage({
        type: "requestRenameJobPause",
        jobId: options.getSelectedJobId(),
        nodeId: editPauseNodeId,
      });
    }
    return true;
  }

  if (jobAction === "delete-pause") {
    var deletePauseNodeId = target.getAttribute("data-job-node-id") || "";
    if (options.getSelectedJobId() && deletePauseNodeId) {
      options.vscode.postMessage({
        type: "requestDeleteJobPause",
        jobId: options.getSelectedJobId(),
        nodeId: deletePauseNodeId,
      });
    }
    return true;
  }

  if (jobAction === "approve-pause") {
    var approveNodeId = target.getAttribute("data-job-node-id") || "";
    if (options.getSelectedJobId() && approveNodeId) {
      options.vscode.postMessage({
        type: "approveJobPause",
        jobId: options.getSelectedJobId(),
        nodeId: approveNodeId,
      });
    }
    return true;
  }

  if (jobAction === "reject-pause") {
    var rejectNodeId = target.getAttribute("data-job-node-id") || "";
    if (options.getSelectedJobId() && rejectNodeId) {
      options.vscode.postMessage({
        type: "rejectJobPause",
        jobId: options.getSelectedJobId(),
        nodeId: rejectNodeId,
      });
    }
    return true;
  }

  if (jobAction === "run-task") {
    var runTaskId = target.getAttribute("data-job-task-id") || "";
    if (runTaskId && typeof options.runTask === "function") {
      options.runTask(runTaskId);
    }
    return true;
  }

  return false;
}

export function bindJobNodeWindowChange(document, options) {
  document.addEventListener("change", function (event) {
    var target = event && event.target;
    if (!target) return;
    if (target.classList && target.classList.contains("job-node-window-input")) {
      var selectedJobId = options.getSelectedJobId();
      if (!selectedJobId) return;
      var nodeId = target.getAttribute("data-job-node-window-id") || "";
      if (!nodeId) return;
      options.vscode.postMessage({
        type: "updateJobNodeWindow",
        jobId: selectedJobId,
        nodeId: nodeId,
        windowMinutes: Number(target.value || 30),
      });
    }
  });
}

export function bindJobDragAndDrop(document, options) {
  document.addEventListener("dragstart", function (event) {
    var target = event && event.target;
    var jobItem = target && target.closest ? target.closest("[data-job-id]") : null;
    if (jobItem && options.jobsList && options.jobsList.contains(jobItem)) {
      options.setDraggedJobId(jobItem.getAttribute("data-job-id") || "");
      if (jobItem.classList) jobItem.classList.add("dragging");
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
      }
      return;
    }
    var card = target && target.closest ? target.closest("[data-job-node-id]") : null;
    if (!card) return;
    options.setDraggedJobNodeId(card.getAttribute("data-job-node-id") || "");
    if (card.classList) card.classList.add("dragging");
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
    }
  });

  document.addEventListener("dragend", function (event) {
    var target = event && event.target;
    var jobItem = target && target.closest ? target.closest("[data-job-id]") : null;
    if (jobItem && jobItem.classList) jobItem.classList.remove("dragging");
    var card = target && target.closest ? target.closest("[data-job-node-id]") : null;
    if (card && card.classList) card.classList.remove("dragging");
    options.setDraggedJobId("");
    options.setDraggedJobNodeId("");
    Array.prototype.forEach.call(
      document.querySelectorAll(".jobs-step-card.drag-over"),
      function (item) {
        if (item && item.classList) item.classList.remove("drag-over");
      },
    );
    Array.prototype.forEach.call(
      document.querySelectorAll(".jobs-folder-item.drag-over"),
      function (item) {
        if (item && item.classList) item.classList.remove("drag-over");
      },
    );
  });

  document.addEventListener("dragover", function (event) {
    var target = event && event.target;
    var folderItem = target && target.closest ? target.closest("[data-job-folder]") : null;
    if (folderItem && options.getDraggedJobId()) {
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }
      if (folderItem.classList) folderItem.classList.add("drag-over");
      return;
    }
    var card = target && target.closest ? target.closest("[data-job-node-id]") : null;
    if (!card || !options.getDraggedJobNodeId()) return;
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
    if (card.classList) card.classList.add("drag-over");
  });

  document.addEventListener("dragleave", function (event) {
    var target = event && event.target;
    var folderItem = target && target.closest ? target.closest("[data-job-folder]") : null;
    if (folderItem && folderItem.classList) folderItem.classList.remove("drag-over");
    var card = target && target.closest ? target.closest("[data-job-node-id]") : null;
    if (card && card.classList) card.classList.remove("drag-over");
  });

  document.addEventListener("drop", function (event) {
    var target = event && event.target;
    var draggedJobId = options.getDraggedJobId();
    var folderItem = target && target.closest ? target.closest("[data-job-folder]") : null;
    if (folderItem && draggedJobId) {
      event.preventDefault();
      if (folderItem.classList) folderItem.classList.remove("drag-over");
      var droppedFolderId = folderItem.getAttribute("data-job-folder") || "";
      var draggedJob = options.getJobById(draggedJobId);
      if (!draggedJob) return;
      if ((draggedJob.folderId || "") === droppedFolderId) return;
      options.vscode.postMessage({
        type: "updateJob",
        jobId: draggedJobId,
        data: {
          folderId: droppedFolderId || undefined,
        },
      });
      return;
    }

    var card = target && target.closest ? target.closest("[data-job-node-id]") : null;
    var draggedJobNodeId = options.getDraggedJobNodeId();
    var selectedJobId = options.getSelectedJobId();
    if (!card || !draggedJobNodeId || !selectedJobId) return;
    event.preventDefault();
    if (card.classList) card.classList.remove("drag-over");
    var targetNodeId = card.getAttribute("data-job-node-id") || "";
    var selectedJob = options.getJobById(selectedJobId);
    if (!selectedJob || !Array.isArray(selectedJob.nodes)) return;
    var targetIndex = selectedJob.nodes.findIndex(function (node) {
      return node && node.id === targetNodeId;
    });
    if (targetIndex < 0 || draggedJobNodeId === targetNodeId) return;
    options.vscode.postMessage({
      type: "reorderJobNode",
      jobId: selectedJobId,
      nodeId: draggedJobNodeId,
      targetIndex: targetIndex,
    });
  });
}
