#!/usr/bin/env bash
#
# Record a single CI verdict as JSON so the report job can aggregate it.
#
# usage: verdict.sh <id> <label> <github-outcome> [details]
#
# Optional environment:
#   VERDICT_OUT    output path (default: verdict.json)
#   VERDICT_EXTRA  JSON object merged into the verdict (e.g. layered checks)
#   VERDICT_GROUP  logical grouping shown in the report table
#
set -euo pipefail

if [ "$#" -lt 3 ]; then
  echo "usage: verdict.sh <id> <label> <outcome> [details]" >&2
  exit 2
fi

VERDICT_ID="$1"
VERDICT_LABEL="$2"
VERDICT_OUTCOME="$3"
VERDICT_DETAILS="${4:-}"
VERDICT_OUT="${VERDICT_OUT:-verdict.json}"

export VERDICT_ID VERDICT_LABEL VERDICT_OUTCOME VERDICT_DETAILS VERDICT_OUT
export VERDICT_EXTRA="${VERDICT_EXTRA:-{\}}"
export VERDICT_GROUP="${VERDICT_GROUP:-}"

node -e '
var fs = require("fs")

var map = {
  success: "pass"
, failure: "fail"
, cancelled: "cancel"
, skipped: "skip"
, pass: "pass"
, fail: "fail"
, skip: "skip"
}

var outcome = String(process.env.VERDICT_OUTCOME || "").toLowerCase()
var extra = {}
try {
  extra = JSON.parse(process.env.VERDICT_EXTRA || "{}")
}
catch (e) {
  extra = {parse_error: String(e.message)}
}

var verdict = {
  id: process.env.VERDICT_ID
, label: process.env.VERDICT_LABEL
, group: process.env.VERDICT_GROUP || ""
, status: map[outcome] || "fail"
, raw_outcome: outcome
, details: process.env.VERDICT_DETAILS || ""
, run_attempt: process.env.GITHUB_RUN_ATTEMPT || ""
}

Object.keys(extra).forEach(function(key) {
  verdict[key] = extra[key]
})

fs.writeFileSync(process.env.VERDICT_OUT, JSON.stringify(verdict, null, 2) + "\n")
console.log(JSON.stringify(verdict))
'
