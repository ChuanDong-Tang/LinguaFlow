export type PcmAudioFrame = {
  pcm: Int16Array;
  sampleRate: number;
  channels: 1;
  timestampMs: number;
};

export type StartRealtimeAudioInput = {
  sampleRate: number;
  frameLength: number;
  onFrame: (frame: PcmAudioFrame) => void;
  onError: (error: Error) => void;
};

export interface RealtimeAudioSource {
  requestPermission(): Promise<boolean>;
  start(input: StartRealtimeAudioInput): Promise<void>;
  stop(): Promise<void>;
}
