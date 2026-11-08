import React, { forwardRef, useEffect, useImperativeHandle } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import Reanimated, {
  cancelAnimation,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Ellipse, G, Path } from "react-native-svg";
import { motion } from "../../motion";
import { theme } from "../../theme";

// The OIO mascot drawn in react-native-svg so it can blink, hop and tilt
// (skills/linguaflow-motion, "Mascot"). Source art: assets/app/oio-character.svg.

const AnimatedEllipse = Reanimated.createAnimatedComponent(Ellipse);
// The mascot is a sticker: dark lines on its white body in both appearances.
const INK = "#1C1C1A";

export type OioMascotHandle = { hop: () => void; tilt: () => void };

export const OioMascot = forwardRef<OioMascotHandle, { size?: number; idle?: boolean; style?: StyleProp<ViewStyle> }>(
  function OioMascot({ size = 30, idle = true, style }, ref) {
    const reduceMotion = useReducedMotion();
    const blink = useSharedValue(0);
    const lift = useSharedValue(0);
    const squash = useSharedValue(0);
    const rotate = useSharedValue(0);

    useEffect(() => {
      if (!idle || reduceMotion) return;
      blink.value = withRepeat(withSequence(
        withDelay(4200 + Math.round(Math.random() * 800), withTiming(1, { duration: 80 })),
        withTiming(0, { duration: 90 }),
      ), -1);
      return () => cancelAnimation(blink);
    }, [blink, idle, reduceMotion]);

    useImperativeHandle(ref, () => ({
      hop() {
        if (reduceMotion) return;
        squash.value = withSequence(withTiming(1, { duration: 90 }), withSpring(0, motion.spring.release));
        lift.value = withSequence(withDelay(80, withTiming(-size * 0.28, { duration: 150 })), withSpring(0, motion.spring.release));
      },
      tilt() {
        if (reduceMotion) return;
        rotate.value = withSequence(withTiming(-9, { duration: 110 }), withTiming(5, { duration: 140 }), withSpring(0, motion.spring.release));
      },
    }), [lift, reduceMotion, rotate, size, squash]);

    const bodyStyle = useAnimatedStyle(() => ({
      transform: [
        { translateY: lift.value },
        { rotate: `${rotate.value}deg` },
        { scaleX: 1 + squash.value * 0.08 },
        { scaleY: 1 - squash.value * 0.1 },
      ],
    }));
    const eyeProps = useAnimatedProps(() => ({ ry: 2.9 * (1 - blink.value * 0.88) }));
    const height = Math.round((size * 115) / 124);

    return <Reanimated.View style={[{ width: size, height }, bodyStyle, style]} pointerEvents="none">
      <Svg width={size} height={height} viewBox="20 75 124 115" fill="none">
        <G stroke={INK} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
          <Path fill="#FFFFFF" d="M32 124c3-25 20-39 42-39s39 14 42 39v55H32z" />
          <Circle cx={59} cy={119} r={14} fill="#FFFFFF" />
          <Circle cx={89} cy={119} r={14} fill="#FFFFFF" />
          <AnimatedEllipse cx={63} cy={119} rx={2.9} fill={INK} stroke="none" animatedProps={eyeProps} />
          <AnimatedEllipse cx={93} cy={119} rx={2.9} fill={INK} stroke="none" animatedProps={eyeProps} />
          <Path d="M74 112v16" strokeWidth={3} />
          <Circle cx={74} cy={105} r={2.6} fill={INK} stroke="none" />
          <Path d="M54 150h40v18H54z" fill={theme.palette.mascotGreen} stroke={theme.palette.mascotGreenInk} />
          <Path d="M106 139c15 0 24-4 35-13" strokeWidth={2.6} />
        </G>
      </Svg>
    </Reanimated.View>;
  },
);
