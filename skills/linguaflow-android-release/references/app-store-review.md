# App Store API review submission

Use this workflow only after the exact IPA has been uploaded to TestFlight and
the user separately asks to submit that version for App Review. Submission and
public release are different mutations.

## Version check before building

```bash
node skills/linguaflow-android-release/scripts/ios-app-store-submit.mjs \
  --check-version --version <proposed-version>
```

Run this before simulator work or a native build. It queries App Store Connect,
which is the authority for version trains; the public App Store product page
may lag and must not be used to choose a version. A new version must be higher
than the highest App Store Connect version. An existing version is reusable
only while it remains `PREPARE_FOR_SUBMISSION`.

## Read-only preflight

```bash
node skills/linguaflow-android-release/scripts/ios-app-store-submit.mjs \
  --check --version <version> --build <build>
```

The check authenticates with the ignored `config/ios-testflight.env`, resolves
the app by bundle ID, and requires exactly one non-expired `VALID` build. It
reports whether the App Store version exists, its state and release type, its
bound build, localization count, and App Review detail status.

Immediately after an upload, App Store Connect may not return the build yet or
may report it as processing. Repeat this read-only check until the exact build
is present and `VALID`; do not upload another build merely because processing
is not instantaneous.

## Prepare version and inspect metadata

```bash
node skills/linguaflow-android-release/scripts/ios-app-store-submit.mjs \
  --prepare --version <version> --build <build> \
  --acceptance .tmp/release-acceptance/ios-<version>-<build>.json \
  --release-type automatic --accept-auto-release-risk --yes
```

Prepare mode creates or reuses the App Store version, sets its release type,
binds the exact `VALID` build, and prints the actual localization and review
metadata without submitting for review. Use the returned locale list for the
subsequent What's New arguments; never hard-code locales from an older version.

## Submit for review

```bash
node skills/linguaflow-android-release/scripts/ios-app-store-submit.mjs \
  --submit --version <version> --build <build> \
  --acceptance .tmp/release-acceptance/ios-<version>-<build>.json \
  --release-type automatic --accept-auto-release-risk \
  --whats-new 'zh-Hans=<approved text>' \
  --whats-new 'ja=<approved text>' --yes
```

Submit mode requires an artifact-bound iOS record that passes the candidate
gate. Version 1.1.8 is the one-off manual-release exception. Later versions use
the project owner's standing automatic-release policy, so complete the normal
promotion evidence before submission unless the owner explicitly accepts the
remaining release risk for that candidate.
It creates the App Store version if needed, binds the exact build, creates or
reuses one review submission, adds the version, and marks the submission as
submitted. Apple rejects incomplete metadata; report the returned missing
fields and stop instead of inventing public copy, reviewer credentials, privacy
answers, export-compliance answers, or content-rights declarations.
The script refuses to continue while any localization lacks What's New text;
pass reviewed copy with one `--whats-new <locale>=<text>` argument per locale.

For versions after 1.1.8, default to the project owner's standing policy:
`--release-type automatic --accept-auto-release-risk`. The explicit risk flag
keeps the consequential setting visible in logs and prevents an accidental
implicit default. Version 1.1.8 remains `MANUAL`. Automatic release normally
requires the standard `promote` gate; bypassing that gate still requires an
explicit decision for the particular candidate and is not implied by the
standing automatic-release policy.

The workflow is idempotent for a version already waiting for review, in review,
or awaiting manual release. It must fail on an ambiguous build, an expired or
still-processing build, multiple open submissions, or a submitted version bound
to a different build.

If the version is already submitted with manual release and the user then
explicitly requests automatic publication, rerun `--submit` for the same exact
version/build with `--release-type automatic --accept-auto-release-risk`. The
idempotent path updates the version to `AFTER_APPROVAL` without creating a new
review submission.

For the 1.1.8 manual exception, do not interpret App Review approval as
authorization to publish: a later public-release request still requires the
normal `promote` acceptance gate and Apple's explicit version-release
operation. For later automatic releases, approval itself can publish the app;
therefore finish the `promote` gate before submitting unless the owner
explicitly accepts that candidate's remaining risk.
