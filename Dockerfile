# syntax=docker/dockerfile:1
#
# Copyright © 2022-2024 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
#

ARG UBUNTU_IMAGE=ubuntu:22.04@sha256:076e7bf82319619f28dd0aa9c02ab34b055ad37100395b4f49a2ffba04fb5e11

FROM ${UBUNTU_IMAGE} AS node-base
ARG TARGETARCH
ARG NODE_VERSION=22.23.4
RUN set -eu; \
    export DEBIAN_FRONTEND=noninteractive; \
    apt-get update; \
    apt-get -y dist-upgrade; \
    apt-get install -y --no-install-recommends ca-certificates curl xz-utils libstdc++6 libatomic1; \
    case "$TARGETARCH" in \
      amd64) node_arch=x64; stf_uid=998;; \
      arm64) node_arch=arm64; stf_uid=999;; \
      *) echo "Unsupported target architecture: $TARGETARCH" >&2; exit 1;; \
    esac; \
    cd /tmp; \
    curl -fsSLO --retry 3 "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz"; \
    curl -fsSLO --retry 3 "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt"; \
    grep " node-v${NODE_VERSION}-linux-${node_arch}.tar.xz$" SHASUMS256.txt | sha256sum -c -; \
    tar -xJf "node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" --strip-components=1 -C /usr/local; \
    rm "node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" SHASUMS256.txt; \
    groupadd --system --gid "$stf_uid" stf; \
    useradd --system --uid "$stf_uid" --gid stf --create-home --shell /usr/sbin/nologin stf; \
    node --version; \
    npm --version; \
    apt-get clean; \
    rm -rf /var/lib/apt/lists/*

FROM node-base AS dependencies
RUN export DEBIAN_FRONTEND=noninteractive \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
      python3 build-essential pkg-config cmake ninja-build git \
      libzmq3-dev libprotobuf-dev graphicsmagick yasm nasm \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /build
RUN chown stf:stf /build
USER stf
# A root lockfile is optional. Keep npm install's existing prepare behavior;
# npm pack builds the application after its sources have been copied.
COPY --chown=stf:stf package*.json ./
RUN npm install --omit=optional --no-audit --no-fund

FROM dependencies AS production-dependencies
RUN npm prune --omit=dev --no-audit --no-fund

FROM dependencies AS build
COPY --chown=stf:stf . .
RUN npm pack --quiet > /tmp/package-name \
    && mkdir /tmp/app \
    && tar -xzf "$(tail -n 1 /tmp/package-name)" --no-same-owner --strip-components=1 -C /tmp/app \
    && cd /tmp/app \
    && rm -rf doc .github .tx .semaphore *.md *.yaml Dockerfile* \
      .eslintrc .nvmrc .tool-versions res/.eslintrc \
    && test -s LICENSE

FROM node-base AS bundletool
ARG BUNDLETOOL_VERSION=1.2.0
ARG BUNDLETOOL_SHA256=25ef168c6f9a14acd3113d4cffb3efde7ed8c94eeac50e4203be7a71cf1ca837
RUN mkdir -p /opt/bundletool \
    && curl -fsSL --retry 3 \
      "https://github.com/google/bundletool/releases/download/${BUNDLETOOL_VERSION}/bundletool-all-${BUNDLETOOL_VERSION}.jar" \
      -o /opt/bundletool/bundletool.jar \
    && echo "${BUNDLETOOL_SHA256}  /opt/bundletool/bundletool.jar" | sha256sum -c -

FROM node-base AS runtime-base
RUN export DEBIAN_FRONTEND=noninteractive \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
      graphicsmagick openjdk-8-jre-headless libzmq5 libprotobuf23 \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app \
    && chown stf:stf /app
ENV PATH=/app/bin:$PATH
WORKDIR /app
EXPOSE 3000
USER stf
CMD ["stf", "--help"]

FROM runtime-base AS runtime
COPY --from=production-dependencies --chown=stf:stf /build/node_modules/ /app/node_modules/
COPY --from=bundletool --chown=stf:stf /opt/bundletool/ /app/bundletool/
COPY --from=build --chown=stf:stf /tmp/app/ /app/
