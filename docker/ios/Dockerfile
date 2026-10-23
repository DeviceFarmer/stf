FROM node:24-bookworm-slim
ARG TARGETARCH

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl unzip python3 python3-venv openssl \
    usbmuxd libusbmuxd-tools libimobiledevice-utils usbutils iproute2 tini \
    && rm -rf /var/lib/apt/lists/*
RUN curl -fL --retry 3 https://github.com/danielpaulus/go-ios/releases/download/v1.3.2/go-ios-linux.zip \
      -o /tmp/go-ios.zip \
    && echo 'a55fdb4c507391c0548252e01d1deb6ae3c7fd99cfbce842c6f80569cc125604  /tmp/go-ios.zip' \
      | sha256sum -c - \
    && unzip -q /tmp/go-ios.zip -d /tmp/go-ios \
    && install -m 755 /tmp/go-ios/ios-${TARGETARCH} /usr/local/bin/ios \
    && rm -rf /tmp/go-ios /tmp/go-ios.zip
RUN apt-get update && apt-get install -y --no-install-recommends gcc libc6-dev python3-dev libssl-dev \
    && python3 -m venv /opt/pymobiledevice3 \
    && /opt/pymobiledevice3/bin/pip install --no-cache-dir pymobiledevice3==11.32.0 \
    && apt-get purge -y --auto-remove gcc libc6-dev python3-dev libssl-dev \
    && rm -rf /var/lib/apt/lists/*

ENV PATH="/opt/pymobiledevice3/bin:${PATH}"
COPY tools/ios-prototype /opt/stf/tools/ios-prototype
COPY lib/util/ios-device-status.ts /opt/stf/lib/util/ios-device-status.ts
COPY lib/util/ios-config.ts /opt/stf/lib/util/ios-config.ts
WORKDIR /opt/stf
USER node
RUN ios version && iproxy --version && pymobiledevice3 version \
    && node tools/ios-prototype/main.mts --help \
    && node --test tools/ios-prototype/test/*.test.mts
ENTRYPOINT ["/usr/bin/tini", "-g", "--"]
CMD ["node", "tools/ios-prototype/main.mts", "--help"]
