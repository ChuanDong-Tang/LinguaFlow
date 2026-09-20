# Local release workflows

Release logic and example configuration are colocated with the
`linguaflow-app-release` Skill in the existing
`skills/linguaflow-android-release/` directory. Skill instructions, scripts,
and `*.env.example` files are versioned; populated `*.env` files remain local
and ignored. `ci/cd/` is output-only: all generated packages go below
`ci/cd/artifacts/`, and no scripts or configuration belong there.

## iOS TestFlight

Before the first run on a Mac, copy
`skills/linguaflow-android-release/config/ios-testflight.env.example` to
`skills/linguaflow-android-release/config/ios-testflight.env` and fill in the
machine-specific values.

## Candidate build

```bash
bash skills/linguaflow-android-release/scripts/ios-testflight.sh
```

The workflow performs these steps:

1. Checks macOS, Xcode, signing identity, `.env`, and the EAS production profile.
2. Builds and cold-launches the same source twice on iOS 26, iOS 27, and the
   configured Android emulator.
3. Runs a complete local EAS production build and allocates the next build number.
4. Opens the generated IPA and verifies its bundle ID, production update channel,
   production API URL, signing team, version, and build number.
5. Stops with a retained local candidate. Upload is a separate, acceptance-gated
   operation.

## Useful modes

```bash
# Check the local machine and configuration only.
bash skills/linguaflow-android-release/scripts/ios-testflight.sh --check

# Build and validate without uploading.
bash skills/linguaflow-android-release/scripts/ios-testflight.sh --build-only

# Skip the confirmation prompt (useful when Codex runs it).
bash skills/linguaflow-android-release/scripts/ios-testflight.sh --yes

# Upload an already accepted IPA without rebuilding or allocating a build number.
bash skills/linguaflow-android-release/scripts/ios-testflight.sh \
  --submit-only ci/cd/artifacts/ios/OIO-1.1.3-147.ipa \
  --acceptance .tmp/release-acceptance/ios-1.1.3-147.json
```

TestFlight installations always use Apple's Sandbox environment for in-app
purchases. This is independent of the app's production API and Expo Updates
channel, both of which are validated by this workflow.

The iOS marketing version and Apple build number describe iOS only. Do not use
them as the expected Android versionName or versionCode, and do not update an
Android latest-version setting merely because iOS advanced.

## Android Google Play and China APK

Before the first run, copy
`skills/linguaflow-android-release/config/android-play.env.example` to
`skills/linguaflow-android-release/config/android-play.env`. Running the Google
script builds a signed Android App Bundle and stops locally. Upload is a second
step and may target only the Google Play internal testing track. Automated
submission requires a Google Service Account key configured in EAS credentials
and an artifact-bound acceptance record.

```bash
# Build and validate a local Google candidate.
bash skills/linguaflow-android-release/scripts/android-play.sh

# Check local configuration only.
bash skills/linguaflow-android-release/scripts/android-play.sh --check

# Build and validate without uploading.
bash skills/linguaflow-android-release/scripts/android-play.sh --build-only

# Skip the confirmation prompt.
bash skills/linguaflow-android-release/scripts/android-play.sh --yes

# Upload the accepted exact AAB to internal testing.
bash skills/linguaflow-android-release/scripts/android-play.sh \
  --submit-direct ci/cd/artifacts/android/OIO-1.1.6-160.aab \
  --acceptance .tmp/release-acceptance/google-android-1.1.6-160.json
```

The Android workflow validates the package ID, version name/code, release
signature, production Expo Updates channel, and embedded production API URL
before upload. The same three-platform startup receipt is mandatory; it is
reused only while the Mobile source fingerprint remains unchanged.

Run the startup gate directly when troubleshooting it:

```bash
# Verify required runtimes and AVD only.
bash skills/linguaflow-android-release/scripts/simulator-smoke.sh --check

# Build and cold-launch all three targets. Leave them open for visual review.
bash skills/linguaflow-android-release/scripts/simulator-smoke.sh --run --keep-target android
```

Payment selection is enforced by the workflow and does not depend on leftover
values in `apps/mobile/.env`:

- `ios-testflight.sh` enables Apple auto-renew and disables Google Play and
  Alipay auto-renew.
- `android-play.sh` builds the Google distribution with Google Play Billing
  enabled and Alipay plus Apple purchase paths disabled.
- `android-china.sh` builds the China distribution with Alipay monthly renewal
  and one-time annual passes enabled and
  Google Play Billing plus Apple purchase paths disabled. It produces a
  validated, signed APK for direct website distribution and never uploads to
  Google Play. China artifacts are written to
  `ci/cd/artifacts/android-china/`; Google Play artifacts remain in
  `ci/cd/artifacts/android/`.

```bash
# China-store build: Alipay, build and validate only.
bash skills/linguaflow-android-release/scripts/android-china.sh

# China-store preflight only.
bash skills/linguaflow-android-release/scripts/android-china.sh --check
```

Do not invoke the underlying Expo/EAS Android production build directly for a
release. Use one of these target-specific scripts so the payment provider and
distribution channel cannot drift apart.

### Publishing the China APK

The China script stops after producing and validating a local artifact. If the
user asks to publish it, first complete candidate acceptance, then upload the
exact APK as an immutable canary with
`upload-china-apk.mjs <apk> --acceptance <record>`. Install from that URL and
make the record pass the `promote` stage. Only then update the
production App-version policy and all public download entry points to that
exact object. The authoritative production settings are:

```text
LF_APP_CHINA_ANDROID_LATEST_VERSION=<APK versionName>
LF_APP_CHINA_ANDROID_DOWNLOAD_URL=<exact public versioned APK URL>
```

Do not reuse the iOS or Google Android version for either value. After the API
configuration and website are deployed, query the China Android App-version
endpoint, download its returned URL, and validate the downloaded APK against
the local artifact. Publication is incomplete while the endpoint or any public
website link still points to an older APK.
