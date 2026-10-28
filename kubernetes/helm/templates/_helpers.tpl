{{- define "stf.fullname" -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- default (ternary .Release.Name (printf "%s-%s" .Release.Name $name) (eq .Release.Name $name)) .Values.fullnameOverride | trunc 32 | trimSuffix "-" -}}
{{- end -}}
{{- define "stf.name" -}}
{{- default (printf "%s-%s" (include "stf.fullname" .root) .component) (get .root.Values.resourceNames .component) -}}
{{- end -}}
{{- define "stf.image" -}}
{{- $i := . -}}
{{- if $i.digest -}}{{ $i.repository }}@{{ $i.digest }}{{- else -}}{{ $i.repository }}:{{ $i.tag }}{{- end -}}
{{- end -}}
{{- define "stf.labels" -}}
app.kubernetes.io/name: stf
app.kubernetes.io/instance: {{ .Release.Name | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service | quote }}
{{- end -}}
{{- define "stf.selector" -}}
{{- if hasKey .root.Values.selectorOverrides .component -}}
{{ toYaml (get .root.Values.selectorOverrides .component) }}
{{- else -}}
app.kubernetes.io/instance: {{ .root.Release.Name | quote }}
app.kubernetes.io/component: {{ .component | quote }}
{{- end -}}
{{- end -}}
{{- define "stf.dbhost" -}}
{{- if .Values.database.bundled -}}{{ include "stf.name" (dict "root" . "component" "rethinkdb") }}{{- else -}}{{ required "database.external.host is required for an external database" .Values.database.external.host }}{{- end -}}
{{- end -}}
{{- define "stf.migration" -}}
{{- $fingerprint := dict "image" .Values.image "database" .Values.database "bootstrap" .Values.bootstrap "revision" .Values.migration "session" .Values.session "pullSecrets" .Values.imagePullSecrets "resources" .Values.core.resources "databaseHost" (include "stf.dbhost" .) "environment" (include "stf.env" .) "migrateLabels" (include "stf.selector" (dict "root" . "component" "migrate")) "httpPort" .Values.ports.http -}}
{{- printf "%s-%s" (include "stf.name" (dict "root" . "component" "migrate") | trunc 52 | trimSuffix "-") (toJson $fingerprint | sha256sum | trunc 10) -}}
{{- end -}}
{{- define "stf.env" -}}
- name: PORT
  value: {{ .Values.ports.http | quote }}
- name: SECRET
  valueFrom:
    secretKeyRef: {name: {{ required "session.existingSecret is required" .Values.session.existingSecret | quote }}, key: {{ .Values.session.key | quote }}}
- name: RETHINKDB_PORT_28015_TCP
  value: {{ printf "tcp://%s:%v" (include "stf.dbhost" .) (ternary 28015 .Values.database.external.port .Values.database.bundled) | quote }}
- name: RETHINKDB_ENV_DATABASE
  value: {{ .Values.database.name | quote }}
{{- if .Values.database.external.existingSecret }}
- name: RETHINKDB_ENV_AUTHKEY
  valueFrom:
    secretKeyRef: {name: {{ .Values.database.external.existingSecret | quote }}, key: {{ .Values.database.external.authKeyKey | quote }}}
{{- end }}
{{- end -}}
{{- define "stf.waitMigration" -}}
{{- if .Values.migration.enabled -}}
- name: wait-migration
  image: {{ include "stf.image" .Values.image | quote }}
  imagePullPolicy: {{ .Values.image.pullPolicy }}
  command: [node, /kubernetes/wait-migration.cjs]
  env:
    - {name: POD_NAMESPACE, value: {{ .Release.Namespace | quote }}}
    - {name: MIGRATION_JOB, value: {{ include "stf.migration" . | quote }}}
    - {name: WAIT_SECONDS, value: {{ .Values.migration.timeoutSeconds | quote }}}
  securityContext: {allowPrivilegeEscalation: false, capabilities: {drop: [ALL]}}
  volumeMounts:
    - {name: kubernetes-scripts, mountPath: /kubernetes, readOnly: true}
    - {name: migration-identity, mountPath: /var/run/stf-migration, readOnly: true}
{{- end -}}
{{- end -}}
{{- define "stf.migrationVolumes" -}}
{{- if .Values.migration.enabled -}}
- name: kubernetes-scripts
  configMap: {name: {{ include "stf.name" (dict "root" . "component" "scripts") }}}
- name: migration-identity
  projected:
    defaultMode: 0444
    sources:
      - serviceAccountToken: {path: token, expirationSeconds: 600}
      - configMap:
          name: kube-root-ca.crt
          items: [{key: ca.crt, path: ca.crt}]
{{- end -}}
{{- end -}}
{{- define "stf.pvc" -}}
{{- $p := .persistence -}}
{{- if and $p.enabled (not $p.existingClaim) }}
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: {{ .name }}
  labels:
    {{- include "stf.labels" .root | nindent 4 }}
  annotations:
    helm.sh/resource-policy: keep
    {{- with $p.annotations }}{{ toYaml . | nindent 4 }}{{ end }}
spec:
  accessModes: [ReadWriteOnce]
  {{- with $p.storageClass }}
  storageClassName: {{ . | quote }}
  {{- end }}
  resources:
    requests: {storage: {{ $p.size | quote }}}
{{- end }}
{{- end -}}
