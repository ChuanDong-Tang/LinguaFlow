import type { RealtimeSttSession, SttProvider, SttRecognitionEvent } from "./SttProvider.js";

export type StartSttSessionInput = {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  candidateLanguages: string[];
  languageIdMode?: "at_start" | "continuous";
  onEvent: (event: SttRecognitionEvent) => void;
};

export class SttService {
  constructor(private readonly provider: SttProvider) {}

  get providerName(): string {
    return this.provider.providerName;
  }

  async startRealtimeSession(input: StartSttSessionInput): Promise<RealtimeSttSession> {
    validateAudioFormat(input);
    return this.provider.startRealtimeSession({
      ...input,
      languageIdMode: input.languageIdMode ?? "at_start",
    });
  }
}

function validateAudioFormat(input: Pick<StartSttSessionInput, "sampleRate" | "channels" | "bitsPerSample">): void {
  if (input.sampleRate !== 16000) {
    throw new Error("sampleRate must be 16000");
  }
  if (input.channels !== 1) {
    throw new Error("channels must be 1");
  }
  if (input.bitsPerSample !== 16) {
    throw new Error("bitsPerSample must be 16");
  }
}
