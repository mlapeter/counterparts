# syntax=docker/dockerfile:1
#
# FOR DIRECTORY CHECKS, NOT AN INSTALL PATH. MCP directories (Glama, glama.ai)
# build a server's image and run it to see that it starts and lists its tools.
# This image does exactly that: Counterparts' MCP server over stdio, against an
# EMPTY memory created inside the container. It has no hooks, no host and no
# memory worth keeping. To use Counterparts, install it from npm (README).
#
#   docker build -t counterparts-mcp-check .
#   docker run -i --rm counterparts-mcp-check
#
# Same runtime and lockfile as the package (bun, bun.lock), the base pinned by
# tag and digest (the same pin as hosted/Dockerfile). Every directory is named
# explicitly, so nothing falls back to ~/.counterparts, and the daily npm update
# check is off: the server makes no network call of its own here.
#
# Glama's own check may build from a form on its admin page rather than from
# this file; the same start under Node is
#   npm install --omit=dev --ignore-scripts
#   env COUNTERPARTS_UPDATE_CHECK=off COUNTERPARTS_DATA_DIR=/tmp/counterparts/store \
#     node src/adapters/mcp/bin/serve.mjs
FROM oven/bun:1.3.10-slim@sha256:5d5863f35ad9b3acceee8dc134fb2b89f07831129eaeec81af2b19a23dabe3e0
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts
COPY src/ src/
COPY docs/manual.md docs/manual.md

# The host configuration the server reads, named below and written here, so the
# explicit-dir guard has nothing to refuse: it names the store and nothing else.
RUN mkdir -p /data \
 && printf '{ "dataDir": "/data/store" }\n' > /data/claude-code.json \
 && chown -R bun:bun /data
USER bun
ENV COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1 \
    COUNTERPARTS_DATA_DIR=/data/store \
    COUNTERPARTS_CONFIG=/data/claude-code.json \
    COUNTERPARTS_UPDATE_CHECK=off

# The package's own `counterparts-mcp` bin (package.json#bin), as an install runs it.
ENTRYPOINT ["/app/src/adapters/mcp/bin/serve.mjs"]
