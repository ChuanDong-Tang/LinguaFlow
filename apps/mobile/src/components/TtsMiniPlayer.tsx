import React from "react";
import { PanResponder, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  cycleTtsPlaybackRate,
  getTtsPlaybackState,
  navigateTtsNext,
  navigateTtsPrevious,
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
  dockSide?: DockSide;
};

type DockSide = "left" | "right";

export function TtsMiniPlayer({ storageKey }: TtsMiniPlayerProps) {
  const window = useWindowDimensions();
  const [expanded, setExpanded] = React.useState(false);
  const [dockSide, setDockSide] = React.useState<DockSide>("left");
  const [dragging, setDragging] = React.useState(false);
  const [position, setPosition] = React.useState(() => ({
    x: getDockedX("left", false, window.width),
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
  const canNavigatePrevious = playback.canNavigatePrevious;
  const canNavigateNext = playback.canNavigateNext;
  const playerWidth = expanded ? EXPANDED_WIDTH : COLLAPSED_TOUCH_WIDTH;
  const dragMinX = expanded ? PLAYER_MARGIN : 0;
  const dragMaxX = expanded
    ? Math.max(PLAYER_MARGIN, window.width - EXPANDED_WIDTH - PLAYER_MARGIN)
    : Math.max(0, window.width - COLLAPSED_TOUCH_WIDTH);
  const dockedX = getDockedX(dockSide, expanded, window.width);
  const maxY = Math.max(PLAYER_MARGIN, window.height - COLLAPSED_SIZE - PLAYER_MARGIN);
  const clampedPosition = React.useMemo(
    () => ({
      x: dragging ? clamp(position.x, dragMinX, dragMaxX) : dockedX,
      y: clamp(position.y, PLAYER_MARGIN, maxY),
    }),
    [dockedX, dragMaxX, dragMinX, dragging, maxY, position.x, position.y],
  );
  const visualDockSide: DockSide =
    dragging && clampedPosition.x + playerWidth / 2 > window.width / 2 ? "right" : dockSide;
  const opensLeft = visualDockSide === "right";
  React.useEffect(() => {
    positionRef.current = clampedPosition;
  }, [clampedPosition]);
  React.useEffect(() => {
    boundsRef.current = { maxX: dragMaxX, maxY };
    windowSizeRef.current = { width: window.width, height: window.height };
    storageKeyRef.current = storageKey;
  }, [dragMaxX, maxY, storageKey, window.height, window.width]);
  React.useEffect(() => {
    let cancelled = false;
    const { width, height } = windowSizeRef.current;
    const { maxY: initialMaxY } = boundsRef.current;
    setPosition({
      x: getDockedX("left", false, width),
      y: Math.max(PLAYER_MARGIN, height * DEFAULT_Y_RATIO),
    });
    void loadStoredPosition(storageKey).then((stored) => {
      if (cancelled) return;
      if (!stored) return;
      const nextDockSide = stored.dockSide ?? (stored.xRatio > 0.5 ? "right" : "left");
      setDockSide(nextDockSide);
      setPosition({
        x: getDockedX(nextDockSide, false, width),
        y: clamp(stored.yRatio * height, PLAYER_MARGIN, initialMaxY),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [storageKey]);
  React.useEffect(() => {
    setPosition((current) => ({
      x: dragging ? clamp(current.x, dragMinX, dragMaxX) : getDockedX(dockSide, expanded, window.width),
      y: clamp(current.y, PLAYER_MARGIN, maxY),
    }));
  }, [dockSide, dragMaxX, dragMinX, dragging, expanded, maxY, window.width]);
  const panResponder = React.useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dx) > 4 || Math.abs(gesture.dy) > 4,
        onPanResponderGrant: () => {
          setDragging(true);
          dragStartRef.current = positionRef.current;
        },
        onPanResponderMove: (_event, gesture) => {
          const { maxX: currentMaxX, maxY: currentMaxY } = boundsRef.current;
          const currentMinX = expanded ? PLAYER_MARGIN : 0;
          setPosition({
            x: clamp(
              dragStartRef.current.x + gesture.dx,
              currentMinX,
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
            const currentMinX = expanded ? PLAYER_MARGIN : 0;
            const clamped = {
              x: clamp(current.x, currentMinX, currentMaxX),
              y: clamp(current.y, PLAYER_MARGIN, currentMaxY),
            };
            const nextDockSide: DockSide = clamped.x + playerWidth / 2 > width / 2 ? "right" : "left";
            const next = {
              x: getDockedX(nextDockSide, expanded, width),
              y: clamped.y,
            };
            setDockSide(nextDockSide);
            setDragging(false);
            void saveStoredPosition(storageKeyRef.current, next, width, height, nextDockSide);
            return next;
          });
        },
        onPanResponderTerminate: () => {
          setDragging(false);
        },
      }),
    [expanded, playerWidth],
  );

  return (
    <View
      style={[
        styles.shell,
        !expanded && styles.shellCollapsed,
        expanded && opensLeft && styles.shellReverse,
        !expanded && visualDockSide === "left" && styles.shellCollapsedLeft,
        !expanded && visualDockSide === "right" && styles.shellCollapsedRight,
        { left: clampedPosition.x, top: clampedPosition.y, width: playerWidth },
      ]}
      {...panResponder.panHandlers}
    >
      <Pressable
        accessibilityRole="button"
        hitSlop={expanded ? 8 : {
          top: 12,
          bottom: 12,
          left: visualDockSide === "right" ? 16 : 4,
          right: visualDockSide === "left" ? 16 : 4,
        }}
        style={[
          styles.collapseButton,
          !expanded && styles.collapsedHandleButton,
          !expanded && visualDockSide === "left" && styles.collapsedHandleLeft,
          !expanded && visualDockSide === "right" && styles.collapsedHandleRight,
        ]}
        onPress={() => setExpanded((value) => !value)}
      >
        <Ionicons
          name={expanded ? (opensLeft ? "chevron-forward" : "chevron-back") : visualDockSide === "right" ? "chevron-back" : "chevron-forward"}
          size={expanded ? 18 : 16}
          color={expanded ? "#4D5361" : "#FFFFFF"}
        />
      </Pressable>

      {expanded ? (
        <View style={styles.controls}>
          <Pressable
            accessibilityRole="button"
            style={[styles.iconButton, !canNavigatePrevious && styles.disabled]}
            disabled={!canNavigatePrevious}
            onPress={navigateTtsPrevious}
          >
            <Ionicons name="play-skip-back" size={16} color={canNavigatePrevious ? "#111111" : "#AEB4C0"} />
          </Pressable>
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
            style={[styles.iconButton, !canNavigateNext && styles.disabled]}
            disabled={!canNavigateNext}
            onPress={navigateTtsNext}
          >
            <Ionicons name="play-skip-forward" size={16} color={canNavigateNext ? "#111111" : "#AEB4C0"} />
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
          <Pressable
            accessibilityRole="button"
            style={[styles.rateButton, !active && styles.disabled]}
            disabled={!active}
            onPress={cycleTtsPlaybackRate}
          >
            <Text style={[styles.rateText, !active && styles.rateTextDisabled]}>{playback.playbackRate.toFixed(1)}x</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const COLLAPSED_SIZE = 46;
const COLLAPSED_TOUCH_WIDTH = 52;
const COLLAPSED_HANDLE_WIDTH = 30;
const EXPANDED_WIDTH = 286;
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
    shadowOpacity: 0.07,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  shellCollapsed: {
    justifyContent: "flex-start",
    paddingHorizontal: 0,
    paddingVertical: 0,
    backgroundColor: "transparent",
    borderWidth: 0,
    shadowOpacity: 0,
    elevation: 0,
  },
  shellReverse: {
    flexDirection: "row-reverse",
  },
  shellCollapsedLeft: {
    flexDirection: "row",
  },
  shellCollapsedRight: {
    flexDirection: "row-reverse",
  },
  collapseButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  collapsedHandleButton: {
    width: COLLAPSED_HANDLE_WIDTH,
    height: 42,
    backgroundColor: "#2477E8",
    shadowColor: "#0E54B6",
    shadowOpacity: 0.24,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  collapsedHandleLeft: {
    borderTopLeftRadius: 0,
    borderBottomLeftRadius: 0,
    borderTopRightRadius: 18,
    borderBottomRightRadius: 18,
  },
  collapsedHandleRight: {
    borderTopLeftRadius: 18,
    borderBottomLeftRadius: 18,
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingRight: 2,
  },
  primaryButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#111111",
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
    borderColor: "#111111",
    backgroundColor: "#111111",
  },
  disabled: {
    opacity: 0.58,
  },
});

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getDockedX(dockSide: DockSide, expanded: boolean, width: number): number {
  if (expanded) {
    return dockSide === "right"
      ? Math.max(PLAYER_MARGIN, width - EXPANDED_WIDTH - PLAYER_MARGIN)
      : PLAYER_MARGIN;
  }
  return dockSide === "right"
    ? Math.max(0, width - COLLAPSED_TOUCH_WIDTH)
    : 0;
}

async function loadStoredPosition(storageKey: string): Promise<StoredTtsMiniPlayerPosition | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredTtsMiniPlayerPosition>;
    if (!isValidRatio(parsed.xRatio) || !isValidRatio(parsed.yRatio)) return null;
    return {
      xRatio: parsed.xRatio,
      yRatio: parsed.yRatio,
      dockSide: parsed.dockSide === "left" || parsed.dockSide === "right" ? parsed.dockSide : undefined,
    };
  } catch {
    return null;
  }
}

async function saveStoredPosition(
  storageKey: string,
  position: { x: number; y: number },
  width: number,
  height: number,
  dockSide: DockSide,
): Promise<void> {
  if (!width || !height) return;
  try {
    await AsyncStorage.setItem(
      storageKey,
      JSON.stringify({
        xRatio: clamp(position.x / width, 0, 1),
        yRatio: clamp(position.y / height, 0, 1),
        dockSide,
      }),
    );
  } catch {
    // Position persistence is convenience-only; dragging should keep working if storage fails.
  }
}

function isValidRatio(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}
