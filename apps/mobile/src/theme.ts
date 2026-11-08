import { Platform, StyleSheet } from "react-native";

// OIO design tokens — "彩铅填色": hand-drawn ink outlines on white paper with
// soft colored-pencil fills that carry meaning. See skills/linguaflow-sketch-style.
const palette = {
  paper: "#FDFDFB",
  white: "#FFFFFF",
  sand50: "#F7F7F4",
  sand100: "#F2F1EC",
  sand200: "#E6E5E0",
  sand300: "#D3D2CC",
  ink900: "#1C1C1A",
  ink700: "#3A3936",
  ink600: "#62615C",
  ink500: "#8A8983",
  ink400: "#A6A59F",
  // Colored pencils
  yellow500: "#FFD25E",
  yellow600: "#F2C24A",
  yellow100: "#FFF1B8",
  yellow50: "#FFF8DB",
  leaf100: "#E2F1CC",
  leaf200: "#D4ECB4",
  petal100: "#FFE2E8",
  sky100: "#DCEEFB",
  mascotGreen: "#A8D65E",
  mascotGreenInk: "#2F6B3F",
  red700: "#B3261E",
  green600: "#3E7B5B",
  amber600: "#B7791F",
  amber50: "#FBF3E4",
  highlight: "#FFE98A",
} as const;

export const theme = {
  palette,
  colors: {
    canvas: palette.paper,
    surface: palette.white,
    surfaceMuted: palette.sand100,
    surfaceSunken: palette.sand50,
    surfacePressed: palette.sand100,
    text: palette.ink900,
    textStrong: palette.ink700,
    textSecondary: palette.ink600,
    textMuted: palette.ink500,
    textFaint: palette.ink400,
    border: palette.sand200,
    borderStrong: palette.sand300,
    // Black and white everywhere except the mascot: the primary action is a
    // solid ink fill with paper-colored text; soft emphasis is pencil gray.
    accent: palette.ink900,
    accentPressed: palette.ink700,
    accentSoft: palette.sand100,
    accentFaint: palette.sand50,
    onAccent: palette.white,
    // Emphasis for text, icons, outlines and spinners (never yellow text).
    accentStrong: palette.ink900,
    ink: palette.ink900,
    onInk: palette.white,
    danger: palette.red700,
    dangerSoft: palette.petal100,
    success: palette.green600,
    successSoft: palette.leaf100,
    successFill: palette.leaf200,
    info: palette.sky100,
    warning: palette.amber600,
    warningSoft: palette.amber50,
    highlight: palette.highlight,
    disabled: palette.sand300,
    pencilShadow: "rgba(98, 97, 92, 0.35)",
    scrim: "rgba(28, 28, 26, 0.32)",
    scrimLight: "rgba(28, 28, 26, 0.12)",
  },
  // Pencil-gray fills for text-only covers; pick by stable hash of an id.
  pencilFills: ["#F4F4F1", "#EFEFEB", "#F7F7F4", "#ECECE7"] as readonly string[],
  radius: {
    tiny: 4,
    control: 10,
    card: 14,
    sheet: 22,
    pill: 999,
  },
  space: { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 },
  gutter: 20,
  type: {
    largeTitle: { fontSize: 30, lineHeight: 36, fontWeight: "700", letterSpacing: -0.4 },
    title: { fontSize: 22, lineHeight: 28, fontWeight: "700", letterSpacing: -0.2 },
    heading: { fontSize: 17, lineHeight: 24, fontWeight: "600" },
    body: { fontSize: 16, lineHeight: 24, fontWeight: "400" },
    callout: { fontSize: 15, lineHeight: 22, fontWeight: "400" },
    subhead: { fontSize: 14, lineHeight: 20, fontWeight: "400" },
    caption: { fontSize: 12, lineHeight: 17, fontWeight: "400" },
    micro: { fontSize: 11, lineHeight: 15, fontWeight: "500", letterSpacing: 0.2 },
  },
  // Memory game route colors: deeper colored-pencil tones.
  gameRoute: ["#E8A92A", "#6FAA3E", "#E57A95", "#5E9FD6"] as readonly string[],
  hairline: StyleSheet.hairlineWidth,
  shadow: {
    // Barely-there lift for floating controls; flat surfaces use no shadow.
    float: Platform.select({
      ios: { shadowColor: "#1C1C1A", shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: 4 } },
      default: { elevation: 4 },
    }),
    menu: Platform.select({
      ios: { shadowColor: "#1C1C1A", shadowOpacity: 0.12, shadowRadius: 20, shadowOffset: { width: 0, height: 8 } },
      default: { elevation: 10 },
    }),
  },
} as const;
