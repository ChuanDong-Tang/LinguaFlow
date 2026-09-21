# Risk-based validation strategy

Choose validation depth from blast radius, not from the semantic version or
the number of edited lines. Record the selected tier and why before coding.
When uncertain, use the higher tier.

| Tier | Use when | Required coverage |
| --- | --- | --- |
| `focused` | Copy, styling, or isolated logic with no shared state, API, native, or core-flow impact | Relevant automated tests plus the changed interaction on one appropriate target |
| `affected-flow` | A user-visible feature, shared component, API integration, released-client behavior, or a fix spanning more than one boundary | Focused automated tests plus a written checklist for the complete affected journey and adjacent failure/retry states; execute the device checklist only when requested or before the applicable release gate |
| `release-core` | App shell/navigation, Expo or native dependencies/configuration, broad refactors, shared Card/chat state, more than one core flow, or an explicitly core/large release | Full automated Mobile suite plus a written core-flow checklist; a native release candidate uses the platform-scoped sequential gate (iOS 26/iOS 27 for iOS, Android for Android), but it is not run proactively during ordinary implementation |

A production native package always runs the sequential startup gate for its
own platform, even when the source change is focused. The breadth of functional
regression remains risk-based. OTA does not waive validation, but manual OTA
experience checks default to user execution: Codex supplies the steps and waits
for the user's result instead of opening simulators and inspecting screenshots
unless explicitly asked.

At native upload time, the harness recomputes the minimum tier from the Git diff
between the previous known-good commit and candidate commit. Expo/React Native,
package/config-plugin/native, app-shell, shared Card detail, selectable text, or
cloze bridge changes force `release-core`; a manually written lower tier is
rejected. A shared component change expands validation to all known consumers,
not only the screen where the edit was first noticed.

## Core-flow checklist

For `release-core`, record observed evidence for all of these flows:

1. attach an image and retain the selected preview;
2. send a message and observe its durable result;
3. start rewrite generation and reach a completed result;
4. reopen the Card and verify original/rewrite/auxiliary alignment and layout;
5. create or use cloze blanks, answer/reveal them, close, and reopen to verify state;
6. enter the memory game, complete at least one question, and observe the result.

When device validation is requested or a native release gate is active, run
only that distribution's targets sequentially: iOS 26 then iOS 27 for iOS, or
the Android AVD for Android. Never keep multiple managed targets alive to save
time. If a person needs to inspect
a result, re-open only that one target with
`simulator-smoke.sh --keep-target ios26|ios27|android` after the gate.

If simulator cleanup removed authentication, follow the app-release Skill's
local test-account fallback instead of treating the login screen as evidence
that the tested flow passed.

The deterministic test suite proves shared logic once. Device evidence proves
native integration and rendering. Do not replace either kind with the other.
