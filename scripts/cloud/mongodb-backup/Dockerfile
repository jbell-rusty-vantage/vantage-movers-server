FROM node:22.18.0-bookworm-slim

# Official MongoDB Database Tools 100.17.0 for Debian 12 x86_64.
# SHA-256 was computed from the official fastdl.mongodb.org artifact
# (MongoDB does not publish a sidecar .sha256 for this tools tarball).
ARG MONGO_TOOLS_VERSION=100.17.0
ARG MONGO_TOOLS_SHA256=15b3562b13ff9aac3baa2594c705ea0ac3597f4b85c7653f17efcd36e8588678
ARG MONGO_TOOLS_URL=https://fastdl.mongodb.org/tools/db/mongodb-database-tools-debian12-x86_64-100.17.0.tgz

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl libgssapi-krb5-2 \
  && curl -fsSL -o /tmp/mongodb-database-tools.tgz "${MONGO_TOOLS_URL}" \
  && echo "${MONGO_TOOLS_SHA256}  /tmp/mongodb-database-tools.tgz" | sha256sum -c - \
  && tar -xzf /tmp/mongodb-database-tools.tgz -C /tmp \
  && mv /tmp/mongodb-database-tools-debian12-x86_64-${MONGO_TOOLS_VERSION}/bin/mongodump /usr/local/bin/mongodump \
  && rm -rf /tmp/mongodb-database-tools.tgz /tmp/mongodb-database-tools-debian12-x86_64-${MONGO_TOOLS_VERSION} \
  && apt-get purge -y curl \
  && rm -rf /var/lib/apt/lists/* \
  && mongodump --version

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY backup.mjs ./

USER node

ENTRYPOINT ["node", "backup.mjs"]
