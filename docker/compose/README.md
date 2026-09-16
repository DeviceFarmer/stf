# Running STF with Docker Compose

The root Compose file runs each STF unit as a separate service using the same
STF image. Compose starts the database migration before the application services
and waits for HTTP and ZeroMQ listeners before starting their dependents.

| Services | Purpose |
|---|---|
| `rethinkdb`, `migrate` | Persistent database and one-off schema/bootstrap setup |
| `adb`, `provider` | Device discovery and device workers |
| `triproxy-app`, `triproxy-dev`, `processor` | ZeroMQ transport between browsers and devices |
| `groups-engine`, `reaper` | Group ownership and absent-device tracking |
| `auth`, `app`, `api`, `websocket` | Login, web UI, API and browser events |
| `storage`, `storage-image`, `storage-apk` | Temporary uploads, image transforms and APK metadata |
| `proxy` | Nginx entry point for HTTP and WebSocket traffic |

On a Linux host with Docker Compose and USB-connected Android devices, run from
the repository root:

```sh
export STF_SECRET="$(openssl rand -hex 32)"
export STF_PUBLIC_IP=192.168.1.10
export STF_ADMIN_EMAIL=admin@example.org
export STF_ADMIN_NAME=administrator
docker compose up -d --wait
```

Replace the public IP with the host address reachable from your browser, then
open `http://192.168.1.10:7100`. Keep the same session secret across restarts.
`STF_IMAGE` can select a versioned image or a locally built tag. This example uses
mock authentication and HTTP; configure authentication and TLS for untrusted
networks as described in [the deployment guide](../../doc/DEPLOYMENT.md).

Port 7100 serves the application and browser WebSocket connection. Ports
7400-7500 are published by the provider for device connections and screen
streams. Database, ZeroMQ and individual HTTP service ports stay on the Compose
network. Nginx resolves service names through Docker DNS, including after a
container is recreated.

RethinkDB data is stored in the `rethinkdb-data` volume. Uploads use the temporary
storage backend and are discarded when its container is replaced. Stop the stack
with `docker compose down`; add `--volumes` only when you intend to erase the
database. To use Android 16, set `SCREEN_GRABBER: minicap-apk` in the provider's
environment, as demonstrated by [the CI override](../../test/compose/docker-compose.yaml).

The [Compose CI test](../../test/compose/README.md) exercises this topology with
an Android 16 AVD, browser device control, and API/storage requests through Nginx.
