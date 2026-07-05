import { setAudioModeAsync } from "expo-audio";
import { VoiceProcessor, type VoiceProcessorError } from "@picovoice/react-native-voice-processor";
import type { PcmAudioFrame, RealtimeAudioSource, StartRealtimeAudioInput } from "./realtimeAudioSource";

export function createPicovoiceRealtimeAudioSource(): RealtimeAudioSource {
  const voiceProcessor = VoiceProcessor.instance;
  let frameListener: ((frame: number[]) => void) | null = null;
  let errorListener: ((error: VoiceProcessorError) => void) | null = null;

  return {
    async requestPermission(): Promise<boolean> {
      return voiceProcessor.hasRecordAudioPermission();
    },

    async start(input: StartRealtimeAudioInput): Promise<void> {
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        shouldPlayInBackground: false,
      });
      frameListener = (frame: number[]) => {
        input.onFrame({
          pcm: Int16Array.from(frame),
          sampleRate: input.sampleRate,
          channels: 1,
          timestampMs: Date.now(),
        });
      };
      errorListener = (error: VoiceProcessorError) => {
        input.onError(error);
      };
      voiceProcessor.addFrameListener(frameListener);
      voiceProcessor.addErrorListener(errorListener);
      await voiceProcessor.start(input.frameLength, input.sampleRate);
    },

    async stop(): Promise<void> {
      try {
        if (await voiceProcessor.isRecording()) {
          await voiceProcessor.stop();
        }
      } finally {
        if (frameListener) {
          voiceProcessor.removeFrameListener(frameListener);
          frameListener = null;
        }
        if (errorListener) {
          voiceProcessor.removeErrorListener(errorListener);
          errorListener = null;
        }
        await setAudioModeAsync({
          allowsRecording: false,
          playsInSilentMode: true,
          shouldPlayInBackground: false,
        }).catch(() => {});
      }
    },
  };
}
