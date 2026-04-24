type TtsService = {
    speak(text: string): Promise<boolean>;
    stop(): void;
    pause(): boolean;
    resume(): boolean;
    isPaused(): boolean;
    setPlaybackRate(rate: number): number | void;
};

type PlaybackState = {
    mode: "none" | "cue" | "whole";
    paused: boolean;
    activeCueIndex: number;
};

export class AudioPlaybackController {
    private readonly ttsService: TtsService;
    private readonly getCueLoopEnabled: () => boolean;
    private readonly getWholeLoopEnabled: () => boolean;
    private readonly onStateChange: (state: PlaybackState) => void;

    private playbackToken = 0;
    private loopTimer: number | null = null;
    private state: PlaybackState = { mode: "none", paused: false, activeCueIndex: -1 };

    constructor({
                    ttsService,
                    getCueLoopEnabled = () => false,
                    getWholeLoopEnabled = () => false,
                    onStateChange = () => {},
                }: {
        ttsService: TtsService;
        getCueLoopEnabled?: () => boolean;
        getWholeLoopEnabled?: () => boolean;
        onStateChange?: (state: PlaybackState) => void;
    }) {
        this.ttsService = ttsService;
        this.getCueLoopEnabled = getCueLoopEnabled;
        this.getWholeLoopEnabled = getWholeLoopEnabled;
        this.onStateChange = onStateChange;
    }

    setPlaybackRate(rate: number): void {
        this.ttsService.setPlaybackRate(rate);
    }

    invalidateLoop(): void {
        this.playbackToken += 1;
        this.clearLoopTimer();
    }

    stop({ invalidateLoop = true }: { invalidateLoop?: boolean } = {}): void {
        if (invalidateLoop) this.playbackToken += 1;
        this.clearLoopTimer();
        this.ttsService.stop();
        this.updateState({ mode: "none", paused: false, activeCueIndex: -1 });
    }

    pause(): boolean {
        const paused = this.ttsService.pause();
        if (paused) this.updateState({ paused: true });
        return paused;
    }

    resume(): boolean {
        const resumed = this.ttsService.resume();
        if (resumed) this.updateState({ paused: false });
        return resumed;
    }

    isPaused(): boolean {
        return this.ttsService.isPaused();
    }

    playCue(cueIndex: number, text: string, { fromLoop = false, loopToken = null }: { fromLoop?: boolean; loopToken?: number | null } = {}): void {
        const content = String(text || "").trim();
        if (!content) return;

        if (!fromLoop) this.playbackToken += 1;
        const token = loopToken ?? this.playbackToken;

        this.clearLoopTimer();
        this.stop({ invalidateLoop: false });
        this.updateState({ mode: "cue", paused: false, activeCueIndex: cueIndex });

        this.ttsService.speak(content).then((played) => {
            if (!played) return;
            if (token !== this.playbackToken) return;
            if (!this.getCueLoopEnabled()) return;
            this.scheduleLoop(() => {
                if (token !== this.playbackToken) return;
                if (!this.getCueLoopEnabled()) return;
                this.playCue(cueIndex, content, { fromLoop: true, loopToken: token });
            });
        }).finally(() => {
            if (token !== this.playbackToken) return;
            if (this.state.mode === "cue" && !this.getCueLoopEnabled()) {
                this.updateState({ mode: "none", paused: false, activeCueIndex: -1 });
            }
        });
    }

    playWhole(text: string, { fromLoop = false, loopToken = null }: { fromLoop?: boolean; loopToken?: number | null } = {}): void {
        const content = String(text || "").trim();
        if (!content) return;

        if (!fromLoop) this.playbackToken += 1;
        const token = loopToken ?? this.playbackToken;

        this.clearLoopTimer();
        this.stop({ invalidateLoop: false });
        this.updateState({ mode: "whole", paused: false, activeCueIndex: -1 });

        this.ttsService.speak(content).then((played) => {
            if (!played) return;
            if (token !== this.playbackToken) return;
            if (!this.getWholeLoopEnabled()) return;
            this.scheduleLoop(() => {
                if (token !== this.playbackToken) return;
                if (!this.getWholeLoopEnabled()) return;
                this.playWhole(content, { fromLoop: true, loopToken: token });
            });
        }).finally(() => {
            if (token !== this.playbackToken) return;
            if (this.state.mode === "whole" && !this.getWholeLoopEnabled()) {
                this.updateState({ mode: "none", paused: false, activeCueIndex: -1 });
            }
        });
    }

    private scheduleLoop(task: () => void): void {
        this.clearLoopTimer();
        this.loopTimer = window.setTimeout(() => {
            this.loopTimer = null;
            task();
        }, 120);
    }

    private clearLoopTimer(): void {
        if (this.loopTimer === null) return;
        window.clearTimeout(this.loopTimer);
        this.loopTimer = null;
    }

    private updateState(partial: Partial<PlaybackState>): void {
        this.state = { ...this.state, ...partial };
        this.onStateChange({ ...this.state });
    }
}
