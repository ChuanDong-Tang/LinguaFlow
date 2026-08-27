export type PronunciationAssessmentView = {
  accuracyScore: number;
  pronunciationScore: number;
  completenessScore: number;
  fluencyScore: number;
  prosodyScore: number | null;
  words: Array<{ word: string; accuracyScore: number | null; errorType: string | null }>;
};

export type SttRecognitionEvent =
  | {
      type: "partial";
      text: string;
      detectedLanguage: string | null;
      languageDetectionConfidence: string | null;
    }
  | {
      type: "final";
      text: string;
      detectedLanguage: string | null;
      languageDetectionConfidence: string | null;
      pronunciationAssessment?: PronunciationAssessmentView;
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
  pronunciationReferenceText?: string;
  onEvent: (event: SttRecognitionEvent) => void;
};

export type StopRealtimeSttSessionResult = {
  finalText: string;
  pronunciationAssessment?: PronunciationAssessmentView;
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
