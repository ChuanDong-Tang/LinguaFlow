---
name: linguaflow-interaction-feel
description: How OIO responds to touch — haptics map, press/disabled/loading/success/error states, gestures and back behavior, feedback copy, and memory-game feel (correct, wrong, streak, round summary). Use whenever building or changing anything the user taps, swipes, answers, or waits for in apps/mobile.
---

# OIO interaction feel

Every touch gets an answer within 100 ms: something moves, something changes
color, or the phone ticks. The user should never wonder whether a tap landed.

Look: `skills/linguaflow-sketch-style/SKILL.md`. Motion numbers: `skills/linguaflow-motion/SKILL.md`.

## Haptics map

Use the helper `apps/mobile/src/feedback/haptics.ts` (wraps `expo-haptics`,
no-ops on web and when the user disabled haptics). Never call `expo-haptics`
directly from screens.

| Moment | Helper | expo-haptics |
|---|---|---|
| Switching tab, segmented control, picker step | `haptic.select()` | `selectionAsync` |
| Opening a card, tapping a secondary button, mascot tap | `haptic.light()` | `impactAsync(Light)` |
| Primary create action (＋, start game, capture photo) | `haptic.medium()` | `impactAsync(Medium)` |
| Correct answer, card saved, round finished | `haptic.success()` | `notificationAsync(Success)` |
| Wrong answer, blocked action | `haptic.warning()` | `notificationAsync(Warning)` |
| Failure that lost user work | `haptic.error()` | `notificationAsync(Error)` |

No haptics on scroll, on passive updates, or more than once per 120 ms.

## States every interactive element needs

- **Pressed**: see the press pattern in linguaflow-motion (paper press / dim).
- **Disabled**: faint text, outline at 40% opacity, no shadow, no haptic; explain why nearby if it is not obvious.
- **Loading**: keep the element's size; replace the label with a small ink spinner or a pencil "…" line; block double taps.
- **Success**: brief green fill or drawn check, then return to rest. Do not show a modal for success.
- **Error**: pink fill on the affected element plus one sentence saying what happened and what to do. Keep the user's input.
- **Empty**: mascot + one line of what goes here + one yellow primary action.

Touch targets are at least 44×44 pt. Destructive actions ask once, inline, never twice.

## Gestures and navigation

- Android back closes the top overlay first (`hooks/useAndroidBack.ts`), then navigates back; it never exits from inside an overlay.
- Horizontal swipe moves between sibling items (cards in a set, game questions after answering); swipes must complete as a full slide, never a half-slide followed by a refresh.
- Vertical swipe-down closes sheets. Do not add gestures that conflict with system edge swipes.

## Memory game feel

- **Answering**: tapping an option answers immediately (no separate "check" step for choice questions).
- **Correct**: option fills leaf green with a drawn check, the blank fills with the word and a drawn underline, mascot hops, `haptic.success()`. "下一题" (yellow primary) appears with a small pop. A swipe or tap advances.
- **Wrong**: option shakes, gets an ink strike line and petal fill, becomes disabled, mascot tilts, `haptic.warning()`, copy "再想想". The user can try again; the answer is revealed after the second wrong try.
- **Progress**: hand-drawn dots, filled mascot green when done, the current dot slightly larger. Never a percentage bar.
- **Streak**: 3 correct in a row → mascot does a double hop and a short line of praise ("连对 3 题"). No confetti, no sounds unless the user enabled sound.
- **Round summary**: a drawn card that summarizes the round (cards reviewed, new words, streak), one yellow "再来一组" and one secondary "回到主页". The summary is a moment of calm, not a scoreboard.

## Feedback copy

Short, warm, specific, Chinese first: "答对了", "再想想", "已保存", "网络断了，已帮你留着草稿". No exclamation-mark spam, no apologies, no technical error codes in user-facing text (log them instead).

## Verification

For each changed interaction: try it with a fast double tap, with slow network
(loading state), offline (error state), with reduce-motion on, and with Android
back. Confirm the haptic fires exactly once.
