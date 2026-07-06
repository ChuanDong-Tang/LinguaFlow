export type SttRequestLogStatus = "success" | "failed";

export interface CreateSttRequestLogInput {
  requestId?: string | null;
  userId: string;
  provider: string;
  mode: string;
  languageIdMode: "at_start" | "continuous";
  candidateLanguages: string[];
  detectedLanguage?: string | null;
  languageDetectionConfidence?: string | null;
  audioFormat: string;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  audioBytes: number;
  audioDurationMs: number;
  billableSeconds: number;
  transcriptChars: number;
  recognizedTextPresent: boolean;
  status: SttRequestLogStatus;
  durationMs?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export interface SttRequestLogRepository {
  create(input: CreateSttRequestLogInput): Promise<void>;
}
