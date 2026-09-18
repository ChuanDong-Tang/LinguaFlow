# Self-hosted Expo OTA workflow

## Architecture

Expo OTA is the update protocol and client runtime. COS is only the selected
object store for the exported JavaScript bundle, fonts, and images; it is not a
requirement of OTA and could be replaced by OSS, S3, or another HTTP object
store. OIO uses this split:

1. The app requests `https://api.yueyantech.com/updates/manifest`.
2. The API selects a manifest by distribution channel, `runtimeVersion`, and platform.
3. The manifest points to content-addressed files on a domestic COS/CDN domain.
4. `expo-updates` downloads, verifies, caches, and loads the compatible update.

Keep the API response small. Do not proxy multi-megabyte bundles and assets
through the business API unless COS/CDN is unavailable and the user explicitly
chooses that tradeoff.

## Compatibility gate

Before choosing OTA, inspect the proposed changes. Use a native package instead
when changes touch native dependencies, Expo SDK/plugins, permissions,
entitlements, native folders, the update URL, the code-signing certificate, or
other build-time configuration. Bump `runtimeVersion` whenever the required
native runtime changes.

The move from Expo-hosted updates to OIO's custom update URL itself requires one
new installation package. Binaries still pointing to `u.expo.dev` cannot be
redirected by publishing to the custom service.

## Stable client URL and server-side control

Treat the URL embedded in `updates.url` as a stable bootstrap endpoint, not as
the current COS location. Production clients should keep requesting
`https://api.yueyantech.com/updates/manifest`; the API controls the selected
manifest, channel, pause, and rollback, while each manifest controls the
COS/CDN asset URLs.

- OTA is disabled by default. Set `LF_EXPO_UPDATES_ENABLED=true` on the API only
  after its COS configuration and manifests are ready. Set it back to `false`
  to return no update without a client release.
- Change COS/CDN settings and republish the manifest to move assets without a
  client release. Signed manifests must be republished by the trusted publisher
  because changing an asset URL changes the signed body.
- Move the API origin using DNS or the reverse proxy behind the stable hostname,
  without changing the client.
- Use the build-time `EXPO_UPDATES_URL` override only when intentionally making
  a binary for another environment.

Do not fetch an arbitrary update URL from remote config and call
`setUpdateURLAndRequestHeadersOverride` in a production build. Expo currently
requires disabling anti-bricking measures for this mechanism and recommends it
only for preview builds. Losing automatic recovery is not worth avoiding one
stable bootstrap hostname.

## Storage and deployment configuration

Prefer an OTA-only COS bucket so making update assets publicly downloadable does
not expose card images or audio. API and publisher accept:

- `LF_EXPO_UPDATES_COS_SECRET_ID`
- `LF_EXPO_UPDATES_COS_SECRET_KEY`
- `LF_EXPO_UPDATES_COS_BUCKET`
- `LF_EXPO_UPDATES_COS_REGION`
- `LF_EXPO_UPDATES_STORAGE_PREFIX` (optional, default `expo-updates`)
- `LF_EXPO_UPDATES_ENABLED` (optional, default `false`; set `true` to enable OTA)

If OTA-specific values are absent, the implementation falls back to the
existing `TENCENT_COS_*` or `COS_*` values. Do this only after confirming the
existing bucket's access policy is safe.

The publisher additionally needs `LF_EXPO_UPDATES_PUBLIC_BASE_URL`, which must
be a domestic HTTPS COS custom domain or CDN address that permits clients to GET
the update objects. Never put COS credentials in the mobile app.

### LinguaFlow production credential source

The production SSH alias `oio-main` provides `/opt/oio-production/.env`. When
the Mac does not have OTA COS credentials, use the Skill helper instead of
copying secrets into a local `.env`:

```bash
node skills/linguaflow-android-release/scripts/publish-ota-via-oio-main.mjs \
  --channel production --platform ios --dry-run
node skills/linguaflow-android-release/scripts/publish-ota-via-oio-main.mjs \
  --channel production --platform ios
```

The helper captures the existing server-side COS secret ID and key over SSH,
injects them only into the child publisher process, and never prints or stores
them locally. It deliberately targets the public download bucket
`oio-download-1422482413` in `ap-shanghai`, served by
`https://download.yueyantech.com`, with the `expo-updates` prefix. Override the
SSH alias only when necessary with `LF_OTA_SSH_HOST`; do not weaken the target
channel/platform allowlist or echo the captured credentials while debugging.

This helper does not grant permission to publish. Keep the normal explicit-user
authorization requirement, run `--dry-run` first, and publish production
channels separately.

For end-to-end signing, build with
`EXPO_UPDATES_CODE_SIGNING_CERTIFICATE=./certs/certificate.pem` and publish with
`LF_EXPO_UPDATES_PRIVATE_KEY_PATH` pointing to the corresponding private key.
Keep the private key outside Git and off the API server.

## Commands

Always begin with a dry-run for the intended channel and platform:

```bash
npm --prefix apps/mobile run publish:update -- --channel preview --platform ios --dry-run
npm --prefix apps/mobile run publish:update -- --channel production --platform ios --dry-run
npm --prefix apps/mobile run publish:update -- --channel production-google --platform android --dry-run
npm --prefix apps/mobile run publish:update -- --channel production-china --platform android --dry-run
```

Publishing is an external mutation. Run one of these only when the user
explicitly asks to publish/deploy the OTA:

```bash
npm --prefix apps/mobile run publish:update -- --channel preview --platform ios
npm --prefix apps/mobile run publish:update -- --channel production --platform ios
npm --prefix apps/mobile run publish:update -- --channel production-google --platform android
npm --prefix apps/mobile run publish:update -- --channel production-china --platform android
```

Never use `--platform all` for production. The iOS, Google Android, and China
Android exports compile different payment-provider flags, so each target must
be exported and published separately. Existing binaries only receive their
embedded channel: `production`, `production-google`, or `production-china`.

The publisher exports with the matching build profile, uploads content-addressed
assets, stores an immutable release manifest, and changes the channel's latest
pointer last. If publishing fails before the pointer write, do not report the
update as live.

## Validation and reporting

Before publishing, confirm that the exported Expo config contains:

- the intended custom update URL;
- the intended `preview`, `production`, `production-google`, or
  `production-china` channel;
- the runtime version already supported by the target installed binary;
- the intended production API URL for a production update.

After publishing, report the exact channel, runtime version, platform, and
manifest update ID printed by the script. Validate on a preview installation
before production when practical. A dry-run validates export and manifest
construction but does not upload anything.
