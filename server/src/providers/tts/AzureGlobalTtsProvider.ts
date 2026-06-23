import * as SpeechSDK from "microsoft-cognitiveservices-speech-sdk";
import type { TtsSentenceMark, TtsWordMark } from "@lf/core/ports/repository/TtsAssetRepository.js";
import type { SynthesizeSpeechInput, SynthesizeSpeechResult, TtsProvider } from "../../services/tts/TtsProvider.js";
import { resolveDefaultTtsVoice } from "../../services/tts/TtsVoiceCatalog.js";

export class AzureGlobalTtsProvider implements TtsProvider {
  readonly providerName = "azure_global";

  constructor(
    private readonly subscriptionKey = process.env.AZURE_SPEECH_KEY ?? "",
    private readonly region = process.env.AZURE_SPEECH_REGION ?? ""
  ) {}

  async synthesize(input: SynthesizeSpeechInput): Promise<SynthesizeSpeechResult> {
    if (!this.subscriptionKey || !this.region) {
      throw new Error("AZURE_SPEECH_KEY and AZURE_SPEECH_REGION are required");
    }

    const speechConfig = SpeechSDK.SpeechConfig.fromSubscription(this.subscriptionKey, this.region);
    speechConfig.speechSynthesisOutputFormat = SpeechSDK.SpeechSynthesisOutputFormat.Audio24Khz96KBitRateMonoMp3;
    speechConfig.setProperty(
      SpeechSDK.PropertyId.SpeechServiceResponse_RequestSentenceBoundary,
      "true"
    );
    const synthesizer = new SpeechSDK.SpeechSynthesizer(speechConfig, undefined);
    const wordMarks: TtsWordMark[] = [];

    synthesizer.wordBoundary = (_sender, event) => {
      const text = String(event.text ?? "").trim();
      if (!text) return;
      const textStart = readFiniteNumber((event as { textOffset?: unknown }).textOffset);
      const textLength = readFiniteNumber((event as { wordLength?: unknown }).wordLength);
      wordMarks.push({
        text,
        ...(textStart !== null ? { textStart } : {}),
        ...(textStart !== null && textLength !== null ? { textEnd: textStart + textLength } : {}),
        startMs: ticksToMs(Number(event.audioOffset ?? 0)),
        durationMs: ticksToMs(Number(event.duration ?? 0)),
      });
    };

    try {
      const result = await speakSsml(synthesizer, buildSsml({
        text: input.text,
        languageCode: input.languageCode,
        voiceCode: input.voiceCode || resolveDefaultTtsVoice(input.languageCode, this.providerName),
      }));
      if (result.reason !== SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
        throw new Error(result.errorDetails || `Azure speech synthesis failed: ${result.reason}`);
      }
      const audio = Buffer.from(result.audioData);
      const durationMs = resolveDurationMs(wordMarks);
      return {
        audio,
        format: "mp3",
        contentType: "audio/mpeg",
        durationMs,
        wordMarks,
        sentenceMarks: buildSentenceMarks(input.text, input.sentenceSegments, wordMarks, durationMs),
      };
    } finally {
      synthesizer.close();
    }
  }
}

function speakSsml(synthesizer: SpeechSDK.SpeechSynthesizer, ssml: string): Promise<SpeechSDK.SpeechSynthesisResult> {
  return new Promise((resolve, reject) => {
    synthesizer.speakSsmlAsync(
      ssml,
      (result) => resolve(result),
      (error) => reject(new Error(String(error)))
    );
  });
}

function buildSsml(input: { text: string; languageCode: string; voiceCode: string }): string {
  return [
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${escapeXml(input.languageCode)}">`,
    `<voice name="${escapeXml(input.voiceCode)}">`,
    escapeXml(input.text),
    "</voice>",
    "</speak>",
  ].join("");
}

function buildSentenceMarks(
  sourceText: string,
  sentenceSegments: Array<{ text: string; textStart: number; textEnd: number }>,
  wordMarks: TtsWordMark[],
  durationMs: number | null
): TtsSentenceMark[] {
  if (!sentenceSegments.length) return [];
  if (!wordMarks.length || !durationMs) {
    const totalChars = sentenceSegments.reduce((sum, row) => sum + row.text.length, 0) || 1;
    let cursor = 0;
    return sentenceSegments.map((segment) => {
      const startMs = Math.round(cursor / totalChars * durationMs!);
      cursor += segment.text.length;
      const endMs = Math.round(cursor / totalChars * durationMs!);
      return { ...segment, startMs, durationMs: Math.max(0, endMs - startMs) };
    });
  }

  let searchFrom = 0;
  const wordRanges = wordMarks.map((word) => {
    if (typeof word.textStart === "number" && typeof word.textEnd === "number") {
      return { ...word, textStart: word.textStart, textEnd: word.textEnd };
    }
    const index = sourceText.toLowerCase().indexOf(word.text.toLowerCase(), searchFrom);
    const start = index >= 0 ? index : searchFrom;
    const end = start + word.text.length;
    searchFrom = end;
    return { ...word, textStart: start, textEnd: end };
  });

  return sentenceSegments.map((segment) => {
    const overlapping = wordRanges.filter((word) => word.textEnd > segment.textStart && word.textStart < segment.textEnd);
    if (!overlapping.length) {
      return buildProportionalSentenceMark(segment, sourceText.length, durationMs);
    }
    const startMs = overlapping[0].startMs;
    const last = overlapping[overlapping.length - 1];
    const endMs = last.startMs + last.durationMs;
    return { ...segment, startMs, durationMs: Math.max(0, endMs - startMs) };
  });
}

function buildProportionalSentenceMark(
  segment: { text: string; textStart: number; textEnd: number },
  totalChars: number,
  durationMs: number
): TtsSentenceMark {
  const safeTotal = Math.max(1, totalChars);
  const startMs = Math.round(segment.textStart / safeTotal * durationMs);
  const endMs = Math.round(segment.textEnd / safeTotal * durationMs);
  return { ...segment, startMs, durationMs: Math.max(0, endMs - startMs) };
}

function resolveDurationMs(wordMarks: TtsWordMark[]): number | null {
  const last = wordMarks[wordMarks.length - 1];
  return last ? last.startMs + last.durationMs : null;
}

function ticksToMs(value: number): number {
  return Math.round(value / 10000);
}

function readFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function resolveDefaultAzureVoice(languageCode: string): string {
  return resolveDefaultTtsVoice(languageCode, "azure_global");
}
