import type * as SpeechSDKTypes from "microsoft-cognitiveservices-speech-sdk";
import type { TtsSentenceMark, TtsWordMark } from "@lf/core/ports/repository/TtsAssetRepository.js";
import type { SynthesizeSpeechInput, SynthesizeSpeechResult, TtsProvider } from "../../services/tts/TtsProvider.js";
import { resolveDefaultTtsVoice } from "../../services/tts/TtsVoiceCatalog.js";

type SpeechSdkModule = typeof SpeechSDKTypes;
type RawBoundaryMark = {
  text: string;
  startMs: number;
  durationMs: number;
};

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

    const SpeechSDK = await loadSpeechSdk();
    const speechConfig = SpeechSDK.SpeechConfig.fromSubscription(this.subscriptionKey, this.region);
    speechConfig.speechSynthesisOutputFormat = SpeechSDK.SpeechSynthesisOutputFormat.Audio24Khz96KBitRateMonoMp3;
    speechConfig.setProperty(
      SpeechSDK.PropertyId.SpeechServiceResponse_RequestSentenceBoundary,
      "true"
    );
    speechConfig.setProperty(
      SpeechSDK.PropertyId.SpeechServiceResponse_RequestWordBoundary,
      "true"
    );
    speechConfig.setProperty(
      SpeechSDK.PropertyId.SpeechServiceResponse_RequestPunctuationBoundary,
      "true"
    );
    const synthesizer = new SpeechSDK.SpeechSynthesizer(speechConfig, undefined);
    const rawWordMarks: RawBoundaryMark[] = [];
    const rawSentenceMarks: RawBoundaryMark[] = [];

    synthesizer.wordBoundary = (_sender, event) => {
      const text = String(event.text ?? "").trim();
      if (!text) return;
      const mark = {
        text,
        startMs: ticksToMs(Number(event.audioOffset ?? 0)),
        durationMs: ticksToMs(Number(event.duration ?? 0)),
      };
      if (String(event.boundaryType) === "SentenceBoundary") {
        rawSentenceMarks.push(mark);
        return;
      }
      rawWordMarks.push(mark);
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
      const wordMarks = alignBoundaryMarks(input.text, rawWordMarks);
      const azureSentenceMarks = alignBoundaryMarks(input.text, rawSentenceMarks);
      const durationMs = resolveDurationMs([...wordMarks, ...azureSentenceMarks]);
      return {
        audio,
        format: "mp3",
        contentType: "audio/mpeg",
        durationMs,
        wordMarks,
        sentenceMarks: buildSentenceMarks(input.text, input.sentenceSegments, wordMarks, durationMs, azureSentenceMarks),
      };
    } finally {
      synthesizer.close();
    }
  }
}

async function loadSpeechSdk(): Promise<SpeechSdkModule> {
  try {
    return await import("microsoft-cognitiveservices-speech-sdk");
  } catch (error) {
    throw new Error(
      `microsoft-cognitiveservices-speech-sdk is required for Azure TTS: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function speakSsml(
  synthesizer: SpeechSDKTypes.SpeechSynthesizer,
  ssml: string
): Promise<SpeechSDKTypes.SpeechSynthesisResult> {
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
  durationMs: number | null,
  azureSentenceMarks: TtsWordMark[] = []
): TtsSentenceMark[] {
  if (!sentenceSegments.length) return [];
  const directSentenceMarks = matchSentenceBoundaryMarks(sentenceSegments, azureSentenceMarks);
  if (directSentenceMarks.length === sentenceSegments.length) return directSentenceMarks;

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

  return sentenceSegments.map((segment) => {
    const overlapping = wordMarks.filter((word) =>
      typeof word.textStart === "number" &&
      typeof word.textEnd === "number" &&
      word.textEnd > segment.textStart &&
      word.textStart < segment.textEnd
    );
    if (!overlapping.length) {
      return buildProportionalSentenceMark(segment, sourceText.length, durationMs);
    }
    const startMs = overlapping[0].startMs;
    const last = overlapping[overlapping.length - 1];
    const endMs = last.startMs + last.durationMs;
    return { ...segment, startMs, durationMs: Math.max(0, endMs - startMs) };
  });
}

function alignBoundaryMarks(sourceText: string, marks: RawBoundaryMark[]): TtsWordMark[] {
  let searchFrom = 0;
  return marks
    .map((mark) => {
      const range = findBoundaryTextRange(sourceText, mark.text, searchFrom);
      if (range) {
        searchFrom = range.textEnd;
        return {
          ...mark,
          textStart: range.textStart,
          textEnd: range.textEnd,
        };
      }
      return mark;
    })
    .sort((a, b) => a.startMs - b.startMs);
}

function findBoundaryTextRange(
  sourceText: string,
  boundaryText: string,
  searchFrom: number
): { textStart: number; textEnd: number } | null {
  const text = boundaryText.trim();
  if (!text) return null;
  const sourceLower = sourceText.toLowerCase();
  const textLower = text.toLowerCase();
  const fromIndex = Math.max(0, Math.min(searchFrom, sourceText.length));
  const index = sourceLower.indexOf(textLower, fromIndex);
  if (index < 0) return null;
  return {
    textStart: index,
    textEnd: index + text.length,
  };
}

function matchSentenceBoundaryMarks(
  sentenceSegments: Array<{ text: string; textStart: number; textEnd: number }>,
  azureSentenceMarks: TtsWordMark[]
): TtsSentenceMark[] {
  if (!azureSentenceMarks.length) return [];
  const used = new Set<number>();
  return sentenceSegments
    .map((segment, segmentIndex) => {
      const exactIndex = azureSentenceMarks.findIndex((mark, markIndex) =>
        !used.has(markIndex) &&
        mark.textStart === segment.textStart &&
        mark.textEnd === segment.textEnd
      );
      const fallbackIndex = exactIndex >= 0
        ? exactIndex
        : sentenceSegments.length === azureSentenceMarks.length
          ? segmentIndex
          : -1;
      const mark = fallbackIndex >= 0 ? azureSentenceMarks[fallbackIndex] : undefined;
      if (!mark) return null;
      used.add(fallbackIndex);
      return {
        ...segment,
        startMs: mark.startMs,
        durationMs: Math.max(0, mark.durationMs),
      };
    })
    .filter((mark): mark is TtsSentenceMark => mark !== null);
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

function resolveDurationMs(marks: Array<Pick<TtsWordMark, "startMs" | "durationMs">>): number | null {
  if (!marks.length) return null;
  return Math.max(...marks.map((mark) => mark.startMs + mark.durationMs));
}

function ticksToMs(value: number): number {
  return Math.round(value / 10000);
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
