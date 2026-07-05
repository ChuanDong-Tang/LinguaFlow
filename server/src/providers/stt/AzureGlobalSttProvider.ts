import type * as SpeechSDKTypes from "microsoft-cognitiveservices-speech-sdk";
import type {
  RealtimeSttSession,
  StartRealtimeSttInput,
  SttProvider,
} from "../../services/stt/SttProvider.js";

type SpeechSdkModule = typeof SpeechSDKTypes;

export class AzureGlobalSttProvider implements SttProvider {
  readonly providerName = "azure_global";

  constructor(
    private readonly subscriptionKey = process.env.AZURE_SPEECH_KEY ?? "",
    private readonly region = process.env.AZURE_SPEECH_REGION ?? ""
  ) {}

  async startRealtimeSession(input: StartRealtimeSttInput): Promise<RealtimeSttSession> {
    if (!this.subscriptionKey || !this.region) {
      throw new Error("AZURE_SPEECH_KEY and AZURE_SPEECH_REGION are required");
    }
    if (input.channels !== 1 || input.bitsPerSample !== 16) {
      throw new Error("Azure realtime STT currently expects 16-bit mono PCM input");
    }

    const SpeechSDK = await loadSpeechSdk();
    const speechConfig = SpeechSDK.SpeechConfig.fromSubscription(this.subscriptionKey, this.region);
    speechConfig.outputFormat = SpeechSDK.OutputFormat.Detailed;

    const format = SpeechSDK.AudioStreamFormat.getWaveFormatPCM(
      input.sampleRate,
      input.bitsPerSample,
      input.channels
    );
    const pushStream = SpeechSDK.AudioInputStream.createPushStream(format);
    const audioConfig = SpeechSDK.AudioConfig.fromStreamInput(pushStream);
    const languages = input.candidateLanguages.length ? input.candidateLanguages : ["zh-CN", "en-US", "ja-JP"];
    const languageConfig = SpeechSDK.AutoDetectSourceLanguageConfig.fromLanguages(languages);
    languageConfig.mode = input.languageIdMode === "continuous"
      ? SpeechSDK.LanguageIdMode.Continuous
      : SpeechSDK.LanguageIdMode.AtStart;
    const recognizer = SpeechSDK.SpeechRecognizer.FromConfig(speechConfig, languageConfig, audioConfig);

    recognizer.recognizing = (_sender, event) => {
      const text = String(event.result.text ?? "").trim();
      if (!text) return;
      input.onEvent({
        type: "partial",
        text,
        ...readDetectedLanguage(SpeechSDK, event.result),
      });
    };
    recognizer.recognized = (_sender, event) => {
      const text = String(event.result.text ?? "").trim();
      if (!text) return;
      input.onEvent({
        type: "final",
        text,
        ...readDetectedLanguage(SpeechSDK, event.result),
      });
    };
    recognizer.canceled = (_sender, event) => {
      input.onEvent({
        type: "canceled",
        reason: String(event.reason),
        errorCode: event.errorCode === undefined ? null : String(event.errorCode),
        errorDetails: event.errorDetails || null,
      });
    };

    await startContinuousRecognition(recognizer);

    let closed = false;
    return {
      write(chunk) {
        if (closed) return;
        pushStream.write(chunk);
      },
      async stop() {
        if (closed) return;
        closed = true;
        pushStream.close();
        await stopContinuousRecognition(recognizer);
        recognizer.close();
      },
      close() {
        if (closed) return;
        closed = true;
        pushStream.close();
        recognizer.close();
      },
    };
  }
}

async function loadSpeechSdk(): Promise<SpeechSdkModule> {
  try {
    return await import("microsoft-cognitiveservices-speech-sdk");
  } catch (error) {
    throw new Error(
      `microsoft-cognitiveservices-speech-sdk is required for Azure STT: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function startContinuousRecognition(recognizer: SpeechSDKTypes.SpeechRecognizer): Promise<void> {
  return new Promise((resolve, reject) => {
    recognizer.startContinuousRecognitionAsync(
      () => resolve(),
      (error) => reject(new Error(String(error)))
    );
  });
}

function stopContinuousRecognition(recognizer: SpeechSDKTypes.SpeechRecognizer): Promise<void> {
  return new Promise((resolve, reject) => {
    recognizer.stopContinuousRecognitionAsync(
      () => resolve(),
      (error) => reject(new Error(String(error)))
    );
  });
}

function readDetectedLanguage(
  SpeechSDK: SpeechSdkModule,
  result: SpeechSDKTypes.SpeechRecognitionResult
): { detectedLanguage: string | null; languageDetectionConfidence: string | null } {
  try {
    const detected = SpeechSDK.AutoDetectSourceLanguageResult.fromResult(result);
    return {
      detectedLanguage: detected.language || null,
      languageDetectionConfidence: detected.languageDetectionConfidence || null,
    };
  } catch {
    return { detectedLanguage: null, languageDetectionConfidence: null };
  }
}
