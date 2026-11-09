#!/usr/bin/env bash
set -euo pipefail

digest_dir=$1
image=$2
tag=$3

shopt -s nullglob dotglob
sources=()
for arch in amd64 arm64; do
  files=("$digest_dir/digest-$arch/"*)
  if (( ${#files[@]} != 1 )) || [[ ! -f "${files[0]}" ]]; then
    echo "Expected exactly one verified digest file for linux/$arch" >&2
    exit 1
  fi
  digest=${files[0]##*/}
  if [[ ! "$digest" =~ ^[0-9a-f]{64}$ ]]; then
    echo "Invalid digest for linux/$arch" >&2
    exit 1
  fi
  sources+=("$image@sha256:$digest")
done

if [[ "${sources[0]}" == "${sources[1]}" ]]; then
  echo 'Expected distinct digests for linux/amd64 and linux/arm64' >&2
  exit 1
fi

docker buildx imagetools create -t "$image:$tag" "${sources[@]}"
docker buildx imagetools inspect "$image:$tag"
