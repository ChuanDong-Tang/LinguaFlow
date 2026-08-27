import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { calculatePcmAudioLevel } from "../services/stt/pcmAudioLevel";
import { createPicovoiceRealtimeAudioSource } from "../services/stt/picovoiceRealtimeAudioSource";
import type { RealtimeAudioSource } from "../services/stt/realtimeAudioSource";
import { openRealtimeSttSession, type PronunciationAssessment, type RealtimeSttSession } from "../services/api/sttRealtimeApi";

export type MemoryPronunciationStatus = "preparing" | "ready" | "recording" | "evaluating" | "retry" | "error";

const FRAME_LENGTH = 512;
const VOICE_LEVEL = 0.12;
const AUTO_STOP_SILENCE_MS = 850;
const EVALUATION_TIMEOUT_MS = 8_000;

export function useMemoryPronunciation(input: {
  active: boolean;
  referenceText: string;
  languageCode: string;
  onPassed: (assessment: PronunciationAssessment) => void;
  onNeedsRetry: (assessment: PronunciationAssessment | null) => void;
}) {
  const [status, setStatus] = useState<MemoryPronunciationStatus>("preparing");
  const [audioLevel, setAudioLevel] = useState(0);
  const sessionRef = useRef<RealtimeSttSession | null>(null);
  const sourceRef = useRef<RealtimeAudioSource | null>(null);
  const generationRef = useRef(0);
  const statusRef = useRef<MemoryPronunciationStatus>("preparing");
  const callbacksRef = useRef({ onPassed: input.onPassed, onNeedsRetry: input.onNeedsRetry });
  const stopRef = useRef<() => Promise<void>>(async () => undefined);
  const voiceStartedRef = useRef(false);
  const lastVoiceAtRef = useRef(0);
  const recordingStartedAtRef = useRef(0);
  const evaluationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doneHandledRef = useRef(false);

  useEffect(() => { callbacksRef.current = { onPassed: input.onPassed, onNeedsRetry: input.onNeedsRetry }; });
  const updateStatus = useCallback((next: MemoryPronunciationStatus) => { statusRef.current = next; setStatus(next); }, []);

  const prepare = useCallback(async (): Promise<RealtimeSttSession | null> => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    doneHandledRef.current = false;
    if (evaluationTimerRef.current) clearTimeout(evaluationTimerRef.current);
    evaluationTimerRef.current = null;
    void sourceRef.current?.stop().catch(() => undefined);
    sourceRef.current = null;
    sessionRef.current?.close();
    sessionRef.current = null;
    updateStatus("preparing");
    try {
      const session = await openRealtimeSttSession({
        frameLength: FRAME_LENGTH,
        languageIdMode: "at_start",
        candidateLanguages: [normalizeSpeechLanguage(input.languageCode)],
        pronunciationReferenceText: input.referenceText,
        onEvent: (event) => {
          if (generationRef.current !== generation) return;
          if (event.type === "done") {
            doneHandledRef.current = true;
            if (evaluationTimerRef.current) clearTimeout(evaluationTimerRef.current);
            evaluationTimerRef.current = null;
            sessionRef.current = null;
            setAudioLevel(0);
            const assessment = event.pronunciationAssessment ?? null;
            if (assessment && passesPronunciation(assessment)) callbacksRef.current.onPassed(assessment);
            else {
              updateStatus("retry");
              callbacksRef.current.onNeedsRetry(assessment);
            }
          } else if (event.type === "error" || event.type === "canceled") {
            if (doneHandledRef.current) return;
            doneHandledRef.current = true;
            if (evaluationTimerRef.current) clearTimeout(evaluationTimerRef.current);
            evaluationTimerRef.current = null;
            void sourceRef.current?.stop().catch(() => undefined);
            sourceRef.current = null;
            updateStatus("error");
            callbacksRef.current.onNeedsRetry(null);
          }
        },
        onError: () => {
          if (generationRef.current !== generation || doneHandledRef.current) return;
          doneHandledRef.current = true;
          if (evaluationTimerRef.current) clearTimeout(evaluationTimerRef.current);
          evaluationTimerRef.current = null;
          void sourceRef.current?.stop().catch(() => undefined);
          sourceRef.current = null;
          updateStatus("error");
          callbacksRef.current.onNeedsRetry(null);
        },
        onClose: () => {
          if (generationRef.current !== generation || doneHandledRef.current || statusRef.current === "retry") return;
          sessionRef.current = null;
          doneHandledRef.current = true;
          if (evaluationTimerRef.current) clearTimeout(evaluationTimerRef.current);
          evaluationTimerRef.current = null;
          void sourceRef.current?.stop().catch(() => undefined);
          sourceRef.current = null;
          updateStatus("error");
          callbacksRef.current.onNeedsRetry(null);
        },
      });
      if (generationRef.current !== generation || !input.active) {
        session.close();
        return null;
      }
      sessionRef.current = session;
      updateStatus("ready");
      return session;
    } catch {
      if (generationRef.current === generation) updateStatus("error");
      return null;
    }
  }, [input.active, input.languageCode, input.referenceText, updateStatus]);

  useEffect(() => {
    if (input.active) void prepare();
    return () => {
      generationRef.current += 1;
      doneHandledRef.current = true;
      if (evaluationTimerRef.current) clearTimeout(evaluationTimerRef.current);
      evaluationTimerRef.current = null;
      void sourceRef.current?.stop().catch(() => undefined);
      sourceRef.current = null;
      sessionRef.current?.close();
      sessionRef.current = null;
    };
  }, [input.active, prepare]);
  useEffect(() => {
    if (!input.active) return;
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active" || statusRef.current !== "recording") return;
      generationRef.current += 1;
      doneHandledRef.current = true;
      void sourceRef.current?.stop().catch(() => undefined);
      sourceRef.current = null;
      sessionRef.current?.close();
      sessionRef.current = null;
      setAudioLevel(0);
      updateStatus("error");
    });
    return () => subscription.remove();
  }, [input.active, updateStatus]);

  const stop = useCallback(async () => {
    if (statusRef.current !== "recording") return;
    updateStatus("evaluating");
    const source = sourceRef.current;
    sourceRef.current = null;
    await source?.stop().catch(() => undefined);
    const session = sessionRef.current;
    if (!session) {
      updateStatus("error");
      callbacksRef.current.onNeedsRetry(null);
      return;
    }
    session.stop();
    evaluationTimerRef.current = setTimeout(() => {
      if (statusRef.current !== "evaluating" || doneHandledRef.current) return;
      doneHandledRef.current = true;
      sessionRef.current?.close();
      sessionRef.current = null;
      updateStatus("error");
      callbacksRef.current.onNeedsRetry(null);
    }, EVALUATION_TIMEOUT_MS);
  }, [updateStatus]);
  stopRef.current = stop;

  const cancel = useCallback(() => {
    generationRef.current += 1;
    doneHandledRef.current = true;
    if (evaluationTimerRef.current) clearTimeout(evaluationTimerRef.current);
    evaluationTimerRef.current = null;
    void sourceRef.current?.stop().catch(() => undefined);
    sourceRef.current = null;
    sessionRef.current?.close();
    sessionRef.current = null;
    setAudioLevel(0);
  }, []);

  const start = useCallback(async () => {
    let session = sessionRef.current;
    if (statusRef.current === "retry" || statusRef.current === "error") {
      session = await prepare();
    }
    if (!session || statusRef.current !== "ready") return;
    const generation = generationRef.current;
    const source = createPicovoiceRealtimeAudioSource();
    if (!await source.requestPermission().catch(() => false)) {
      if (generationRef.current !== generation) return;
      updateStatus("error");
      return;
    }
    if (generationRef.current !== generation) {
      await source.stop().catch(() => undefined);
      return;
    }
    sourceRef.current = source;
    voiceStartedRef.current = false;
    lastVoiceAtRef.current = Date.now();
    recordingStartedAtRef.current = Date.now();
    updateStatus("recording");
    try {
      await source.start({
        sampleRate: 16000,
        frameLength: FRAME_LENGTH,
        onFrame: (frame) => {
          if (generationRef.current !== generation || statusRef.current !== "recording") return;
          session!.sendFrame(frame);
          const level = calculatePcmAudioLevel(frame.pcm);
          setAudioLevel(level);
          const now = Date.now();
          if (now - recordingStartedAtRef.current >= 20_000) {
            void stopRef.current();
            return;
          }
          if (level >= VOICE_LEVEL) {
            voiceStartedRef.current = true;
            lastVoiceAtRef.current = now;
          } else if (voiceStartedRef.current && now - lastVoiceAtRef.current >= AUTO_STOP_SILENCE_MS && now - recordingStartedAtRef.current >= 1000) {
            void stopRef.current();
          }
        },
        onError: () => {
          doneHandledRef.current = true;
          void source.stop().catch(() => undefined);
          sourceRef.current = null;
          session.close();
          sessionRef.current = null;
          updateStatus("error");
          callbacksRef.current.onNeedsRetry(null);
        },
      });
      if (generationRef.current !== generation) await source.stop().catch(() => undefined);
    } catch {
      doneHandledRef.current = true;
      await source.stop().catch(() => undefined);
      sourceRef.current = null;
      session.close();
      sessionRef.current = null;
      updateStatus("error");
      callbacksRef.current.onNeedsRetry(null);
    }
  }, [prepare, updateStatus]);

  return { status, audioLevel, start, stop, cancel };
}

function passesPronunciation(value: PronunciationAssessment): boolean {
  return value.completenessScore >= 68 && value.accuracyScore >= 52;
}

function normalizeSpeechLanguage(value: string): string {
  const language = value.trim();
  if (/^ja(?:-|$)/i.test(language)) return "ja-JP";
  if (/^zh(?:-|$)/i.test(language)) return "zh-CN";
  if (/^ko(?:-|$)/i.test(language)) return "ko-KR";
  const englishRegion = language.match(/^en-([a-z]{2})$/i)?.[1];
  return englishRegion ? `en-${englishRegion.toUpperCase()}` : "en-US";
}
