import { Platform, StyleSheet } from "react-native";

// OIO design tokens. Hierarchy comes from type and whitespace; the coral accent
// is reserved for the primary action, selection, and a few highlights.
const palette = {
  paper: "#FBFAF8",
  white: "#FFFFFF",
  sand50: "#F6F4F1",
  sand100: "#F1EEEA",
  sand200: "#E8E4DE",
  sand300: "#D7D2CB",
  ink900: "#1F1E1C",
  ink700: "#45423E",
  ink600: "#5F5B56",
  ink500: "#8C8984",
  ink400: "#ADA9A3",
  coral600: "#C9452F",
  coral500: "#E0533D",
  coral100: "#FBE9E5",
  coral50: "#FDF4F2",
  red700: "#B3261E",
  green600: "#3E7B5B",
  green50: "#EDF5F0",
  amber600: "#B7791F",
  amber50: "#FBF3E4",
  highlight: "#FBE7A9",
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
    // Coral: primary actions, links, selection, focus.
    accent: palette.coral500,
    accentStrong: palette.coral500,
    accentPressed: palette.coral600,
    accentSoft: palette.coral100,
    accentFaint: palette.coral50,
    onAccent: palette.white,
    // Dark neutral for secondary filled controls (e.g. photo deck, coachmarks).
    ink: palette.ink900,
    onInk: palette.white,
    danger: palette.red700,
    success: palette.green600,
    successSoft: palette.green50,
    warning: palette.amber600,
    warningSoft: palette.amber50,
    highlight: palette.highlight,
    disabled: palette.sand300,
    scrim: "rgba(31, 30, 28, 0.32)",
    scrimLight: "rgba(31, 30, 28, 0.12)",
  },
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
  // Memory game route colors: warm, muted companions to the coral accent.
  gameRoute: ["#E0533D", "#D4921C", "#5E9C7A", "#6F7FC0"] as readonly string[],
  hairline: StyleSheet.hairlineWidth,
  shadow: {
    // Barely-there lift for floating controls; flat surfaces use no shadow.
    float: Platform.select({
      ios: { shadowColor: "#1F1E1C", shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: 4 } },
      default: { elevation: 4 },
    }),
    menu: Platform.select({
      ios: { shadowColor: "#1F1E1C", shadowOpacity: 0.12, shadowRadius: 20, shadowOffset: { width: 0, height: 8 } },
      default: { elevation: 10 },
    }),
  },
} as const;
