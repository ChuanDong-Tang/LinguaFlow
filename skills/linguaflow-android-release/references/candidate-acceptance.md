# Candidate acceptance and staged rollout

Native delivery is a two-phase operation. Building creates a local candidate;
uploading it to TestFlight, Google Play internal testing, or an immutable China
APK URL creates a canary. Neither action publishes a production release.

## 1. Build from committed source

The release scripts refuse dirty `apps/mobile` source. Build each platform
sequentially and retain the exact IPA, AAB, or APK. Do not rebuild after testing:
a new byte changes the SHA-256 and requires a new acceptance record.

## 2. Create an artifact-bound record

Choose the previous known-good source commit as `--baseline`; the risk classifier
uses the real Git diff from that commit to the candidate commit and may raise the
minimum validation profile. A native dependency/configuration or shared Card/app
runtime change is always `release-core` and cannot be downgraded manually.

```bash
node skills/linguaflow-android-release/scripts/release-acceptance.mjs init \
  --output .tmp/release-acceptance/<distribution>-<version>-<build>.json \
  --distribution ios|google-android|china-android \
  --version <version> --build <build> --runtime <runtime> \
  --baseline <previous-good-commit> --commit <candidate-commit> \
  --artifact <absolute-artifact-path> --profile release-core \
  --receipt .tmp/release-smoke/ios.json # use android.json for either Android distribution
```

## 3. Exercise the candidate

Run only the targets for the distribution, one at a time: iOS 26 then iOS 27
for TestFlight, or Android for either Android distribution. For `release-core`,
complete every flow on every required target:

- cold start twice and login;
- open an existing Card;
- attach an image and keep its preview;
- send a message and observe the durable result;
- generate a rewrite and observe completion;
- close and reopen the Card; verify rewrite/original alignment and layout;
- answer/reveal a cloze, close/reopen, and verify its state;
- complete one memory-game question and observe its result.

Use the ignored fixed test-account file if login is missing. Preserve existing
Cards/settings. Create only clearly identified, bounded test content; never
change membership or payment state unless that flow is explicitly in scope.

Record each observed flow with `pass-flow`. Then record the final candidate
check, which recomputes the artifact SHA:

```bash
node skills/linguaflow-android-release/scripts/release-acceptance.mjs pass-flow \
  --file <record> --flow <flow> --targets ios26,ios27 \
  --evidence '<what was observed and where>'
node skills/linguaflow-android-release/scripts/release-acceptance.mjs pass-candidate \
  --file <record> --evidence '<artifact install and complete journey evidence>'
```

## 4. Upload only to a canary path

Upload scripts require `--acceptance <record>` and recompute the artifact SHA,
distribution, source diff, and risk tier before any network mutation:

- iOS: TestFlight;
- Google Android: internal testing track only;
- China Android: immutable versioned APK URL only; do not update the public
  latest-version/API/website pointer yet.

Install from that real canary delivery path and repeat every risk-required flow
against that exact package. Record each with `pass-canary-flow`, then record its
exact installed version/build and delivery evidence with `verify-canary`.

```bash
node skills/linguaflow-android-release/scripts/release-acceptance.mjs pass-canary-flow \
  --file <record> --flow <flow> \
  --evidence '<observation from the delivered package>'
node skills/linguaflow-android-release/scripts/release-acceptance.mjs verify-canary \
  --file <record> --source '<TestFlight/internal/immutable URL>' \
  --external '<build id or URL>' --evidence '<installed version/build evidence>'
node skills/linguaflow-android-release/scripts/release-acceptance.mjs check \
  --file <record> --stage promote
```

## 5. Promote, then verify the public path

`release-acceptance.mjs check --stage promote` must pass before App Store/Google
production promotion or changing the China latest APK pointer. After the public
path is live, install from that path and make the record pass `--stage live`.
For China, the endpoint URL, downloaded APK version/build, and SHA-256 must all
match the accepted artifact.

Any source edit, rebuild, new artifact SHA, or failed canary invalidates the
promotion. Return to candidate validation instead of editing the record around
the failure.
