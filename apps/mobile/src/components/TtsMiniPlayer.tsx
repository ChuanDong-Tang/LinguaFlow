import React from "react";
import { PanResponder, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  cycleTtsPlaybackRate,
  getTtsPlaybackState,
  stopTtsAudio,
  subscribeTtsPlayback,
  toggleTtsLoop,
  toggleTtsPlayback,
} from "../services/tts/ttsPlayback";

type TtsMiniPlayerProps = {
  storageKey: string;
};

type StoredTtsMiniPlayerPosition = {
  xRatio: number;
  yRatio: number;
};

export function TtsMiniPlayer({ storageKey }: TtsMiniPlayerProps) {
  const window = useWindowDimensions();
  const [expanded, setExpanded] = React.useState(false);
  const [position, setPosition] = React.useState(() => ({
    x: PLAYER_MARGIN,
    y: Math.max(PLAYER_MARGIN, window.height * 0.28),
  }));
  const dragStartRef = React.useRef(position);
  const positionRef = React.useRef(position);
  const boundsRef = React.useRef({
    maxX: Math.max(PLAYER_MARGIN, window.width - COLLAPSED_SIZE - PLAYER_MARGIN),
    maxY: Math.max(PLAYER_MARGIN, window.height - COLLAPSED_SIZE - PLAYER_MARGIN),
  });
  const windowSizeRef = React.useRef({ width: window.width, height: window.height });
  const storageKeyRef = React.useRef(storageKey);
  const playback = React.useSyncExternalStore(
    subscribeTtsPlayback,
    getTtsPlaybackState,
    getTtsPlaybackState,
  );
  const active = playback.hasActiveAudio;
  const isPlaying = playback.status === "playing";
  const opensLeft = position.x > window.width / 2;
  const playerWidth = expanded ? EXPANDED_WIDTH : COLLAPSED_SIZE;
  const maxX = Math.max(PLAYER_MARGIN, window.width - playerWidth - PLAYER_MARGIN);
  const maxY = Math.max(PLAYER_MARGIN, window.height - COLLAPSED_SIZE - PLAYER_MARGIN);
  const clampedPosition = React.useMemo(
    () => ({
      x: clamp(position.x, PLAYER_MARGIN, maxX),
      y: clamp(position.y, PLAYER_MARGIN, maxY),
    }),
    [maxX, maxY, position.x, position.y],
  );
  React.useEffect(() => {
    positionRef.current = clampedPosition;
  }, [clampedPosition]);
  React.useEffect(() => {
    boundsRef.current = { maxX, maxY };
    windowSizeRef.current = { width: window.width, height: window.height };
    storageKeyRef.current = storageKey;
  }, [maxX, maxY, storageKey, window.height, window.width]);
  React.useEffect(() => {
    let cancelled = false;
    const { width, height } = windowSizeRef.current;
    const { maxX: initialMaxX, maxY: initialMaxY } = boundsRef.current;
    setPosition({
      x: PLAYER_MARGIN,
      y: Math.max(PLAYER_MARGIN, height * DEFAULT_Y_RATIO),
    });
    void loadStoredPosition(storageKey).then((stored) => {
      if (cancelled) return;
      if (!stored) return;
      setPosition({
        x: clamp(stored.xRatio * width, PLAYER_MARGIN, initialMaxX),
        y: clamp(stored.yRatio * height, PLAYER_MARGIN, initialMaxY),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [storageKey]);
  React.useEffect(() => {
    setPosition((current) => ({
      x: clamp(current.x, PLAYER_MARGIN, maxX),
      y: clamp(current.y, PLAYER_MARGIN, maxY),
    }));
  }, [maxX, maxY]);
  const panResponder = React.useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dx) > 4 || Math.abs(gesture.dy) > 4,
        onPanResponderGrant: () => {
          dragStartRef.current = positionRef.current;
        },
        onPanResponderMove: (_event, gesture) => {
          const { maxX: currentMaxX, maxY: currentMaxY } = boundsRef.current;
          setPosition({
            x: clamp(
              dragStartRef.current.x + gesture.dx,
              PLAYER_MARGIN,
              currentMaxX,
            ),
            y: clamp(
              dragStartRef.current.y + gesture.dy,
              PLAYER_MARGIN,
              currentMaxY,
            ),
          });
        },
        onPanResponderRelease: () => {
          const { maxX: currentMaxX, maxY: currentMaxY } = boundsRef.current;
          const { width, height } = windowSizeRef.current;
          setPosition((current) => {
            const next = {
              x: clamp(current.x, PLAYER_MARGIN, currentMaxX),
              y: clamp(current.y, PLAYER_MARGIN, currentMaxY),
            };
            void saveStoredPosition(storageKeyRef.current, next, width, height);
            return next;
          });
        },
      }),
    [],
  );

  return (
    <View
      style={[
        styles.shell,
        !expanded && styles.shellCollapsed,
        opensLeft && styles.shellReverse,
        { left: clampedPosition.x, top: clampedPosition.y, width: playerWidth },
      ]}
      {...panResponder.panHandlers}
    >
      <Pressable
        accessibilityRole="button"
        hitSlop={8}
        style={styles.collapseButton}
        onPress={() => setExpanded((value) => !value)}
      >
        <Ionicons
          name={expanded ? (opensLeft ? "chevron-forward" : "chevron-back") : opensLeft ? "chevron-back" : "chevron-forward"}
          size={18}
          color="#4D5361"
        />
      </Pressable>

      {expanded ? (
        <View style={styles.controls}>
          <Pressable
            accessibilityRole="button"
            style={[styles.primaryButton, !active && styles.disabled]}
            disabled={!active}
            onPress={toggleTtsPlayback}
          >
            <Ionicons name={isPlaying ? "pause" : "play"} size={18} color="#FFFFFF" />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={[styles.iconButton, !active && styles.disabled]}
            disabled={!active}
            onPress={() => stopTtsAudio()}
          >
            <Ionicons name="stop" size={16} color={active ? "#111111" : "#AEB4C0"} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={[styles.rateButton, !active && styles.disabled]}
            disabled={!active}
            onPress={cycleTtsPlaybackRate}
          >
            <Text style={[styles.rateText, !active && styles.rateTextDisabled]}>{playback.playbackRate.toFixed(1)}x</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={[
              styles.iconButton,
              playback.loopEnabled && styles.loopButtonActive,
              !active && styles.disabled,
            ]}
            disabled={!active}
            onPress={toggleTtsLoop}
          >
            <Ionicons
              name="repeat-outline"
              size={18}
              color={playback.loopEnabled && active ? "#FFFFFF" : active ? "#4D5361" : "#AEB4C0"}
            />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const COLLAPSED_SIZE = 46;
const EXPANDED_WIDTH = 244;
const PLAYER_MARGIN = 14;
const DEFAULT_Y_RATIO = 0.28;

const styles = StyleSheet.create({
  shell: {
    position: "absolute",
    zIndex: 30,
    height: COLLAPSED_SIZE,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 23,
    backgroundColor: "rgba(255, 255, 255, 0.94)",
    borderWidth: 1,
    borderColor: "rgba(225, 228, 236, 0.9)",
    flexDirection: "row",
    alignItems: "center",
    shadowColor: "#111111",
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  shellCollapsed: {
    justifyContent: "center",
  },
  shellReverse: {
    flexDirection: "row-reverse",
  },
  collapseButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingRight: 2,
  },
  primaryButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#7065F8",
    alignItems: "center",
    justifyContent: "center",
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E3E6ED",
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  rateButton: {
    minWidth: 50,
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E3E6ED",
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  rateText: {
    color: "#111111",
    fontSize: 14,
    fontWeight: "500",
    letterSpacing: 0,
  },
  rateTextDisabled: {
    color: "#AEB4C0",
  },
  loopButtonActive: {
    borderColor: "#7065F8",
    backgroundColor: "#7065F8",
  },
  disabled: {
    opacity: 0.58,
  },
});

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

async function loadStoredPosition(storageKey: string): Promise<StoredTtsMiniPlayerPosition | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredTtsMiniPlayerPosition>;
    if (!isValidRatio(parsed.xRatio) || !isValidRatio(parsed.yRatio)) return null;
    return { xRatio: parsed.xRatio, yRatio: parsed.yRatio };
  } catch {
    return null;
  }
}

async function saveStoredPosition(
  storageKey: string,
  position: { x: number; y: number },
  width: number,
  height: number,
): Promise<void> {
  if (!width || !height) return;
  try {
    await AsyncStorage.setItem(
      storageKey,
      JSON.stringify({
        xRatio: clamp(position.x / width, 0, 1),
        yRatio: clamp(position.y / height, 0, 1),
      }),
    );
  } catch {
    // Position persistence is convenience-only; dragging should keep working if storage fails.
  }
}

function isValidRatio(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}
