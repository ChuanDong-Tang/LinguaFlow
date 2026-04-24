import { AudioProviderSwitchOptions, AudioTextProviderBase } from "../../types";
import { setSelectedTtsPlaybackSource } from "../ttsPreferences";
import { WebSpeechSynthesizer } from "../webspeech/WebSpeechSynthesizer";
import { KokoroEngine } from "./KokoroEngine";

const KOKORO_SWITCH_TIMEOUT_MS = 45_000;

export class KokoroAudioProvider extends AudioTextProviderBase {
  readonly id = "kokoro";
  private readonly engine: KokoroEngine;
  private readonly fallbackSynthesizer: WebSpeechSynthesizer;

  constructor({
    engine = new KokoroEngine(),
    fallbackSynthesizer = new WebSpeechSynthesizer(),
  }: {
    engine?: KokoroEngine;
    fallbackSynthesizer?: WebSpeechSynthesizer;
  } = {}) {
    super("kokoro");
    this.engine = engine;
    this.fallbackSynthesizer = fallbackSynthesizer;
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
    const played = await this.engine.speak(text);
    if (played) return true;
    return this.fallbackSynthesizer.speak(text);
  }

  stop(): void {
    this.engine.stop();
    this.fallbackSynthesizer.stop();
  }

  setPlaybackRate(rate: number): number {
    const normalized = this.engine.setPlaybackRate(rate);
    this.fallbackSynthesizer.setPlaybackRate(normalized);
    return normalized;
  }
}
