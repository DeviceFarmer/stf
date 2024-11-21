#
# Copyright © 2022-2024 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
#

FROM ubuntu:22.04

# Sneak the stf executable into $PATH.
ENV PATH=/app/bin:$PATH

# Work in app dir by default.
WORKDIR /app

# Export default app port, not enough for all processes but it should do
# for now.
EXPOSE 3000

# Install app requirements. Trying to optimize push speed for dependant apps
# by reducing layers as much as possible. Note that one of the final steps
# installs development files for node-gyp so that npm install won't have to
# wait for them on the first native module installation.
RUN export DEBIAN_FRONTEND=noninteractive && \
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
    mv bundletool-all-1.2.0.jar bundletool.jar

# Copy app source.
COPY . /tmp/build/

# Give permissions to our build user.
RUN mkdir -p /app && \
    chown -R stf-build:stf-build /tmp/build /tmp/bundletool /app

# Switch over to the build user.
USER stf-build

# Run the build.
RUN set -x && \
    echo '--- Building app' && \
    cd /tmp/build && \
    export PATH=$PWD/node_modules/.bin:$PATH && \
    npm install --python="/usr/bin/python3" --omit=optional --loglevel http && \
    echo '--- Assembling app' && \
    npm pack && \
    tar xzf devicefarmer-stf-*.tgz --strip-components 1 -C /app && \
    bower cache clean && \
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
    cd /app

# Switch to the app user.
USER stf

# Show help by default.
CMD ["stf", "--help"]
