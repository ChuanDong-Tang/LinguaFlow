import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export type FloatingNoticeType = "info" | "success" | "warning" | "error";
export type FloatingNoticePosition = "top-right" | "top-left" | "top-center" | "bottom-center";

export type FloatingNoticeOptions = {
  message: string;
  type?: FloatingNoticeType;
  position?: FloatingNoticePosition;
  offsetTop?: number;
  offsetBottom?: number;
  offsetRatioY?: number;
  durationMs?: number;
};

type FloatingNoticeHandle = {
  update: (next: Partial<FloatingNoticeOptions>) => void;
  hide: () => void;
};

type FloatingNoticeContextValue = {
  showNotice: (options: FloatingNoticeOptions) => FloatingNoticeHandle;
};

type NoticeState = Required<FloatingNoticeOptions> & {
  id: number;
};

const FloatingNoticeContext = createContext<FloatingNoticeContextValue | null>(null);

const DEFAULT_DURATION_MS = 2200;

export function FloatingNoticeProvider({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-8)).current;
  const spin = useRef(new Animated.Value(0)).current;
  const spinAnimationRef = useRef<Animated.CompositeAnimation | null>(null);
  const nextIdRef = useRef(1);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHideTimer = useCallback(() => {
    if (!hideTimerRef.current) return;
    clearTimeout(hideTimerRef.current);
    hideTimerRef.current = null;
  }, []);

  const hideById = useCallback(
    (id: number) => {
      clearHideTimer();
      Animated.timing(opacity, {
        toValue: 0,
        duration: 160,
        useNativeDriver: true,
      }).start(() => {
        setNotice((current) => (current?.id === id ? null : current));
      });
    },
    [clearHideTimer, opacity],
  );

  const scheduleHide = useCallback(
    (id: number, durationMs: number) => {
      clearHideTimer();
      if (durationMs <= 0) return;
      hideTimerRef.current = setTimeout(() => hideById(id), durationMs);
    },
    [clearHideTimer, hideById],
  );

  const showNotice = useCallback(
    (options: FloatingNoticeOptions): FloatingNoticeHandle => {
      const id = nextIdRef.current;
      nextIdRef.current += 1;
      const durationMs = options.durationMs ?? DEFAULT_DURATION_MS;
      const nextNotice: NoticeState = {
        id,
        message: options.message,
        type: options.type ?? "info",
        position: options.position ?? "top-right",
        offsetTop: options.offsetTop ?? 0,
        offsetBottom: options.offsetBottom ?? 0,
        offsetRatioY: options.offsetRatioY ?? 0.2,
        durationMs,
      };
      clearHideTimer();
      setNotice(nextNotice);
      opacity.setValue(0);
      translateY.setValue(-8);
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 160,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 0,
          duration: 160,
          useNativeDriver: true,
        }),
      ]).start();
      scheduleHide(id, durationMs);

      return {
        update: (next) => {
          setNotice((current) => {
            if (!current || current.id !== id) return current;
            const merged = {
              ...current,
              ...next,
              durationMs: next.durationMs ?? current.durationMs,
            };
            scheduleHide(id, merged.durationMs);
            return merged;
          });
        },
        hide: () => hideById(id),
      };
    },
    [clearHideTimer, hideById, opacity, scheduleHide, translateY],
  );

  useEffect(() => clearHideTimer, [clearHideTimer]);

  useEffect(() => {
    spinAnimationRef.current?.stop();
    spin.setValue(0);
    if (notice?.type !== "info") return;

    const animation = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 900,
        useNativeDriver: true,
      }),
    );
    spinAnimationRef.current = animation;
    animation.start();

    return () => {
      animation.stop();
      if (spinAnimationRef.current === animation) {
        spinAnimationRef.current = null;
      }
    };
  }, [notice?.id, notice?.type, spin]);

  const value = useMemo(() => ({ showNotice }), [showNotice]);
  const placement = notice ? getPlacementStyle(notice, insets.top, insets.bottom, window.height) : null;
  const palette = notice ? NOTICE_PALETTE[notice.type] : NOTICE_PALETTE.info;

  return (
    <FloatingNoticeContext.Provider value={value}>
      {children}
      {notice && placement ? (
        <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
          <Animated.View
            pointerEvents="box-none"
            style={[
              styles.host,
              placement,
              {
                opacity,
                transform: [{ translateY }],
              },
            ]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={notice.message}
              onPress={() => hideById(notice.id)}
              style={[styles.notice, { borderColor: palette.border, backgroundColor: palette.background }]}
            >
              {notice.type === "info" ? (
                <Animated.View
                  style={{
                    transform: [
                      {
                        rotate: spin.interpolate({
                          inputRange: [0, 1],
                          outputRange: ["0deg", "360deg"],
                        }),
                      },
                    ],
                  }}
                >
                  <Ionicons name={palette.icon} size={17} color={palette.iconColor} />
                </Animated.View>
              ) : (
                <Ionicons name={palette.icon} size={17} color={palette.iconColor} />
              )}
              <Text numberOfLines={2} style={styles.message}>
                {notice.message}
              </Text>
            </Pressable>
          </Animated.View>
        </View>
      ) : null}
    </FloatingNoticeContext.Provider>
  );
}

export function useFloatingNotice(): FloatingNoticeContextValue {
  const value = useContext(FloatingNoticeContext);
  if (!value) {
    throw new Error("useFloatingNotice must be used within FloatingNoticeProvider");
  }
  return value;
}

function getPlacementStyle(notice: NoticeState, topInset: number, bottomInset: number, windowHeight: number) {
  const position = notice.position;
  const top = Math.max(12, topInset + 8);
  const ratioTop = Math.round(windowHeight * notice.offsetRatioY);
  const topLower = Math.max(top, notice.offsetTop, ratioTop);
  const bottom = Math.max(14, bottomInset + 10);
  const bottomOffset = Math.max(bottom, notice.offsetBottom);
  if (position === "top-left") return { top: topLower, left: 14, alignItems: "flex-start" as const };
  if (position === "top-center") return { top: topLower, left: 14, right: 14, alignItems: "center" as const };
  if (position === "bottom-center") return { bottom: bottomOffset, left: 14, right: 14, alignItems: "center" as const };
  return { top: topLower, right: 0, alignItems: "flex-end" as const };
}

const NOTICE_PALETTE: Record<
  FloatingNoticeType,
  {
    background: string;
    border: string;
    iconColor: string;
    icon: keyof typeof Ionicons.glyphMap;
  }
> = {
  info: {
    background: "#FFFFFF",
    border: "#DEE4F2",
    iconColor: "#4965D8",
    icon: "sync-outline",
  },
  success: {
    background: "#FFFFFF",
    border: "#D7EBDD",
    iconColor: "#248A4B",
    icon: "checkmark-circle-outline",
  },
  warning: {
    background: "#FFFFFF",
    border: "#F0DFC2",
    iconColor: "#A96514",
    icon: "alert-circle-outline",
  },
  error: {
    background: "#FFFFFF",
    border: "#F0D1D1",
    iconColor: "#C43E3E",
    icon: "close-circle-outline",
  },
};

const styles = StyleSheet.create({
  host: {
    position: "absolute",
    maxWidth: "86%",
  },
  notice: {
    minHeight: 34,
    maxWidth: 230,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
    flexDirection: "row",
    alignItems: "center",
  },
  message: {
    marginLeft: 7,
    color: "#20242F",
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
  },
});
