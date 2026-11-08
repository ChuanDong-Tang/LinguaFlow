---
name: linguaflow-sketch-style
description: OIO's visual language for the mobile app — hand-drawn ink outlines filled with soft colored-pencil color (direction "B3 彩铅填色"). Use whenever creating or restyling any mobile screen, component, empty state, dialog, icon, illustration, or color/token choice, so new UI matches the OIO mascot and the rest of the app.
---

# OIO sketch style — 彩铅填色

The OIO mascot (`apps/mobile/assets/app/oio-character.svg`) is the source of the
whole language: round ink lines on white paper, with one small patch of flat
color. Every screen should look like it was drawn by the same hand with the same
pen, then lightly colored in with pencils.

Visual thesis: **black hand-drawn outlines, white paper, soft flat fills used to
mean something.** Photos stay full color and become the brightest thing on screen.

Pair this skill with `skills/linguaflow-motion/SKILL.md` (how things move) and
`skills/linguaflow-interaction-feel/SKILL.md` (how things respond). The approved
clickable reference is `references/mockup.html` (open it in a browser; the B3
phone is the target).

## Tokens

All values live in `apps/mobile/src/theme.ts`. Never write hex literals in
screens; add a token if one is missing.

| Role | Token | Value | Meaning |
|---|---|---|---|
| Paper | `colors.canvas` | `#FDFDFB` | Page background |
| Card paper | `colors.surface` | `#FFFFFF` | Inside outlined objects |
| Ink | `colors.ink` / `colors.text` | `#1C1C1A` | All outlines, titles, icons |
| Graphite | `colors.textSecondary` | `#62615C` | Secondary text, pencil shadow |
| Faint | `colors.textMuted` | `#A6A59F` | Dates, disabled labels |
| Yellow | `colors.accent` | `#FFD25E` | **Primary action fill** (one per screen) |
| Butter | `sketch.fill.yellow` | `#FFF1B8` | Featured block (e.g. memory game banner) |
| Leaf | `sketch.fill.green` | `#E2F1CC` | Progress, success, correct answer (`#D4ECB4` when selected) |
| Petal | `sketch.fill.pink` | `#FFE2E8` | Soft error / wrong answer background |
| Sky | `sketch.fill.blue` | `#DCEEFB` | Neutral information, tags |
| Mascot green | `palette.mascotGreen` | `#A8D65E` / `#2F6B3F` | Mascot pocket and progress dots only |

Text on a fill is always ink. Never put white text on yellow or pastel. White
text appears only on solid ink fills.

### Color discipline
- One yellow primary action per screen. Secondary actions are white with an ink outline.
- Green means "done / right / progress". Pink means "not right". Do not use them as decoration.
- Pastel cover fills for text-only cards rotate through yellow/green/pink/blue chosen by a stable hash of the record id, never by list index (the color must not change when the list reorders).
- At most one pastel fill per object. No gradients, no glass blur, no colored shadows, no coral (the 2026-11 coral palette is retired).

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
- `SketchButton` — primary (yellow fill) / secondary (white) / ink variants with press behavior.
- `SketchBlob` — soft filled shape behind a selected tab or label.
- `SketchUnderline` — wavy underline for cloze blanks and emphasis.
- `sketchPath.ts` — pure, deterministic path generators (`wobbleRect`, `wobbleEllipse`, `wave`); add new shapes here and keep them pure.

## Typography

System font only (PingFang SC / SF / Roboto). Titles bold ink, body regular ink,
secondary text graphite. No handwriting fonts for UI text — the hand lives in the
lines, not the letters. Use the existing `theme.type` scale.

## Icons and illustration

- Icons: Phosphor via `components/Icon.tsx`, regular weight, ink color. No duotone color fills on icons.
- Illustrations and empty states use the OIO mascot (blink, hop, tilt poses) or simple ink line drawings with at most one pastel fill.
- The mascot is never recolored except its pocket (mascot green).

## Do / Don't

- Do let whitespace and paper do most of the work; a screen should still read well in grayscale.
- Do keep photos untouched (no filters, no sketch overlay).
- Don't outline every element; nested hand-drawn boxes are not allowed (a sketched card does not contain sketched sub-boxes, except buttons).
- Don't mix the sketched style with platform-default elevated Material cards or iOS grouped lists on the same screen.

## Verification

Before handing off a styled screen: screenshot it on the iOS simulator and the
Android emulator, compare against `references/mockup.html` (B3), check text
contrast on every fill, and confirm the outlines do not change between two
renders of the same data.
