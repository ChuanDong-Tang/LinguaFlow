import { Easing } from "react-native-reanimated";

// Motion tokens (see skills/linguaflow-motion). Use these instead of inline numbers.
export const motion = {
  duration: { press: 100, quick: 180, enter: 380, flyOut: 280 },
  stagger: 45,
  maxStaggered: 8,
  draw: (length: number) => Math.min(900, 380 + length * 0.35),
  easing: {
    press: Easing.out(Easing.quad),
    enter: Easing.bezier(0.25, 1.2, 0.45, 1),
    draw: Easing.bezier(0.35, 0.7, 0.3, 1),
  },
  spring: {
    release: { damping: 14, stiffness: 260, mass: 0.6 },
    land: { damping: 16, stiffness: 180 },
    indicator: { damping: 18, stiffness: 220 },
  },
} as const;
