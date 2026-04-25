import { AudioTextProviderBase } from "../../types";
import { setSelectedTtsPlaybackSource } from "../ttsPreferences";
import { WebSpeechSynthesizer } from "./WebSpeechSynthesizer";

export class WebSpeechProvider extends AudioTextProviderBase {
  readonly id = "web";
  private readonly synthesizer: WebSpeechSynthesizer;

  constructor({ synthesizer = new WebSpeechSynthesizer() }: { synthesizer?: WebSpeechSynthesizer } = {}) {
    super("web");
    this.synthesizer = synthesizer;
  }

  activate(): boolean {
    setSelectedTtsPlaybackSource("web");
    return true;
  }

  deactivate(): void {
    this.synthesizer.stop();
  }

  async speak(text: string): Promise<boolean> {
    setSelectedTtsPlaybackSource("web");
    return this.synthesizer.speak(text);
  }

  async prefetchTexts(_texts: string[]): Promise<boolean> {
    setSelectedTtsPlaybackSource("web");
    await this.synthesizer.prewarm();
    return true;
  }

  stop(): void {
    this.synthesizer.stop();
  }

  pause(): boolean {
    return this.synthesizer.pause();
  }

  resume(): boolean {
    return this.synthesizer.resume();
  }

  isPaused(): boolean {
    return this.synthesizer.isPaused();
  }

  setPlaybackRate(rate: number): number {
    return this.synthesizer.setPlaybackRate(rate);
  }
}
