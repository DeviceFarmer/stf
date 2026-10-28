# STF on Kubernetes

The Helm chart in [`kubernetes/helm`](../kubernetes/helm) deploys the STF server, a browser-facing proxy and an optional single-node RethinkDB. Android and Linux iOS USB providers are opt-in and can be assigned to separate nodes. The chart uses the existing STF commands and images; it does not install Argo CD, Appium Grid or a test scheduler.

## Prerequisites

- Kubernetes 1.27 or later, Helm 3 or later, and `kubectl` configured for the intended cluster.
- A default StorageClass for the bundled database, or a reviewed existing claim/external database configuration.
- An existing session Secret in the release namespace. All STF units must keep the same session key across upgrades.
- For USB devices, Linux worker nodes with the devices visible to the host. iOS additionally needs host `usbmuxd`, a trusted pairing and signed WebDriverAgent, as described in the [iOS provider guide](ios-provider.md).

The default authentication mode is `mock`, intended for private development. Configure LDAP or OAuth2 before making a shared installation reachable. The chart does not provision certificates, Apple signing accounts or device trust.

## Quickstart: a new installation

These commands create a separate installation with no USB providers. They do not adopt an existing STF namespace or migrate a running farm. Review the rendered resources first; use your actual Kubernetes context in place of `YOUR_CONTEXT`.

```sh
helm lint kubernetes/helm --set session.existingSecret=stf-session
helm template stf kubernetes/helm --namespace stf \
  --set session.existingSecret=stf-session > /tmp/stf-kubernetes.yaml

KUBE_CONTEXT=YOUR_CONTEXT
kubectl --context "$KUBE_CONTEXT" create namespace stf
umask 077
STF_SESSION_DIR=$(mktemp -d)
openssl rand -hex 32 > "$STF_SESSION_DIR/SECRET"
kubectl --context "$KUBE_CONTEXT" --namespace stf create secret generic stf-session \
  --from-file=SECRET="$STF_SESSION_DIR/SECRET"
rm "$STF_SESSION_DIR/SECRET"
rmdir "$STF_SESSION_DIR"

helm upgrade --install stf kubernetes/helm \
  --kube-context "$KUBE_CONTEXT" --namespace stf \
  --set session.existingSecret=stf-session --wait --timeout 10m

kubectl --context "$KUBE_CONTEXT" --namespace stf \
  port-forward service/stf-proxy 7100:7100
```

The default STF image is `devicefarmer/stf:3.9.0`. Pin an immutable `image.digest` when recording a reproducible deployment. The examples use local browser access at `http://localhost:7100`; the database needs a working StorageClass before the installation can become ready. A successful Helm render does not establish cluster or hardware readiness.

## Configuration

Keep installation values in an environment-specific file outside the STF checkout, and pass it with `-f PATH` on every Helm render or upgrade. Sensitive values belong in existing Kubernetes Secrets; the chart references them by name.

| Values | Purpose |
| --- | --- |
| `publicOrigin` | Complete browser-facing HTTP(S) origin, without a path or trailing slash |
| `image.repository`, `image.tag`, `image.digest` | STF server image; a digest takes precedence over the tag |
| `imagePullSecrets` | Existing registry pull credentials in the release namespace |
| `session.existingSecret`, `session.key` | Existing session key; the default key name is `SECRET` |
| `auth.type` | `mock`, `ldap` or `oauth2` |
| `auth.env`, `auth.extraArgs` | Non-sensitive options accepted by the selected STF auth command |
| `auth.existingSecret` | Sensitive authentication environment variables, supplied to the auth unit |
| `database.bundled` | Run the included single-node RethinkDB or use an external database |
| `database.external` | External host, port and optional existing authentication Secret |
| `database.persistence` | Database claim, StorageClass and size |
| `storage.persistence` | Optional persistent upload volume; temporary storage metadata remains process-local |
| `proxy.ingress` | Optional Ingress, controller class, annotations and existing TLS Secret references |
| `core.nodeSelector`, `core.units` | Core scheduling and per-unit overrides |
| `ports.http`, `messaging.app`, `messaging.dev` | HTTP and ZeroMQ ports; override when adopting existing endpoints |
| `proxy.containerPort`, `proxy.service.port` | Proxy listener and Service ports |
| `migration.enabled`, `migration.revision` | Migration gate and explicit rerun revision |
| `bootstrap.adminName`, `bootstrap.adminEmail` | Optional explicit root-owner overrides; empty values preserve an existing owner |
| `resourceNames`, `selectorOverrides` | Explicit names/selectors for a separately reviewed adoption plan |

The bundled database is a single StatefulSet, not a highly available database service. If `database.bundled: false`, set `database.external.host`, port and database name, and verify the database is reachable from the release namespace. Refer to [`values.yaml`](../kubernetes/helm/values.yaml) for the exact keys. A claim alone does not preserve in-progress upload metadata across a storage-process restart.

For remote access, set `publicOrigin` to the URL users open and configure `proxy.ingress` or an equivalent private gateway. Keep HTTP and WebSocket traffic on that same origin. TLS certificates and DNS records are operator inputs.

## USB providers

Both `android.providers` and `ios.devices` are empty by default. A device-free cluster can validate the server lifecycle; it cannot validate USB permissions, passthrough or device interaction. The namespace policy must allow the chart's privileged Android ADB/iOS tunnel containers and host device mounts when those providers are enabled.

Android entries select the Linux USB node and optionally restrict serials:

```yaml
android:
  providers:
    - name: android-a
      nodeSelector:
        kubernetes.io/hostname: usb-worker
      serials: []
      capacity: 8
      minPort: 7400
```

Android providers fetch install URLs through the complete proxy so APK metadata routes are available. Set an entry's `storageUrl` to an existing full gateway when adopting a farm; the raw temporary-storage endpoint cannot serve APK metadata.

Use one USB ADB server per node, selected by an explicit `kubernetes.io/hostname`. Additional labels do not partition a host's USB bus. To share an existing server, configure `externalAdb` and disjoint serial lists rather than starting competing ADB services. USB passthrough and host permissions remain node preparation tasks. Set `adbKeysClaim` to an existing claim when ADB trust keys must survive replacement of its pod.

For iOS, build the Linux runtime from the same STF checkout and make it available to the cluster. The chart deliberately supplies no published iOS runtime image name:

```sh
docker build -f docker/ios/Dockerfile -t YOUR_REGISTRY/stf-ios-runtime:VERSION .
```

Set `ios.image.repository` and `tag` or `digest` after publishing or loading that actual image. Prepare a private token Secret for each device, then configure:

```yaml
ios:
  image:
    repository: YOUR_REGISTRY/stf-ios-runtime
    tag: VERSION
  devices:
    - name: iphone-a
      udid: YOUR_DEVICE_UDID
      wdaBundleId: com.example.WebDriverAgentRunner.xctrunner
      tokenSecret: iphone-a-token
      tokenKey: token
      nodeSelector:
        kubernetes.io/hostname: usb-worker
      persistence:
        size: 5Gi
```

The [USB values example](../kubernetes/helm/examples/usb.yaml) combines Android and iOS configuration. Replace its synthetic identifiers and image before applying it. Keep the pairing/state claim for each phone. Confirm that the selected node exposes the expected usbmuxd socket and has already established trust with that iPhone. WDA must be signed and installed beforehand; the Kubernetes chart does not perform signing or first-time device preparation. See the [provider limits and recovery behavior](ios-provider.md).

## Database migration and upgrades

The chart renders `stf migrate` as an ordinary Job whose name depends on the relevant image/configuration. Core units wait for that exact Job to complete. Their init container has read access only to that named Job; the application container does not receive a Kubernetes token. The chart uses this barrier for both Helm and Argo CD rendering, without lifecycle hooks.

For an existing database already prepared for the exact selected image, `migration.enabled: false` omits the migration Job, barrier and its RBAC. The operator must verify schema compatibility before using that mode.

Keep the session Secret, database claim and device state claims stable during upgrades. Review migration changes before changing the image. `migration.revision` explicitly requests another migration when the other inputs have not changed. An installation that cannot migrate remains blocked rather than starting against an unprepared database.

Existing farms need a separate adoption plan: compare names, namespaces, immutable selectors, Pod templates, PVC ownership, images and Secret references before using `resourceNames` or `existingClaim`. Matching a resource name does not make an existing resource safe for Helm adoption. Do not run the Quickstart or install Argo CD over a working farm to switch its Git source.

## Verification

Run `helm lint` and `helm template` with the actual values file before an installation. Review optional database, auth, ingress and provider branches separately. Chart fixture tests require Python 3, PyYAML 6 and Helm on `PATH`:

```sh
python3 kubernetes/helm/tests/render_test.py
```

Set `HELM=/path/to/helm` if Helm is installed elsewhere. These tests validate rendered manifests and migration behavior without proving real USB operation.

The API-only smoke creates and removes its own Kind cluster, installs and upgrades the chart, checks login/session and database persistence, and never reuses the current Kubernetes context. With Docker, Kind, Helm and kubectl available:

```sh
python3 kubernetes/helm/tests/smoke.py \
  --cluster-name stf-chart-local \
  --kubeconfig /tmp/stf-chart-new.kubeconfig \
  --artifacts /tmp/stf-chart-smoke
```

Use a new kubeconfig path. The current smoke was verified with Helm 4.3.1 and Kubernetes 1.37.0. For a hardware check, confirm database readiness, completed migration, healthy STF units and browser login. For each enabled provider, check device discovery, live screen, input, disconnect/reconnect and persistence across pod replacement. Record the tested image, cluster and devices separately; a device-free smoke test does not establish those hardware results.

Bootstrap administrator fields are optional. Empty values preserve the existing root owner during migration; set them explicitly only when changing that owner is intended. A fresh database uses STF's built-in bootstrap defaults.
