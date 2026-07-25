# Metrics

STF exposes the counters of the whole platform through the `GET /api/v1/metrics` operation of the
[API](API.md), using the [Prometheus text exposition format][exposition-format].

The operation is a privileged one: it is tagged `admin` in the API specification and the controller
checks the privilege of the caller as well, so it is reserved to the administrator user of the
platform whether the caller authenticates with an access token or with a browser session. This is
required because the returned counters cover all the devices, users and groups whatever the group
they belong to, which a simple user is not allowed to see.

The counters are computed when the endpoint is scraped, not on a timer, so the returned values are
always those of the very moment the Prometheus server asked for them.

## Exposed metrics

| Metric | Type | Labels | Description |
| ------ | ---- | ------ | ----------- |
| `stf_devices_total` | gauge | | Number of devices known to STF, whether they are present or not |
| `stf_devices_by_state` | gauge | `state` | Number of devices per aggregate device state |
| `stf_devices_available` | gauge | | Number of devices in the `available` state |
| `stf_devices_busy` | gauge | | Number of devices in the `busy` state |
| `stf_providers_total` | gauge | | Number of distinct providers serving at least one present device |
| `stf_users_total` | gauge | | Number of users known to STF |
| `stf_users_by_privilege` | gauge | `privilege` | Number of users per privilege (`root`, `admin`, `user`) |
| `stf_groups_total` | gauge | | Number of groups known to STF |
| `stf_groups_active` | gauge | | Number of groups which are currently active |
| `stf_groups_by_state` | gauge | `state` | Number of groups per group state (`pending`, `ready`, `waiting`) |
| `stf_groups_by_class` | gauge | `class` | Number of groups per group class (`once`, `bookable`, `standard`, `hourly`, ...) |

The `app="stf"` label is added to every metric, and the standard `process_*` and `nodejs_*` metrics
of the API process are exposed as well.

The `state` label of `stf_devices_by_state` holds the aggregate device state, computed with the same
state machine as the one the device list uses:

| State | Meaning |
| ----- | ------- |
| `absent` | The device is not plugged to any provider |
| `offline` | The device is present but `adb` reports it offline |
| `unauthorized` | The device is present but `adb` is not authorized to use it |
| `preparing` | The device is online but not ready yet |
| `available` | The device is ready and owned by nobody |
| `busy` | The device is ready and owned by a user |
| `present` | The device is present and currently being connected or authorized |

The `using` and `automation` states of the device list are not exposed since they only make sense
for a given user session.

Every label value is known in advance, so a counter which drops to zero is exported as zero instead
of vanishing, and a device or a group holding an unexpected value can't create new time series.

## Scraping the endpoint

The operation uses the same authentication as the rest of the API, so the Prometheus server needs
the access token of an administrator user. Generate one from the STF UI, in
*Settings* > *Keys* > *Access Tokens*, while logged in as the administrator.

```yaml
scrape_configs:
  - job_name: stf
    metrics_path: /api/v1/metrics
    scheme: http
    authorization:
      type: Bearer
      credentials: <STF_ADMIN_ACCESS_TOKEN>
    static_configs:
      - targets: ['stf.example.org:7100']
```

Errors are reported the way the rest of the API reports them, as a JSON body: `401` when the token
is missing or invalid, `403` when the token belongs to a simple user, and `500` when the counters
can't be read from the database. Only the successful response uses the Prometheus text format,
since that is what the format is specified for.

## Setting up a minimal test environment

Start STF as usual, for instance with the [docker-compose.yaml](../docker-compose.yaml) of this
repository, then add a Prometheus server and a Grafana instance next to it:

```yaml
services:
  prometheus:
    image: prom/prometheus:v3.1.0
    ports:
      - "9090:9090"
    volumes:
      - "./prometheus.yml:/etc/prometheus/prometheus.yml"

  grafana:
    image: grafana/grafana:11.5.1
    ports:
      - "3000:3000"
    environment:
      - GF_AUTH_ANONYMOUS_ENABLED=true
      - GF_AUTH_ANONYMOUS_ORG_ROLE=Admin
```

With a `prometheus.yml` holding the scrape configuration above and a `15s` scrape interval:

```yaml
global:
  scrape_interval: 15s
```

Check that the endpoint answers, then that Prometheus scrapes it:

```bash
curl -H "Authorization: Bearer $STF_ADMIN_ACCESS_TOKEN" http://localhost:7100/api/v1/metrics
```

```
# HELP stf_devices_total Number of devices known to STF, whether they are present or not
# TYPE stf_devices_total gauge
stf_devices_total{app="stf"} 3
# HELP stf_devices_by_state Number of devices per aggregate device state
# TYPE stf_devices_by_state gauge
stf_devices_by_state{state="absent",app="stf"} 1
stf_devices_by_state{state="available",app="stf"} 1
stf_devices_by_state{state="busy",app="stf"} 1
...
```

The target then shows up as `UP` on http://localhost:9090/targets, and Grafana can be pointed at
`http://prometheus:9090` to graph the series, for example the ratio of devices in use:

```
sum(stf_devices_busy) / sum(stf_devices_total)
```

[exposition-format]: <https://prometheus.io/docs/instrumenting/exposition_formats/#text-based-format>
