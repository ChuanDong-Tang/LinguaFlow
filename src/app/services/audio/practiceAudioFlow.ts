import { getAudioFacade } from "./audioFacade";

type CueLike = { text?: string | null } | null | undefined;

type PlayCueOptions = {
  fromLoop?: boolean;
  loopToken?: number | null;
};

export type PracticeAudioFlowDeps = {
  getCueByIndex: (cueIndex: number) => CueLike;
  getPlaybackRate: () => number;
  isCueLoopEnabled: () => boolean;
  getLastPlayedCueIndex: () => number;
  setLastPlayedCueIndex: (cueIndex: number) => void;
  onActiveCueChange?: (cueIndex: number) => void;
  onCueInlineStarted?: (cueIndex: number) => void;
};

export type PracticeAudioFlow = {
  playCue: (cueIndex: number, options?: PlayCueOptions) => void;
  playCueInline: (cueIndex: number) => void;
  stop: (options?: { invalidateLoop?: boolean }) => void;
  clearLoopTimer: () => void;
  onCueLoopToggleChanged: (enabled: boolean) => void;
};

export function createPracticeAudioFlow(deps: PracticeAudioFlowDeps): PracticeAudioFlow {
  const audio = getAudioFacade();
  let activeCueIndex = -1;
  let speechLoopToken = 0;
  let speechLoopTimer: number | null = null;

  const clearLoopTimer = (): void => {
    if (speechLoopTimer === null) return;
    window.clearTimeout(speechLoopTimer);
    speechLoopTimer = null;
  };

  const stop = ({ invalidateLoop = true }: { invalidateLoop?: boolean } = {}): void => {
    if (invalidateLoop) speechLoopToken += 1;
    clearLoopTimer();
    audio.stop();
    activeCueIndex = -1;
    deps.onActiveCueChange?.(-1);
  };

  const scheduleCueLoop = (loopToken: number, cueIndex: number): void => {
    clearLoopTimer();
    speechLoopTimer = window.setTimeout(() => {
      if (!deps.isCueLoopEnabled()) return;
      if (deps.getLastPlayedCueIndex() < 0) return;
      if (loopToken !== speechLoopToken) return;
      if (deps.getLastPlayedCueIndex() !== cueIndex) return;
      playCue(cueIndex, { fromLoop: true, loopToken });
    }, 120);
  };

  const playCue = (cueIndex: number, { fromLoop = false, loopToken = null }: PlayCueOptions = {}): void => {
    const cue = deps.getCueByIndex(cueIndex);
    if (!cue) return;

    const content = String(cue.text || "").trim();
    if (!content) return;

    const rate = deps.getPlaybackRate();
    audio.setPlaybackRate(Number.isFinite(rate) ? rate : 1);

    if (!fromLoop) speechLoopToken += 1;
    const token = loopToken ?? speechLoopToken;

    clearLoopTimer();
    stop({ invalidateLoop: false });
    activeCueIndex = cueIndex;
    deps.onActiveCueChange?.(cueIndex);

    void audio
      .speak(content)
      .then((played) => {
        if (!played) return;
        if (!deps.isCueLoopEnabled()) return;
        if (deps.getLastPlayedCueIndex() < 0) return;
        if (token !== speechLoopToken) return;
        if (deps.getLastPlayedCueIndex() !== cueIndex) return;
        scheduleCueLoop(token, cueIndex);
      })
      .finally(() => {
        if (token !== speechLoopToken) return;
        if (activeCueIndex !== cueIndex) return;
        activeCueIndex = -1;
        deps.onActiveCueChange?.(-1);
      });
  };

  const playCueInline = (cueIndex: number): void => {
    const cue = deps.getCueByIndex(cueIndex);
    if (!cue) return;
    deps.setLastPlayedCueIndex(cueIndex);
    deps.onCueInlineStarted?.(cueIndex);
    playCue(cueIndex);
  };

  const onCueLoopToggleChanged = (enabled: boolean): void => {
    if (enabled) return;
    speechLoopToken += 1;
    clearLoopTimer();
  };

  return {
    playCue,
    playCueInline,
    stop,
    clearLoopTimer,
    onCueLoopToggleChanged,
  };
}
