import type { TtsSentenceMark, TtsWordMark } from "@lf/core/ports/repository/TtsAssetRepository.js";

export type TtsAudioFormat = "mp3";

export interface SynthesizeSpeechInput {
  text: string;
  languageCode: string;
  voiceCode: string;
  sentenceSegments: Array<{ text: string; textStart: number; textEnd: number }>;
}

export interface SynthesizeSpeechResult {
  audio: Buffer;
  format: TtsAudioFormat;
  contentType: string;
  durationMs: number | null;
  wordMarks: TtsWordMark[];
  sentenceMarks: TtsSentenceMark[];
}

export interface TtsProvider {
  readonly providerName: string;
  synthesize(input: SynthesizeSpeechInput): Promise<SynthesizeSpeechResult>;
}
