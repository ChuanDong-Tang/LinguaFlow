import { Platform, StyleSheet } from "react-native";

import { appearance } from "./appearance/state";

// OIO design tokens — black-and-white hand-drawn style; only the mascot and
// photos carry color. Two palettes with identical keys: light (ink on paper)
// and inverted (light ink on dark paper), chosen once at startup.
// See skills/linguaflow-sketch-style.
const lightPalette = {
  paper: "#FDFDFB",
  white: "#FFFFFF",
  onDark: "#FFFFFF",
  sand50: "#F7F7F4",
  sand100: "#F2F1EC",
  sand200: "#E6E5E0",
  sand300: "#D3D2CC",
  ink900: "#1C1C1A",
  ink700: "#3A3936",
  ink600: "#62615C",
  ink500: "#8A8983",
  ink400: "#A6A59F",
  mascotGreen: "#A8D65E",
  mascotGreenInk: "#2F6B3F",
  red700: "#B3261E",
  redSoft: "#FBE9E7",
  green600: "#3E7B5B",
  greenSoft: "#EAF3EC",
  amber600: "#B7791F",
  amber50: "#FBF3E4",
  highlight: "#E9E8E2",
  pencilShadow: "rgba(98, 97, 92, 0.35)",
  scrim: "rgba(28, 28, 26, 0.32)",
  scrimLight: "rgba(28, 28, 26, 0.12)",
  shadowColor: "#1C1C1A",
};

const darkPalette: typeof lightPalette = {
  paper: "#1A1A18",
  white: "#232321",
  onDark: "#1A1A18",
  sand50: "#1F1F1D",
  sand100: "#2A2A27",
  sand200: "#353531",
  sand300: "#4A4944",
  ink900: "#ECEBE6",
  ink700: "#D3D2CC",
  ink600: "#A9A8A2",
  ink500: "#868580",
  ink400: "#6C6B66",
  mascotGreen: "#A8D65E",
  mascotGreenInk: "#2F6B3F",
  red700: "#F08A80",
  redSoft: "#3A2624",
  green600: "#86C3A0",
  greenSoft: "#22302A",
  amber600: "#E3AA55",
  amber50: "#352C1E",
  highlight: "#3A3A36",
  pencilShadow: "rgba(236, 235, 230, 0.16)",
  scrim: "rgba(0, 0, 0, 0.55)",
  scrimLight: "rgba(0, 0, 0, 0.3)",
  shadowColor: "#000000",
};

export function isDarkAppearance() {
  return appearance.resolved === "dark";
}
// Mutable copy of the active palette. Switching appearance rewrites theme
// values in place (applyAppearancePalette) and regenerates createStyles()
// sheets, so module-level imports of `theme` stay valid.
const palette = { ...(isDarkAppearance() ? darkPalette : lightPalette) };
const PENCIL_FILLS = { light: ["#F4F4F1", "#EFEFEB", "#F7F7F4", "#ECECE7"], dark: ["#262624", "#2B2B28", "#232321", "#2F2F2C"] };

function paletteColors() {
  return {

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
    onAccent: palette.onDark,
    // Emphasis for text, icons, outlines and spinners (never yellow text).
    accentStrong: palette.ink900,
    ink: palette.ink900,
    onInk: palette.onDark,
    danger: palette.red700,
    dangerSoft: palette.redSoft,
    // Black-and-white rule: "done / correct" is shown with ink and drawn marks,
    // not green. Only real errors keep a (muted) red.
    success: palette.ink900,
    successSoft: palette.sand100,
    warning: palette.amber600,
    warningSoft: palette.amber50,
    highlight: palette.highlight,
    disabled: palette.sand300,
    pencilShadow: palette.pencilShadow,
    scrim: palette.scrim,
    scrimLight: palette.scrimLight,
  };
}

function shadows() {
  return {
    // Barely-there lift for floating controls; flat surfaces use no shadow.
    float: Platform.select({
      ios: { shadowColor: palette.shadowColor, shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: 4 } },
      default: { elevation: 4 },
    }),
    menu: Platform.select({
      ios: { shadowColor: palette.shadowColor, shadowOpacity: 0.12, shadowRadius: 20, shadowOffset: { width: 0, height: 8 } },
      default: { elevation: 10 },
    }),
  };
}

export const theme = {
  palette,
  colors: paletteColors(),
  // Pencil-gray fills for text-only covers; pick by stable hash of an id.
  pencilFills: [...PENCIL_FILLS[appearance.resolved]] as readonly string[],
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
  // Memory game route: graphite steps (black-and-white style).
  gameRoute: [palette.ink900, palette.ink700, palette.ink600, palette.ink500] as readonly string[],
  hairline: StyleSheet.hairlineWidth,
  shadow: shadows(),
} as const;

/** Rewrite every theme value in place for the given appearance. */
export function applyAppearancePalette(resolved: "light" | "dark") {
  appearance.resolved = resolved;
  Object.assign(palette, resolved === "dark" ? darkPalette : lightPalette);
  Object.assign(theme.colors, paletteColors());
  (theme.pencilFills as string[]).splice(0, theme.pencilFills.length, ...PENCIL_FILLS[resolved]);
  (theme.gameRoute as string[]).splice(0, theme.gameRoute.length, palette.ink900, palette.ink700, palette.ink600, palette.ink500);
  Object.assign(theme.shadow, shadows());
}
