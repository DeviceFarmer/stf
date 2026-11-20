# Personal Team WDA signer

`sign.py` builds the pinned official Appium WebDriverAgent source with the existing
Xcode account and Keychain. It produces a private app, deterministic ZIP and
version-1 manifest for the separate renewal worker. Run it on the Mac with Xcode;
no signing keys leave Keychain.

Prepare a private source checkout outside this repository. WDA v16.15.0 is pinned
to `e7e2665a00633dc174d7fc579f7e606bc9ba782a`. Fetch that commit from
`https://github.com/appium/WebDriverAgent.git`, check it out detached, and keep the
checkout clean. `projectPath` must name its `WebDriverAgent.xcodeproj`. Production
source, configuration, state and artifacts must live in durable private storage;
a temporary proof directory is unsuitable for subsequent manual renewals.

Create a regular, current-user-owned configuration file with mode `0600`. Paths
must be absolute and contain no symlinks or `..`. Configure these fields privately:

| Field | Value |
| --- | --- |
| `projectPath` | Pinned source's `WebDriverAgent.xcodeproj` |
| `teamId` | Existing Personal Team identifier |
| `bundleId` | Exact installed runner ID, including `.xctrunner` |
| `deviceUDIDs` | All intended iPhones, with no duplicate IDs |
| `stateDirectory` | Dedicated private build/log directory, outside Git, mode `0700` |
| `artifactDirectory` | Separate private artifact directory, outside Git, mode `0700` |
| `previousProfilePath` | A private `0600` CMS copy of the previously accepted profile |
| `previousExpiresAt` | Its exact UTC expiry in ISO-8601 format |
| `minValidityHours` | Optional integer, defaults to `48`, cannot be below `48` |
| `buildTimeoutSeconds` | Optional integer, defaults to `900`, range `60`–`3600` |

The previous profile and expiry form the renewal baseline and must agree. Keep
that baseline aligned with the latest accepted renewal before subsequent cycles.
Copy the CMS into private state; do not use an Xcode-cache file as the baseline.

```sh
python3 tools/wda-renewal/sign.py --config /secure/private/signer.json
```

The command uses `build-for-testing`, `generic/platform=iOS`, automatic signing
and `-allowProvisioningUpdates`. Host compiler include/library paths are removed
from the build environment. Xcode selects its existing development identity;
after signing, the leaf certificate must match the one from the previous profile
that is present in the local valid identity inventory. A certificate change blocks
the result.

If Xcode reuses a profile with insufficient lifetime, the signer makes one refresh
attempt with clean DerivedData. With no other `xcodebuild` process active, it backs
up and temporarily removes only cache files whose UUID, Team and exact bundle ID
match the stale embedded profile. The private baseline, other profiles and Apple
portal records are preserved. Every moved file has a private path/SHA/mode audit;
a failed refresh restores its original bytes and permissions. Successful refresh
keeps the newly issued profile and retains the private backup for diagnosis.

Before publishing a manifest the signer checks:

- Personal Team `LocalProvision=true`, exact Team and bundle ID, development
  entitlements and inclusion of every configured UDID.
- Expiry at least 48 hours ahead (or the configured longer interval), and at least
  one day later than the previous expiry.
- `codesign --verify --deep --strict`, each nested runtime Mach-O signature,
  matching signed entitlements and a signing certificate valid through the profile
  expiry. Mach-O dSYM companions contain debug data and remain sealed resources.
- A fixed archive root `WebDriverAgentRunner-Runner.app`, no symlinks, traversal or
  special files. ZIP entries are sorted, timestamps are fixed and Unix executable
  bits and every bundle file are preserved.

On success stdout contains `status=signed`, `manifestPath` and the new expiry.
The `0600` manifest contains `version`, `bundleId`, `profileUUID`, `createdAt`,
`expiresAt`, `deviceUDIDs`, `appPath`, `archivePath`, `archiveSha256` and `sourceSHA`.
Identifiers and full build/signing output stay in private files. On failure stdout
contains a fixed reason code and, when available, `logPath`; exit status is nonzero.

DerivedData is removed in `finally` on success and failure. Private attempt logs
and profile-cache backups retain the latest 20 attempts, excluding the active run.
Signed artifacts are retained by the one-shot renewal command; this signer does
not prune them. Apple account authentication or signing failures remain blocked
for operator review.

Offline verification uses only Python's standard library:

```sh
python3 -B tools/wda-renewal/test_sign.py
```
