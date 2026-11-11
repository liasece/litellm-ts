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

FROM node:22-bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

ARG APP_PORT=4000
ENV APP_PORT=${APP_PORT}
ENV NODE_ENV=production

WORKDIR /app

COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

COPY --from=backend-build /build/dist/ ./dist/
COPY drizzle/ ./drizzle/
COPY --from=dashboard-build /build/ui/litellm-dashboard/out/ ./ui/out/
ENV CLIPROXY_RUNTIME_ROOT=/var/lib/litellm/cliproxy

RUN node -e "const { readMigrationFiles } = require('drizzle-orm/migrator'); const migrations = readMigrationFiles({ migrationsFolder: '/app/drizzle' }); if (migrations.length === 0) throw new Error('Drizzle migrations are missing from runtime image');" \
    && test -s /app/ui/out/index.html

EXPOSE ${APP_PORT}

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -fsS -o /dev/null http://127.0.0.1:${APP_PORT}/health/liveliness || exit 1

CMD ["node", "dist/main.js"]
