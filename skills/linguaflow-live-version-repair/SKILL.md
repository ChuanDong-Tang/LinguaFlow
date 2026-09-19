---
name: linguaflow-live-version-repair
description: Repair a problem affecting a currently released LinguaFlow app version from evidence and exact-version reproduction through the correct backend, targeted-data, OTA, or native-release path. Use for live-version bugs, regressions, emergency fixes, or reports that production users still see an issue; ordinary unreleased feature work and diagnosis-only requests use narrower Skills.
---

# LinguaFlow live version repair

Own the repair from the reported production symptom to a verified outcome, but
keep implementation, deployment, OTA publication, and store submission as
separate authorization boundaries.

Read [references/repair-lanes.md](references/repair-lanes.md) when selecting a
repair path or when more than one released version, platform, runtime, or OTA
channel may be affected.

Use the repair record harness for every production repair that proceeds beyond
diagnosis. It converts user feedback into a durable incident record and blocks
rollout or closure while required evidence is missing:

```bash
node skills/linguaflow-live-version-repair/scripts/repair-record.mjs init \
  --output .tmp/live-repairs/<id>.json \
  --scope ios|google-android|china-android|backend|cross-platform \
  --symptom "<user-visible symptom>" \
  --expected "<expected behavior>"

node skills/linguaflow-live-version-repair/scripts/repair-record.mjs check \
  --file .tmp/live-repairs/<id>.json --stage rollout

node skills/linguaflow-live-version-repair/scripts/repair-record.mjs check \
  --file .tmp/live-repairs/<id>.json --stage close
```

The record lives under ignored `.tmp/`; it may contain operational identifiers
but must not contain passwords, tokens, private keys, or unnecessary user
content. `rollout` is a readiness check, not authorization: obtain explicit
user approval before the external mutation and record it truthfully.

## Establish the affected release

Start with the read-only production incident snapshot:

```bash
bash skills/linguaflow-production-incident/scripts/incident-snapshot.sh
```

Create a compact repair record containing:

- user-visible symptom and the expected behavior;
- platform and distribution: iOS, Google Android, or China Android;
- app version, native build/version code, runtime version, and OTA channel;
- whether the problem reproduces after a cold start and with the latest OTA;
- affected account or object identifiers, timestamps, and provider IDs when
  relevant;
- current backend commit and the smallest known affected population.

Do not diagnose from the marketing version alone. Two users on the same app
version may have different native builds, OTA manifests, cached state, account
data, or provider state.

Keep iOS, Google Android, and China Android version/build/runtime facts in
separate rows. They commonly advance at different times. Never substitute the
iOS version for an unknown Android version, or the Google Android state for the
China APK state.

## Protect the released baseline

Before editing, identify the exact code and configuration represented by the
affected installed binary and its currently selected OTA manifest. Do not build
an emergency fix from an arbitrary dirty `main` checkout or publish all pending
Mobile changes merely because the intended fix is among them.

Preserve unrelated local changes. When the working tree contains unreleased
work, isolate the repair with explicit paths or a clean worktree/branch based on
the correct release state. An OTA export must contain the released baseline
plus the intended compatible fix, not a convenient snapshot of current work.

## Make every OTA fix permanent in source

Treat OTA as delivery, never as the source of truth. Implement and test the fix
in tracked Mobile source first. Production OTA publication must use a committed
Mobile tree and record its source commit. Never patch an exported bundle,
generated native directory, manifest, COS object, or publisher script output to
create a one-off repair.

If the repair is developed from an older release branch or worktree, preserve
the minimal hotfix there and forward-port the same fix and regression test to
the active development branch. Record both commits when they differ. Do not
close the repair until the active branch contains the fix, so the next native
package embeds it even when no OTA is loaded.

Before the next native build, compare production OTA source commits since the
previous package with the build source. Every still-required OTA fix must be an
ancestor of the build commit or have an explicitly verified equivalent change.
An OTA that works online while the next package regresses is an incomplete
repair.

List the supported live populations before choosing a fix. Include older
clients that still call the production API. Backend and schema fixes must remain
compatible with them unless the product explicitly blocks those versions.

## Select one repair lane

Choose the least invasive lane that fixes the actual failing layer:

1. **Backend/configuration/provider:** preserve client contracts, validate the
   relevant API and Worker paths, then use the backend deployment Skill.
2. **Targeted production data:** prove the exact rows and expected state, use
   the production database or subscription Skill, and verify the user-visible
   result. Do not turn one repair into a historical backfill.
3. **OTA:** only JavaScript or bundled-asset changes with a compatible native
   runtime. Use the app release Skill's OTA workflow and publish each production
   platform/channel separately.
4. **Native release:** native dependency, Expo plugin, permission, entitlement,
   signing, update bootstrap, startup crash, or incompatible runtime change.
   Increment the native build/version as required and use the app release Skill.

For a China APK repair, distinguish local artifact creation from publication.
The repair is not live until the production China App-version endpoint and all
public download entry points resolve to the newly validated APK, and a fresh
download matches its versionName, versionCode, and SHA-256.

Do not combine lanes merely for convenience. If a safe server-side mitigation
can stop harm while a native fix is reviewed, describe the mitigation and the
permanent fix separately.

## Implement and validate

Trace the current behavior and use the feature-delivery Skill for the code
change. Add a regression test for the demonstrated failure when deterministic.
Validate the failure first when practical, then validate the same scenario
after the fix.

For client fixes, test the exact affected release family and the intended
delivery mechanism. Native release candidates must pass the repository's iOS
26, iOS 27, and Android startup gate. OTA fixes must prove that the target
installed binary accepts the intended runtime/channel update and that unrelated
production channels remain unchanged.

For backend or data repairs, verify persisted state and the actual client-visible
outcome; HTTP 200, a running PM2 process, or a completed job alone is not enough.

## Roll out deliberately

A request to fix code does not authorize push, backend deployment, database
mutation, OTA publication, or store submission. Before any authorized rollout,
state the exact target, artifact or commit, affected population, verification
plan, and available stop/rollback action.

After rollout, recheck the original reproduction and inspect nearby errors or
failed jobs for the bounded affected window. Do not declare the incident fixed
until the real target environment reflects the intended behavior. If only part
of the installed population can receive the repair, report that limitation and
the remaining path explicitly.

## Handoff

Report these states separately:

- root cause and affected release population;
- repair lane and why it is compatible;
- local implementation and validation;
- commit and push state;
- backend/database rollout state;
- OTA channel/update ID or native artifact/store state;
- real-environment verification and anything still exposed.

Do not call the repair complete unless the record passes `--stage close`.
