import { AudioProviderSwitchOptions, AudioTextProviderBase } from "../../types";
import { setSelectedTtsPlaybackSource } from "../ttsPreferences";
import { KokoroEngine } from "./KokoroEngine";

const KOKORO_SWITCH_TIMEOUT_MS = 45_000;

export class KokoroAudioProvider extends AudioTextProviderBase {
  readonly id = "kokoro";
  private readonly engine: KokoroEngine;

  constructor({
    engine = new KokoroEngine(),
  }: {
    engine?: KokoroEngine;
  } = {}) {
    super("kokoro");
    this.engine = engine;
  }

  async activate(options?: AudioProviderSwitchOptions): Promise<boolean> {
    setSelectedTtsPlaybackSource("kokoro");
    const timeoutMs = Number.isFinite(options?.warmupTimeoutMs)
      ? Number(options?.warmupTimeoutMs)
      : KOKORO_SWITCH_TIMEOUT_MS;
    try {
      await this.engine.prewarm(timeoutMs);
      return true;
    } catch {
      setSelectedTtsPlaybackSource("web");
      this.engine.deactivate();
      return false;
    }
  }

  deactivate(): void {
    this.engine.deactivate();
  }

  async speak(text: string): Promise<boolean> {
    setSelectedTtsPlaybackSource("kokoro");
    return this.engine.speak(text);
  }

  async prefetchTexts(texts: string[]): Promise<boolean> {
    setSelectedTtsPlaybackSource("kokoro");
    return this.engine.prefetchTexts(texts);
  }

  stop(): void {
    this.engine.stop();
  }

  pause(): boolean {
    return this.engine.pause();
  }

  resume(): boolean {
    return this.engine.resume();
  }

  isPaused(): boolean {
    return this.engine.isPaused();
  }

  setPlaybackRate(rate: number): number {
    return this.engine.setPlaybackRate(rate);
  }
}
