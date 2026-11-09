import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, View, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import Reanimated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { haptic, type HapticKind } from "../../feedback/haptics";
import { motion } from "../../motion";
import { theme } from "../../theme";
import { Icon } from "../Icon";

// Flat surfaces (skills/linguaflow-visual-style): objects are separated by
// background color — white cards on a light gray feed — never by borders or
// shadows. Pressing dims and slightly shrinks, like Xiaohongshu cards.

export type SurfaceProps = {
  radius?: number;
  /** Background; defaults to the card surface. */
  fill?: string;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  pointerEvents?: "box-none" | "none" | "auto" | "box-only";
};

export function Surface({ radius = theme.radius.card, fill, style, children, pointerEvents }: SurfaceProps) {
  return <View pointerEvents={pointerEvents} style={[{ borderRadius: radius, backgroundColor: fill ?? theme.colors.surface }, style]}>{children}</View>;
}

export type PressableSurfaceProps = Omit<PressableProps, "style" | "children"> & {
  radius?: number;
  fill?: string;
  /** Haptic on press; `null` for none. */
  feedback?: HapticKind | null;
  /** Fade the control while disabled (default true). */
  dimWhenDisabled?: boolean;
  /** Layout of the touch target (width, margins, flex). */
  style?: StyleProp<ViewStyle>;
  /** Inner layout (padding, alignment) of the surface. */
  contentStyle?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
};

export const PressableSurface = React.forwardRef<View, PressableSurfaceProps>(function PressableSurface({ radius = theme.radius.card, fill, feedback = "light", dimWhenDisabled = true, style, contentStyle, children, onPress, onPressIn, onPressOut, disabled, ...rest }, ref) {
  const pressed = useSharedValue(0);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 - pressed.value * 0.03 }], opacity: 1 - pressed.value * 0.12 }));
  return <Pressable
    ref={ref}
    {...rest}
    disabled={disabled}
    style={style}
    onPressIn={(event) => { pressed.value = withTiming(1, { duration: motion.duration.press, easing: motion.easing.press }); onPressIn?.(event); }}
    onPressOut={(event) => { pressed.value = withSpring(0, motion.spring.release); onPressOut?.(event); }}
    onPress={(event) => { if (feedback) haptic[feedback](); onPress?.(event); }}
  >
    <Reanimated.View style={[{ borderRadius: radius, backgroundColor: fill ?? theme.colors.surface, overflow: "hidden" }, contentStyle, animatedStyle, disabled && dimWhenDisabled && styles.disabled]}>
      {children}
    </Reanimated.View>
  </Pressable>;
});

/** Active-tab indicator: a short brand-colored bar under the label. */
export function TabUnderline({ width, style }: { width: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ width, height: 3, borderRadius: 2, backgroundColor: theme.colors.accent }, style]} />;
}

/** Brand check mark for "done" moments. */
export function CheckMark({ size = 22, color }: { size?: number; color?: string }) {
  return <Icon name="checkmark" size={size} color={color ?? theme.colors.accent} weight="bold" />;
}

/** Stable neutral tint for a text-only cover (never by list index). */
export function coverFillFor(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return theme.pencilFills[Math.abs(h) % theme.pencilFills.length];
}

// Lists animate in only the first time a record appears in this session.
const seenKeys = new Set<string>();
export function useFirstAppearance(key: string): boolean {
  const [first] = useState(() => !seenKeys.has(key));
  useEffect(() => { seenKeys.add(key); }, [key]);
  return first;
}

const styles = StyleSheet.create({
  disabled: { opacity: 0.45 },
});
