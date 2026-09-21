# App Store API review submission

Use this workflow only after the exact IPA has been uploaded to TestFlight and
the user separately asks to submit that version for App Review. Submission and
public release are different mutations.

## Read-only preflight

```bash
node skills/linguaflow-android-release/scripts/ios-app-store-submit.mjs \
  --check --version <version> --build <build>
```

The check authenticates with the ignored `config/ios-testflight.env`, resolves
the app by bundle ID, and requires exactly one non-expired `VALID` build. It
reports whether the App Store version exists, its state and release type, its
bound build, localization count, and App Review detail status.

## Submit for review

```bash
node skills/linguaflow-android-release/scripts/ios-app-store-submit.mjs \
  --submit --version <version> --build <build> \
  --acceptance .tmp/release-acceptance/ios-<version>-<build>.json \
  --release-type manual \
  --whats-new 'zh-Hans=<approved text>' \
  --whats-new 'ja=<approved text>' --yes
```

Submit mode requires an artifact-bound iOS record that passes the candidate
gate. With explicit user authorization it may submit before full TestFlight
canary acceptance when the script forces and verifies manual release.
It creates the App Store version if needed, binds the exact build, creates or
reuses one review submission, adds the version, and marks the submission as
submitted. Apple rejects incomplete metadata; report the returned missing
fields and stop instead of inventing public copy, reviewer credentials, privacy
answers, export-compliance answers, or content-rights declarations.
The script refuses to continue while any localization lacks What's New text;
pass reviewed copy with one `--whats-new <locale>=<text>` argument per locale.

Default to `--release-type manual`. Use `--release-type automatic` only when the
user explicitly asks for approval to publish immediately, and add
`--accept-auto-release-risk`. Automatic release normally requires the standard
`promote` gate; bypassing that gate is a release-risk decision that must come
from the user in the active request, never from a prior preference or an agent
assumption.

The workflow is idempotent for a version already waiting for review, in review,
or awaiting manual release. It must fail on an ambiguous build, an expired or
still-processing build, multiple open submissions, or a submitted version bound
to a different build.

Do not interpret App Review approval as authorization to publish. A later
public-release request still requires the normal `promote` acceptance gate and
must use Apple's explicit version-release operation.
