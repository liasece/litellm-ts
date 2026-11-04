# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS backend-build

WORKDIR /build

COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:22-alpine AS dashboard-build

WORKDIR /build/ui/litellm-dashboard

COPY ui/litellm-dashboard/package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY ui/litellm-dashboard/ ./
COPY src/shared/ ./../../src/shared/
RUN npm run build

FROM golang:1.26-bookworm AS commandcode-plugin-build

# The CommandCode plugin is vendored under plugins/commandcode-go-cliproxyapi and
# built from that source instead of a published release: our fork carries fixes
# upstream does not ship (Responses namespace tool flattening). Build it against
# the runtime's glibc ABI - the plugin is loaded through cgo/dlopen, so a musl
# build would crash at load time.
ARG TARGETARCH
WORKDIR /src

COPY plugins/commandcode-go-cliproxyapi/ ./
RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg/mod \
    set -eu; \
    case "${TARGETARCH:-amd64}" in \
      amd64) goarch=amd64 ;; \
      arm64) goarch=arm64 ;; \
      *) echo "Unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    go test ./internal/... 2>&1 | tail -5; \
    CGO_ENABLED=1 GOOS=linux GOARCH="${goarch}" \
      go build -trimpath -buildmode=c-shared -ldflags "-s -w" \
      -o /out/commandcode-go-cliproxyapi.so . ; \
    rm -f /out/commandcode-go-cliproxyapi.h; \
    test -s /out/commandcode-go-cliproxyapi.so

FROM alpine:3.22 AS cliproxy-download

ARG TARGETARCH
ARG CLIPROXY_VERSION=8.0.47
ARG OPENCODE_GO_PLUGIN_VERSION=0.2.2
WORKDIR /download
RUN set -eu; \
    case "${TARGETARCH:-amd64}" in \
      amd64) cliproxy_arch=amd64; plugin_arch=amd64 ;; \
      arm64) cliproxy_arch=aarch64; plugin_arch=arm64 ;; \
      *) echo "Unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    archive="CLIProxyAPI_${CLIPROXY_VERSION}_linux_${cliproxy_arch}.tar.gz"; \
    base="https://github.com/router-for-me/CLIProxyAPI/releases/download/v${CLIPROXY_VERSION}"; \
    wget -q "${base}/checksums.txt" -O checksums.txt; \
    wget -q "${base}/${archive}" -O "${archive}"; \
    expected="$(awk -v name="${archive}" '$2 == name { print $1 }' checksums.txt)"; \
    test -n "${expected}"; \
    echo "${expected}  ${archive}" | sha256sum -c -; \
    tar -xzf "${archive}" cli-proxy-api; \
    chmod 0755 cli-proxy-api; \
    plugin_archive="opencode-go-cliproxyapi_${OPENCODE_GO_PLUGIN_VERSION}_linux_${plugin_arch}.zip"; \
    plugin_base="https://github.com/massiveits/opencode-go-cliproxyapi/releases/download/v${OPENCODE_GO_PLUGIN_VERSION}"; \
    wget -q "${plugin_base}/checksums.txt" -O plugin-checksums.txt; \
    wget -q "${plugin_base}/${plugin_archive}" -O "${plugin_archive}"; \
    plugin_expected="$(awk -v name="${plugin_archive}" '$2 == name { print $1 }' plugin-checksums.txt)"; \
    test -n "${plugin_expected}"; \
    echo "${plugin_expected}  ${plugin_archive}" | sha256sum -c -; \
    mkdir -p plugins; \
    unzip -q -o "${plugin_archive}" -d plugins

FROM node:22-bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

ARG APP_PORT=4000
ARG CLIPROXY_VERSION=8.0.47
ENV APP_PORT=${APP_PORT}
ENV NODE_ENV=production

WORKDIR /app

COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

COPY --from=backend-build /build/dist/ ./dist/
COPY drizzle/ ./drizzle/
COPY --from=dashboard-build /build/ui/litellm-dashboard/out/ ./ui/out/
COPY --from=cliproxy-download /download/cli-proxy-api /opt/cliproxy/cli-proxy-api
COPY --from=cliproxy-download /download/plugins/opencode-go-cliproxyapi.so /opt/cliproxy/plugins/opencode-go-cliproxyapi.so
COPY --from=commandcode-plugin-build /out/commandcode-go-cliproxyapi.so /opt/cliproxy/plugins/commandcode-go-cliproxyapi.so

ENV CLIPROXY_PLUGIN_DIR=/opt/cliproxy/plugins
ENV CLIPROXY_BOOTSTRAP_BINARY=/opt/cliproxy/cli-proxy-api
ENV CLIPROXY_BOOTSTRAP_VERSION=${CLIPROXY_VERSION}
ENV CLIPROXY_RUNTIME_ROOT=/var/lib/litellm/cliproxy

RUN node -e "const { readMigrationFiles } = require('drizzle-orm/migrator'); const migrations = readMigrationFiles({ migrationsFolder: '/app/drizzle' }); if (migrations.length === 0) throw new Error('Drizzle migrations are missing from runtime image');" \
    && test -s /app/ui/out/index.html

EXPOSE ${APP_PORT}

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -fsS -o /dev/null http://127.0.0.1:${APP_PORT}/health/liveliness || exit 1

CMD ["node", "dist/main.js"]
