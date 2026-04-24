import { getAudioFacade } from "./audioFacade";

type CueLike = { text?: string | null } | null | undefined;

type PlayCueOptions = {
  triggeredByLoop?: boolean;
  requestToken?: number | null;
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
  let loopGeneration = 0;
  let loopTimerId: number | null = null;

  const clearLoopTimer = (): void => {
    if (loopTimerId === null) return;
    window.clearTimeout(loopTimerId);
    loopTimerId = null;
  };

  const stop = ({ invalidateLoop = true }: { invalidateLoop?: boolean } = {}): void => {
    if (invalidateLoop) loopGeneration += 1;
    clearLoopTimer();
    audio.stop();
    activeCueIndex = -1;
    deps.onActiveCueChange?.(-1);
  };

  const scheduleCueLoop = (generation: number, cueIndex: number): void => {
    clearLoopTimer();
    loopTimerId = window.setTimeout(() => {
      if (!deps.isCueLoopEnabled()) return;
      if (deps.getLastPlayedCueIndex() < 0) return;
      if (generation !== loopGeneration) return;
      if (deps.getLastPlayedCueIndex() !== cueIndex) return;
      playCue(cueIndex, { triggeredByLoop: true, requestToken: generation });
    }, 120);
  };

  const playCue = (cueIndex: number, { triggeredByLoop = false, requestToken = null }: PlayCueOptions = {}): void => {
    const cue = deps.getCueByIndex(cueIndex);
    if (!cue) return;

    const content = String(cue.text || "").trim();
    if (!content) return;

    const rate = deps.getPlaybackRate();
    audio.setPlaybackRate(Number.isFinite(rate) ? rate : 1);

    if (!triggeredByLoop) loopGeneration += 1;
    const token = requestToken ?? loopGeneration;

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
        if (token !== loopGeneration) return;
        if (deps.getLastPlayedCueIndex() !== cueIndex) return;
        scheduleCueLoop(token, cueIndex);
      })
      .finally(() => {
        if (token !== loopGeneration) return;
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
    loopGeneration += 1;
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
