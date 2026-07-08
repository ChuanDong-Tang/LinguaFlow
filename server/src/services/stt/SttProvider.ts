export type SttRecognitionEvent =
  | {
      type: "partial";
      text: string;
      alternatives?: SttRecognitionAlternatives;
      detectedLanguage: string | null;
      languageDetectionConfidence: string | null;
    }
  | {
      type: "final";
      text: string;
      alternatives?: SttRecognitionAlternatives;
      detectedLanguage: string | null;
      languageDetectionConfidence: string | null;
    }
  | {
      type: "canceled";
      reason: string;
      errorCode: string | null;
      errorDetails: string | null;
    };

export type StartRealtimeSttInput = {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  candidateLanguages: string[];
  languageIdMode: "at_start" | "continuous";
  onEvent: (event: SttRecognitionEvent) => void;
};

export type SttRecognitionAlternatives = {
  displayText: string | null;
  nbestDisplay: string | null;
  lexical: string | null;
  itn: string | null;
  confidence: number | null;
};

export type StopRealtimeSttSessionResult = {
  finalText: string;
};

export type RealtimeSttSession = {
  write: (chunk: ArrayBuffer) => void;
  stop: () => Promise<StopRealtimeSttSessionResult>;
  close: () => void;
};

export interface SttProvider {
  readonly providerName: string;
  startRealtimeSession(input: StartRealtimeSttInput): Promise<RealtimeSttSession>;
}
