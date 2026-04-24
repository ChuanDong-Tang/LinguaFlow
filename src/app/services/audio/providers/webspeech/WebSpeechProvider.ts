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

  async speak(text: string): Promise<boolean> {
    setSelectedTtsPlaybackSource("web");
    return this.synthesizer.speak(text);
  }

  stop(): void {
    this.synthesizer.stop();
  }

  setPlaybackRate(rate: number): number {
    return this.synthesizer.setPlaybackRate(rate);
  }
}
