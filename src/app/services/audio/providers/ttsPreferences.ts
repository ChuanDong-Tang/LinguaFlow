export type TtsPlaybackSource = "kokoro" | "web";
export type TtsLanguageId = "en-US" | "en-GB" | "zh-CN" | "ja-JP";
export type KokoroVoiceId = "bm_fable" | "bf_emma" | "am_echo" | "af_heart";

const TTS_SOURCE_STORAGE_KEY = "linguaflow-tts-source";
const TTS_LANGUAGE_STORAGE_KEY = "linguaflow-tts-language";
const KOKORO_VOICE_STORAGE_KEY = "linguaflow-kokoro-voice";

const TTS_SOURCE_SET = new Set<TtsPlaybackSource>(["kokoro", "web"]);
const TTS_LANGUAGE_SET = new Set<TtsLanguageId>(["en-US", "en-GB", "zh-CN", "ja-JP"]);
const KOKORO_VOICE_OPTIONS: readonly KokoroVoiceId[] = [
  "bm_fable",
  "bf_emma",
  "am_echo",
  "af_heart",
];
const KOKORO_VOICE_SET = new Set<KokoroVoiceId>(KOKORO_VOICE_OPTIONS);
const KOKORO_DEFAULT_VOICE: KokoroVoiceId = "am_echo";

function getDefaultPlaybackSource(): TtsPlaybackSource {
  return "web";
}

export function getSelectedTtsPlaybackSource(): TtsPlaybackSource {
  try {
    const raw = localStorage.getItem(TTS_SOURCE_STORAGE_KEY);
    if (raw && TTS_SOURCE_SET.has(raw as TtsPlaybackSource)) return raw as TtsPlaybackSource;
  } catch {
    // ignore
  }
  return getDefaultPlaybackSource();
}

export function setSelectedTtsPlaybackSource(source: string): TtsPlaybackSource {
  const normalized = TTS_SOURCE_SET.has(source as TtsPlaybackSource)
    ? (source as TtsPlaybackSource)
    : getDefaultPlaybackSource();
  try {
    localStorage.setItem(TTS_SOURCE_STORAGE_KEY, normalized);
  } catch {
    // ignore
  }
  return normalized;
}

export function getSelectedTtsLanguageId(): TtsLanguageId {
  try {
    const raw = localStorage.getItem(TTS_LANGUAGE_STORAGE_KEY);
    if (raw && TTS_LANGUAGE_SET.has(raw as TtsLanguageId)) return raw as TtsLanguageId;
  } catch {
    // ignore
  }
  return "en-US";
}

export function setSelectedTtsLanguageId(lang: string): TtsLanguageId {
  const normalized = TTS_LANGUAGE_SET.has(lang as TtsLanguageId)
    ? (lang as TtsLanguageId)
    : "en-US";
  try {
    localStorage.setItem(TTS_LANGUAGE_STORAGE_KEY, normalized);
  } catch {
    // ignore
  }
  return normalized;
}

export function getSelectedKokoroVoiceId(): KokoroVoiceId {
  try {
    const raw = localStorage.getItem(KOKORO_VOICE_STORAGE_KEY);
    if (raw && KOKORO_VOICE_SET.has(raw as KokoroVoiceId)) return raw as KokoroVoiceId;
  } catch {
    // ignore
  }
  return KOKORO_DEFAULT_VOICE;
}

export function setSelectedKokoroVoiceId(voiceId: string): KokoroVoiceId {
  const normalized = KOKORO_VOICE_SET.has(voiceId as KokoroVoiceId)
    ? (voiceId as KokoroVoiceId)
    : KOKORO_DEFAULT_VOICE;
  try {
    localStorage.setItem(KOKORO_VOICE_STORAGE_KEY, normalized);
  } catch {
    // ignore
  }
  return normalized;
}

export function listKokoroVoiceIds(): readonly KokoroVoiceId[] {
  return KOKORO_VOICE_OPTIONS;
}
