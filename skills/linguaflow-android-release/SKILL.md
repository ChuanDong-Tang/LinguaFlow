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

Treat App publication as a standalone workflow. Finishing a feature, fixing a
bug, preparing release notes, or concluding that OTA is technically eligible
does not authorize an OTA publish, native build, upload, submission, or public
promotion. Report readiness and wait for a separate explicit release request.

Read [references/release-workflows.md](references/release-workflows.md) when
setting up a machine, troubleshooting a release, or choosing non-default modes.
Read [references/candidate-acceptance.md](references/candidate-acceptance.md)
before building or uploading any native candidate.
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
| Apple, iOS, TestFlight | `bash skills/linguaflow-android-release/scripts/ios-testflight.sh` | `ci/cd/artifacts/ios/OIO-<version>-<build>.ipa` | Build and validate only; accepted artifact may later upload to TestFlight |
| Google, Google Play | `bash skills/linguaflow-android-release/scripts/android-play.sh` | `ci/cd/artifacts/android/OIO-<version>-<versionCode>.aab` | Build and validate only; accepted artifact may later upload to internal testing |
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
Every `--submit-only` or `--submit-direct` command also requires
`--acceptance <record>`. Retry a failed transfer with the identical artifact and
record so no additional build/version number is allocated.

If the user requests all three, run them sequentially, not concurrently. For a
configuration-only request, use the selected script's `--check`. Respect an
explicit no-upload request for iOS by adding `--build-only`.

## Platform versions are independent

Treat the live iOS, Google Android, and China Android versions as three separate
facts. Never infer one platform's marketing version, build number, versionName,
versionCode, runtimeVersion, review state, or rollout state from another
platform. A shared source checkout or matching display version does not make
their live releases equal.

Before release or live-version repair, record the matrix explicitly:

| Distribution | User version | Native build | Runtime | Delivery state |
| --- | --- | --- | --- | --- |
| iOS | App Store version | Apple build number | iOS runtimeVersion | review/TestFlight/App Store |
| Google Android | versionName | versionCode | Google runtimeVersion | testing/production track |
| China Android | versionName | versionCode | China runtimeVersion | uploaded APK and active download URL |

Use the platform-specific backend settings
`LF_APP_IOS_LATEST_VERSION`, `LF_APP_GOOGLE_ANDROID_LATEST_VERSION`, and
`LF_APP_CHINA_ANDROID_LATEST_VERSION`. Do not change the shared
`LF_APP_LATEST_VERSION` as a shortcut when only one distribution advances.

## Platform-scoped startup gate

Every native release candidate must pass the same-source startup gate for the
distribution being uploaded:

```bash
bash skills/linguaflow-android-release/scripts/simulator-smoke.sh --run --target ios
bash skills/linguaflow-android-release/scripts/simulator-smoke.sh --run --target android
```

An iOS/TestFlight candidate requires iOS 26 and iOS 27. A Google or China
Android candidate requires the configured Android AVD. Do not block one
distribution on an unrelated platform. When multiple distributions are being
released, run each platform gate separately. Each selected target cold-launches
twice, runs sequentially, and shuts down before the next target. Receipts are
written to `.tmp/release-smoke/ios.json` or `android.json` and bound to the
Mobile source fingerprint. Release scripts select the correct target by
default; submit-only retries require the corresponding valid receipt.

Use `--check` to inspect prerequisites without building or launching. Use
`--keep-target ios26|ios27|android` only when a person needs to inspect one
target after the gate (`--keep-running` remains an Android compatibility alias). Never
replace a missing target with a different OS major and still report the gate as
passed. Startup is only the first gate: it never substitutes for candidate
functional acceptance.

## Simulator test-account fallback

Simulator cleanup may remove the saved login session. When a required manual
flow reaches the login screen, load the fixed test credentials from the ignored
local file `config/test-account.env` and log in with that account. If the file
is absent, copy `config/test-account.env.example` and ask the user to populate
it; do not invent an account or silently skip authenticated validation.

Never print the password, copy it into a receipt, commit the populated file, or
include it in screenshots or logs. This is also a real user-owned account: use
it for the requested validation only, preserve its existing Cards and settings,
and do not change membership, payment, or account state unless that exact flow
is in scope.

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

## China APK publication invariant

`android-china.sh` builds and validates a local APK; that alone is not a
publication. When the user explicitly asks to publish the China APK:

1. upload the validated artifact under its immutable versioned filename;
2. set `LF_APP_CHINA_ANDROID_LATEST_VERSION` to that APK's `versionName` and
   `LF_APP_CHINA_ANDROID_DOWNLOAD_URL` to that exact uploaded object;
3. update and deploy every public website download link that is not already
   driven by the same canonical URL;
4. query `/app/version?platform=android&distribution=china` and verify it
   returns the new independent China version and exact URL;
5. download from the returned public URL, verify it is reachable, and confirm
   the downloaded APK's versionName, versionCode, and SHA-256 match the local
   validated artifact.

Change the visible pointer only after the immutable APK upload succeeds. If
any public entry point still resolves to the previous APK, report the China
release as incomplete rather than published.

## Verification and reporting

For a release candidate, create a distribution-specific acceptance record and
fill it with observed evidence rather than expected outcomes:

```bash
node skills/linguaflow-android-release/scripts/release-acceptance.mjs init \
  --output .tmp/release-acceptance/<distribution>-<version>-<build>.json \
  --distribution ios|google-android|china-android \
  --version <version> --build <build> --runtime <runtime> \
  --baseline <previous-good-commit> --commit <source-commit> \
  --artifact <absolute-artifact-path> \
  --profile focused|affected-flow|release-core

node skills/linguaflow-android-release/scripts/release-acceptance.mjs check \
  --file <record> --stage candidate

node skills/linguaflow-android-release/scripts/release-acceptance.mjs check \
  --file <record> --stage live
```

The upload gate recomputes risk from `baselineCommit..sourceCommit`, rejects a
manually selected lower profile, and verifies the exact artifact path and
SHA-256. Uploading to TestFlight, Google internal testing, or an immutable China
URL creates a private canary; it must not require the very real-device evidence
that the canary exists to collect. Before canary upload, require the selected
platform's startup receipt, automated checks, and artifact-bound candidate
verification. After canary upload, reinstall through that delivery path and
record every risk-required flow on the targets for that distribution: iOS 26
and iOS 27 for TestFlight, or Android for either Android distribution. The
`--stage promote` gate must pass before App Store review, Google production, or
changing the public China APK pointer. A release is not live-verified until the
same record passes `live` against its real public delivery path.

Before reporting success, use the script and artifact validation output to
confirm all of the following:

- the startup smoke required by the selected distribution passed for the current source;
- the iOS, Google Android, and China Android live version/build matrix was
  checked independently;
- destination and payment provider match the matrix above;
- production API URL, package/bundle ID, distribution/update channel, version,
  and build/version code are correct;
- artifact extension and final directory match the release table;
- signature validation passed and a SHA-256 was printed;
- TestFlight upload is claimed only when the accepted `--submit-only` transfer
  actually completed;
- Google Play upload is claimed only when the accepted internal-track submit
  command completed.

For a China APK publication, additionally report the public download URL and
the matching downloaded SHA-256; never report a local China APK build as live.

For OTA, instead confirm the exact channel, runtime version, platform, manifest
update ID, and that the COS upload completed before the latest pointer changed.
Do not call a dry-run a published update, and do not claim existing binaries can
receive a custom OTA URL unless that URL was already embedded in those binaries.

Report the exact final artifact path. Do not treat a successful build as a
successful store upload.
