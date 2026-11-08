---
name: linguaflow-sketch-style
description: OIO's visual language for the mobile app — hand-drawn black-and-white ink outlines with pencil-gray fills; only the mascot is colored; light and inverted modes. Use whenever creating or restyling any mobile screen, component, empty state, dialog, icon, illustration, or color/token choice, so new UI matches the OIO mascot and the rest of the app.
---

# OIO sketch style — 黑白手绘

The OIO mascot (`apps/mobile/assets/app/oio-character.svg`) is the source of the
whole language: round ink lines on white paper, with one small patch of flat
color. Every screen should look like it was drawn by the same hand with the same
pen, then lightly colored in with pencils.

Visual thesis: **black hand-drawn outlines on white paper (or white on black in
inverted mode), with pencil-gray fills.** Only the mascot and photos carry color.

Pair this skill with `skills/linguaflow-motion/SKILL.md` (how things move) and
`skills/linguaflow-interaction-feel/SKILL.md` (how things respond). The approved
clickable reference is `references/mockup.html` (open it in a browser; the B3
phone is the target).

## Tokens

All values live in `apps/mobile/src/theme.ts`, which has a light palette and an
inverted (dark) palette chosen at startup (see "Appearance" below). Never write
hex literals in screens; add a token if one is missing.

**Black and white everywhere except the mascot.** The mascot keeps its white
body and green pocket in both modes; nothing else in the UI uses hue.

| Role | Token | Light | Inverted |
|---|---|---|---|
| Paper | `colors.canvas` | `#FDFDFB` | `#1A1A18` |
| Card paper | `colors.surface` | `#FFFFFF` | `#222220` |
| Ink (lines, titles, icons) | `colors.ink` / `colors.text` | `#1C1C1A` | `#ECEBE6` |
| Graphite | `colors.textSecondary` | `#62615C` | `#A9A8A2` |
| Faint | `colors.textMuted` | `#8A8983` | `#7E7D78` |
| Primary action fill | `colors.accent` | ink | ink |
| Text on primary | `colors.onAccent` | paper | paper |
| Soft emphasis fill | `colors.accentSoft` | pencil gray | dark pencil gray |
| Text-only covers | `theme.pencilFills` | 4 light grays | 4 dark grays |

`success` is ink (done/correct is shown with drawn marks, not green); `danger`
is a muted red reserved for real errors and destructive actions. Pick a cover gray by stable hash of the record id (`pencilFillFor`),
never by list index.

### Color discipline
- One solid ink primary action per screen. Secondary actions are paper with an ink outline.
- No yellow, pastel, gradient, glass blur, or colored shadow. Emphasis comes from ink weight, a drawn underline, or a gray pencil fill.
- Photos are the only full-color content and stay untouched.

### Appearance (inverted mode)
Users choose 浅色 / 深色 / 系统 in 我的 → 外观, and the switch is live (no reload):
`src/appearance/switch.ts` rewrites `theme` values in place, regenerates every
style sheet, and the app root remounts its views (App state is kept, so the user
stays on the same screen). For this to work:
- Create style sheets with `createStyles(() => ({ ... }))` from `src/styles.ts`, never `StyleSheet.create`.
- Read `theme.colors.*` at render time or inside `createStyles`; never copy a color into a module-level constant.
- No hex or `rgba(255,255,255,…)` literals for surfaces or text; scrims and shadows over photos are the only exception.
- `Text`, `TextInput` and `Icon` default to `theme.colors.text`; don't rely on platform defaults (black).
- Any new color must exist in both palettes. Check every new screen in both modes before handing off.

## Line

- Outline: ink, 1.8 dp, round caps and joins, plus a second lighter pass (0.9 dp, 45% opacity) slightly offset. This double line is what reads as "drawn by hand".
- Pencil shadow: the same outline in graphite at 35% opacity, offset (3.5, 3.5). Use it for objects you can press or lift: cards, primary buttons, the dock, game options. Never use platform drop shadows/elevation on sketched objects.
- Wobble is deterministic. Paths come from a seeded generator keyed by a stable id (record id, button key) plus size. Never `Math.random()` in render; the outline must not jitter between renders.
- Corners: cards 14, buttons/pills 22, chips/options 12, dock 31.

## Where to draw by hand, where to stay clean

Hand-drawn: cards, buttons, option chips, the dock, the active-tab blob, progress dots, banners, dialogs' outer frame, empty-state illustrations, the blank in cloze sentences.

Clean (straight, no wobble): body text, text inputs and editors, long settings/list rows (use a hairline divider), photos, the reading view's long text, anything that scrolls in large numbers where performance matters.

When unsure, keep it clean. A screen with too many wobbly lines looks noisy, not handmade.

## Components

Use the shared primitives in `apps/mobile/src/components/sketch/` instead of
re-implementing paths:

- `SketchBox` — outline (+ optional fill, pencil shadow) around any children; measures itself.
- `SketchPressable` — pressable drawn box (primary = ink fill) with paper press and haptic.
- `SketchBlob` — soft gray filled shape behind a label.
- `OioMascot` — the mascot with blink / hop / tilt.
- `SketchUnderline` — wavy underline for cloze blanks and emphasis.
- `sketchPath.ts` — pure, deterministic path generators (`wobbleRect`, `wobbleEllipse`, `wave`); add new shapes here and keep them pure.

## Typography

System font only (PingFang SC / SF / Roboto). Titles bold ink, body regular ink,
secondary text graphite. No handwriting fonts for UI text — the hand lives in the
lines, not the letters. Use the existing `theme.type` scale.

## Icons and illustration

- Icons: Phosphor via `components/Icon.tsx`, regular weight, ink color. No duotone color fills on icons.
- Illustrations and empty states use the OIO mascot (blink, hop, tilt poses) or simple ink line drawings with at most one gray fill.
- The mascot is never recolored; it keeps its white body and green pocket in both modes.

## Do / Don't

- Do let whitespace and paper do most of the work; a screen should still read well in grayscale.
- Do keep photos untouched (no filters, no sketch overlay).
- Don't outline every element; nested hand-drawn boxes are not allowed (a sketched card does not contain sketched sub-boxes, except buttons).
- Don't mix the sketched style with platform-default elevated Material cards or iOS grouped lists on the same screen.

## Verification

Before handing off a styled screen: screenshot it on the iOS simulator and the
Android emulator, compare against `references/mockup.html` (B3 layout, without the colors), check both light and inverted modes, check text
contrast on every fill, and confirm the outlines do not change between two
renders of the same data.
