export class PlayerController {
  constructor({
    playerEl,
    playerTimeDisplay,
    playerSeekEl,
    playerPlayBtn,
    playerPlayIcon,
    playerRateEl,
    loopWholeCheckbox,
    getPlaybackCues,
    getCueListMode,
    getCueInputs,
    getCueElements,
    getCueIndexForTime,
    applyCuePosition,
    seekToCueNoPlay,
    firstFocusableFillBlankSlot,
    formatClockSec,
  }) {
    this.playerEl = playerEl;
    this.playerTimeDisplay = playerTimeDisplay;
    this.playerSeekEl = playerSeekEl;
    this.playerPlayBtn = playerPlayBtn;
    this.playerPlayIcon = playerPlayIcon;
    this.playerPlayLabel = this.playerPlayBtn?.querySelector(".player-play-label") ?? null;
    this.playerRateEl = playerRateEl;
    this.loopWholeCheckbox = loopWholeCheckbox;
    this.getPlaybackCues = getPlaybackCues;
    this.getCueListMode = getCueListMode;
    this.getCueInputs = getCueInputs;
    this.getCueElements = getCueElements;
    this.getCueIndexForTime = getCueIndexForTime;
    this.applyCuePosition = applyCuePosition;
    this.seekToCueNoPlay = seekToCueNoPlay;
    this.firstFocusableFillBlankSlot = firstFocusableFillBlankSlot;
    this.formatClockSec = formatClockSec;
    this.playerSeekDragging = false;
  }

  setSeekDragging(v) {
    this.playerSeekDragging = !!v;
  }

  isSeekDragging() {
    return this.playerSeekDragging;
  }

  seekToCue(idx) {
    const playbackCues = this.getPlaybackCues();
    if (!playbackCues[idx]) return;
    const cueListMode = this.getCueListMode();
    const cueInputs = this.getCueInputs();
    const cueElements = this.getCueElements();

    const fillBlank = cueListMode === "fillblank";
    if (fillBlank) {
      this.seekToCueNoPlay(idx);
      this.firstFocusableFillBlankSlot(cueElements[idx])?.focus({ preventScroll: true });
      return;
    }
    this.applyCuePosition(idx);
    if (cueListMode === "dictation" && cueInputs[idx]) {
      cueInputs[idx].focus({ preventScroll: true });
    }
    this.playerEl.play().catch(() => {});
  }

  goNextCue() {
    const playbackCues = this.getPlaybackCues();
    if (!playbackCues.length || !this.playerEl.src) return;
    const cur = this.getCueIndexForTime(this.playerEl.currentTime);
    this.seekToCue(Math.min(playbackCues.length - 1, cur + 1));
  }

  goPrevCue() {
    const playbackCues = this.getPlaybackCues();
    if (!playbackCues.length || !this.playerEl.src) return;
    const cur = this.getCueIndexForTime(this.playerEl.currentTime);
    this.seekToCue(Math.max(0, cur - 1));
  }

  togglePlayPause() {
    if (!this.playerEl.src) return;
    if (this.playerEl.paused) {
      this.playerEl.play().catch(() => {});
    } else {
      this.playerEl.pause();
    }
  }

  syncPlayerTransport() {
    const d = this.playerEl.duration;
    const t = this.playerEl.currentTime;
    if (this.playerTimeDisplay) {
      const ds = Number.isFinite(d) ? d : 0;
      this.playerTimeDisplay.textContent = `${this.formatClockSec(t)} / ${this.formatClockSec(ds)}`;
    }
    if (this.playerSeekEl && !this.playerSeekDragging && Number.isFinite(d) && d > 0) {
      this.playerSeekEl.value = String(Math.round((t / d) * 1000));
    }
    if (this.playerPlayBtn && this.playerPlayIcon) {
      const playing = !this.playerEl.paused && !!this.playerEl.src;
      this.playerPlayIcon.textContent = playing ? "⏸" : "▶";
      if (this.playerPlayLabel) {
        this.playerPlayLabel.textContent = playing ? "暂停" : "播放";
      }
      this.playerPlayBtn.setAttribute("aria-label", playing ? "暂停" : "播放");
      this.playerPlayBtn.setAttribute("aria-pressed", playing ? "true" : "false");
    }
  }

  resetPlayerTransportOptions() {
    if (this.playerRateEl) this.playerRateEl.value = "1";
    this.playerEl.playbackRate = 1;
    if (this.loopWholeCheckbox) {
      this.loopWholeCheckbox.checked = false;
      this.playerEl.loop = false;
    }
  }
}
