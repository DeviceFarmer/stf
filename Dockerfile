#
# Copyright © 2022-2024 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
#

FROM ubuntu:22.04

# Sneak the stf executable into $PATH.
ENV PATH=/app/bin:$PATH

# Work in app dir by default.
WORKDIR /app
COPY . /tmp/build/

# Export default app port, not enough for all processes but it should do
# for now.
EXPOSE 3000

ARG TARGETARCH

RUN if [ "$TARGETARCH" = "amd64" ]; then \
    export DEBIAN_FRONTEND=noninteractive && \
    useradd --system \
      --create-home \
      --shell /usr/sbin/nologin \
      stf-build && \
    useradd --system \
      --create-home \
      --shell /usr/sbin/nologin \
      stf && \
    sed -i'' 's@http://archive.ubuntu.com/ubuntu/@mirror://mirrors.ubuntu.com/mirrors.txt@' /etc/apt/sources.list && \
    echo '--- Updating repositories' && \
    apt-get update && \
    echo '--- Upgrading repositories' && \
    apt-get -y dist-upgrade && \
    apt-get -y install wget python3 build-essential && \
    cd /tmp && \
    wget --progress=dot:mega \
      https://nodejs.org/dist/v22.11.0/node-v22.11.0-linux-x64.tar.xz && \
    tar -xJf node-v*.tar.xz --strip-components 1 -C /usr/local && \
    rm node-v*.tar.xz && \
    su stf-build -s /bin/bash -c '/usr/local/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js install' && \
    apt-get -y install --no-install-recommends libzmq3-dev libprotobuf-dev git graphicsmagick openjdk-8-jdk yasm cmake && \
    apt-get clean && \
    rm -rf /var/cache/apt/* /var/lib/apt/lists/* && \
    mkdir /tmp/bundletool && \
    cd /tmp/bundletool && \
    wget --progress=dot:mega \
      https://github.com/google/bundletool/releases/download/1.2.0/bundletool-all-1.2.0.jar && \
    mv bundletool-all-1.2.0.jar bundletool.jar && \
    mkdir -p /app && \
    chown -R stf:stf /tmp/build /tmp/bundletool /app && \
    set -x && \
    echo '--- Building app' && \
    cd /tmp/build && \
    export PATH=$PWD/node_modules/.bin:$PATH && \
    echo 'npm install --python="/usr/bin/python3" --omit=optional --loglevel http' | su stf -s /bin/bash && \
    echo '--- Assembling app' && \
    echo 'npm pack' | su stf -s /bin/bash && \
    tar xzf devicefarmer-stf-*.tgz --strip-components 1 -C /app && \
    echo '/tmp/build/node_modules/.bin/bower cache clean' | su stf -s /bin/bash && \
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
    cd /app; \
  fi
  
RUN if [ "$TARGETARCH" = "arm64" ]; then \
    export DEBIAN_FRONTEND=noninteractive && \
    echo '--- Updating repositories' && \
    apt-get update && \
    echo '--- Upgrading repositories' && \
    apt-get -y dist-upgrade && \
    echo '--- Building node' && \
    apt-get -y install pkg-config curl zip unzip wget python3 build-essential cmake ninja-build && \
    cd /tmp && \
    wget --progress=dot:mega \
      https://nodejs.org/dist/v22.11.0/node-v22.11.0-linux-arm64.tar.xz && \
    tar -xJf node-v*.tar.xz --strip-components 1 -C /usr/local && \
    rm node-v*.tar.xz && \
    useradd --system \
      --create-home \
      --shell /usr/sbin/nologin \
      stf && \
    su stf -s /bin/bash -c '/usr/local/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js install' && \
    apt-get -y install --no-install-recommends libzmq3-dev libprotobuf-dev git graphicsmagick yasm && \
    echo '--- Building app' && \
    mkdir -p /app && \
    chown -R stf:stf /tmp/build && \
    set -x && \
    cd /tmp/build && \
    export PATH=$PWD/node_modules/.bin:$PATH && \
    sed -i'' -e '/phantomjs/d' package.json && \
    export VCPKG_FORCE_SYSTEM_BINARIES="arm" && \
    echo 'npm install --save-dev pnpm' | su stf -s /bin/bash && \
    echo 'npm install --python="/usr/bin/python3" --omit=optional --loglevel http' | su stf -s /bin/bash && \
    echo '--- Assembling app' && \
    echo 'npm pack' | su stf -s /bin/bash && \
    tar xzf devicefarmer-stf-*.tgz --strip-components 1 -C /app && \
    echo '/tmp/build/node_modules/.bin/bower cache clean' | su stf -s /bin/bash && \
    echo 'npm prune --omit=dev' | su stf -s /bin/bash && \
    wget --progress=dot:mega \
      https://github.com/google/bundletool/releases/download/1.2.0/bundletool-all-1.2.0.jar && \
    mkdir -p /app/bundletool && \
    mv bundletool-all-1.2.0.jar /app/bundletool/bundletool.jar && \
    mv node_modules /app && \
    chown -R root:root /app && \
    echo '--- Cleaning up' && \
    echo 'npm cache clean --force' | su stf -s /bin/bash && \
    rm -rf ~/.node-gyp && \
    apt-get -y purge pkg-config curl zip unzip wget python3 build-essential cmake ninja-build && \
    apt-get -y clean && \
    apt-get -y autoremove && \
    cd /home/stf && \
    rm -rf vcpkg .npm .cache .cmake-ts .config .local && \
    rm -rf /var/cache/apt/* /var/lib/apt/lists/* && \
    cd /app && \
    rm -rf doc .github .tx .semaphore *.md *.yaml LICENSE Dockerfile* \
      .eslintrc .nvmrc .tool-versions res/.eslintrc && \
    rm -rf /tmp/*; \
  fi

# Switch to the app user.
USER stf

# Show help by default.
CMD ["stf", "--help"]
