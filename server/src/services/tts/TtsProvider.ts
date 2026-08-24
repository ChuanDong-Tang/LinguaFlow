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
  providerTimings?: {
    firstByteMs: number | null;
    finishMs: number | null;
    networkMs: number | null;
  };
}

export interface SynthesizeSpeechStreamCallbacks {
  onAudioChunk(chunk: Buffer): void;
}

export interface TtsProvider {
  readonly providerName: string;
  synthesize(input: SynthesizeSpeechInput): Promise<SynthesizeSpeechResult>;
  synthesizeStreaming?(
    input: SynthesizeSpeechInput,
    callbacks: SynthesizeSpeechStreamCallbacks,
  ): Promise<SynthesizeSpeechResult>;
}
