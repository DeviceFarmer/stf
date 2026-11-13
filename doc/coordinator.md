# STF coordinator

`stf coordinator` schedules renewable device leases for external test clients. It
reserves devices through STF, gives each lease a fenced Appium WebDriver or
Android ADB connection, and verifies cleanup before making the device available
again. Test code and reports stay with the client.

## Start the coordinator

Run one coordinator per device and port pool. Use matching STF API, processor,
and provider builds that support [automation leases](API.md#automation-leases).
The coordinator uses a regular STF access token from an account that can see
the devices it should schedule.

Appium requires a reachable Grid with slots for the devices you want to use.
Android slots must advertise the provider pool's `appium:remoteAdbHost` and,
when one host serves multiple ADB ports, `appium:adbPort`. iOS slots must
advertise the device's `appium:udid` and `appium:platformVersion`. Configure the
iOS Appium node's `appium:webDriverAgentUrl` to reach the existing WDA forward
or an adapter for that WDA session. The [iOS runtime](ios-provider.md) pauses
its WDA health probes during a coordinator lease and restores its session on
release. For Maestro on physical Android, the coordinator connects to the
provider's ADB service.

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

Use `[]` for an iOS-only setup. For a Maestro-only setup, leave
`--appium-grid-url` unset and use an empty `systemPorts` array for each pool.
If you remove Grid from an existing coordinator, first cancel queued Appium
requests and finish cleaning up Appium leases while Grid is still reachable.

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

## Credentials

The STF token stays with the coordinator. For shared use, pass
`--project-tokens-file` with a private JSON document containing `version: 1`
and a `projects` array. Each project has a unique `id`, a lowercase SHA-256
`tokenSha256` and a positive integer `maxParallel`. Give the client the
original project token. Each project has its own idempotency keys, requests,
leases and concurrency limit. The operator token can inspect all projects and
run recovery. Keep it separate from project credentials.

The API accepts a Bearer token or HTTP Basic authentication with username
`coordinator` and the token as password. The WebDriver and ADB gateways use
the same project authorization.

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

Use `runner: maestro` for Maestro. Appium is the default runner. Optional
`serial`, `model` and `provider` fields filter matching devices. Requests
remain queued without holding a device. Appium and Maestro schedule
independently while sharing device and concurrency limits. Grid delays
affect Appium scheduling. Poll the request for its `leaseId`, then fetch
the lease and wait for `active`.

- For Appium, create a W3C session at the returned `webdriverUrl` and use the
  lease's `connection.capabilities`. The gateway binds one session to the lease
  and rejects overrides of the device and its assigned ADB route. It accepts
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
- For Maestro, forward each local ADB smart-socket connection over its own
  authenticated binary WebSocket at `connection.path`. Use the returned
  `connection.serial`. The gateway checks provider ownership independently of
  the worker heartbeat and can reuse a proof for at most one second. It
  exposes only that device and closes the streams on lease expiry or release.

Renew on a separate timer at the returned `heartbeatIntervalSeconds`.
WebDriver and ADB activity do not renew the lease. The default worker lease
lifetime is 180 seconds and the default absolute limit is six hours. The
coordinator enforces both limits and rejects commands after expiry. For slow
Grid operations, set `--upstream-timeout-seconds` and give the client a longer
HTTP timeout.

Close the Appium session or finish the Maestro run, then release the lease.
A cleanup request returns HTTP 202. Poll the lease to see whether cleanup
finished or the device entered quarantine.

| Method | Coordinator path | Purpose |
| --- | --- | --- |
| GET | `/healthz`, `/readyz` | Process health and readiness |
| GET | `/api/v1/status` | Queue and lease counts |
| POST | `/api/v1/requests` | Queue a device request |
| GET, DELETE | `/api/v1/requests/:id` | Read or cancel a request |
| GET | `/api/v1/leases` | List leases |
| GET, DELETE | `/api/v1/leases/:id` | Read or release a lease |
| POST | `/api/v1/leases/:id/renew` | Renew an active lease with an empty JSON object |
| POST | `/api/v1/leases/:id/recover` | Retry quarantined cleanup as an operator |
| POST | `/api/v1/maintenance` | Drain an iOS device as an operator |
| GET, DELETE | `/api/v1/maintenance/:id` | Read or complete an iOS drain |

## Recovery and maintenance

Keep the state file across restarts. Startup recovers interrupted leases before
reusing their devices. A lease remains quarantined if cleanup cannot be proved.
Each project can retain up to 10,000 requests. The coordinator prunes resolved
history after seven days from submission and keeps queued requests and requests
whose leases still hold resources.
Use the recovery endpoint with `{}` to retry ordinary cleanup. For Maestro,
the provider verifies that the driver has stopped, removes packages added by the
runner and restores tracked settings before acknowledging release. STF allows
90 seconds for a release and the coordinator's STF client allows at least
95 seconds. STF records a durable receipt for the exact account and lease ID,
so a retry can confirm that release without touching another reservation.
If cleanup cannot be confirmed for an apparently free Maestro device, the
coordinator keeps the lease quarantined.

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
state and writes v2, which older v1-only coordinators cannot load.
