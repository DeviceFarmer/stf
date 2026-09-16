# Docker Compose end-to-end test

The `Compose` job in `ci.yml` builds the root Dockerfile from the PR checkout and
starts the root `docker-compose.yaml` with the overrides in this directory.
Each STF unit runs in its own container. Nginx routes browser HTTP and WebSocket
traffic to the app, auth, API, WebSocket and storage services. The provider talks
to ADB and the device-side ZeroMQ proxy over the Compose network.

The job boots an Android 16 (API 36, x86_64) AVD on the Linux runner with KVM.
A relay exposes the AVD's loopback ADB transport to the ADB container, and
Playwright's `adb` helpers use that same server through port 15037. The override
replaces USB access with the runner's ADB keys and enables the APK screen grabber
for Android 16. CI uses the locally built STF image and disables service restarts.

Before and after Playwright, the job verifies that all 16 long-running services
are running without restarts, their health checks pass, and the one-off migration
completed successfully. It also checks that each STF container runs its own unit
command from the checked-out image.

All 14 Playwright tests run: the 11 existing UI/device tests plus authenticated
API routing, APK upload/manifest/download, and image upload/resizing. Device
coverage includes claiming, changing screen frames, tap/swipe coordinates
captured on the AVD, shell execution and release. Missing or skipped coverage
fails the job. The other CI jobs retain the broader Android matrix.

The shared CI report includes Compose as a required tier. Each run uploads
service state and logs, ADB/device logs, and Playwright reports, screenshots,
traces and videos. The stack is torn down even when tests fail.

To reproduce on Linux, install Docker Compose 2.24.4 or newer, Node from `.nvmrc`,
the Android SDK, `socat` and GNU `timeout`. Boot a rootable API 36 AVD on console
port 5554, then run from the repository root:

```sh
export COMPOSE_FILE=docker-compose.yaml:test/compose/docker-compose.yaml
export COMPOSE_PROJECT_NAME=stf-compose-ci
export STF_ADB_KEYS="$HOME/.android"
export STF_IMAGE=stf-compose:ci
export STF_RESTART_POLICY=no
export STF_SECRET=stf-compose-test-secret
export STF_ADMIN_EMAIL=ci_user@ci.local
export STF_ADMIN_NAME=ci_user
docker build --platform linux/amd64 -t "$STF_IMAGE" .
docker compose pull rethinkdb adb proxy
npm install --prefix test/playwright --registry=https://registry.npmjs.org
(cd test/playwright && npx playwright install --with-deps chromium)
bash .github/scripts/compose-leg.sh
docker compose logs --no-color
docker compose down --volumes --remove-orphans
```

Ports 7100, 7400-7500, 15037 and 15555 must be free. Use a disposable runner:
the relay listens on all interfaces while the test runs, and STF uses mock auth.
