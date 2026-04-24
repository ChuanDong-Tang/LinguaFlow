export type AudioTextProviderId = string;

export type AudioProviderSwitchOptions = {
  warmupTimeoutMs?: number;
};

export interface AudioTextProvider {
  id: AudioTextProviderId;
  activate?(options?: AudioProviderSwitchOptions): Promise<boolean> | boolean;
  deactivate?(): void;
  speak(text: string): Promise<boolean>;
  stop(): void;
  pause?(): boolean;
  resume?(): boolean;
  isPaused?(): boolean;
  setPlaybackRate?(rate: number): number | void;
}

export abstract class AudioTextProviderBase implements AudioTextProvider {
  readonly id: AudioTextProviderId;

  protected constructor(id: AudioTextProviderId) {
    this.id = id;
  }

  activate(_options?: AudioProviderSwitchOptions): Promise<boolean> | boolean {
    return true;
  }

  deactivate(): void {
    // optional
  }

  abstract speak(text: string): Promise<boolean>;
  abstract stop(): void;

  pause(): boolean {
    return false;
  }

  resume(): boolean {
    return false;
  }

  isPaused(): boolean {
    return false;
  }

  setPlaybackRate(rate: number): number {
    return Number.isFinite(rate) ? Math.min(2, Math.max(0.5, rate)) : 1;
  }
}
