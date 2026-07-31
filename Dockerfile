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
RUN npm run build

FROM alpine:3.22 AS cliproxy-download

ARG TARGETARCH
ARG CLIPROXY_VERSION=7.2.110
WORKDIR /download
RUN set -eu; \
    case "${TARGETARCH:-amd64}" in \
      amd64) cliproxy_arch=amd64 ;; \
      arm64) cliproxy_arch=aarch64 ;; \
      *) echo "Unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    archive="CLIProxyAPI_${CLIPROXY_VERSION}_linux_${cliproxy_arch}_no-plugin.tar.gz"; \
    base="https://github.com/router-for-me/CLIProxyAPI/releases/download/v${CLIPROXY_VERSION}"; \
    wget -q "${base}/checksums.txt" -O checksums.txt; \
    wget -q "${base}/${archive}" -O "${archive}"; \
    expected="$(awk -v name="${archive}" '$2 == name { print $1 }' checksums.txt)"; \
    test -n "${expected}"; \
    echo "${expected}  ${archive}" | sha256sum -c -; \
    tar -xzf "${archive}" cli-proxy-api; \
    chmod 0755 cli-proxy-api

FROM node:22-alpine AS runtime

ARG APP_PORT=4000
ARG CLIPROXY_VERSION=7.2.110
ENV APP_PORT=${APP_PORT}
ENV NODE_ENV=production

WORKDIR /app

COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

COPY --from=backend-build /build/dist/ ./dist/
COPY drizzle/ ./drizzle/
COPY --from=dashboard-build /build/ui/litellm-dashboard/out/ ./ui/out/
COPY --from=cliproxy-download /download/cli-proxy-api /opt/cliproxy/cli-proxy-api

ENV CLIPROXY_BOOTSTRAP_BINARY=/opt/cliproxy/cli-proxy-api
ENV CLIPROXY_BOOTSTRAP_VERSION=${CLIPROXY_VERSION}
ENV CLIPROXY_RUNTIME_ROOT=/var/lib/litellm/cliproxy

RUN node -e "const { readMigrationFiles } = require('drizzle-orm/migrator'); const migrations = readMigrationFiles({ migrationsFolder: '/app/drizzle' }); if (migrations.length === 0) throw new Error('Drizzle migrations are missing from runtime image');" \
    && test -s /app/ui/out/index.html

EXPOSE ${APP_PORT}

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:${APP_PORT}/health/liveliness || exit 1

CMD ["node", "dist/main.js"]
