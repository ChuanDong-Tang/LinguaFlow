import { useNetInfo } from "@react-native-community/netinfo";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { getLanguage, t } from "../i18n";
import { getUserPreference } from "../services/api/meApi";
import {
  openRealtimeSttSession,
  STT_INPUT_MAX_RECORDING_MS,
  type RealtimeSttSession,
} from "../services/api/sttRealtimeApi";
import { createPicovoiceRealtimeAudioSource } from "../services/stt/picovoiceRealtimeAudioSource";
import type { PcmAudioFrame, RealtimeAudioSource } from "../services/stt/realtimeAudioSource";
import { stopTtsAudio } from "../services/tts/ttsPlayback";
import { calculatePcmAudioLevel } from "../services/stt/pcmAudioLevel";

export type RealtimeSttInputStatus = "idle" | "connecting" | "recording" | "stopping";

const FRAME_LENGTH = 512;
const PREBUFFER_MAX_FRAMES = 180;
const MULTILINGUAL_LANGUAGES = ["zh-CN", "ja-JP", "ko-KR", "en-US"];

export function useRealtimeSttInput(input: {
  value: string;
  onChangeText?: (value: string) => void;
  disabled?: boolean;
  languageCode?: string;
}) {
  const netInfo = useNetInfo();
  const [status, setStatus] = useState<RealtimeSttInputStatus>("idle");
  const [audioLevel, setAudioLevel] = useState(0);
  const valueRef = useRef(input.value);
  const onChangeTextRef = useRef(input.onChangeText);
  const selectionRef = useRef({ start: input.value.length, end: input.value.length });
  const sourceRef = useRef<RealtimeAudioSource | null>(null);
  const sessionRef = useRef<RealtimeSttSession | null>(null);
  const generationRef = useRef(0);
  const mountedRef = useRef(true);
  const statusRef = useRef<RealtimeSttInputStatus>("idle");
  const baseRef = useRef("");
  const rangeRef = useRef({ start: 0, end: 0 });
  const finalTextRef = useRef("");
  const partialTextRef = useRef("");
  const multilingualRecognitionRef = useRef(false);
  const lastAudioLevelAtRef = useRef(0);

  useEffect(() => { valueRef.current = input.value; }, [input.value]);
  useEffect(() => { onChangeTextRef.current = input.onChangeText; }, [input.onChangeText]);
  useEffect(() => { statusRef.current = status; }, [status]);
  useEffect(() => {
    let cancelled = false;
    void getUserPreference().then((preference) => {
      if (!cancelled) multilingualRecognitionRef.current = preference.sttMultilingualRecognitionEnabled === true;
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      void sourceRef.current?.stop().catch(() => undefined);
      sourceRef.current = null;
      sessionRef.current?.close();
      sessionRef.current = null;
    };
  }, []);

  const stop = useCallback(async () => {
    if (statusRef.current === "idle" || statusRef.current === "stopping") return;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    statusRef.current = "stopping";
    setStatus("stopping");
    setAudioLevel(0);
    const source = sourceRef.current;
    sourceRef.current = null;
    await source?.stop().catch(() => undefined);
    sessionRef.current?.close();
    sessionRef.current = null;
    if (!mountedRef.current || generationRef.current !== generation) return;
    statusRef.current = "idle";
    setStatus("idle");
  }, []);

  const start = useCallback(async () => {
    if (input.disabled || !onChangeTextRef.current) return;
    if (statusRef.current !== "idle") {
      await stop();
      return;
    }
    if (netInfo.isConnected === false) {
      Alert.alert(t("stt.error.start_title"), t("stt.error.network_retry"));
      return;
    }
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    statusRef.current = "connecting";
    setStatus("connecting");
    stopTtsAudio({ resetControls: true });
    const source = createPicovoiceRealtimeAudioSource();
    const hasPermission = await source.requestPermission().catch(() => false);
    if (!mountedRef.current || generationRef.current !== generation) {
      await source.stop().catch(() => undefined);
      return;
    }
    if (!hasPermission) {
      statusRef.current = "idle";
      setStatus("idle");
      Alert.alert(t("stt.permission.title"), t("stt.permission.input_message"));
      return;
    }

    const currentValue = valueRef.current;
    const selection = selectionRef.current;
    baseRef.current = currentValue;
    rangeRef.current = {
      start: Math.max(0, Math.min(selection.start, selection.end, currentValue.length)),
      end: Math.max(0, Math.min(Math.max(selection.start, selection.end), currentValue.length)),
    };
    finalTextRef.current = "";
    partialTextRef.current = "";
    const forcedLanguage = input.languageCode?.trim();
    const multilingual = !forcedLanguage && multilingualRecognitionRef.current;
    const candidateLanguages = forcedLanguage ? [forcedLanguage] : multilingual ? MULTILINGUAL_LANGUAGES : [directLanguage(getLanguage())];
    const bufferedFrames: PcmAudioFrame[] = [];
    const sendOrBuffer = (frame: PcmAudioFrame) => {
      if (generationRef.current !== generation) return;
      const now = Date.now();
      if (now - lastAudioLevelAtRef.current >= 90) {
        lastAudioLevelAtRef.current = now;
        setAudioLevel(calculatePcmAudioLevel(frame.pcm));
      }
      const session = sessionRef.current;
      if (session) session.sendFrame(frame);
      else {
        bufferedFrames.push({ ...frame, pcm: Int16Array.from(frame.pcm) });
        if (bufferedFrames.length > PREBUFFER_MAX_FRAMES) bufferedFrames.shift();
      }
    };
    const applyRecognition = (finalText: string, partialText: string) => {
      const merged = mergeRecognition(baseRef.current, finalText, partialText, rangeRef.current);
      valueRef.current = merged.text;
      selectionRef.current = merged.selection;
      onChangeTextRef.current?.(merged.text);
    };
    const fail = () => {
      if (!mountedRef.current || generationRef.current !== generation) return;
      void stop();
      Alert.alert(t("stt.error.unavailable_title"), t("stt.error.retry"));
    };

    try {
      sourceRef.current = source;
      await source.start({
        sampleRate: 16000,
        frameLength: FRAME_LENGTH,
        onFrame: sendOrBuffer,
        onError: fail,
      });
      if (generationRef.current !== generation) {
        await source.stop().catch(() => undefined);
        return;
      }
      statusRef.current = "recording";
      setStatus("recording");
      const session = await openRealtimeSttSession({
        frameLength: FRAME_LENGTH,
        languageIdMode: multilingual ? "continuous" : "at_start",
        candidateLanguages,
        autoStopAfterMs: STT_INPUT_MAX_RECORDING_MS,
        onAutoStop: () => {
          if (!mountedRef.current || generationRef.current !== generation) return;
          const activeSource = sourceRef.current;
          sourceRef.current = null;
          void activeSource?.stop().catch(() => undefined);
          statusRef.current = "stopping";
          setStatus("stopping");
          setAudioLevel(0);
        },
        onEvent: (event) => {
          if (!mountedRef.current || generationRef.current !== generation) return;
          if (event.type === "ready") {
            if (statusRef.current !== "stopping") {
              statusRef.current = "recording";
              setStatus("recording");
            }
          } else if (event.type === "partial") {
            if (statusRef.current !== "stopping") {
              statusRef.current = "recording";
              setStatus("recording");
            }
            const finalText = event.finalText ?? finalTextRef.current;
            partialTextRef.current = event.text;
            applyRecognition(finalText, event.text);
          } else if (event.type === "final") {
            if (statusRef.current !== "stopping") {
              statusRef.current = "recording";
              setStatus("recording");
            }
            finalTextRef.current = event.finalText ?? joinRecognition(finalTextRef.current, event.text);
            partialTextRef.current = "";
            applyRecognition(finalTextRef.current, "");
          } else if (event.type === "done") {
            finalTextRef.current = event.text || finalTextRef.current || partialTextRef.current;
            partialTextRef.current = "";
            applyRecognition(finalTextRef.current, "");
            const activeSource = sourceRef.current;
            sourceRef.current = null;
            void activeSource?.stop().catch(() => undefined);
            sessionRef.current = null;
            statusRef.current = "idle";
            setStatus("idle");
            setAudioLevel(0);
          } else if (event.type === "error" || event.type === "canceled") {
            fail();
          }
        },
        onError: fail,
        onClose: () => {
          if (!mountedRef.current || generationRef.current !== generation) return;
          const activeSource = sourceRef.current;
          sourceRef.current = null;
          void activeSource?.stop().catch(() => undefined);
          sessionRef.current = null;
          statusRef.current = "idle";
          setStatus("idle");
          setAudioLevel(0);
        },
      });
      if (generationRef.current !== generation || isInactiveStatus(statusRef.current)) {
        session.close();
        return;
      }
      sessionRef.current = session;
      bufferedFrames.forEach((frame) => session.sendFrame(frame));
    } catch {
      await source.stop().catch(() => undefined);
      if (generationRef.current !== generation) return;
      sourceRef.current = null;
      sessionRef.current?.close();
      sessionRef.current = null;
      statusRef.current = "idle";
      setStatus("idle");
      setAudioLevel(0);
      Alert.alert(t("stt.error.unavailable_title"), t("stt.error.retry"));
    }
  }, [input.disabled, input.languageCode, netInfo.isConnected, stop]);

  const handleTextChange = useCallback((value: string) => {
    if (statusRef.current !== "idle") void stop();
    valueRef.current = value;
    onChangeTextRef.current?.(value);
  }, [stop]);

  return {
    status,
    audioLevel,
    toggle: start,
    onChangeText: handleTextChange,
    onSelectionChange: (selection: { start: number; end: number }) => { selectionRef.current = selection; },
  };
}

function directLanguage(appLocale: string): string {
  if (appLocale === "en-US") return "en-US";
  if (appLocale === "ja-JP") return "ja-JP";
  return "zh-CN";
}

function isInactiveStatus(status: RealtimeSttInputStatus): boolean {
  return status === "idle" || status === "stopping";
}

function joinRecognition(current: string, next: string): string {
  if (!current.trim()) return next.trim();
  if (!next.trim()) return current.trim();
  return `${current.trim()} ${next.trim()}`;
}

function mergeRecognition(
  base: string,
  finalText: string,
  partialText: string,
  range: { start: number; end: number },
): { text: string; selection: { start: number; end: number } } {
  const speech = [finalText.trim(), partialText.trim()].filter(Boolean).join(" ");
  if (!speech) return { text: base, selection: { start: range.start, end: range.start } };
  const start = Math.max(0, Math.min(range.start, range.end, base.length));
  const end = Math.max(0, Math.min(Math.max(range.start, range.end), base.length));
  const before = base.slice(0, start);
  const after = base.slice(end);
  const prefix = before && !/\s$/.test(before) ? " " : "";
  const suffix = after && !/^\s/.test(after) ? " " : "";
  const text = `${before}${prefix}${speech}${suffix}${after}`;
  const cursor = before.length + prefix.length + speech.length;
  return { text, selection: { start: cursor, end: cursor } };
}
