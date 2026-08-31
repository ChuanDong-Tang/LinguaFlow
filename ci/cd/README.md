# Local iOS TestFlight workflow

The release workflow and documentation in this directory are versioned. Local
credentials/configuration and generated IPA artifacts remain ignored by Git.

Before the first run on a Mac, copy `ios-testflight.env.example` to
`ios-testflight.env` and fill in the machine-specific values. Do not commit the
resulting `ios-testflight.env` file.

## Normal release

```bash
bash ci/cd/ios-testflight.sh
```

The workflow performs these steps:

1. Checks macOS, Xcode, signing identity, `.env`, and the EAS production profile.
2. Runs a complete local EAS production build and allocates the next build number.
3. Opens the generated IPA and verifies its bundle ID, production update channel,
   production API URL, signing team, version, and build number.
4. Uploads only a validated IPA to App Store Connect and waits for Apple to accept it.

## Useful modes

```bash
# Check the local machine and configuration only.
bash ci/cd/ios-testflight.sh --check

# Build and validate without uploading.
bash ci/cd/ios-testflight.sh --build-only

# Skip the confirmation prompt (useful when Codex runs it).
bash ci/cd/ios-testflight.sh --yes
```

TestFlight installations always use Apple's Sandbox environment for in-app
purchases. This is independent of the app's production API and Expo Updates
channel, both of which are validated by this workflow.

# Local Android Google Play workflow

Before the first run, copy `android-play.env.example` to `android-play.env`.
The default workflow builds a signed Android App Bundle and submits it to the
Google Play internal testing track, not directly to production. Automated
submission requires a Google Service Account key configured in EAS credentials.

```bash
# Build, validate, and submit to Google Play internal testing.
bash ci/cd/android-play.sh

# Check local configuration only.
bash ci/cd/android-play.sh --check

# Build and validate without uploading.
bash ci/cd/android-play.sh --build-only

# Skip the confirmation prompt.
bash ci/cd/android-play.sh --yes
```

The Android workflow validates the package ID, version name/code, release
signature, production Expo Updates channel, and embedded production API URL
before upload.

Payment selection is enforced by the workflow and does not depend on leftover
values in `apps/mobile/.env`:

- `android-play.sh` builds the Google distribution with Google Play Billing
  enabled and Alipay disabled.
- `android-china.sh` builds the China distribution with Alipay enabled and
  Google Play Billing disabled. It only produces a validated AAB and never
  uploads to Google Play. China artifacts are written to
  `ci/cd/artifacts/android-china/`; Google Play artifacts remain in
  `ci/cd/artifacts/android/`.

```bash
# China-store build: Alipay, build and validate only.
bash ci/cd/android-china.sh

# China-store preflight only.
bash ci/cd/android-china.sh --check
```

Do not invoke the underlying Expo/EAS Android production build directly for a
release. Use one of these target-specific scripts so the payment provider and
distribution channel cannot drift apart.
