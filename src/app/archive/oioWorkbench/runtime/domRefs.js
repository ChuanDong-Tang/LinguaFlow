export function getDomRefs() {
  const textEl = document.getElementById("text");
  const voiceComboboxEl = document.getElementById("voice-combobox");
  const voiceComboboxTrigger = document.getElementById("voice-combobox-trigger");
  const voiceComboboxValue = document.getElementById("voice-combobox-value");
  const voiceComboboxList = document.getElementById("voice-combobox-list");
  const btnEl = document.getElementById("generate");
  const clearInputBtn = document.getElementById("clear-input");
  const statusEl = document.getElementById("status");
  const playerEl = document.getElementById("player");
  const subsSectionEl = document.getElementById("subs-section");
  const subtitlesListEl = document.getElementById("subtitles-list");
  const transportBarEl = document.getElementById("transport-bar");
  const loopCheckbox = document.getElementById("loop-sentence");
  const loopWholeCheckbox = document.getElementById("loop-whole");
  const playerPlayBtn = document.getElementById("player-play-btn");
  const playerPlayIcon = playerPlayBtn?.querySelector(".player-play-icon");
  const playerTimeDisplay = document.getElementById("player-time-display");
  const playerSeekEl = document.getElementById("player-seek");
  const playerRateEl = document.getElementById("player-rate");
  const playerPrevBtn = document.getElementById("player-prev-cue");
  const playerNextBtn = document.getElementById("player-next-cue");
  const practiceModeBarEl = document.getElementById("practice-mode-bar");
  const practicePagerEl = document.getElementById("practice-pager");
  const practicePagePrevBtn = document.getElementById("practice-page-prev");
  const practicePageNextBtn = document.getElementById("practice-page-next");
  const practicePageIndicator = document.getElementById("practice-page-indicator");
  const practiceActionsBar = document.getElementById("practice-actions-bar");
  const fillblankCheckBtn = document.getElementById("fillblank-check-btn");
  const dictationCheckBtn = document.getElementById("dictation-check-btn");
  const fillblankSaveStatesBtn = document.getElementById("fillblank-save-states-btn");
  const proofreadSaveBtn = document.getElementById("proofread-save-btn");
  const historyExportBtn = document.getElementById("history-export-btn");
  const historyExportDialog = document.getElementById("history-export-dialog");
  const historyExportFrom = document.getElementById("history-export-from");
  const historyExportTo = document.getElementById("history-export-to");
  const historyExportApplyRange = document.getElementById("history-export-apply-range");
  const historyExportClearRange = document.getElementById("history-export-clear-range");
  const historyExportSelectAll = document.getElementById("history-export-select-all");
  const historyExportCount = document.getElementById("history-export-count");
  const historyExportList = document.getElementById("history-export-list");
  const historyExportCancel = document.getElementById("history-export-cancel");
  const historyExportConfirm = document.getElementById("history-export-confirm");
  const oioImportSuccessDialog = document.getElementById("oio-import-success-dialog");
  const oioImportSuccessBody = document.getElementById("oio-import-success-body");
  const oioImportSuccessOk = document.getElementById("oio-import-success-ok");
  const oioImportReportDialog = document.getElementById("oio-import-report-dialog");
  const oioImportReportTitle = document.getElementById("oio-import-report-title");
  const oioImportReportBody = document.getElementById("oio-import-report-body");
  const oioImportReportOk = document.getElementById("oio-import-report-ok");
  const fillblankUpdateDoneDialog = document.getElementById("fillblank-update-done-dialog");
  const fillblankUpdateDoneBody = document.getElementById("fillblank-update-done-body");
  const fillblankUpdateDoneOk = document.getElementById("fillblank-update-done-ok");
  const historySectionEl = document.getElementById("history-section");
  const historyCollapseBtn = document.getElementById("history-collapse-btn");
  const historyCollapsibleEl = document.getElementById("history-collapsible");
  const historyContextLabelEl = document.getElementById("history-context-label");
  const historyGranularityEl = document.getElementById("history-granularity");
  const historyNavRootEl = document.getElementById("history-nav-root");
  const historyEntriesRootEl = document.getElementById("history-entries-root");
  const historyMagicCardEl = document.getElementById("history-magic-card");
  const historyQuickJumpBtn = document.getElementById("history-quick-jump-btn");
  const historyJumpDialog = document.getElementById("history-jump-dialog");
  const historyJumpText = document.getElementById("history-jump-text");
  const historyJumpCancel = document.getElementById("history-jump-cancel");
  const historyJumpConfirm = document.getElementById("history-jump-confirm");

  return {
    textEl,
    voiceComboboxEl,
    voiceComboboxTrigger,
    voiceComboboxValue,
    voiceComboboxList,
    btnEl,
    clearInputBtn,
    statusEl,
    playerEl,
    subsSectionEl,
    subtitlesListEl,
    transportBarEl,
    loopCheckbox,
    loopWholeCheckbox,
    playerPlayBtn,
    playerPlayIcon,
    playerTimeDisplay,
    playerSeekEl,
    playerRateEl,
    playerPrevBtn,
    playerNextBtn,
    practiceModeBarEl,
    practicePagerEl,
    practicePagePrevBtn,
    practicePageNextBtn,
    practicePageIndicator,
    practiceActionsBar,
    fillblankCheckBtn,
    dictationCheckBtn,
    fillblankSaveStatesBtn,
    proofreadSaveBtn,
    historyExportBtn,
    historyExportDialog,
    historyExportFrom,
    historyExportTo,
    historyExportApplyRange,
    historyExportClearRange,
    historyExportSelectAll,
    historyExportCount,
    historyExportList,
    historyExportCancel,
    historyExportConfirm,
    oioImportSuccessDialog,
    oioImportSuccessBody,
    oioImportSuccessOk,
    oioImportReportDialog,
    oioImportReportTitle,
    oioImportReportBody,
    oioImportReportOk,
    fillblankUpdateDoneDialog,
    fillblankUpdateDoneBody,
    fillblankUpdateDoneOk,
    historySectionEl,
    historyCollapseBtn,
    historyCollapsibleEl,
    historyContextLabelEl,
    historyGranularityEl,
    historyNavRootEl,
    historyEntriesRootEl,
    historyMagicCardEl,
    historyQuickJumpBtn,
    historyJumpDialog,
    historyJumpText,
    historyJumpCancel,
    historyJumpConfirm,
  };
}
