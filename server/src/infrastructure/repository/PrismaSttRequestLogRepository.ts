import type {
  CreateSttRequestLogInput,
  SttRequestLogRepository,
} from "@lf/core/ports/repository/SttRequestLogRepository.js";

type PrismaSttRequestLogClient = {
  sttRequestLog: {
    create: (args: any) => Promise<any>;
  };
};

export class PrismaSttRequestLogRepository implements SttRequestLogRepository {
  constructor(private readonly prisma: PrismaSttRequestLogClient) {}

  async create(input: CreateSttRequestLogInput): Promise<void> {
    await this.prisma.sttRequestLog.create({
      data: {
        requestId: input.requestId ?? null,
        userId: input.userId,
        provider: input.provider,
        mode: input.mode,
        languageIdMode: input.languageIdMode,
        candidateLanguages: input.candidateLanguages,
        detectedLanguage: input.detectedLanguage ?? null,
        languageDetectionConfidence: input.languageDetectionConfidence ?? null,
        audioFormat: input.audioFormat,
        sampleRate: input.sampleRate,
        channels: input.channels,
        bitsPerSample: input.bitsPerSample,
        audioBytes: input.audioBytes,
        audioDurationMs: input.audioDurationMs,
        billableSeconds: input.billableSeconds,
        transcriptChars: input.transcriptChars,
        recognizedTextPresent: input.recognizedTextPresent,
        status: input.status,
        durationMs: input.durationMs ?? null,
        errorCode: input.errorCode ?? null,
        errorMessage: input.errorMessage ?? null,
      },
    });
  }
}
