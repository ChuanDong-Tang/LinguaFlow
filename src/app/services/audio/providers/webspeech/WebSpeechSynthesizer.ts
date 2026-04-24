import { getSelectedTtsLanguageId } from "../ttsPreferences";

export class WebSpeechSynthesizer {
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private playbackRate = 1;

  isSupported(): boolean {
    if (typeof window === "undefined") return false;
    return "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
  }

  stop(): void {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    this.currentUtterance = null;
  }

  setPlaybackRate(rate: number): number {
    const normalized = Number.isFinite(rate) ? Math.min(2, Math.max(0.5, rate)) : 1;
    this.playbackRate = normalized;
    if (this.currentUtterance) {
      this.currentUtterance.rate = normalized;
    }
    return normalized;
  }

  async speak(text: string): Promise<boolean> {
    const content = String(text ?? "").trim();
    if (!content || !this.isSupported()) return false;
    this.stop();
    return new Promise<boolean>((resolve) => {
      const utterance = new SpeechSynthesisUtterance(content);
      utterance.lang = getSelectedTtsLanguageId();
      utterance.rate = this.playbackRate;
      utterance.pitch = 1;
      utterance.volume = 1;

      const englishVoice = this.pickEnglishVoice();
      if (englishVoice) utterance.voice = englishVoice;

      const finish = (played: boolean) => {
        if (this.currentUtterance === utterance) {
          this.currentUtterance = null;
        }
        resolve(played);
      };

      utterance.onend = () => finish(true);
      utterance.onerror = () => finish(false);

      this.currentUtterance = utterance;
      try {
        window.speechSynthesis.speak(utterance);
      } catch {
        finish(false);
      }
    });
  }

  private pickEnglishVoice(): SpeechSynthesisVoice | null {
    if (!(typeof window !== "undefined" && "speechSynthesis" in window)) return null;
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return null;
    return voices.find((voice) => voice.lang.toLowerCase().startsWith("en")) ?? voices[0] ?? null;
  }
}
