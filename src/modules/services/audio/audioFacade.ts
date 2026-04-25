import { KokoroAudioProvider } from "./providers/kokoro/KokoroAudioProvider";
import { getSelectedTtsPlaybackSource, setSelectedTtsPlaybackSource } from "./providers/ttsPreferences";
import { WebSpeechProvider } from "./providers/webspeech/WebSpeechProvider";
import type { AudioProviderSwitchOptions, AudioTextProvider, AudioTextProviderId } from "./types";

class AudioFacade {
  private readonly providers = new Map<AudioTextProviderId, AudioTextProvider>();
  private activeProviderId: AudioTextProviderId = "";

  registerProvider(provider: AudioTextProvider, { setActive = false }: { setActive?: boolean } = {}): void {
    if (!provider?.id) {
      throw new Error("AudioTextProvider id is required");
    }
    this.providers.set(provider.id, provider);
    if (!this.activeProviderId || setActive) {
      this.activeProviderId = provider.id;
    }
  }

  setActiveProvider(id: AudioTextProviderId): boolean {
    if (!this.providers.has(id)) return false;
    this.activeProviderId = id;
    this.persistActiveProvider(id);
    return true;
  }

  async switchProvider(id: AudioTextProviderId, options?: AudioProviderSwitchOptions): Promise<boolean> {
    const target = this.providers.get(id);
    if (!target) return false;
    const previous = this.providers.get(this.activeProviderId);
    if (previous && previous !== target) {
      previous.stop();
      if (typeof previous.deactivate === "function") {
        previous.deactivate();
      }
    }
    const ok = typeof target.activate === "function" ? await target.activate(options) : true;
    if (!ok) return false;
    this.activeProviderId = id;
    this.persistActiveProvider(id);
    return true;
  }

  getActiveProviderId(): AudioTextProviderId {
    return this.activeProviderId;
  }

  listProviderIds(): AudioTextProviderId[] {
    return Array.from(this.providers.keys());
  }

  async speak(text: string): Promise<boolean> {
    for (const [id, provider] of this.providers.entries()) {
      if (id === this.activeProviderId) continue;
      provider.stop();
    }
    const provider = this.requireActiveProvider();
    return provider.speak(text);
  }

  async prefetchTexts(texts: string[]): Promise<boolean> {
    const provider = this.requireActiveProvider();
    if (typeof provider.prefetchTexts !== "function") return true;
    return provider.prefetchTexts(texts);
  }

  stop(): void {
    for (const provider of this.providers.values()) {
      provider.stop();
    }
  }

  pause(): boolean {
    const provider = this.requireActiveProvider();
    if (typeof provider.pause !== "function") return false;
    return !!provider.pause();
  }

  resume(): boolean {
    const provider = this.requireActiveProvider();
    if (typeof provider.resume !== "function") return false;
    return !!provider.resume();
  }

  isPaused(): boolean {
    const provider = this.requireActiveProvider();
    if (typeof provider.isPaused !== "function") return false;
    return !!provider.isPaused();
  }

  setPlaybackRate(rate: number): number {
    const normalized = Number.isFinite(rate) ? Math.min(2, Math.max(0.5, rate)) : 1;
    const provider = this.requireActiveProvider();
    if (typeof provider.setPlaybackRate !== "function") return normalized;
    const maybeRate = provider.setPlaybackRate(normalized);
    return Number.isFinite(maybeRate) ? Number(maybeRate) : normalized;
  }

  private requireActiveProvider(): AudioTextProvider {
    const provider = this.providers.get(this.activeProviderId);
    if (!provider) {
      throw new Error(`Audio provider not found: ${this.activeProviderId || "(empty)"}`);
    }
    return provider;
  }

  private persistActiveProvider(id: AudioTextProviderId): void {
    if (id === "web" || id === "kokoro") {
      setSelectedTtsPlaybackSource(id);
    }
  }
}

function createDefaultProviders(): AudioTextProvider[] {
  return [new WebSpeechProvider(), new KokoroAudioProvider()];
}

const audioFacade = new AudioFacade();
for (const provider of createDefaultProviders()) {
  audioFacade.registerProvider(provider);
}
const storedSource = getSelectedTtsPlaybackSource();
if (!audioFacade.setActiveProvider(storedSource)) {
  audioFacade.setActiveProvider("web");
}

export function getAudioFacade(): AudioFacade {
  return audioFacade;
}

export function registerAudioTextProvider(provider: AudioTextProvider, options?: { setActive?: boolean }): void {
  audioFacade.registerProvider(provider, options);
}

export function setActiveAudioTextProvider(id: AudioTextProviderId): boolean {
  return audioFacade.setActiveProvider(id);
}

export async function switchActiveAudioTextProvider(id: AudioTextProviderId, options?: AudioProviderSwitchOptions): Promise<boolean> {
  return audioFacade.switchProvider(id, options);
}

export type { AudioProviderSwitchOptions, AudioTextProvider, AudioTextProviderId } from "./types";
