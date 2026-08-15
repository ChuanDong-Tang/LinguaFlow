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
