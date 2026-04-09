export class PracticeController {
  constructor({
    getCueListMode,
    getPlaybackCues,
    setCueListMode,
    syncSubtitlePracticeUI,
    updatePracticeModeButtons,
  }) {
    this.getCueListMode = getCueListMode;
    this.getPlaybackCues = getPlaybackCues;
    this.setCueListMode = setCueListMode;
    this.syncSubtitlePracticeUI = syncSubtitlePracticeUI;
    this.updatePracticeModeButtons = updatePracticeModeButtons;
  }

  goPracticeSubtitles() {
    if (!this.getPlaybackCues().length) return;
    this.setCueListMode("subtitles");
    this.syncSubtitlePracticeUI();
    this.updatePracticeModeButtons();
  }

  goPracticeDictation() {
    if (!this.getPlaybackCues().length) return;
    this.setCueListMode("dictation");
    this.syncSubtitlePracticeUI();
    this.updatePracticeModeButtons();
  }
}
