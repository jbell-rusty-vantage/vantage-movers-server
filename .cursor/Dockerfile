# Cursor Cloud Agent base image for vantage_movers_server.
#
# Provides the system-level dependencies the dev environment needs:
#   - Node.js 22 + pnpm (pinned via corepack to the repo's packageManager)
#   - MongoDB 8.0 server + shell (run locally as a single-node replica set;
#     the API's write paths use multi-document transactions, which require a
#     replica set rather than a standalone mongod)
#   - git / build tooling expected by the agent runtime
#
# NOTE: Do not COPY the repository here. Cursor checks out the workspace and
# runs `install` (pnpm install) on each agent start; this image only supplies
# the OS-level toolchain.

FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_MAJOR=22

# Base OS tooling. The ubuntu:24.04 image already ships a non-root `ubuntu`
# user (uid 1000); we reuse it as the agent user.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        gnupg \
        git \
        sudo \
        procps \
        build-essential \
        python3 \
    && rm -rf /var/lib/apt/lists/*

# Node.js 22 (NodeSource) + corepack-managed pnpm.
RUN curl --retry 3 --retry-delay 5 -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable \
    && corepack prepare pnpm@10.13.1 --activate

# MongoDB 8.0 community server + mongosh.
RUN curl --retry 3 --retry-delay 5 -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc \
        | gpg --dearmor -o /usr/share/keyrings/mongodb-server-8.0.gpg \
    && echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/8.0 multiverse" \
        > /etc/apt/sources.list.d/mongodb-org-8.0.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends mongodb-org \
    && rm -rf /var/lib/apt/lists/*

# Local MongoDB data directory (outside the workspace), owned by the agent user.
RUN mkdir -p /home/ubuntu/.local-mongo/data \
    && chown -R ubuntu:ubuntu /home/ubuntu/.local-mongo

# Allow the agent user to manage packages/services if needed.
RUN echo "ubuntu ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/ubuntu \
    && chmod 0440 /etc/sudoers.d/ubuntu

USER ubuntu
WORKDIR /home/ubuntu
