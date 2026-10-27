# syntax=docker/dockerfile:1
#
# THE HOSTED SERVER'S IMAGE (OL2b). Node 24 (production's runtime: oidc-provider's
# SSRF guard for the CIMD fetch arms on Node, not on bun) plus the Litestream
# sidecar, pinned by version AND sha256. Build from the repository root:
#
#   docker build -f hosted/Dockerfile -t counterparts-hosted .
#
# Every base image is pinned by tag and digest; Litestream by version and the
# checksums its release publishes (checksums.txt, cross-checked against
# GitHub's own asset digests on 2026-10-26). Bumping any of them is a review
# event: read the changelog, update the pins together, run the restore drill.

# ── dependencies, installed by bun from the two lockfiles ────────────────────
FROM oven/bun:1.3.10-slim@sha256:5d5863f35ad9b3acceee8dc134fb2b89f07831129eaeec81af2b19a23dabe3e0 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY hosted/package.json hosted/bun.lock hosted/
RUN bun install --frozen-lockfile --production --ignore-scripts \
 && bun install --cwd hosted --frozen-lockfile --production --ignore-scripts

# ── Litestream, checked ─────────────────────────────────────────────────────
FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS litestream
ARG TARGETARCH
ARG LITESTREAM_VERSION=0.5.17
ARG LITESTREAM_SHA256_AMD64=cfb371176d164437ae869f8351cfde49bd1804ae71c61923f75c9cba9c9c006d
ARG LITESTREAM_SHA256_ARM64=f8ca4a050095c1efbda2c4365172e61bf9d955ea0d9ac42f448b52e51819baa5
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
RUN set -eu; \
    case "${TARGETARCH:-amd64}" in \
      amd64) arch=x86_64; sum="$LITESTREAM_SHA256_AMD64" ;; \
      arm64) arch=arm64; sum="$LITESTREAM_SHA256_ARM64" ;; \
      *) echo "no pinned Litestream for $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    file="litestream-${LITESTREAM_VERSION}-linux-${arch}.tar.gz"; \
    curl -fsSL -o "/tmp/$file" "https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/$file"; \
    echo "$sum  /tmp/$file" | sha256sum -c -; \
    mkdir /tmp/ls && tar -xzf "/tmp/$file" -C /tmp/ls; \
    install -m 0755 "$(find /tmp/ls -type f -name litestream | head -n 1)" /usr/local/bin/litestream; \
    /usr/local/bin/litestream version

# ── the server ──────────────────────────────────────────────────────────────
FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205
ENV NODE_ENV=production \
    LITESTREAM_BIN=/usr/local/bin/litestream \
    PORT=8080
WORKDIR /app
COPY --from=litestream /usr/local/bin/litestream /usr/local/bin/litestream
COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/hosted/node_modules hosted/node_modules
COPY package.json ./
COPY src src
COPY hosted/package.json hosted/
COPY hosted/src hosted/src
# Not root. A volume the platform mounts root-owned needs its own answer
# (docs/hosted/RUNBOOK.md, step 2).
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
ENTRYPOINT ["node", "--import", "./src/adapters/node-hooks.mjs", "hosted/src/main.ts"]
CMD ["serve"]
