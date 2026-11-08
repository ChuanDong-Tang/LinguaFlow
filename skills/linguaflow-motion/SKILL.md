---
name: linguaflow-motion
description: Motion rules for the OIO mobile app — durations, springs, entrance choreography, pen "draw-on" lines, mascot animation, reduced motion, and performance limits. Use whenever adding or changing any animation, transition, gesture-driven movement, or loading/feedback motion in apps/mobile.
---

# OIO motion

Motion in OIO should feel like **paper and pencil**: things are pressed into the
page, lines are drawn rather than faded in, and small objects bounce a little
when they land. Motion confirms what happened; it never delays the user.

Visual language: `skills/linguaflow-sketch-style/SKILL.md`. Feedback and haptics:
`skills/linguaflow-interaction-feel/SKILL.md`. Reference: `skills/linguaflow-sketch-style/references/mockup.html`.

## Engine

- New animation code uses `react-native-reanimated` (v4, already installed) running on the UI thread. Do not add new `Animated` (RN core) code; migrate old code when you touch it.
- Shared tokens live in `apps/mobile/src/motion.ts`. Use them instead of inline numbers.
- Gestures use `react-native-gesture-handler`.

## Tokens (`motion.ts`)

| Token | Value | Use |
|---|---|---|
| `duration.press` | 100 ms, ease-out | Pressing down |
| `spring.release` | damping 14, stiffness 260, mass 0.6 | Releasing a press; slight overshoot |
| `spring.land` | damping 16, stiffness 180 | Elements landing (entrance, re-deal) |
| `spring.indicator` | damping 18, stiffness 220 | Tab blob sliding |
| `duration.enter` | 380 ms | List/section entrance |
| `stagger` | 45 ms per item, max 8 items | Entrance order |
| `duration.draw` | 380 ms + 0.35 ms per path length unit, max 900 ms | Pen draw-on |
| `duration.quick` | 180 ms | Fades, color changes |

Nothing interactive waits longer than 300 ms for an animation before it can be
used again. Navigation transitions stay under 350 ms.

## Patterns

1. **Press like paper.** Sketched pressables move (2, 2) down-right and hide their pencil shadow while held (100 ms), then spring back with `spring.release`. Non-sketched rows only dim to the pressed surface color.
2. **Lines are drawn.** When a sketched outline, underline, or check mark first appears because of a user action (correct answer, new card, tab change), animate `strokeDashoffset` from length to 0. Fills fade/scale in (0.92 → 1) after the stroke starts. Do not redraw lines on every re-render or on scroll.
3. **Entrance.** On first mount of a screen section, items rise 10 dp and fade in with `stagger`. Only the first 8 visible items stagger; the rest appear immediately. Returning to an already-seen screen does not replay the entrance.
4. **Indicator.** The selected-tab blob slides with `spring.indicator` and redraws its outline once it lands.
5. **Re-deal.** Card sets (blind box, next round) leave by flying out to the side with a small rotation (≤ 24°, 280 ms) and the new set lands with `spring.land`.
6. **Mascot.** Blinks every 4–5 s (eyes scaleY 1 → 0.12 → 1 over 160 ms), hops on success (squash 1.08×0.9, then up 9 dp, `spring.release`), tilts on a wrong answer (−9° → 5° → 0). Only one mascot on screen animates at a time.
7. **Wrong answer.** Horizontal shake: −6, 5, −3, 0 dp over 360 ms, plus an ink strike line drawn through the option.

## Reduced motion

Read `useReducedMotion()` from reanimated. When true: no entrance stagger, no
draw-on (show final strokes), no mascot idle animation, no shake; keep instant
state changes (color, fill, check mark). Never hide information behind an
animation that might not run.

## Performance

- Generate sketch paths once per (seed, width, height) and memoize; never regenerate in an animation frame.
- Animate transforms and opacity, and `strokeDashoffset` via `useAnimatedProps`. Do not animate layout properties (width/height/top) in lists.
- At most ~12 simultaneously animating SVG paths. Long lists (`FlatList` items beyond the first screen) render static outlines.
- Test every new animation on the Android emulator (Pixel 8 AVD) in addition to iOS; drop frames there mean simplify the effect.

## Verification

Record or screenshot the before/after on both simulators, toggle the system
reduce-motion setting once, and confirm the screen is fully usable with motion
off.
