FROM ubuntu:18.04 AS nodebase

# Install base packages
RUN export DEBIAN_FRONTEND=noninteractive && \
    apt-get update && \
    apt-get -y --no-install-recommends install curl wget libxml-bare-perl libzmq3-dev libprotobuf-dev graphicsmagick ca-certificates openjdk-8-jdk

# Install node
RUN export DEBIAN_FRONTEND=noninteractive && \
    curl -sL -o /tmp/install_node.sh https://deb.nodesource.com/setup_8.x && \
    /bin/bash /tmp/install_node.sh && \
    apt install --no-install-recommends -y nodejs

RUN useradd --system --create-home --shell /usr/sbin/nologin stf

FROM nodebase as with_packages

# Install additional packages for building things
RUN export DEBIAN_FRONTEND=noninteractive && \
    apt-get -y --no-install-recommends install build-essential git yasm jq python vim

# Install node-gyp ahead of time to avoid installation on native module install
# RUN /bin/bash -c '/usr/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js install'

# Install just the package dependencies before copying in the full source
RUN mkdir -p /tmp/build/res/build
COPY ./package*.json /tmp/build/
WORKDIR /tmp/build
RUN set -x && \
    export PATH=$PWD/node_modules/.bin:$PATH && \
    npm install --loglevel http && \
    curl -sf https://gobinaries.com/tj/node-prune | sh

wget --progress=dot:mega \
	https://github.com/google/bundletool/releases/download/1.2.0/bundletool-all-1.2.0.jar \
	-O /tmp/bundletool.jar

# ********* FRONTEND **********
    
FROM with_packages as frontend

# Install bower dependencies
WORKDIR /tmp/build
COPY ./bower.json /tmp/build/
COPY ./.bowerrc /tmp/build/
RUN mkdir bower_modules && \
    ./node_modules/.bin/bower install

# Copy the app ( res ) in
COPY ./bower.json /tmp/build/
COPY ./gulpfile.js /tmp/build/
COPY ./webpack.config.js /tmp/build/
COPY ./res /tmp/build/res
COPY ./lib/util /tmp/build/lib/util

RUN ./node_modules/.bin/gulp build

# ********* BACKEND **********

FROM with_packages as backend

COPY ./lib /tmp/build/lib

# Package and cleanup
WORKDIR /tmp/build
RUN npm pack 2>&1 | grep -v "npm notice [1-9]" && \
    mv devicefarmer-stf-$(jq .version package.json -j).tgz stf.tgz

#npm prune --production && \
#    node-prune && \

FROM alpine as app

RUN mkdir -p /app
COPY --from=backend /tmp/build/stf.tgz /tmp/stf.tgz
RUN tar xf /tmp/stf.tgz --strip-components 1 -C /app

# ********* RUNTIME **********

FROM nodebase as runtime

EXPOSE 3000

# Setup user
RUN mkdir -p /app/res && mkdir -p /app/bundletool && chown stf:stf /app && chown stf:stf /app/*

WORKDIR /app

# Copy in node_modules and prune them
COPY --from=with_packages --chown=stf:stf /tmp/build/node_modules /app/node_modules
COPY --from=with_packages --chown=stf:stf /tmp/build/package.json /app/package.json
RUN npm prune --production

# Copy in resources needed by backend
COPY --chown=stf:stf ./res/common /app/res/common
COPY --chown=stf:stf ./res/app/views /app/res/app/views
COPY --chown=stf:stf ./res/auth/mock/views /app/res/auth/mock/views

# Copy in the backend
COPY --from=app --chown=stf:stf /app /app

# Copy in the frontend
COPY --from=frontend --chown=stf:stf /tmp/build/res/build /app/res/build

# Copy in bundletool
COPY --from=with_packages --chown=stf:stf /tmp/bundletool.jar /app/bundletool/bundletool.jar

COPY ./webpackserver.config.js /app/

#USER root
#RUN apt-get -y --no-install-recommends install ncdu

# Add stf executable dir into $PATH
ENV PATH /app/bin:$PATH
    
# Show help by default.
CMD stf --help
