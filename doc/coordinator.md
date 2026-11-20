# STF coordinator

`stf coordinator` schedules renewable iOS and Android device leases for external
Appium clients. It reserves devices through STF, links each lease to a WebDriver
session and verifies cleanup before making the device available again. Test code
and reports stay with the client.

## Start the coordinator

Run one coordinator per device and port pool. Use matching STF API, processor,
and provider builds that support [automation leases](API.md#automation-leases).
Use an STF access token from a dedicated service account that can see the
devices it should schedule. Authorize its exact STF email on each STF API
replica with `stf api --automation-lease-accounts` or
`STF_API_AUTOMATION_LEASE_ACCOUNTS`. The value is a comma-separated list of
service account emails. An empty list disables managed capture and renewal.

Appium requires a reachable Grid with slots for the devices you want to use.
Android slots must advertise the provider pool's `appium:remoteAdbHost` and,
when one host serves multiple ADB ports, `appium:adbPort`. iOS slots must
advertise the device's `appium:udid` and `appium:platformVersion`. Configure the
iOS Appium node's `appium:webDriverAgentUrl` to reach the existing WDA forward
or an adapter for that WDA session. The [iOS runtime](ios-provider.md) pauses
its WDA health probes during a coordinator lease and restores its session on
release.

Keep the token files, ADB pool configuration and persistent state outside the
checkout. The example prepares an operator token for local testing.

```sh
umask 077
COORDINATOR_DIR=$(mktemp -d)
mkdir "$COORDINATOR_DIR/state"
install -m 600 /secure/stf-access-token "$COORDINATOR_DIR/stf-token"
openssl rand -hex 32 > "$COORDINATOR_DIR/operator-token"
```

Save your pool mapping as `adb-pools.json` in that directory. Use the provider
name from STF inventory and a reachable ADB host. Reserve the Appium system
ports for this coordinator and keep them disjoint from other consumers on the
same host.

```json
[
  {
    "provider": "android-provider",
    "host": "adb.example.test",
    "port": 5037,
    "systemPorts": [8200, 8201]
  }
]
```

Use `[]` for an iOS-only setup.

```sh
stf coordinator \
  --stf-api-url https://stf.example.test/api/v1 \
  --appium-grid-url https://grid.example.test \
  --stf-token-file "$COORDINATOR_DIR/stf-token" \
  --api-token-file "$COORDINATOR_DIR/operator-token" \
  --adb-pools-file "$COORDINATOR_DIR/adb-pools.json" \
  --state-file "$COORDINATOR_DIR/state/coordinator.json"
```

Leave the process running and check readiness from another terminal.

```sh
curl --fail http://127.0.0.1:8080/readyz
```

The default listen address and public URL are `127.0.0.1:8080` and
`http://127.0.0.1:8080`. Set `--public-url` to the base URL clients use for
Appium and use TLS for remote access. Every CLI option also accepts an
`STF_COORDINATOR_` environment variable. See `stf coordinator --help` for the
full list.

For Kubernetes, the [Helm chart](../kubernetes/helm/README.md#appium-coordinator)
can deploy this process with an existing credentials Secret, a persistent claim
and an external Grid. It is opt-in and renders one replica with `Recreate`.
Use matching STF API, processor, provider and coordinator images. The chart's
default STF 3.9.0 image predates the coordinator. Give each coordinator an exclusive device and system-port pool and its own
state file. `Recreate` runs one replica at a time during a normal rollout.

## Credentials

The STF token stays with the coordinator. For shared use, pass
`--project-tokens-file` with a private JSON document containing `version: 1`
and a `projects` array. Each project has a unique `id`, a lowercase SHA-256
`tokenSha256` and a positive integer `maxParallel`. Give the client the
original project token. Each project has its own idempotency keys, requests,
leases and concurrency limit. The operator token can inspect all projects,
revoke their leases and run recovery. Keep it separate from project credentials.

The API and WebDriver gateway accept a Bearer token or HTTP Basic authentication
with username `coordinator` and the token as password. Both enforce the project's
access to each lease.

## Request and use a device

Submit a request with a unique `Idempotency-Key`. For seven days from
submission, repeat that key and the same payload if the request times out.
A changed payload for a retained key returns HTTP 409. For the example, set
`COORDINATOR_DIR` to the directory created when starting the coordinator.

```sh
printf 'header = "Authorization: Bearer %s"\n' \
  "$(cat "$COORDINATOR_DIR/operator-token")" > "$COORDINATOR_DIR/curl.conf"
curl --fail --config "$COORDINATOR_DIR/curl.conf" \
  --header 'Idempotency-Key: android-smoke-1' \
  --json '{"runId":"android-smoke","runner":"appium","platform":"Android","maxDurationSeconds":600}' \
  http://127.0.0.1:8080/api/v1/requests
```

The optional `runner` field accepts `appium`. Use `serial`, `model` and
`provider` to filter devices. Requests remain queued without holding a device
while STF or Grid has no matching slot. Poll the request for its `leaseId`,
then fetch the lease and wait for `active`.

Create a W3C session at the returned `webdriverUrl` and use the lease's
`connection.capabilities`. The gateway binds one session to the lease and
rejects overrides of the device and its assigned ADB route. It accepts
`browserName`, `acceptInsecureCerts`, `pageLoadStrategy`, `timeouts`,
`unhandledPromptBehavior` and `strictFileInteractability` as W3C options.
Select an installed Android app with `appium:appPackage` and
`appium:appActivity`, or an installed iOS app with `appium:bundleId`.
Other accepted Appium options are
`appium:appWaitPackage`, `appium:appWaitActivity`, `appium:appWaitDuration`,
`appium:appWaitForLaunch`, `appium:autoGrantPermissions`,
`appium:disableWindowAnimation`, `appium:language`, `appium:locale` and
`appium:skipDeviceInitialization`. Host paths, app upload through session
capabilities, and emulator options are rejected.

Renew on a separate timer at the returned `heartbeatIntervalSeconds`.
WebDriver activity does not renew the lease. The default worker lease
lifetime is 180 seconds and the default absolute limit is six hours. The
coordinator enforces both limits and rejects commands after expiry. For slow
Grid operations, set `--upstream-timeout-seconds` and give the client a longer
HTTP timeout. STF providers cap each managed capture or renewal timeout at
73 minutes and enforce a fixed ceiling of 24 hours plus 73 minutes from
capture, including the maximum cleanup window. These provider limits apply
even outside the coordinator.

Close the Appium session, then release the lease.
A cleanup request returns HTTP 202. Poll the lease to see whether cleanup
finished or the device entered quarantine.

| Method | Coordinator path | Purpose |
| --- | --- | --- |
| GET | `/healthz`, `/readyz` | Process health and readiness |
| GET | `/api/v1/status` | Queue and lease counts |
| POST | `/api/v1/requests` | Queue a device request |
| GET, DELETE | `/api/v1/requests/:id` | Read or cancel a request |
| GET | `/api/v1/leases` | List leases |
| GET, DELETE | `/api/v1/leases/:id` | Read or release a lease. Operators can release across projects |
| POST | `/api/v1/leases/:id/renew` | Renew an active lease with an empty JSON object |
| POST | `/api/v1/leases/:id/recover` | Retry quarantined cleanup as an operator |
| POST | `/api/v1/maintenance` | Drain an iOS device as an operator |
| GET, DELETE | `/api/v1/maintenance/:id` | Read or complete an iOS drain |

## Recovery and maintenance

Use the coordinator operator token with `DELETE /api/v1/leases/:id` to revoke
the exact lease in any project. The coordinator confirms Appium session cleanup
with Grid before releasing the STF reservation. Poll the lease after HTTP 202.
If the coordinator is unavailable, restore it with its existing state file and
let recovery finish before retrying the request.

Keep the state file across restarts. Startup recovers interrupted leases before
reusing their devices. A lease remains quarantined if cleanup cannot be proved.
Each project can retain up to 10,000 requests. The coordinator prunes resolved
history after seven days from submission and keeps queued requests and requests
whose leases still hold resources.
Use the recovery endpoint with `{}` to retry ordinary cleanup. STF allows
90 seconds for a release and the coordinator's STF client allows at least
95 seconds. STF records a durable receipt for the exact account and lease ID,
so a retry can confirm that release without touching another reservation.

An unconfirmed Appium capture can reach the provider after a timeout. To
reconcile that specific quarantine, pause submissions, finish active work
and stop the coordinator. Stop every STF API replica, APP and DEV triproxy,
processor and affected provider that could still hold or deliver the original
capture. Confirm those processes exited, restart them and wait for the device
and Grid to report it free. Restart the coordinator with the same state file.
Then send the exact `serial`, `reconcileUnowned: true`,
`captureTransportRetired: true` and a `reason` to the recovery endpoint. The
coordinator checks that the capture safety window expired and that the device
has no other owner or session. It records the acknowledgment in lease history.

iOS allocations require fresh WebDriverAgent signing telemetry that covers the
requested duration plus five minutes. To drain an iOS device, post its
`serial` and an `operationId` UUID to `/api/v1/maintenance`. The drain prevents
new allocations while current leases finish. Complete it once the device is
free, its signing profile covers the coordinator's duration limit and Grid
confirms the slot is available. Drains survive restart. The loader accepts v1
state and writes v2, which older v1-only coordinators cannot load. If persistent
state contains an unsupported runner, startup stops and preserves the state file.

The [on-demand WDA renewal tool](../tools/wda-renewal/README.md) uses this drain
while it installs and verifies a new WebDriverAgent build on one iPhone.

Pause submissions and finish/release active leases before a coordinated upgrade
or credential rotation. Back up the state file and keep its PVC so the
coordinator can recover and verify outstanding leases. Experimental state containing
Maestro history is unsupported by this Appium-only coordinator, including
resolved history. Preserve it and plan an explicit migration before switching
images. Do not roll a v2 state file back to a v1-only runtime. A replacement
coordinator recovers interrupted leases before becoming ready. During normal
recovery `/healthz` remains live and `/readyz` returns 503. A state write failure
logs the cause and makes `/healthz` return 503 so Kubernetes can restart it.

The STF token, operator token, project policy and ADB pool configuration are
loaded at startup. Restart the single coordinator after changing these files.
When rotating credentials, retain the STF account identity until all leases
captured by it have confirmed cleanup. The Helm deployment allows 120 seconds for shutdown and cleanup and preserves unfinished work in state
for recovery after replacement.
