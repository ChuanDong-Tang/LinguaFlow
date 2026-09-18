---
name: linguaflow-app-release
description: Build, validate, retain, upload, submit, or hot-update LinguaFlow app releases. Use for Expo OTA updates, Apple TestFlight/App Store, Google Play Android, China Android direct distribution, version/build management, or multi-channel packaging requests.
---

# LinguaFlow App release

Route every native production release through this Skill's local scripts. Never replace
them with a raw Expo, EAS, Xcode, or Gradle production command. Release scripts,
local configuration, and detailed instructions live under this Skill;
`ci/cd/` is output-only and must contain only `artifacts/`. If a required script
or ignored local configuration is missing, stop and report the missing file.

Read [references/release-workflows.md](references/release-workflows.md) when
setting up a machine, troubleshooting a release, or choosing non-default modes.
Read [references/ota-workflow.md](references/ota-workflow.md) before preparing,
publishing, validating, or troubleshooting an OTA/hot update.

## OTA versus native release

An OTA update can change JavaScript and bundled assets only. Do not use it for
native dependencies, Expo plugins, permissions, signing certificates, update
URLs, or other native configuration. Those changes require a new installation
package and, when native compatibility changes, a new `runtimeVersion`.

Use `npm --prefix apps/mobile run publish:update -- --dry-run ...` for an OTA
preflight. Remove `--dry-run` only when the user explicitly asks to publish or
deploy the hot update. Preview and production are separate channels; never
publish to production merely because a preview export succeeded.

Production OTA channels are distribution-specific: iOS uses `production`,
Google Android uses `production-google`, and China Android uses
`production-china`. Never publish a production update with `--platform all`;
each target has different compiled payment flags.

## OTA source permanence

OTA is a delivery mechanism, not a temporary patch layer. Production OTA
publication requires all `apps/mobile` source changes to be committed and the
manifest records that Git commit. Never edit an exported bundle, generated
artifact, manifest, or COS object as the implementation of a fix.

When an OTA fix is made from an older release branch, forward-port the fix and
its regression test to the active development branch before calling the repair
complete. Before building the next native version, confirm that every
still-required production OTA fix since the previous package is present in the
build source; the new package must behave correctly even before downloading an
OTA.

## Release routes

| User intent | Command | Retained artifact | Upload behavior |
| --- | --- | --- | --- |
| Apple, iOS, TestFlight | `bash skills/linguaflow-android-release/scripts/ios-testflight.sh` | `ci/cd/artifacts/ios/OIO-<version>-<build>.ipa` | Build, validate, then upload directly with Apple's Transporter |
| Google, Google Play | `bash skills/linguaflow-android-release/scripts/android-play.sh --build-only` | `ci/cd/artifacts/android/OIO-<version>-<versionCode>.aab` | Keep the AAB locally; upload only when the user explicitly asks, by running the script without `--build-only` |
| 国内包, 中国包, China Android | `bash skills/linguaflow-android-release/scripts/android-china.sh` | `ci/cd/artifacts/android-china/OIO-<version>-<versionCode>.apk` | Never upload to Google Play |
| OTA / 热更新 | Read `references/ota-workflow.md`, then use `npm --prefix apps/mobile run publish:update -- ...` | Content-addressed bundle/assets and an immutable manifest in COS | Dry-run by default; upload only when explicitly requested |

Google output is an Android App Bundle (`.aab`, not `.apk` or `.abb`). China
output is a directly installable `.apk`. TestFlight receives the validated IPA
and the IPA is also retained locally.
If EAS Submit cannot upload its archive, reuse the validated Google AAB with
`android-play.sh --submit-direct <aab>`. This direct fallback requires
`GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` in the local Android release config and uses
an atomic Google Play edit to upload the bundle, update the configured track,
and commit it.
Retry a failed TestFlight transfer with `--submit-only <ipa>` so the validated
artifact is reused and no additional build number is allocated.

If the user requests all three, run them sequentially, not concurrently. For a
configuration-only request, use the selected script's `--check`. Respect an
explicit no-upload request for iOS by adding `--build-only`.

## Three-platform startup gate

Every native release candidate must pass the same-source startup gate before
it may be uploaded:

```bash
bash skills/linguaflow-android-release/scripts/simulator-smoke.sh --run
```

The gate builds the current source, installs it on an iOS 26 simulator, an iOS
27 simulator, and the configured Android AVD, then cold-launches each target
twice. It writes a short-lived receipt under `.tmp/release-smoke/`. The receipt
is bound to a content fingerprint, so any relevant Mobile source or native
configuration change invalidates it. Release scripts run this gate by default;
submit-only retries require an existing valid receipt.

Use `--check` to inspect prerequisites without building or launching. Use
`--keep-running` only when a person needs to inspect the three targets. Never
replace a missing target with a different OS major and still report the gate as
passed.

## Payment isolation — release blocker

Payment routing is a hard release invariant. Never build, upload, or report
success when the selected package does not match this matrix:

| Package | Distribution channel | Enabled payment | Must be disabled / unreachable |
| --- | --- | --- | --- |
| iOS / TestFlight | `production` | Apple IAP / StoreKit; Apple auto-renew must be enabled | Google Play Billing and Alipay must never be selected on iOS |
| Google AAB | `google` | Google Play Billing and Google auto-renew | Alipay auto-renew must be `false` |
| China APK | `china` | Alipay monthly auto-renew and Alipay annual pass | Google Play auto-renew must be `false`; Google Billing must not initialize |

The scripts must export provider flags themselves instead of trusting leftover
values in `apps/mobile/.env`:

- iOS: `EXPO_PUBLIC_ENABLE_APPLE_AUTO_RENEW=true`, while Google Play and
  both Alipay payment flags are `false`.
- Google: `EXPO_PUBLIC_ENABLE_GOOGLE_PLAY_AUTO_RENEW=true` and
  both Alipay payment flags are `false`; both Apple purchase flags are `false`.
- China: `EXPO_PUBLIC_ENABLE_GOOGLE_PLAY_AUTO_RENEW=false` and
  both `EXPO_PUBLIC_ENABLE_ALIPAY_AUTO_RENEW=true` and
  `EXPO_PUBLIC_ENABLE_ALIPAY_ANNUAL_PASS=true`; both Apple purchase flags are `false`.

If the current release includes Apple's one-time purchase, also confirm
`EXPO_PUBLIC_ENABLE_APPLE_ONE_TIME_PURCHASE=true`.

Prices and purchase actions must remain provider-specific: Apple reads Apple
products, Google reads Google Play products, and China Android reads Alipay
quotes from the backend. Never fall back to another channel's price or purchase
flow. A missing provider price must remain unavailable (`--`), not borrow a
price from Apple, Google, a hard-coded constant, or Alipay. Never put Alipay
private keys or other server credentials in the mobile package.

## Verification and reporting

Before reporting success, use the script and artifact validation output to
confirm all of the following:

- iOS 26, iOS 27, and Android startup smoke passed for the current source;
- destination and payment provider match the matrix above;
- production API URL, package/bundle ID, distribution/update channel, version,
  and build/version code are correct;
- artifact extension and final directory match the release table;
- signature validation passed and a SHA-256 was printed;
- TestFlight upload actually completed for the default iOS flow;
- Google Play upload is claimed only when the user requested it and the submit
  command completed.

For OTA, instead confirm the exact channel, runtime version, platform, manifest
update ID, and that the COS upload completed before the latest pointer changed.
Do not call a dry-run a published update, and do not claim existing binaries can
receive a custom OTA URL unless that URL was already embedded in those binaries.

Report the exact final artifact path. Do not treat a successful build as a
successful store upload.
