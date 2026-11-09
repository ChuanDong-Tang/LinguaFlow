import { Platform, StyleSheet } from "react-native";

import { appearance } from "./appearance/state";

// OIO design tokens — Xiaohongshu-style layering: a light gray feed behind
// borderless white cards, separated by background color, never by outlines or
// shadows. One brand color (OIO green, from the mascot's pocket) for primary
// actions, the active tab and "done" states; everything else is neutral.
// Two palettes with identical keys (light / dark). See skills/linguaflow-visual-style.
const lightPalette = {
  page: "#FFFFFF",
  feed: "#F5F5F5",
  card: "#FFFFFF",
  onDark: "#FFFFFF",
  fill1: "#F7F7F8",
  fill2: "#F0F0F1",
  fill3: "#E4E4E6",
  hairline: "#EDEDED",
  separator: "#E0E0E0",
  text1: "#333333",
  text2: "#4D4D4D",
  text3: "#666666",
  text4: "#8C8C8C",
  text5: "#BABABA",
  brand: "#20904E",
  brandPressed: "#1A7A42",
  brandSoft: "#E8F5EC",
  brandFaint: "#F3FAF5",
  onBrand: "#FFFFFF",
  ink: "#333333",
  mascotGreen: "#A8D65E",
  mascotGreenInk: "#2F6B3F",
  link: "#133667",
  red700: "#E5484D",
  redSoft: "#FDECEC",
  amber600: "#D97706",
  amber50: "#FFF4E5",
  highlight: "#EDEDED",
  scrim: "rgba(0, 0, 0, 0.5)",
  scrimLight: "rgba(0, 0, 0, 0.16)",
  shadowColor: "#000000",
};

const darkPalette: typeof lightPalette = {
  page: "#121215",
  feed: "#0B0B0D",
  card: "#1C1C21",
  onDark: "#121215",
  fill1: "#1F1F24",
  fill2: "#26262C",
  fill3: "#323239",
  hairline: "#26262B",
  separator: "#33333A",
  text1: "#E3E3E6",
  text2: "#CFCFD3",
  text3: "#A3A3A9",
  text4: "#7C7C83",
  text5: "#55555C",
  brand: "#6CCB7E",
  brandPressed: "#5BB86C",
  brandSoft: "#18301F",
  brandFaint: "#142219",
  onBrand: "#0E1A12",
  ink: "#E3E3E6",
  mascotGreen: "#A8D65E",
  mascotGreenInk: "#2F6B3F",
  link: "#8AB4F8",
  red700: "#FF6B6B",
  redSoft: "#3A2224",
  amber600: "#F2A541",
  amber50: "#33271A",
  highlight: "#2C2C32",
  scrim: "rgba(0, 0, 0, 0.6)",
  scrimLight: "rgba(0, 0, 0, 0.35)",
  shadowColor: "#000000",
};

export function isDarkAppearance() {
  return appearance.resolved === "dark";
}
// Mutable copy of the active palette. Switching appearance rewrites theme
// values in place (applyAppearancePalette) and regenerates createStyles()
// sheets, so module-level imports of `theme` stay valid.
const palette = { ...(isDarkAppearance() ? darkPalette : lightPalette) };
// Text-only card covers: soft neutral tints picked by a stable hash of the id.
const PENCIL_FILLS = { light: ["#F3F3F5", "#EEF5F0", "#F5F1EC", "#EEF1F6"], dark: ["#24242A", "#1E2A22", "#2A2620", "#20242C"] };

function paletteColors() {
  return {
    /** Page background (detail pages, sheets, settings). */
    canvas: palette.page,
    /** Feed background behind cards (home, related, blind box). */
    feed: palette.feed,
    surface: palette.card,
    surfaceMuted: palette.fill2,
    surfaceSunken: palette.fill1,
    surfacePressed: palette.fill2,
    fill1: palette.fill1,
    fill2: palette.fill2,
    fill3: palette.fill3,
    text: palette.text1,
    textStrong: palette.text2,
    textSecondary: palette.text3,
    textMuted: palette.text4,
    textFaint: palette.text5,
    border: palette.hairline,
    borderStrong: palette.separator,
    // OIO green: primary actions, active tab, progress / done.
    accent: palette.brand,
    accentPressed: palette.brandPressed,
    accentSoft: palette.brandSoft,
    accentFaint: palette.brandFaint,
    onAccent: palette.onBrand,
    accentStrong: palette.brand,
    // Neutral solid fill for secondary filled controls (selected chips…).
    ink: palette.ink,
    onInk: palette.onDark,
    link: palette.link,
    danger: palette.red700,
    dangerSoft: palette.redSoft,
    success: palette.brand,
    successSoft: palette.brandSoft,
    warning: palette.amber600,
    warningSoft: palette.amber50,
    highlight: palette.highlight,
    disabled: palette.fill3,
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
    card: 10,
    sheet: 16,
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
  gameRoute: [palette.brand, palette.text2, palette.text3, palette.text4] as readonly string[],
  hairline: StyleSheet.hairlineWidth,
  shadow: shadows(),
} as const;

/** Rewrite every theme value in place for the given appearance. */
export function applyAppearancePalette(resolved: "light" | "dark") {
  appearance.resolved = resolved;
  Object.assign(palette, resolved === "dark" ? darkPalette : lightPalette);
  Object.assign(theme.colors, paletteColors());
  (theme.pencilFills as string[]).splice(0, theme.pencilFills.length, ...PENCIL_FILLS[resolved]);
  (theme.gameRoute as string[]).splice(0, theme.gameRoute.length, palette.brand, palette.text2, palette.text3, palette.text4);
  Object.assign(theme.shadow, shadows());
}
