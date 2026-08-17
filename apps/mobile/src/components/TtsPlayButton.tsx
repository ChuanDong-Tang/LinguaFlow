import React from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { getMessageTtsAsset, type TtsSourceKey } from "../services/api/ttsApi";
import { beginTtsPlaybackSession, getTtsPlaybackState, isTtsPlaybackSessionCurrent, playTtsAudio, subscribeTtsPlayback, toggleTtsPlayback } from "../services/tts/ttsPlayback";
import { t } from "../i18n";

type TtsPlayButtonProps = {
  messageId: string | null | undefined;
  sourceKey?: TtsSourceKey;
  textStart?: number;
  textEnd?: number;
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  onError?: (error: Error) => void;
};

export function TtsPlayButton({
  messageId,
  sourceKey = "rewrite",
  textStart,
  textEnd,
  size = 18,
  color = "#4D5361",
  style,
  disabled = false,
  onError,
}: TtsPlayButtonProps) {
  const [loading, setLoading] = React.useState(false);
  const mountedRef = React.useRef(true);
  const requestControllerRef = React.useRef<AbortController | null>(null);
  const playbackSequenceRef = React.useRef(0);
  const playback = React.useSyncExternalStore(subscribeTtsPlayback, getTtsPlaybackState, getTtsPlaybackState);
  const navigationKey = messageId ? `message:${messageId}:${sourceKey}` : null;
  const isActive = Boolean(navigationKey && playback.hasActiveAudio && playback.activeNavigationKey === navigationKey);
  const isPlaybackLoading = isActive && playback.status === "loading";
  const isPlaying = isActive && playback.status === "playing";
  const hasValidRange = isValidOptionalRange(textStart, textEnd);
  const canPlay = !!messageId && !disabled && !loading && !isPlaybackLoading && hasValidRange;

  React.useEffect(() => {
    return () => {
      mountedRef.current = false;
      playbackSequenceRef.current += 1;
      requestControllerRef.current?.abort();
      requestControllerRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    requestControllerRef.current?.abort();
    playbackSequenceRef.current += 1;
    requestControllerRef.current = null;
    setLoading(false);
  }, [messageId, sourceKey, textStart, textEnd]);

  async function handlePress(): Promise<void> {
    if (!messageId || loading || disabled || !hasValidRange || isPlaybackLoading) return;
    if (isActive) {
      toggleTtsPlayback();
      return;
    }
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    const ttsSessionId = beginTtsPlaybackSession();
    const sequence = playbackSequenceRef.current + 1;
    playbackSequenceRef.current = sequence;
    requestControllerRef.current = controller;
    setLoading(true);
    try {
      const asset = await getMessageTtsAsset({
        messageId,
        sourceKey,
        textStart,
        textEnd,
        signal: controller.signal,
      });
      if (!mountedRef.current || controller.signal.aborted) return;
      if (!navigationKey || playbackSequenceRef.current !== sequence || !isTtsPlaybackSessionCurrent(ttsSessionId)) return;
      await playTtsAudio({
        url: asset.audioUrl,
        cacheKey: buildTtsCacheKey(asset),
        playbackRange: asset.playbackRange ?? undefined,
        navigationKey,
        loopScope: "all",
        sessionId: ttsSessionId,
      });
    } catch (error) {
      if (!mountedRef.current || controller.signal.aborted) return;
      const normalized = error instanceof Error ? error : new Error(String(error));
      if (onError) {
        onError(normalized);
      } else {
        Alert.alert(t("tts.error.title"), toFriendlyErrorMessage(normalized));
      }
    } finally {
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null;
      }
      if (mountedRef.current) setLoading(false);
    }
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("tts.play")}
      hitSlop={8}
      style={[styles.button, style, !canPlay && styles.disabled]}
      disabled={!canPlay}
      onPress={() => void handlePress()}
    >
      {loading || isPlaybackLoading ? (
        <ActivityIndicator size="small" color={color} />
      ) : (
        <Ionicons name={isPlaying ? "pause" : "play"} size={size} color={canPlay ? color : "#C1C5CE"} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minWidth: 32,
    minHeight: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  disabled: {
    opacity: 0.72,
  },
});

function toFriendlyErrorMessage(error: Error & { code?: string; status?: number }): string {
  if (error.code === "PRO_REQUIRED" || error.status === 403) return t("tts.error.pro_required");
  return t("tts.error.failed");
}

function isValidOptionalRange(textStart: number | undefined, textEnd: number | undefined): boolean {
  if (textStart === undefined && textEnd === undefined) return true;
  if (typeof textStart !== "number" || typeof textEnd !== "number") return false;
  return (
    Number.isInteger(textStart) &&
    Number.isInteger(textEnd) &&
    textStart >= 0 &&
    textEnd > textStart
  );
}

function buildTtsCacheKey(asset: {
  id: string;
  voiceCode: string;
  languageCode: string;
  sourceKey: string;
  sourceTextHash: string;
}): string {
  return [
    asset.id,
    asset.voiceCode,
    asset.languageCode,
    asset.sourceKey,
    asset.sourceTextHash,
  ].join("-");
}
