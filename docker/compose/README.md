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

On a Linux host with Docker Compose and USB-connected Android devices, create a
`.env` file in the repository root. Compose reads it for every command, so
`docker compose down` and later restarts keep working in a new shell:

```sh
cat > .env <<EOF
STF_SECRET=$(openssl rand -hex 32)
STF_PUBLIC_IP=192.168.1.10
STF_ADMIN_EMAIL=admin@example.org
STF_ADMIN_NAME=administrator
EOF
docker compose up -d --wait
```

Replace the public IP with the host address reachable from your browser, then
open `http://192.168.1.10:7100`. Keep the same session secret across restarts.
`STF_IMAGE` can select a versioned image or a locally built tag.

This example uses mock authentication and HTTP. Mock login accepts any name and
email; the user matching `STF_ADMIN_NAME` and `STF_ADMIN_EMAIL` is the
administrator. For untrusted networks, replace the `auth` service command and
the `app` service `--auth-url` in an override file with one of the other auth
units described in [the deployment guide](../../doc/DEPLOYMENT.md#stf-authservice),
and put TLS in front of the `proxy` service.

### Emulators and network devices

The provider only uses USB devices by default, so on Docker Desktop (macOS,
Windows) or with emulators and devices connected over the network, the device
list stays empty. Allow remote devices in a `docker-compose.override.yaml` next
to `docker-compose.yaml`, which Compose loads automatically:

```yaml
services:
  provider:
    environment:
      STF_PROVIDER_ALLOW_REMOTE: "true"
```

Then connect each device from the `adb` service, for example an emulator whose
adb port the host relays on 15555:

```sh
docker compose up -d --wait
docker compose exec adb adb connect host.docker.internal:15555
```

Port 7100 serves the application and browser WebSocket connection. Ports
7400-7500 are published by the provider for device connections and screen
streams. Database, ZeroMQ and individual HTTP service ports stay on the Compose
network. Nginx resolves service names through Docker DNS, including after a
container is recreated.

RethinkDB data is stored in the `rethinkdb-data` volume. Uploads use the temporary
storage backend and are discarded when its container is replaced. Stop the stack
with `docker compose down`; add `--volumes` only when you intend to erase the
database.

To use Android 16, add the minicap apk screen grabber to the provider's
environment in `docker-compose.override.yaml`, as
[the CI override](../../test/compose/docker-compose.yaml) does:

```yaml
services:
  provider:
    environment:
      STF_PROVIDER_ALLOW_REMOTE: "true"
      SCREEN_GRABBER: minicap-apk
```

The [Compose CI test](../../test/compose/README.md) exercises this topology with
an Android 16 AVD, browser device control, and API/storage requests through Nginx.

For physical iPhones on a Linux host, use the optional
[local iOS launcher](../ios/README.md). It reuses this topology, selects devices
from one JSON file and adds the USB tunnel/runtime/provider without Kubernetes.
