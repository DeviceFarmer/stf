#
# Copyright © 2022-2024 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
#

FROM node:22.14-alpine3.20

# Sneak the stf executable into $PATH.
ENV PATH=/app/bin:$PATH

# Work in app dir by default.
WORKDIR /app
COPY . /tmp/build/

# Export default app port, not enough for all processes but it should do
# for now.
EXPOSE 3000

ARG TARGETARCH

RUN apk update && \
    apk upgrade && \ 
    apk add zeromq-dev musl-dev protobuf-dev git graphicsmagick yasm ninja g++ git wget python3 cmake make curl unzip zip coreutils shadow && \
    adduser -D -h /home/stf -s /sbin/nologin stf && \
    mkdir -p /home/stf && \
    chown stf:stf /home/stf && \
    mkdir -p /tmp/bundletool && \
    cd /tmp/bundletool && \
    wget --progress=dot:mega \
      https://github.com/google/bundletool/releases/download/1.2.0/bundletool-all-1.2.0.jar && \
    mv bundletool-all-1.2.0.jar bundletool.jar && \
    mkdir -p /app && \
    chown -R stf:stf /tmp/build /tmp/bundletool /app && \
    set -x && \
    echo '--- Building app' && \   
    cd /tmp/build && \
    if [ "$TARGETARCH" = "arm64" ]; then sed -i'' -e '/phantomjs/d' package.json ; fi && \
    if [ "$TARGETARCH" = "arm64" ]; then export VCPKG_FORCE_SYSTEM_BINARIES="arm"; fi && \        
    export PATH=$PWD/node_modules/.bin:$PATH && \
    echo 'npm install --python="/usr/bin/python3" --omit=optional --loglevel http' | su stf -s /bin/sh && \
    echo '--- Assembling app' && \
    echo 'npm pack' | su stf -s /bin/sh && \
    tar xzf devicefarmer-stf-*.tgz --strip-components 1 -C /app && \
    echo '/tmp/build/node_modules/.bin/bower cache clean' | su stf -s /bin/sh && \
    npm prune --omit=dev && \
    mv node_modules /app && \
    rm -rf ~/.node-gyp && \
    mkdir /app/bundletool && \
    mv /tmp/bundletool/* /app/bundletool && \
    cd /app && \
    find /tmp -mindepth 1 ! -regex '^/tmp/hsperfdata_root\(/.*\)?' -delete && \
    rm -rf doc .github .tx .semaphore *.md *.yaml LICENSE Dockerfile* \
      .eslintrc .nvmrc .tool-versions res/.eslintrc && \
    cd && \
    rm -rf .npm .cache .config .local && \
    apk add libc6-compat && \
    cd /app

# Switch to the app user.
USER stf

# Show help by default.
CMD ["stf", "--help"]
