# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS ui-builder

WORKDIR /app/ui

COPY ui/litellm-dashboard/package.json ui/litellm-dashboard/package-lock.json ./
RUN npm ci
COPY ui/litellm-dashboard/ ./
RUN npm run build && test -s /app/ui/out/index.html

FROM node:22-alpine

ARG APP_PORT=4000
ENV APP_PORT=${APP_PORT}

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY dist/ ./dist/
COPY drizzle/ ./drizzle/
COPY --from=ui-builder /app/ui/out ./ui/out

RUN node -e "const { readMigrationFiles } = require('drizzle-orm/migrator'); const migrations = readMigrationFiles({ migrationsFolder: '/app/drizzle' }); if (migrations.length === 0) throw new Error('Drizzle migrations are missing from runtime image');" \
    && test -s /app/ui/out/index.html

EXPOSE ${APP_PORT}

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:${APP_PORT}/health/liveliness || exit 1

CMD ["node", "dist/main.js"]
