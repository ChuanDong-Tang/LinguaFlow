export function getDomRefs() {
  const textEl = document.getElementById("text");
  const btnEl = document.getElementById("generate");
  const clearInputBtn = document.getElementById("clear-input");
  const statusEl = document.getElementById("status");
  const playerEl = document.getElementById("player");
  const subtitlesListEl = document.getElementById("subtitles-list");

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
  const fillblankSyncBtn = document.getElementById("fillblank-sync-btn");
  const dictationCheckBtn = document.getElementById("dictation-check-btn");
  const proofreadSaveBtn = document.getElementById("proofread-save-btn");

  return {
    textEl,
    btnEl,
    clearInputBtn,
    statusEl,
    playerEl,
    subtitlesListEl,
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
    fillblankSyncBtn,
    dictationCheckBtn,
    proofreadSaveBtn,
  };
}
