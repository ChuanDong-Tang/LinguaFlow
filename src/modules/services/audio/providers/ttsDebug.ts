export const TTS_DEBUG_EVENT = "app-tts-debug";

export interface TtsDebugEventDetail {
  level: "info" | "warn" | "error";
  stage: string;
  message: string;
  meta?: Record<string, unknown>;
  at: string;
}

export function emitTtsDebug(detail: Omit<TtsDebugEventDetail, "at">): void {
  if (typeof document === "undefined") return;
  document.dispatchEvent(
    new CustomEvent<TtsDebugEventDetail>(TTS_DEBUG_EVENT, {
      detail: { ...detail, at: new Date().toISOString() },
    }),
  );
}
