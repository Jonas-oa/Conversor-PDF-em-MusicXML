FROM node:22-bookworm-slim

ARG AUDIVERIS_VERSION=5.11.0
ARG AUDIVERIS_DEB_SHA256=ae714594f40e54b1a4951fc3f914f08ae38fe5d07b7f2283b1a904fdb6e0a318

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl tesseract-ocr tesseract-ocr-eng \
    && curl -fsSL -o /tmp/audiveris.deb \
      "https://github.com/Audiveris/audiveris/releases/download/${AUDIVERIS_VERSION}/Audiveris-${AUDIVERIS_VERSION}-ubuntu22.04-x86_64.deb" \
    && echo "${AUDIVERIS_DEB_SHA256}  /tmp/audiveris.deb" | sha256sum -c - \
    && apt-get install -y --no-install-recommends /tmp/audiveris.deb \
    && rm -f /tmp/audiveris.deb \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY LICENSE README.md ./
RUN mkdir -p /data && chown -R node:node /app /data

ENV NODE_ENV=production \
    PORT=8081 \
    OMR_DATA_DIR=/data \
    AUDIVERIS_COMMAND=/opt/audiveris/bin/Audiveris \
    AUDIVERIS_VERSION=${AUDIVERIS_VERSION}

VOLUME ["/data"]
EXPOSE 8081
USER node
CMD ["node", "src/start.mjs"]
