# Live repair lanes

Use this table after the affected version, build, runtime, channel, and backend
state are known.

| Evidence | Preferred lane | Required proof before rollout | Typical stop or rollback |
| --- | --- | --- | --- |
| All app versions fail against the same endpoint after a backend rollout | Backend | Contract compatibility, focused tests, exact deploy commit | Redeploy last known-good commit or disable the new server path |
| One account/order/card has incorrect persisted state | Targeted data | Exact identifier, expected current state, affected-row count, audit trail | Abort on assertion mismatch; restore from captured prior values when authorized |
| UI/business logic bug in JS, native runtime unchanged | OTA | Exact baseline diff, runtime/channel match, installed released binary accepts update | Pause or repoint that channel to a known-good compatible manifest |
| Startup crash, native SDK/plugin/permission/signing issue | Native release | Release build passes iOS 26, iOS 27, and Android startup gate as applicable | Stop submission/phased rollout; keep previous store build available |
| Payment entitlement differs from Apple, Google, or Alipay | Provider reconciliation or targeted repair | Provider truth, local transaction history, ownership/transfer audit, idempotent repair | Stop before mutation on identity ambiguity; never fabricate provider state |
| Only one platform or distribution is affected | Matching platform lane only | Other production channels were not exported, published, or reconfigured | Roll back or pause only the affected channel |

Do not put iOS, Google Android, and China Android under one ambiguous "current
version" field. Record their live user version, native build, runtime, OTA
channel, and rollout/download state independently.

For China Android, a local APK is only an artifact. Publication requires the
immutable APK upload, the China-specific backend version and URL, any static
website download links, and a public re-download check to agree on that exact
artifact.

## OTA baseline rule

An OTA is not “whatever JavaScript is currently local.” It is a new bundle for
a specific installed native runtime. Compare the export against the affected
release baseline and list every included user-visible change. If unrelated
unreleased features cannot be separated confidently, make an isolated repair
branch/worktree or choose a new native release instead of publishing a mixed
hotfix.

For LinguaFlow production, keep channels separate:

- iOS: `production`
- Google Android: `production-google`
- China Android: `production-china`

Never use `--platform all` for a production repair. Payment flags and compiled
native capabilities differ by distribution.

The production publisher rejects an uncommitted `apps/mobile` tree and records
the Git source commit in the manifest. This prevents an exported-only repair,
but it does not prove that a release-branch fix reached the active branch; the
repair handoff must record and verify that forward-port explicitly.

## Compatibility questions

Before closing the repair, answer:

1. Which installed builds can receive it?
2. Which users remain on an older runtime or channel?
3. Does the backend still understand requests from those users?
4. Can stale caches, delayed jobs, retries, or provider notifications recreate
   the bad state?
5. What observable evidence shows the original user flow now succeeds?
