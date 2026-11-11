import React from "react";
import { View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { theme } from "../theme";
import type { CardProgressRing } from "../domain/practice/cardProgressRing";

/** Small completion ring for home cards (see domain/practice/cardProgressRing). */
export function ProgressRing({ ring, size = 22 }: { ring: CardProgressRing; size?: number }) {
  const stroke = 3;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const color = ring.tone === "perfect" ? theme.colors.accent : ring.tone === "partial" ? theme.colors.warning : theme.colors.textFaint;
  return <View style={{ width: size, height: size }}>
    <Svg width={size} height={size}>
      <Circle cx={size / 2} cy={size / 2} r={radius} stroke={theme.colors.fill3} strokeWidth={stroke} fill="none" />
      {ring.fraction > 0 ? <Circle
        cx={size / 2} cy={size / 2} r={radius}
        stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round"
        strokeDasharray={`${circumference * ring.fraction} ${circumference}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      /> : null}
      {ring.tone === "perfect" ? <Path
        d={`M ${size * 0.32} ${size * 0.52} L ${size * 0.45} ${size * 0.64} L ${size * 0.68} ${size * 0.38}`}
        stroke={color} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round"
      /> : null}
    </Svg>
  </View>;
}
