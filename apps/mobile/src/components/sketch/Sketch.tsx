import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View, type LayoutChangeEvent, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import Reanimated, {
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { haptic, type HapticKind } from "../../feedback/haptics";
import { motion } from "../../motion";
import { theme } from "../../theme";
import { createStyles } from "../../styles";
import { checkMark, sketchSeed, wave, wobbleEllipse, wobbleRect, type SketchPath } from "./sketchPath";

// Hand-drawn primitives for the "彩铅填色" style (skills/linguaflow-sketch-style).

const AnimatedPath = Reanimated.createAnimatedComponent(Path);
const PAD = 8;

type Size = { w: number; h: number };

function useMeasuredSize() {
  const [size, setSize] = useState<Size | null>(null);
  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize((previous) => (previous && Math.abs(previous.w - width) < 0.5 && Math.abs(previous.h - height) < 0.5 ? previous : { w: width, h: height }));
  };
  return [size, onLayout] as const;
}

/** A path that can be drawn on like a pen stroke once, on mount. */
function PenPath({ path, draw, delay = 0, ...props }: { path: SketchPath; draw: boolean; delay?: number } & React.ComponentProps<typeof Path>) {
  const reduceMotion = useReducedMotion();
  const animate = draw && !reduceMotion;
  const offset = useSharedValue(animate ? path.length : 0);
  useEffect(() => {
    if (!animate) return;
    offset.value = path.length;
    offset.value = withDelay(delay, withTiming(0, { duration: motion.draw(path.length), easing: motion.easing.draw }));
    // Draw only when the path first appears or its shape changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path.d]);
  const animatedProps = useAnimatedProps(() => ({ strokeDashoffset: offset.value }));
  if (!animate) return <Path d={path.d} {...props} />;
  return <AnimatedPath d={path.d} strokeDasharray={[path.length, path.length + 10]} animatedProps={animatedProps} {...props} />;
}

export type SketchBoxProps = {
  /** Stable key (record id, button name) — keeps the outline identical across renders. */
  seed: string;
  radius?: number;
  fill?: string;
  stroke?: string;
  shadow?: boolean;
  /** Draw the outline on with a pen animation when it first appears. */
  draw?: boolean;
  drawDelay?: number;
  /** 0 → resting, 1 → pressed. Hides the pencil shadow while pressed. */
  pressed?: SharedValue<number>;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  pointerEvents?: "box-none" | "none" | "auto" | "box-only";
};

/** Wraps children in a hand-drawn rounded outline with optional pencil fill and shadow. */
export function SketchBox({ seed, radius = theme.radius.card, fill, stroke = theme.colors.ink, shadow = false, draw = false, drawDelay = 0, pressed, style, children, pointerEvents }: SketchBoxProps) {
  const [size, onLayout] = useMeasuredSize();
  const paths = useMemo(() => {
    if (!size || size.w < 2 || size.h < 2) return null;
    const base = sketchSeed(seed);
    return {
      main: wobbleRect(size.w, size.h, radius, base),
      second: wobbleRect(size.w, size.h, radius, base + 3, 1.6, 0.02),
      shadow: shadow ? wobbleRect(size.w, size.h, radius, base + 7, 1.1) : null,
    };
  }, [radius, seed, shadow, size]);
  const shadowProps = useAnimatedProps(() => ({ opacity: pressed ? 1 - pressed.value : 1 }));
  return <View style={style} onLayout={onLayout} pointerEvents={pointerEvents}>
    {size && paths ? <Svg pointerEvents="none" style={[styles.svg, { width: size.w + PAD * 2, height: size.h + PAD * 2 }]} viewBox={`${-PAD} ${-PAD} ${size.w + PAD * 2} ${size.h + PAD * 2}`}>
      {paths.shadow ? <AnimatedPath d={paths.shadow.d} transform="translate(3.5 3.5)" fill="none" stroke={theme.colors.pencilShadow} strokeWidth={1.4} strokeLinecap="round" animatedProps={shadowProps} /> : null}
      <PenPath path={paths.main} draw={draw} delay={drawDelay} fill={fill ?? "none"} stroke={stroke} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      <PenPath path={paths.second} draw={draw} delay={drawDelay + 80} fill="none" stroke={stroke} strokeOpacity={0.45} strokeWidth={0.9} strokeLinecap="round" />
    </Svg> : null}
    {children}
  </View>;
}

export type SketchPressableProps = Omit<PressableProps, "style" | "children"> & {
  seed: string;
  radius?: number;
  fill?: string;
  shadow?: boolean;
  draw?: boolean;
  drawDelay?: number;
  /** Fade the control while disabled (default true). */
  dimWhenDisabled?: boolean;
  /** Haptic on press; `null` for none. */
  feedback?: HapticKind | null;
  /** Layout of the touch target (width, margins, flex). */
  style?: StyleProp<ViewStyle>;
  /** Inner layout (padding, alignment) of the drawn box. */
  contentStyle?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
};

/** A hand-drawn button/card that presses into the paper and springs back. */
export const SketchPressable = React.forwardRef<View, SketchPressableProps>(function SketchPressable({ seed, radius, fill, shadow = true, draw, drawDelay, feedback = "light", dimWhenDisabled = true, style, contentStyle, children, onPress, onPressIn, onPressOut, disabled, ...rest }, ref) {
  const pressed = useSharedValue(0);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ translateX: pressed.value * 2 }, { translateY: pressed.value * 2 }] }));
  return <Pressable
    ref={ref}
    {...rest}
    disabled={disabled}
    style={style}
    onPressIn={(event) => { pressed.value = withTiming(1, { duration: motion.duration.press, easing: motion.easing.press }); onPressIn?.(event); }}
    onPressOut={(event) => { pressed.value = withSpring(0, motion.spring.release); onPressOut?.(event); }}
    onPress={(event) => { if (feedback) haptic[feedback](); onPress?.(event); }}
  >
    <Reanimated.View style={[styles.grow, animatedStyle, disabled && dimWhenDisabled && styles.disabled]}>
      <SketchBox seed={seed} radius={radius} fill={fill} shadow={shadow && !(disabled && dimWhenDisabled)} draw={draw} drawDelay={drawDelay} pressed={pressed} style={[styles.grow, contentStyle]}>
        {children}
      </SketchBox>
    </Reanimated.View>
  </Pressable>;
});

// Outlines draw on only the first time a record appears in this session, so
// scrolling back or switching tabs does not replay the pen animation.
const drawnKeys = new Set<string>();
export function useFirstAppearance(key: string): boolean {
  const [first] = useState(() => !drawnKeys.has(key));
  useEffect(() => { drawnKeys.add(key); }, [key]);
  return first;
}

/** Soft colored-pencil blob, e.g. behind the selected tab label. */
export function SketchBlob({ seed, color, style }: { seed: string; color: string; style?: StyleProp<ViewStyle> }) {
  const [size, onLayout] = useMeasuredSize();
  const path = useMemo(() => (size ? wobbleEllipse(size.w / 2, size.h / 2, size.w / 2, size.h / 2, sketchSeed(seed), 1.02) : null), [seed, size]);
  return <View pointerEvents="none" style={style} onLayout={onLayout}>
    {size && path ? <Svg style={[styles.svg, { width: size.w + PAD * 2, height: size.h + PAD * 2 }]} viewBox={`${-PAD} ${-PAD} ${size.w + PAD * 2} ${size.h + PAD * 2}`}>
      <Path d={path.d} fill={color} stroke={color} strokeWidth={1} />
    </Svg> : null}
  </View>;
}

/** Wavy pen underline, drawn on when it appears. */
export function SketchUnderline({ seed, width, color = theme.colors.ink, draw = true, style }: { seed: string; width: number; color?: string; draw?: boolean; style?: StyleProp<ViewStyle> }) {
  const path = useMemo(() => wave(width, 4, sketchSeed(seed)), [seed, width]);
  return <Svg pointerEvents="none" width={width + 6} height={9} viewBox={`-3 0 ${width + 6} 9`} style={style}>
    <PenPath path={path} draw={draw} fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
  </Svg>;
}

/** Pen check mark, drawn on when it appears. */
export function SketchCheck({ seed, size = 22, color = theme.colors.ink, draw = true }: { seed: string; size?: number; color?: string; draw?: boolean }) {
  const path = useMemo(() => checkMark(size, sketchSeed(seed)), [seed, size]);
  return <Svg pointerEvents="none" width={size} height={size}>
    <PenPath path={path} draw={draw} fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>;
}

/** Pick a stable pastel fill for a record (never by list index). */
export function pencilFillFor(id: string) {
  return theme.pencilFills[sketchSeed(id) % theme.pencilFills.length];
}

const styles = createStyles(() => ({
  svg: { position: "absolute", left: -PAD, top: -PAD },
  // No flexGrow here: inside full-height flex parents it stretched buttons to
  // the whole screen. Callers size the box with `style` / `contentStyle`.
  grow: {},
  disabled: { opacity: 0.45 },
}));
