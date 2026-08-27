import type * as SpeechSDKTypes from "microsoft-cognitiveservices-speech-sdk";
import type {
  RealtimeSttSession,
  StartRealtimeSttInput,
  SttProvider,
  StopRealtimeSttSessionResult,
  PronunciationAssessmentView,
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
    const languages = input.candidateLanguages.length ? input.candidateLanguages : ["zh-CN", "en-US", "ja-JP", "ko-KR"];
    const speechConfig = createSpeechConfig(SpeechSDK, this.subscriptionKey, this.region, input.languageIdMode, languages);

    const format = SpeechSDK.AudioStreamFormat.getWaveFormatPCM(
      input.sampleRate,
      input.bitsPerSample,
      input.channels
    );
    const pushStream = SpeechSDK.AudioInputStream.createPushStream(format);
    const audioConfig = SpeechSDK.AudioConfig.fromStreamInput(pushStream);
    const recognizer = languages.length === 1
      ? createSingleLanguageRecognizer(SpeechSDK, speechConfig, audioConfig, languages[0])
      : createAutoDetectRecognizer(SpeechSDK, speechConfig, audioConfig, languages, input.languageIdMode);
    if (input.pronunciationReferenceText) {
      if (languages.length !== 1) throw new Error("Pronunciation assessment requires one fixed language");
      const assessmentConfig = new SpeechSDK.PronunciationAssessmentConfig(
        input.pronunciationReferenceText,
        SpeechSDK.PronunciationAssessmentGradingSystem.HundredMark,
        SpeechSDK.PronunciationAssessmentGranularity.Phoneme,
        true,
      );
      assessmentConfig.enableProsodyAssessment = languages[0]?.toLowerCase() === "en-us";
      assessmentConfig.applyTo(recognizer);
    }
    let finalText = "";
    let pronunciationAssessment: PronunciationAssessmentView | undefined;

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
      if (input.pronunciationReferenceText) {
        const candidate = readPronunciationAssessment(SpeechSDK, event.result);
        if (candidate && isBetterAssessment(candidate, pronunciationAssessment)) pronunciationAssessment = candidate;
      }
      finalText = joinTranscript(finalText, text);
      input.onEvent({
        type: "final",
        text,
        ...(pronunciationAssessment ? { pronunciationAssessment } : {}),
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
      async stop(): Promise<StopRealtimeSttSessionResult> {
        if (closed) return { finalText, ...(pronunciationAssessment ? { pronunciationAssessment } : {}) };
        closed = true;
        pushStream.close();
        await stopContinuousRecognition(recognizer);
        recognizer.close();
        return { finalText, ...(pronunciationAssessment ? { pronunciationAssessment } : {}) };
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

function readPronunciationAssessment(
  SpeechSDK: SpeechSdkModule,
  result: SpeechSDKTypes.SpeechRecognitionResult,
): PronunciationAssessmentView | undefined {
  try {
    const assessment = SpeechSDK.PronunciationAssessmentResult.fromResult(result);
    const detail = assessment.detailResult;
    const value: PronunciationAssessmentView = {
      accuracyScore: finiteScore(assessment.accuracyScore),
      pronunciationScore: finiteScore(assessment.pronunciationScore),
      completenessScore: finiteScore(assessment.completenessScore),
      fluencyScore: finiteScore(assessment.fluencyScore),
      prosodyScore: Number.isFinite(assessment.prosodyScore) ? assessment.prosodyScore : null,
      words: (detail?.Words ?? []).map((word) => ({
        word: String(word.Word ?? ""),
        accuracyScore: Number.isFinite(word.PronunciationAssessment?.AccuracyScore) ? word.PronunciationAssessment!.AccuracyScore : null,
        errorType: word.PronunciationAssessment?.ErrorType ? String(word.PronunciationAssessment.ErrorType) : null,
      })).filter((word) => word.word),
    };
    if (value.accuracyScore <= 0 && value.completenessScore <= 0 && value.fluencyScore <= 0 && !value.words.length) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

function isBetterAssessment(candidate: PronunciationAssessmentView, current?: PronunciationAssessmentView): boolean {
  if (!current) return true;
  return candidate.completenessScore > current.completenessScore
    || candidate.completenessScore === current.completenessScore && candidate.pronunciationScore > current.pronunciationScore;
}

function finiteScore(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function createSpeechConfig(
  SpeechSDK: SpeechSdkModule,
  subscriptionKey: string,
  region: string,
  languageIdMode: "at_start" | "continuous",
  languages: string[]
): SpeechSDKTypes.SpeechConfig {
  if (languageIdMode === "continuous" && languages.length > 1) {
    const endpoint = new URL(`wss://${region}.stt.speech.microsoft.com/speech/universal/v2`);
    const speechConfig = SpeechSDK.SpeechConfig.fromEndpoint(endpoint, subscriptionKey);
    speechConfig.setProperty(SpeechSDK.PropertyId.SpeechServiceConnection_LanguageIdMode, "Continuous");
    speechConfig.setProperty(SpeechSDK.PropertyId.SpeechServiceResponse_PostProcessingOption, "TrueText");
    return speechConfig;
  }
  const speechConfig = SpeechSDK.SpeechConfig.fromSubscription(subscriptionKey, region);
  speechConfig.setProperty(SpeechSDK.PropertyId.SpeechServiceResponse_PostProcessingOption, "TrueText");
  if (languageIdMode === "at_start" && languages.length > 1) {
    speechConfig.setProperty(SpeechSDK.PropertyId.SpeechServiceConnection_LanguageIdMode, "AtStart");
  }
  return speechConfig;
}

function joinTranscript(current: string, next: string): string {
  const text = next.trim();
  if (!text) return current;
  if (!current) return text;
  return `${current} ${text}`;
}

function createSingleLanguageRecognizer(
  SpeechSDK: SpeechSdkModule,
  speechConfig: SpeechSDKTypes.SpeechConfig,
  audioConfig: SpeechSDKTypes.AudioConfig,
  language: string
): SpeechSDKTypes.SpeechRecognizer {
  speechConfig.speechRecognitionLanguage = language;
  return new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);
}

function createAutoDetectRecognizer(
  SpeechSDK: SpeechSdkModule,
  speechConfig: SpeechSDKTypes.SpeechConfig,
  audioConfig: SpeechSDKTypes.AudioConfig,
  languages: string[],
  languageIdMode: "at_start" | "continuous"
): SpeechSDKTypes.SpeechRecognizer {
  const languageConfig = SpeechSDK.AutoDetectSourceLanguageConfig.fromLanguages(languages);
  languageConfig.mode = languageIdMode === "continuous"
    ? SpeechSDK.LanguageIdMode.Continuous
    : SpeechSDK.LanguageIdMode.AtStart;
  return SpeechSDK.SpeechRecognizer.FromConfig(speechConfig, languageConfig, audioConfig);
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
