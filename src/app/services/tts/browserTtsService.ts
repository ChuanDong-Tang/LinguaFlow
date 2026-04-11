export function splitTextForSpeech(text: string): string[] {
  const normalized = String(text ?? "").replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const parts = normalized
    .split(/(?<=[.!?。！？])\s+|\n+/g)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length) return parts;
  return [normalized];
}

class BrowserTtsService {
  private currentUtterance: SpeechSynthesisUtterance | null = null;

  isSupported(): boolean {
    return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
  }

  stop(): void {
    if (!this.isSupported()) return;
    window.speechSynthesis.cancel();
    this.currentUtterance = null;
  }

  speak(text: string): boolean {
    const content = String(text ?? "").trim();
    if (!content || !this.isSupported()) return false;

    this.stop();

    const utterance = new SpeechSynthesisUtterance(content);
    utterance.lang = "en-US";
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.volume = 1;
    const englishVoice = this.pickEnglishVoice();
    if (englishVoice) utterance.voice = englishVoice;
    utterance.onend = () => {
      if (this.currentUtterance === utterance) {
        this.currentUtterance = null;
      }
    };
    utterance.onerror = () => {
      if (this.currentUtterance === utterance) {
        this.currentUtterance = null;
      }
    };
    this.currentUtterance = utterance;
    window.speechSynthesis.speak(utterance);
    return true;
  }

  private pickEnglishVoice(): SpeechSynthesisVoice | null {
    if (!this.isSupported()) return null;
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return null;
    return voices.find((voice) => voice.lang.toLowerCase().startsWith("en")) ?? voices[0] ?? null;
  }
}

const browserTtsService = new BrowserTtsService();

export function getBrowserTtsService(): BrowserTtsService {
  return browserTtsService;
}
