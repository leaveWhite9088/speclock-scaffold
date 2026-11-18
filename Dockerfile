# Stage 1: Build web frontend static bundle (build tools stay here, never enter runtime image)
FROM node:22-alpine AS web-builder
WORKDIR /build

COPY package.json package-lock.json ./
COPY packages/agentd/package.json packages/agentd/
COPY packages/backend/package.json packages/backend/
COPY packages/drivers/package.json packages/drivers/
COPY packages/preflight/package.json packages/preflight/
COPY packages/web/package.json packages/web/

RUN npm ci

COPY packages/web/ packages/web/
RUN npm --prefix packages/web run build

# Stage 2: Minimal runtime image (no frontend source, no Vite/TS build toolchain, no secrets)
FROM node:22-alpine AS runtime
ARG GIT_SHA=dev
LABEL org.opencontainers.image.title="speclock-scaffold" \
      org.opencontainers.image.revision="${GIT_SHA}"

ENV NODE_ENV=production \
    APP_GIT_SHA="${GIT_SHA}" \
    AGENTD_DATA_DIR=/data \
    AGENTD_PORT=9787 \
    BACKEND_HOST=0.0.0.0 \
    BACKEND_PORT=8787 \
    SERVE_WEB_DIST=1

WORKDIR /app

COPY package.json ./
COPY packages/drivers/ packages/drivers/
COPY packages/preflight/ packages/preflight/
COPY packages/agentd/ packages/agentd/
COPY packages/backend/ packages/backend/
COPY --from=web-builder /build/packages/web/dist/ packages/web/dist/

# Wire workspace symlinks (runtime packages have zero external npm dependencies) and prepare data dir
RUN mkdir -p /app/node_modules/@speclock-scaffold /data /run/speclock && \
    ln -s /app/packages/drivers /app/node_modules/@speclock-scaffold/drivers && \
    ln -s /app/packages/preflight /app/node_modules/@speclock-scaffold/preflight && \
    ln -s /app/packages/agentd /app/node_modules/@speclock-scaffold/agentd && \
    ln -s /app/packages/backend /app/node_modules/@speclock-scaffold/backend && \
    chown -R node:node /app /data /run/speclock

USER node
EXPOSE 8787

HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.BACKEND_PORT || 8787) + '/api/health').then(r => process.exit(r.status === 200 ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "packages/backend/src/server.mjs"]
