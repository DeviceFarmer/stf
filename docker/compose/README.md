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
administrator. For untrusted networks, replace mock authentication with one of
the auth units described in [the deployment guide](../../doc/DEPLOYMENT.md#stf-authservice)
and add TLS, as shown in [Production settings](#production-settings).

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

### Production settings

A production setup usually needs real authentication, TLS, persistent adb keys
and sometimes providers on other hosts. All of it fits in
`docker-compose.override.yaml`; this example uses Google OAuth 2.0 for
`stf.example.org`, with the client secret in `.env`:

```yaml
services:
  adb:
    volumes:
      # Without this, devices ask to authorize a new adb key whenever the
      # container is recreated.
      - /root/.android:/root/.android

  auth:
    command: stf auth-oauth2 --app-url https://stf.example.org/
    environment:
      OAUTH_AUTHORIZATION_URL: https://accounts.google.com/o/oauth2/v2/auth
      OAUTH_TOKEN_URL: https://www.googleapis.com/oauth2/v4/token
      OAUTH_USERINFO_URL: https://www.googleapis.com/oauth2/v3/userinfo
      OAUTH_CLIENT_ID: ${OAUTH_CLIENT_ID:?}
      OAUTH_CLIENT_SECRET: ${OAUTH_CLIENT_SECRET:?}
      OAUTH_CALLBACK_URL: https://stf.example.org/auth/oauth/callback
      OAUTH_SCOPE: openid email
      OAUTH_DOMAIN: "@example.org"

  app:
    command: >-
      stf app
      --auth-url https://stf.example.org/auth/oauth/
      --websocket-url wss://stf.example.org/

  proxy:
    volumes: !override
      - ./nginx-tls.conf:/etc/nginx/nginx.conf:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro
    ports: !override
      - "80:80"
      - "443:443"
    # The stock check requests /auth/mock/, which no longer exists once auth is
    # replaced; nginx-tls.conf answers /healthz on port 7100 instead.
    healthcheck:
      test: [CMD, wget, -q, --spider, http://127.0.0.1:7100/healthz]
```

`nginx-tls.conf` is a copy of [nginx.conf](nginx.conf) with:

- `location = /healthz { return 200; }` in the port 7100 server, which the other
  services keep using over plain HTTP inside the Compose network;
- a `listen 443 ssl` server with the certificate, proxying to the same
  `$stf_backend` map, and a `listen 80` server that redirects to HTTPS;
- all `proxy_set_header` lines at the `http` level. A `location` that sets any
  header of its own stops inheriting the others, including the WebSocket
  `Upgrade` and `Connection` headers, and the browser connection then fails
  with HTTP 400.

To renew certificates without downtime, reload the proxy after certbot runs:
`docker compose --project-directory /path/to/stf exec -T proxy nginx -s reload`.

**Providers on other hosts.** Publish the device-side triproxy on the main
host, for example as ports 7250 and 7270:

```yaml
services:
  triproxy-dev:
    ports:
      - "7250:7111"
      - "7270:7113"
```

On each device host, run only `adb` and `provider` with `network_mode: host`,
because the provider hands out one port per device from its port range. Point
the provider at `--connect-sub tcp://stf.example.org:7250`,
`--connect-push tcp://stf.example.org:7270` and
`--storage-url https://stf.example.org/`. To serve its screens through the
main host's TLS, give it a name and
`--screen-ws-url-pattern "wss://stf.example.org/d/NAME/<%= serial %>/<%= publicPort %>/"`,
and add a matching location to `nginx-tls.conf` that proxies
`^/d/NAME/[^/]+/(?<port>[0-9]+)/$` to `http://DEVICE_HOST_IP:$port/`.

### Migrating from the systemd units

The Compose services replace the units in [DEPLOYMENT.md](../../doc/DEPLOYMENT.md)
one for one, apart from `rethinkdb-proxy-28015` (the ambassador), which Compose
doesn't need. When moving an existing installation:

- Mount the existing RethinkDB data directory instead of the `rethinkdb-data`
  volume (`volumes: !override` with `- /srv/rethinkdb:/data`), and keep the
  RethinkDB image version it was written with. Never run an older version on it.
- Keep the old session secret as `STF_SECRET`, so existing logins keep working.
- Set `STF_ADMIN_NAME` and `STF_ADMIN_EMAIL` to the owner of the existing root
  group, as stored in the database's `groups` table; `stf migrate` creates a new
  administrator when they differ. The root group keeps its name, because the
  Compose file doesn't pass `STF_ROOT_GROUP_NAME`. Don't copy the values from
  `/etc/environment`: unless a unit passed them with `-e`, they never reached
  STF, so the database can hold different ones.
- Compose doesn't run `stf log-rethinkdb`. Add it as a service if you use the
  device log recording.
- Stop and disable every old unit before `docker compose up`. Two RethinkDB
  servers must never use the same data directory.
- Take a cold copy of the data directory while everything is stopped; that is
  the rollback.

The [Compose CI test](../../test/compose/README.md) exercises this topology with
an Android 16 AVD, browser device control, and API/storage requests through Nginx.

For physical iPhones on a Linux host, use the optional
[local iOS launcher](../ios/README.md). It reuses this topology, selects devices
from one JSON file and adds the USB tunnel/runtime/provider without Kubernetes.
