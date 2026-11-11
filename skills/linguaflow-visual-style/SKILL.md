---
name: linguaflow-visual-style
description: OIO's visual language for the mobile app — Xiaohongshu (RED) style layering: borderless white cards on a light gray feed, separated by background color, one brand green, the OIO mascot as the only illustration. Use whenever creating or restyling any mobile screen, component, card, list, sheet, empty state, icon, or color/token choice.
---

# OIO visual style — 小红书式分层

Decided 2026-11-09 after team feedback that hand-drawn borders "steal the show".
Reference product: the Xiaohongshu mobile app. Borrow its principles and
interaction patterns, not its brand (no red, no logo, no copied assets).
Research notes: `references/xiaohongshu.md`.

Visual thesis: **content first — photos and words on quiet surfaces.** Objects
are separated by background color (white card on a light gray feed), never by
outlines or shadows. Color is reserved for one brand green and for photos.

Pair with `skills/linguaflow-motion/SKILL.md` and
`skills/linguaflow-interaction-feel/SKILL.md`.

## Tokens (`apps/mobile/src/theme.ts`)

Never write hex literals in screens; add a token to both palettes instead.

| Role | Token | Light | Dark |
|---|---|---|---|
| Feed background (home, related, blind box) | `colors.feed` | `#F5F5F5` | `#0B0B0D` |
| Page background (detail, sheets, settings) | `colors.canvas` | `#FFFFFF` | `#121215` |
| Card | `colors.surface` | `#FFFFFF` | `#1C1C21` |
| Fills: subtle / control / pressed | `colors.fill1/2/3` | `#F7F7F8` / `#F0F0F1` / `#E4E4E6` | `#1F1F24` / `#26262C` / `#323239` |
| Text: title / body / secondary / caption / faint | `text`, `textStrong`, `textSecondary`, `textMuted`, `textFaint` | `#333` … `#BABABA` | `#E3E3E6` … `#55555C` |
| Hairline separator | `colors.border` | `#EDEDED` | `#26262B` |
| Brand (OIO green) | `colors.accent` | `#20904E` | `#6CCB7E` |
| Text on brand | `colors.onAccent` | `#FFFFFF` | `#0E1A12` |
| Brand tint (selected / correct background) | `colors.accentSoft` | `#E8F5EC` | `#18301F` |
| Wrong answer (yellow) | `colors.warning` | `#D19A00` | `#F2C14E` |
| Wrong-answer tint | `colors.warningSoft` | `#FFF6D6` | `#352C17` |
| Text on solid yellow | `colors.onWarning` | `#2B2200` | `#2B2200` |
| Native cloze highlight (#RRGGBBAA) | `colors.clozeCorrectFill` / `clozeIncorrectFill` | brand / yellow at ~25–30% | same |
| Hashtag / link | `colors.link` | `#133667` | `#8AB4F8` |
| Danger (delete, real errors) | `colors.danger` | `#E5484D` | `#FF6B6B` |

Pure black is never used for text. The mascot keeps its own colors.

### Color discipline
- Brand green only for: the primary action on a screen, the active tab underline, progress / done / correct, and the ＋ create button. Nothing decorative.
- Cloze grading (2026-11): **green = answered right, yellow = answered wrong, gray = never answered.** Blanks keep their latest color on re-encounter. The 答对了 box/button is green, the 正确答案 box/button is yellow (`onWarning` text). Yellow is used only for wrong answers and the completion ring of a card with mistakes — never as decoration or as a warning banner color elsewhere.
- Secondary buttons: `fill2` background with `text` color, no border.
- Selected chips/segments: brand fill with `onAccent` text (or bold text only for text tabs).
- Photos are untouched and are the most colorful thing on screen.

## Layering rules (the core of the style)

- **No borders on objects.** Cards, buttons, inputs, chips, tray tiles, menus: separate them with a background difference (`surface` on `feed`, or `fill1/2` on `canvas`).
- **No shadows**, except things that float above content: the bottom dock, popover menus (`theme.shadow.float` / `.menu`). Dark mode: no shadows at all.
- Hairlines (`border`) are allowed only as list separators and the footer rule on the reading page.
- Radii: cards 10, controls 10–12, pills 999, bottom sheets 16 (top corners).

## Layouts

**Feed (home 回忆, 相关回忆, search results)** — Xiaohongshu double-column masonry:
- `feed` background, 6dp side padding, ~7dp gaps between cards.
- Card = image flush to the top (top corners rounded) → title 14/500, 2 lines, 10dp side padding → footer row: date (12, `textMuted`) left, 👁 count right. No avatar (single-user app).
- Text-only memories: a soft tinted cover (`coverFillFor(id)`) with the title centered 17/600 — like a text post image.
- Status badge: 24dp circle, `surface` at 92% opacity, top-left of the cover.

**Top of the home page**: white page area with ☰, text tabs 回忆 / 今日 / 盲盒 (active 600 + 3dp brand underline; inactive 400 `textMuted`), mascot, search. Folder row below is plain text channels (active bold), never pills.

**Bottom dock**: white floating bar with soft shadow; ＋ is a brand rounded rectangle (52×38, radius 12) with a white plus, like Xiaohongshu's publish button.

**Reading page (card detail)**: white page; photo carousel → title (21/700) with the flip button → body (16–18 / line height ~1.7) → `# folder` in link color → 相关回忆 row on `fill1` → hairline → time + actions (icons 20–24 with counts in 12 `textMuted`, no plates).

**Sheets and menus**: bottom sheets on a 50% scrim, rounded top 16, options as rows; popovers are white with the menu shadow.

## Components (`apps/mobile/src/components/surface/Surface.tsx`)

- `Surface` — a background block with radius (no outline).
- `PressableSurface` — pressable block; press dims to 88% and scales to 0.97, then springs back; optional haptic.
- `TabUnderline` — the brand bar under the active tab.
- `CheckMark` — brand check for done/correct.
- `coverFillFor(id)` — stable tint for text-only covers.
- `OioMascot` (`components/sketch/OioMascot.tsx`) — the only hand-drawn element: header button, empty states, game feedback.

## Typography

System font (PingFang SC / SF / Roboto). Scale follows Xiaohongshu: titles 18/600, card title 14/500, body 16 (reading 17–18), captions 12. Weight 700 only for page titles and emphasized numbers.

## Do / Don't

- Do let photos and whitespace carry the page; a screen should read well with color removed.
- Do keep tap targets ≥ 44pt even when the visible block is smaller.
- Don't draw outlines, double lines, wobbly strokes or pencil shadows (the 2026-11-08 sketch style is retired).
- Don't use brand green for icons or text that aren't the single primary action / active state.
- Don't put a white control on a white page without a fill (use `fill2`).

## Verification

Screenshot on iOS and Android in light and dark; check every control is visible
without borders, text contrast on brand fills (white on `#20904E` is 4:1, bold
15+ only), and that no hex literals were added outside `theme.ts`.
