import { bindClickAction } from "./copilotWebviewBindings.js";

export function bindJobToolbarButtons(options) {
  bindClickAction(options.jobsNewFolderBtn, function () {
    options.vscode.postMessage({
      type: "requestCreateJobFolder",
      parentFolderId: options.getSelectedJobFolderId() || undefined,
    });
  });

  bindClickAction(options.jobsRenameFolderBtn, function () {
    var selectedJobFolderId = options.getSelectedJobFolderId();
    if (!selectedJobFolderId) return;
    options.vscode.postMessage({
      type: "requestRenameJobFolder",
      folderId: selectedJobFolderId,
    });
  });

  bindClickAction(options.jobsDeleteFolderBtn, function () {
    var selectedJobFolderId = options.getSelectedJobFolderId();
    if (!selectedJobFolderId) return;
    options.vscode.postMessage({
      type: "requestDeleteJobFolder",
      folderId: selectedJobFolderId,
    });
  });

  function requestCreateJob(switchToEditor) {
    options.setCreatingJob(true);
    options.syncEditorTabLabels();
    options.vscode.postMessage({
      type: "requestCreateJob",
      folderId: options.getSelectedJobFolderId() || undefined,
    });
    if (switchToEditor) {
      options.switchTab("jobs-edit");
    }
  }

  bindClickAction(options.jobsNewJobBtn, function () {
    requestCreateJob(true);
  });

  bindClickAction(options.jobsEmptyNewBtn, function () {
    requestCreateJob(false);
  });

  bindClickAction(options.jobsBackBtn, function () {
    options.switchTab("jobs");
  });

  bindClickAction(options.jobsOpenEditorBtn, function () {
    options.openJobEditor(options.getSelectedJobId() || "");
  });

  bindClickAction(options.jobsSaveBtn, options.submitJobEditor);
  bindClickAction(options.jobsSaveDeckBtn, options.submitJobEditor);

  bindClickAction(options.jobsDuplicateBtn, function () {
    var selectedJobId = options.getSelectedJobId();
    if (!selectedJobId) return;
    options.vscode.postMessage({ type: "duplicateJob", jobId: selectedJobId });
  });

  function toggleSelectedJobPaused() {
    var selectedJobId = options.getSelectedJobId();
    if (!selectedJobId) return;
    options.vscode.postMessage({ type: "toggleJobPaused", jobId: selectedJobId });
  }

  bindClickAction(options.jobsPauseBtn, toggleSelectedJobPaused);
  bindClickAction(options.jobsStatusPill, toggleSelectedJobPaused);

  bindClickAction(options.jobsCompileBtn, function () {
    var selectedJobId = options.getSelectedJobId();
    if (!selectedJobId) return;
    options.vscode.postMessage({ type: "compileJob", jobId: selectedJobId });
  });

  bindClickAction(options.jobsToggleSidebarBtn, function () {
    options.toggleJobsSidebar();
  });

  bindClickAction(options.jobsShowSidebarBtn, function () {
    options.showJobsSidebar();
  });

  bindClickAction(options.jobsDeleteBtn, function () {
    var selectedJobId = options.getSelectedJobId();
    if (!selectedJobId) return;
    options.vscode.postMessage({ type: "deleteJob", jobId: selectedJobId });
  });

  bindClickAction(options.jobsAttachBtn, function () {
    var selectedJobId = options.getSelectedJobId();
    if (
      !selectedJobId ||
      !options.jobsExistingTaskSelect ||
      !options.jobsExistingTaskSelect.value
    ) {
      return;
    }
    options.vscode.postMessage({
      type: "attachTaskToJob",
      jobId: selectedJobId,
      taskId: options.jobsExistingTaskSelect.value,
      windowMinutes: options.jobsExistingWindowInput
        ? Number(options.jobsExistingWindowInput.value || 30)
        : 30,
    });
  });

  bindClickAction(options.jobsCreateStepBtn, function () {
    var selectedJobId = options.getSelectedJobId();
    if (!selectedJobId) return;

    var name = options.jobsStepNameInput ? options.jobsStepNameInput.value.trim() : "";
    var prompt = options.jobsStepPromptInput
      ? options.jobsStepPromptInput.value.trim()
      : "";
    if (!name || !prompt) return;

    var selectedJob = options.getJobById(selectedJobId);
    options.vscode.postMessage({
      type: "createJobTask",
      jobId: selectedJobId,
      windowMinutes: options.jobsStepWindowInput
        ? Number(options.jobsStepWindowInput.value || 30)
        : 30,
      data: {
        name: name,
        prompt: prompt,
        cronExpression:
          selectedJob && selectedJob.cronExpression
            ? selectedJob.cronExpression
            : "0 9 * * 1-5",
        agent: options.jobsStepAgentSelect ? options.jobsStepAgentSelect.value : "",
        model: options.jobsStepModelSelect ? options.jobsStepModelSelect.value : "",
        labels: options.parseLabels(
          options.jobsStepLabelsInput ? options.jobsStepLabelsInput.value : "",
        ),
        scope: "workspace",
        promptSource: "inline",
        oneTime: false,
      },
    });

    if (options.jobsStepNameInput) options.jobsStepNameInput.value = "";
    if (options.jobsStepPromptInput) options.jobsStepPromptInput.value = "";
    if (options.jobsStepLabelsInput) options.jobsStepLabelsInput.value = "";
    if (options.jobsStepWindowInput) options.jobsStepWindowInput.value = "30";
  });

  bindClickAction(options.jobsCreatePauseBtn, function () {
    var selectedJobId = options.getSelectedJobId();
    if (!selectedJobId) return;
    var title = options.jobsPauseNameInput ? options.jobsPauseNameInput.value.trim() : "";
    options.vscode.postMessage({
      type: "createJobPause",
      jobId: selectedJobId,
      data: {
        title: title || options.defaultPauseTitle || "Manual review",
      },
    });
    if (options.jobsPauseNameInput) {
      options.jobsPauseNameInput.value = "";
    }
  });
}
