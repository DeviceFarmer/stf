#!/usr/bin/env bash
#
# Round-trip an apk through both storage backends: upload it, download it from
# a url, and read the bytes back out. The s3 half runs against SeaweedFS, which
# is the only way to catch the addressing and metadata bugs that a mock cannot.
#
# usage: storage-leg.sh
set -euo pipefail

LOG_DIR="${STF_LOG_DIR:-stf-logs}"
S3_ENDPOINT="${S3_ENDPOINT:-http://127.0.0.1:8333}"
BUCKET="${S3_BUCKET:-stf-ci}"
APK=node_modules/@devicefarmer/stfservice-prebuilt/prebuilt/noarch/STFService.apk

mkdir -p "$LOG_DIR"
failures=0

note() { echo; echo "=== $* ==="; }
fail() { echo "::error::$*"; failures=$((failures + 1)); }

note "serving $APK over http"
SRC=$(mktemp -d)
cp "$APK" "$SRC/test.apk"
EXPECTED=$(md5sum "$APK" | cut -d' ' -f1)
( cd "$SRC" && python3 -m http.server 8898 --bind 127.0.0.1 >/dev/null 2>&1 & echo $! > "$LOG_DIR/apk-http.pid" )
bash .github/scripts/wait-for-port.sh 8898 30 apk-http

note "writing s3 credentials"
mkdir -p "$HOME/.aws"
cat > "$HOME/.aws/credentials" <<EOF
[stfci]
aws_access_key_id = stfci
aws_secret_access_key = stfcisecret
EOF

note "creating bucket $BUCKET"
node -e "
var sdk = require('@aws-sdk/client-s3')
var creds = require('@aws-sdk/credential-providers')
var client = new sdk.S3Client({
  credentials: creds.fromIni({profile: 'stfci'})
, endpoint: '$S3_ENDPOINT'
, forcePathStyle: true
, region: 'us-east-1'
})
var attempts = 0
function create() {
  attempts++
  client.send(new sdk.CreateBucketCommand({Bucket: '$BUCKET'}))
    .then(function() { console.log('bucket ready') })
    .catch(function(err) {
      if (err.name === 'BucketAlreadyOwnedByYou' || err.name === 'BucketAlreadyExists') {
        console.log('bucket already there')
        return
      }
      if (attempts < 10) {
        console.log('createBucket attempt ' + attempts + ' failed (' + err.name + '), retrying')
        setTimeout(create, 3000)
        return
      }
      console.error('createBucket failed:', err.name, err.message)
      process.exit(1)
    })
}
create()
"

roundtrip() {
  local label="$1"
  local port="$2"
  local apk_port="$3"

  note "$label: POST /s/download/apk"
  local body
  body=$(curl -sS -X POST "http://127.0.0.1:$port/s/download/apk" \
    -H 'Content-Type: application/json' \
    -d '{"url":"http://127.0.0.1:8898/test.apk"}')
  echo "$body"

  local href
  href=$(printf '%s' "$body" | node -e "
    var d = ''
    process.stdin.on('data', function(c) { d += c })
    process.stdin.on('end', function() {
      try {
        var r = JSON.parse(d).resource
        process.stdout.write(r && r.href ? r.href : '')
      }
      catch (err) {
        process.stdout.write('')
      }
    })
  ")

  if [ -z "$href" ]; then
    fail "$label: download returned no resource href"
    return
  fi
  echo "  href: $href"

  note "$label: GET \$href/manifest"
  curl -sS "http://127.0.0.1:$apk_port$href/manifest" \
    -o "$LOG_DIR/$label-manifest.out" || true
  local pkg
  pkg=$(node -e "
    var fs = require('fs')
    try {
      var m = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'))
      process.stdout.write(m.success && m.manifest ? (m.manifest.package || '') : '')
    }
    catch (err) {
      process.stdout.write('')
    }
  " "$LOG_DIR/$label-manifest.out")
  if [ -n "$pkg" ]; then
    echo "  package: $pkg"
  else
    fail "$label: manifest was not json, the href shape is wrong"
    echo "  got: $(head -c 120 "$LOG_DIR/$label-manifest.out" | tr -d '\0' | cat -v)"
  fi

  note "$label: GET the blob back"
  local blob="${href/\/s\/apk\//\/s\/blob\/}"
  local got
  got=$(curl -sS "http://127.0.0.1:$port$blob" | md5sum | cut -d' ' -f1)
  if [ "$got" = "$EXPECTED" ]; then
    echo "  md5 matches: $got"
  else
    fail "$label: blob differs, expected $EXPECTED got $got"
  fi

  note "$label: POST /s/upload/apk"
  curl -sS -X POST "http://127.0.0.1:$port/s/upload/apk" -F "file=@$APK" \
    -o "$LOG_DIR/$label-upload.out" || true
  local uphref
  uphref=$(node -e "
    var fs = require('fs')
    try {
      var r = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'))
      process.stdout.write(r.success && r.resources && r.resources.file
        ? (r.resources.file.href || '') : '')
    }
    catch (err) {
      process.stdout.write('')
    }
  " "$LOG_DIR/$label-upload.out")
  if [ -n "$uphref" ]; then
    echo "  upload href: $uphref"
    local uploaded_blob="${uphref/\/s\/apk\//\/s\/blob\/}"
    got=$(curl -sS "http://127.0.0.1:$port$uploaded_blob" | md5sum | cut -d' ' -f1)
    if [ "$got" = "$EXPECTED" ]; then
      echo "  uploaded md5 matches: $got"
    else
      fail "$label: uploaded blob differs, expected $EXPECTED got $got"
    fi
  else
    fail "$label: upload did not return a resource href"
    echo "  got: $(head -c 120 "$LOG_DIR/$label-upload.out" | tr -d '\0' | cat -v)"
  fi

  note "$label: POST /s/download/apk with no url"
  local code
  code=$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
    "http://127.0.0.1:$port/s/download/apk" \
    -H 'Content-Type: application/json' -d '{}')
  if [ "$code" = "400" ]; then
    echo "  rejected with 400"
  else
    fail "$label: expected 400 for a missing url, got $code"
  fi
}

note "starting storage-temp on 7202"
nohup node lib/cli/index.js storage-temp --port 7202 \
  > "$LOG_DIR/storage-temp.log" 2>&1 &
echo $! > "$LOG_DIR/storage-temp.pid"
bash .github/scripts/wait-for-port.sh 7202 60 storage-temp

note "starting storage-plugin-apk on 7203 against storage-temp"
nohup node lib/cli/index.js storage-plugin-apk --port 7203 \
  --storage-url "http://127.0.0.1:7202/" \
  > "$LOG_DIR/apk-temp.log" 2>&1 &
echo $! > "$LOG_DIR/apk-temp.pid"
bash .github/scripts/wait-for-port.sh 7203 60 storage-plugin-apk-temp

note "starting storage-s3 on 7204"
nohup node lib/cli/index.js storage-s3 --port 7204 \
  --bucket "$BUCKET" --endpoint "$S3_ENDPOINT" --profile stfci \
  --force-path-style \
  > "$LOG_DIR/storage-s3.log" 2>&1 &
echo $! > "$LOG_DIR/storage-s3.pid"
bash .github/scripts/wait-for-port.sh 7204 60 storage-s3

note "starting storage-plugin-apk on 7205 against storage-s3"
nohup node lib/cli/index.js storage-plugin-apk --port 7205 \
  --storage-url "http://127.0.0.1:7204/" \
  > "$LOG_DIR/apk-s3.log" 2>&1 &
echo $! > "$LOG_DIR/apk-s3.pid"
bash .github/scripts/wait-for-port.sh 7205 60 storage-plugin-apk-s3

roundtrip "storage-temp" 7202 7203
roundtrip "storage-s3" 7204 7205

for p in storage-temp apk-temp storage-s3 apk-s3 apk-http; do
  if [ -f "$LOG_DIR/$p.pid" ]; then
    kill "$(cat "$LOG_DIR/$p.pid")" 2>/dev/null || true
  fi
done

echo
if [ "$failures" -gt 0 ]; then
  echo "$failures storage check(s) failed"
  exit 1
fi
echo "both storage backends round-tripped an apk"
