---
name: linguaflow-android-release
description: Build or validate LinguaFlow Android releases. Use when the user asks to build, package, validate, or upload a China Android package or Google Play package.
---

# LinguaFlow Android release

Route Android release requests by destination and use the repository scripts;
do not run a raw Expo/EAS production build.

- “国内包”, “中国包”, or a China-store build means `bash ci/cd/android-china.sh`.
  It must use distribution channel `china`, enable Alipay auto-renew, disable
  Google Play Billing, must not upload to Google Play, and must write artifacts
  under `ci/cd/artifacts/android-china/`.
- “Google 包”, “Google Play 包”, or “Play 包” means
  `bash ci/cd/android-play.sh`. It must use distribution channel `google`,
  enable Google Play Billing, disable Alipay, and normally upload to the Play
  internal track after validation. Its artifacts belong under
  `ci/cd/artifacts/android/`.
- If the user asks only to build, pass `--build-only`. If they ask only to
  inspect or validate configuration, pass `--check`.
- If the destination is genuinely absent, ask before building; never infer a
  store from unrelated conversation context.

Before reporting success, use the selected script's output to confirm target,
payment provider, package ID, version, API URL, update channel, and artifact
path. Never claim upload success from a build-only run.
